var express = require('express');
var passport = require('passport');
var GoogleStrategy = require('passport-google-oauth20').Strategy;
var jwt = require('jsonwebtoken');

var dbConnect = require('./db/connect.js');
var appConfig = require('./config.js');
var authMiddleware = require('./middleware/authMiddleware.js');

var router = express.Router();

/* ==============================
   CONFIG
================================ */
var GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
var GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
var GOOGLE_CALLBACK_URL = 'https://www.neukaps.com/auth/google/callback';
var GEMINI_API_KEY = process.env.GEMINI_API_KEY;
var JWT_SECRET = appConfig.JWT_SECRET;
var FRONTEND_URL = appConfig.FRONTEND_URL;
var client = dbConnect.client;


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
      var db = client.db('Interest');
      var usersCollection = db.collection('users');
      
      usersCollection.findOne({ googleId: profile.id })
        .then(function(user) {
          if (user) return user;
          return usersCollection.findOne({ email: profile.emails[0].value });
        })
        .then(function(user) {
          var grantedScopes = (req && req.query && req.query.scope) ? 
            req.query.scope.split(' ') : [];

          if (!user) {
            var newUser = {
              googleId: profile.id,
              email: profile.emails[0].value,
              name: profile.displayName,
              accessToken: accessToken,
              refreshToken: refreshToken,
                  credits: 100,
              googleGrantedScopes: grantedScopes,
              createdAt: new Date()
            };
            return usersCollection.insertOne(newUser)
              .then(function(result) {
                return usersCollection.findOne({ _id: result.insertedId });
              });
          } else {
            var updateData = {
              googleId: profile.id,
              accessToken: accessToken,
              refreshToken: refreshToken,
              googleGrantedScopes: grantedScopes,
              updatedAt: new Date()
            };
            return usersCollection.updateOne(
              { _id: user._id },
              { $set: updateData }
            ).then(function() {
              return Object.assign({}, user, updateData);
            });
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
  var db = client.db('Interest');
  var usersCollection = db.collection('users');
  
  try {
    var objectId = require('mongodb').ObjectId;
    usersCollection.findOne({ _id: new objectId(id) })
      .then(function(user) {
        done(null, user);
      })
      .catch(function(e) {
        done(e, null);
      });
  } catch (e) {
    done(e, null);
  }
});

/* ==============================
   GOOGLE OAUTH ROUTES
================================ */
router.get(
  '/google',
  passport.authenticate('google', {
    scope: [
      'profile',
      'email'
      // 'https://www.googleapis.com/auth/gmail.readonly',
      // 'https://www.googleapis.com/auth/gmail.send',
      // 'https://www.googleapis.com/auth/calendar'
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

router.get('/me', authMiddleware.verifyToken, authMiddleware.getUserFromDB, function(req, res) {
  res.json(req.user);
});



module.exports = router;
