import express from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import axios from 'axios';
import cheerio from 'cheerio';
import { PdfReader } from 'pdfreader';
import { google } from 'googleapis';
import { GoogleGenerativeAI } from '@google/generative-ai';

import User from "./models/User.js";
import { client } from './db/connect.js';
import { JWT_SECRET, FRONTEND_URL } from '../config/app.js';

const router = express.Router();

/* ==============================
   CONFIG
================================ */
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = 'http://localhost:3000/auth/google/callback';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/* ==============================
   MULTER
================================ */
const upload = multer({ storage: multer.memoryStorage() });

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
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        let user =
          (await User.findOne({ googleId: profile.id })) ||
          (await User.findOne({ email: profile.emails[0].value }));

        const grantedScopes =
          req?.query?.scope?.split(' ') || [];

        if (!user) {
          user = await User.create({
            googleId: profile.id,
            email: profile.emails[0].value,
            name: profile.displayName,
            accessToken,
            refreshToken,
            googleGrantedScopes: grantedScopes
          });
        } else {
          user.googleId = profile.id;
          user.accessToken = accessToken;
          user.refreshToken = refreshToken;
          user.googleGrantedScopes = grantedScopes;
          await user.save();
        }

        done(null, user);
      } catch (err) {
        done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    done(null, await User.findById(id));
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
      'email',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar'
    ],
    accessType: 'offline',
    prompt: 'consent'
  })
);

router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false }, (err, user) => {
    if (err || !user) return res.redirect('/auth/failure');

    const token = jwt.sign(
      { id: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.redirect(`${FRONTEND_URL}/auth/success?token=${token}`);
  })(req, res, next);
});

router.get('/logout', (req, res) => {
  req.logout(() => {});
  res.redirect('/');
});

router.get('/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(req.user);
});

/* ==============================
   GEMINI PDF → RESUME JSON
================================ */
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-2.0-flash-lite-001',
  generationConfig: { responseMimeType: 'application/json' }
});

router.post('/pdf-to-text', upload.array('pdfs', 10), async (req, res) => {
  try {
    if (!req.files?.length) {
      return res.status(400).json({ error: 'No PDFs uploaded' });
    }

    const results = [];

    for (const file of req.files) {
      const chunks = [];

      await new Promise((resolve, reject) => {
        new PdfReader().parseBuffer(file.buffer, (err, item) => {
          if (err) reject(err);
          if (!item) resolve();
          if (item?.text) chunks.push(item.text);
        });
      });

      const rawText = chunks.join(' ');

      const prompt = `
Extract resume details as JSON:
{
  name,
  current_company,
  skillssets: [],
  collegename,
  total_experience_months: [
    { company: string, months: number }
  ]
}

Resume:
${rawText}
`;

      const aiResult = await model.generateContent(prompt);
      const responseText = aiResult.response.text();

      results.push({
        filename: file.originalname,
        parsed_data: JSON.parse(responseText)
      });
    }

    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ==============================
   NEWS / SCRAPING APIs
================================ */
router.get('/normalNews', async (req, res) => {
  const db = client.db('NewsList');
  const docs = await db.collection('Student').find().limit(15).toArray();
  res.json({ res: docs[0]?.object });
});

router.get('/getCollectionData', async (req, res) => {
  const db = client.db('NewsList');
  const latest = await db
    .collection(req.query.collectionName)
    .find()
    .sort({ _id: -1 })
    .limit(1)
    .toArray();
  res.json({ res: latest });
});

router.get('/categoryList', async (req, res) => {
  const db = client.db('NewsList');
  const collections = await db.listCollections().toArray();
  res.json({
    collections: collections
      .map(c => c.name)
      .filter(n => !['Dataset', 'Student'].includes(n))
  });
});

router.get('/about', async (req, res) => {
  const url = `https://www.youtube.com/results?search_query=${req.query.topic}`;
  const html = await axios.get(url);
  const $ = cheerio.load(html.data);
  res.json({ text: $.root().text() });
});

export default router;
