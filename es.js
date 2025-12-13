var express = require('express');
var passport = require('passport');
var GoogleStrategy = require('passport-google-oauth20').Strategy;
var jwt = require('jsonwebtoken');
var multer = require('multer');
var axios = require('axios');
var cheerio = require('cheerio');
var PdfReader = require('pdfreader').PdfReader;
var google = require('googleapis');
var GoogleGenerativeAI = require('@google/generative-ai').GoogleGenerativeAI;

var User = require("./models/User.js");
var dbConnect = require('./db/connect.js');
var appConfig = require('../config/app.js');

var router = express.Router();

/* ==============================
   CONFIG
================================ */
var GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
var GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
var GOOGLE_CALLBACK_URL = 'http://localhost:3000/auth/google/callback';
var GEMINI_API_KEY = process.env.GEMINI_API_KEY;
var JWT_SECRET = appConfig.JWT_SECRET;
var FRONTEND_URL = appConfig.FRONTEND_URL;
var client = dbConnect.client;

/* ==============================
   MULTER
================================ */
var upload = multer({ storage: multer.memoryStorage() });

/* ==============================
   GOOGLE OAUTH STRATEGY
================================ */
passport.use(
  new GoogleStrategy(
    {
      clientID: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      callbackURL: GOOGLE_CALLBACK_URL,
      passReqToCallback: true
    },
    function(req, accessToken, refreshToken, profile, done) {
      var self = this;
      
      User.findOne({ googleId: profile.id })
        .then(function(user) {
          if (user) return user;
          return User.findOne({ email: profile.emails[0].value });
        })
        .then(function(user) {
          var grantedScopes = (req && req.query && req.query.scope) ? 
            req.query.scope.split(' ') : [];

          if (!user) {
            return User.create({
              googleId: profile.id,
              email: profile.emails[0].value,
              name: profile.displayName,
              accessToken: accessToken,
              refreshToken: refreshToken,
              googleGrantedScopes: grantedScopes
            });
          } else {
            user.googleId = profile.id;
            user.accessToken = accessToken;
            user.refreshToken = refreshToken;
            user.googleGrantedScopes = grantedScopes;
            return user.save();
          }
        })
        .then(function(user) {
          done(null, user);
        })
        .catch(function(err) {
          done(err, null);
        });
    }
  )
);

passport.serializeUser(function(user, done) {
  done(null, user.id);
});

passport.deserializeUser(function(id, done) {
  User.findById(id)
    .then(function(user) {
      done(null, user);
    })
    .catch(function(e) {
      done(e, null);
    });
});

/* ==============================
   GOOGLE OAUTH ROUTES
================================ */
router.get(
  '/google',
  passport.authenticate('google', {
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar'
    ],
    accessType: 'offline',
    prompt: 'consent'
  })
);

router.get('/google/callback', function(req, res, next) {
  passport.authenticate('google', { session: false }, function(err, user) {
    if (err || !user) return res.redirect('/auth/failure');

    var token = jwt.sign(
      { id: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.redirect(FRONTEND_URL + '/auth/success?token=' + token);
  })(req, res, next);
});

router.get('/logout', function(req, res) {
  req.logout(function() {});
  res.redirect('/');
});

router.get('/me', function(req, res) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(req.user);
});

/* ==============================
   GEMINI PDF → RESUME JSON
================================ */
var genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
var model = genAI.getGenerativeModel({
  model: 'gemini-2.0-flash-lite-001',
  generationConfig: { responseMimeType: 'application/json' }
});

router.post('/pdf-to-text', upload.array('pdfs', 10), function(req, res) {
  if (!req.files || !req.files.length) {
    return res.status(400).json({ error: 'No PDFs uploaded' });
  }

  var results = [];
  var fileIndex = 0;

  function processNextFile() {
    if (fileIndex >= req.files.length) {
      return res.json({ success: true, results: results });
    }

    var file = req.files[fileIndex];
    var chunks = [];

    new PdfReader().parseBuffer(file.buffer, function(err, item) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      if (!item) {
        // File processing complete, now process with AI
        var rawText = chunks.join(' ');
        
        var prompt = 'Extract resume details as JSON:\n' +
          '{\n' +
          '  name,\n' +
          '  current_company,\n' +
          '  skillssets: [],\n' +
          '  collegename,\n' +
          '  total_experience_months: [\n' +
          '    { company: string, months: number }\n' +
          '  ]\n' +
          '}\n' +
          '\n' +
          'Resume:\n' +
          rawText;

        model.generateContent(prompt)
          .then(function(aiResult) {
            var responseText = aiResult.response.text();
            
            try {
              var parsedData = JSON.parse(responseText);
              results.push({
                filename: file.originalname,
                parsed_data: parsedData
              });
            } catch (parseErr) {
              results.push({
                filename: file.originalname,
                error: 'Failed to parse AI response'
              });
            }
            
            fileIndex++;
            processNextFile();
          })
          .catch(function(err) {
            results.push({
              filename: file.originalname,
              error: err.message
            });
            fileIndex++;
            processNextFile();
          });
      }
      
      if (item && item.text) {
        chunks.push(item.text);
      }
    });
  }

  processNextFile();
});

/* ==============================
   NEWS / SCRAPING APIs
================================ */
router.get('/normalNews', function(req, res) {
  var db = client.db('NewsList');
  db.collection('Student').find().limit(15).toArray()
    .then(function(docs) {
      res.json({ res: docs[0] ? docs[0].object : null });
    })
    .catch(function(err) {
      res.status(500).json({ error: err.message });
    });
});

router.get('/getCollectionData', function(req, res) {
  var db = client.db('NewsList');
  db.collection(req.query.collectionName)
    .find()
    .sort({ _id: -1 })
    .limit(1)
    .toArray()
    .then(function(latest) {
      res.json({ res: latest });
    })
    .catch(function(err) {
      res.status(500).json({ error: err.message });
    });
});

router.get('/categoryList', function(req, res) {
  var db = client.db('NewsList');
  db.listCollections().toArray()
    .then(function(collections) {
      var collectionNames = collections
        .map(function(c) { return c.name; })
        .filter(function(n) { 
          return n !== 'Dataset' && n !== 'Student'; 
        });
      res.json({ collections: collectionNames });
    })
    .catch(function(err) {
      res.status(500).json({ error: err.message });
    });
});

router.get('/about', function(req, res) {
  var url = 'https://www.youtube.com/results?search_query=' + req.query.topic;
  axios.get(url)
    .then(function(response) {
      var $ = cheerio.load(response.data);
      res.json({ text: $.root().text() });
    })
    .catch(function(err) {
      res.status(500).json({ error: err.message });
    });
});

module.exports = router;
