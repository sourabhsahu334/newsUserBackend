import express from 'express';
import passport from 'passport';
import pkg from 'passport-google-oauth20';
const { Strategy: GoogleStrategy } = pkg;
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';

import * as dbConnect from './db/connect.js';
import * as appConfig from './config.js';
import authMiddleware from './middleware/authMiddleware.js';

const router = express.Router();
import { getInbox, sendEmail } from './controller/emailcontroller.js';
import { processResumes } from './controller/resumeProcessor.js';
import { microsoftAuth, microsoftCallback, getOutlookInbox, sendOutlookMail, microsoftCustomAuth } from './controller/microsoftController.js';
import { googleCustomAuth } from './controller/googleController.js';



/* ==============================
   CONFIG
================================ */
var GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
var GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
var GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'https://www.neukaps.com/auth/google/callback';
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
    function (req, accessToken, refreshToken, profile, done) {
      var self = this;
      var db = client.db('Interest');
      var usersCollection = db.collection('users');

      usersCollection.findOne({ googleId: profile.id })
        .then(function (user) {
          if (user) return user;
          return usersCollection.findOne({ email: profile.emails[0].value });
        })
        .then(function (user) {
          var grantedScopes = (req && req.query && req.query.scope) ?
            req.query.scope.split(' ') : [];

          if (!user) {
            var newUser = {
              googleId: profile.id,
              email: profile.emails[0].value,
              name: profile.displayName,
              accessToken: accessToken,
              refreshToken: refreshToken,
              credits: [{
                amount: 100,
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                createdAt: new Date()
              }],
              folderTypes: [{
                foldername: "default",
                JD: "",
                activeColumn: [
                  "fit_status",
                  "current_company",
                  "mobile",
                  "summary",
                  "collegename",
                  "skillsets",
                  "total_skills",
                  "total_experience",
                  "total_experience_months",
                  "number_of_companies",
                  "latest_company",
                  "latest_start_date",
                  "latest_end_date",
                  "latest_duration_months",
                  "experience_history"
                ]
              }],
              gmailGrantedScopes: grantedScopes,
              createdAt: new Date()
            };

            // Check for Gmail specific scope
            if (grantedScopes.some(s => s.includes('gmail.readonly'))) {
              newUser.gmailAccessToken = accessToken;
              newUser.gmailRefreshToken = refreshToken;
              newUser.gmailGrantedScopes = grantedScopes;
            }

            return usersCollection.insertOne(newUser)
              .then(function (result) {
                return usersCollection.findOne({ _id: result.insertedId });
              });
          } else {
            var updateData = {
              googleId: profile.id,
              accessToken: accessToken,
              refreshToken: refreshToken,
              gmailGrantedScopes: grantedScopes,
              updatedAt: new Date()
            };

            // Check for Gmail specific scope
            if (grantedScopes.some(s => s.includes('gmail.readonly'))) {
              updateData.gmailAccessToken = accessToken;
              updateData.gmailRefreshToken = refreshToken;
              updateData.gmailGrantedScopes = grantedScopes;
            }

            return usersCollection.updateOne(
              { _id: user._id },
              { $set: updateData }
            ).then(function () {
              return Object.assign({}, user, updateData);
            });
          }
        })
        .then(function (user) {
          done(null, user);
        })
        .catch(function (err) {
          done(err, null);
        });
    }
  )
);

passport.serializeUser(function (user, done) {
  done(null, user.id);
});

passport.deserializeUser(function (id, done) {
  var db = client.db('Interest');
  var usersCollection = db.collection('users');

  try {
    usersCollection.findOne({ _id: new ObjectId(id) })
      .then(function (user) {
        done(null, user);
      })
      .catch(function (e) {
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
    ],
    accessType: 'offline',
    prompt: 'consent'
  })
);

router.get(
  '/google/permissions',
  passport.authenticate('google', {
    scope: [
      'profile',
      'email',
      // 'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      // 'https://www.googleapis.com/auth/calendar'
    ],
    accessType: 'offline',
    prompt: 'consent'
  })
);

router.get('/microsoft', microsoftAuth);
router.get('/microsoft/callback', microsoftCallback);
router.post('/microsoft/custom', microsoftCustomAuth);
router.post('/google/custom', googleCustomAuth);

router.get('/google/callback', function (req, res, next) {
  passport.authenticate('google', { session: false }, function (err, user) {
    console.log(err, user)
    if (err || !user) return res.redirect('/auth/failure');

    var token = jwt.sign(
      { id: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.redirect(FRONTEND_URL + '/auth/success?token=' + token);
  })(req, res, next);
});

router.get('/logout', function (req, res) {
  req.logout(function () { });
  res.redirect('/');
});

router.get('/me', authMiddleware.verifyToken, authMiddleware.getUserFromDB, function (req, res) {
  const user = { ...req.user };
  const totalCredits = (user.credits || []).reduce((sum, c) => sum + (c.amount || 0), 0);

  // Remove sensitive tokens before sending to frontend
  const sensitiveFields = [
    'accessToken', 'refreshToken',
    'msAccessToken', 'msRefreshToken', 'msIdToken',
    'gmailAccessToken', 'gmailRefreshToken',
    'zoomAccessToken', 'zoomRefreshToken',
    'slackAccessToken',
    'instagramAccessToken',
    'metaAccessToken', 'metaPageTokens',
    'passwordHash'
  ];
  sensitiveFields.forEach(field => delete user[field]);

  res.json({
    ...user,
    credits: totalCredits,
    creditDetails: user.credits
  });
});

router.get('/isPremiumUser', authMiddleware.verifyToken, authMiddleware.getUserFromDB, function (req, res) {
  const isPremium = req.user.isPremium === true;
  console.log(req.user)
  res.json({
    isPremium: isPremium,
    message: isPremium ? 'User is premium' : 'User is not premium'
  });
});

// Test API to initialize premium user with credits and send congratulatory email
router.post('/test/init-premium', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const db = client.db('Interest');
    const usersCollection = db.collection('users');

    // Default configuration for new/reset users
    const defaultFolderTypes = [{
      foldername: "default",
      JD: "",
      activeColumn: [
        "name", "email", "mobile", "fit_status", "current_company",
        "summary", "collegename", "skillsets", "total_skills",
        "total_experience", "total_experience_months", "number_of_companies",
        "latest_company", "latest_start_date", "latest_end_date",
        "latest_duration_months", "experience_history"
      ]
    }];

    // 100 credits valid for 1 year
    const testCredits = [{
      amount: 100,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      createdAt: new Date()
    }];

    // Upsert user
    const updateResult = await usersCollection.findOneAndUpdate(
      { email: email },
      {
        $set: {
          email: email,
          isPremium: true,
          updatedAt: new Date()
        },
        $push: { credits: { $each: testCredits } },
        $setOnInsert: {
          folderTypes: defaultFolderTypes,
          createdAt: new Date()
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    const user = updateResult.value || await usersCollection.findOne({ email });

    // Send congratulatory email
    const mailOptions = {
      from: '"Neukaps Team" <support@neukaps.com>',
      to: email,
      subject: 'Congratulations! Your Neukaps Premium Access is Active',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #4F46E5;">Welcome to Neukaps Premium!</h2>
          <p>Hello,</p>
          <p>We are excited to inform you that your <strong>Premium Access</strong> and <strong>100 Credits</strong> have been successfully added to your account (<strong>${email}</strong>).</p>
          <p>With Neukaps Premium, you can now:</p>
          <ul style="line-height: 1.6;">
            <li>Access your Gmail/Outlook resume inbox directly.</li>
            <li>Send professional selection/rejection emails with custom templates.</li>
            <li>Efficiently process and manage your talent pool.</li>
          </ul>
          <p>Go ahead and start exploring the premium features on the platform.</p>
          <div style="margin-top: 30px; text-align: center;">
            <a href="${FRONTEND_URL}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Go to Dashboard</a>
          </div>
          <p style="margin-top: 30px; color: #666; font-size: 12px;">If you have any questions, feel free to reply to this email.</p>
          <p style="color: #666; font-size: 12px;">The Neukaps Team</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    res.json({
      success: true,
      message: 'User initialized as premium, credits added, and welcome email sent.',
      user: {
        id: user._id,
        email: user.email,
        isPremium: user.isPremium,
        totalCredits: (user.credits || []).reduce((sum, c) => sum + (c.amount || 0), 0)
      }
    });

  } catch (error) {
    console.error('Error in /test/init-premium:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

router.get('/gmail/inbox', authMiddleware.verifyToken, getInbox);
router.post('/gmail/send', authMiddleware.verifyToken, sendEmail);
router.get('/microsoft/inbox', authMiddleware.verifyToken, getOutlookInbox);
router.post('/microsoft/send', authMiddleware.verifyToken, sendOutlookMail);
router.post('/process-resumes', authMiddleware.verifyToken, processResumes);

/* ==============================
   EMAIL OTP VERIFICATION
================================ */

// Configure nodemailer for Namecheap Private Email
const transporter = nodemailer.createTransport({
  host: 'mail.privateemail.com',
  port: 465,
  secure: true,
  auth: {
    user: "support@neukaps.com",
    pass: "MueG_Tx-2g3aqSA"
  }
});

// Store OTPs in database
const otpCollection = client.db('Interest').collection('otps');

// Generate 6-digit OTP
function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

// Clean up expired OTPs (helper function)
async function cleanupExpiredOTPs() {
  try {
    await otpCollection.deleteMany({
      expiryTime: { $lt: Date.now() }
    });
  } catch (error) {
    console.error('Error cleaning up expired OTPs:', error);
  }
}

// Send OTP to email
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    console.log(req.body)
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Clean up expired OTPs first
    await cleanupExpiredOTPs();

    // Generate OTP
    const otp = generateOTP();
    const expiryTime = Date.now() + (5 * 60 * 1000); // 5 minutes

    // Store OTP in database
    await otpCollection.updateOne(
      { email: email },
      {
        $set: {
          otp,
          expiryTime,
          attempts: 0,
          createdAt: new Date()
        }
      },
      { upsert: true }
    );

    // Send email
    const mailOptions = {
      from: '"Neukaps Support" <support@neukaps.com>',
      to: email,
      subject: 'Your OTP Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Email Verification</h2>
          <p>Thank you for using our service. Use the OTP below to verify your email address:</p>
          <div style="background: #f0f0f0; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="color: #007bff; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
          </div>
          <p><strong>Note:</strong> This OTP will expire in 5 minutes.</p>
          <p>If you didn't request this OTP, please ignore this email.</p>
          <hr style="border: 1px solid #eee; margin: 30px 0;">
          <p style="color: #666; font-size: 14px;">This is an automated message. Please do not reply to this email.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    res.json({
      success: true,
      message: 'OTP sent successfully',
      expiryMinutes: 5
    });

  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      error: error.message
    });
  }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required'
      });
    }

    // Get OTP from database
    const storedData = await otpCollection.findOne({ email: email });

    if (!storedData) {
      return res.status(400).json({
        success: false,
        message: 'OTP not found or expired'
      });
    }

    // Check if OTP has expired
    if (Date.now() > storedData.expiryTime) {
      await otpCollection.deleteOne({ email: email });
      return res.status(400).json({
        success: false,
        message: 'OTP has expired'
      });
    }

    // Check attempts (max 3 attempts)
    if (storedData.attempts >= 3) {
      await otpCollection.deleteOne({ email: email });
      return res.status(400).json({
        success: false,
        message: 'Maximum attempts exceeded. Please request a new OTP'
      });
    }

    // Verify OTP
    if (storedData.otp == otp) {
      // Clear OTP after successful verification
      await otpCollection.deleteOne({ email: email });

      // Get or create user in database
      const db = client.db('Interest');
      const usersCollection = db.collection('users');

      let user = await usersCollection.findOne({ email: email });

      if (!user) {
        // Create new user if doesn't exist
        const newUser = {
          email: email,
          emailVerified: true,
          emailVerifiedAt: new Date(),
          credits: [{
            amount: 100,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            createdAt: new Date()
          }],
          folderTypes: [{
            foldername: "default",
            JD: "",
            activeColumn: [

              "name",

              "email",

              "mobile",

              "fit_status",

              "current_company",

              "summary",

              "collegename",

              "skillsets",

              "total_skills",

              "total_experience",

              "total_experience_months",

              "number_of_companies",

              "latest_company",

              "latest_start_date",

              "latest_end_date",

              "latest_duration_months",

              "experience_history"

            ]

          }],
          createdAt: new Date()
        };

        const result = await usersCollection.insertOne(newUser);
        user = await usersCollection.findOne({ _id: result.insertedId });
      } else {
        // Update existing user's email verification status
        await usersCollection.updateOne(
          { email: email },
          {
            $set: {
              emailVerified: true,
              emailVerifiedAt: new Date()
            }
          }
        );

        // Fetch updated user
        user = await usersCollection.findOne({ email: email });
      }

      // Generate JWT token
      const token = jwt.sign(
        { id: user._id, email: user.email },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        success: true,
        message: 'OTP verified successfully',
        token: token,
        user: {
          id: user._id,
          email: user.email,
          name: user.name || null,
          emailVerified: user.emailVerified,
          credits: (user.credits || []).reduce((sum, c) => sum + (c.amount || 0), 0),
          creditDetails: user.credits
        }
      });
    } else {
      // Increment attempts
      await otpCollection.updateOne(
        { email: email },
        { $inc: { attempts: 1 } }
      );

      res.status(400).json({
        success: false,
        message: 'Invalid OTP',
        remainingAttempts: 3 - (storedData.attempts + 1)
      });
    }

  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP',
      error: error.message
    });
  }
});

// Resend OTP
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Clean up expired OTPs first
    await cleanupExpiredOTPs();

    // Generate new OTP
    const otp = generateOTP();
    const expiryTime = Date.now() + (5 * 60 * 1000); // 5 minutes

    // Store new OTP in database (replaces existing one)
    await otpCollection.updateOne(
      { email: email },
      {
        $set: {
          otp,
          expiryTime,
          attempts: 0,
          createdAt: new Date()
        }
      },
      { upsert: true }
    );

    // Send email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your New OTP Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Email Verification - New Code</h2>
          <p>Here is your new OTP verification code:</p>
          <div style="background: #f0f0f0; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="color: #007bff; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
          </div>
          <p><strong>Note:</strong> This OTP will expire in 5 minutes.</p>
          <p>If you didn't request this OTP, please ignore this email.</p>
          <hr style="border: 1px solid #eee; margin: 30px 0;">
          <p style="color: #666; font-size: 14px;">This is an automated message. Please do not reply to this email.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    res.json({
      success: true,
      message: 'New OTP sent successfully',
      expiryMinutes: 5
    });

  } catch (error) {
    console.error('Error resending OTP:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend OTP',
      error: error.message
    });
  }
});

/* ==============================
   PASSWORD AUTHENTICATION
================================ */

// Set password after OTP verification
router.post('/set-password', authMiddleware.verifyToken, authMiddleware.getUserFromDB, async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password is required'
      });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Update user with hashed password
    const db = client.db('Interest');
    const usersCollection = db.collection('users');

    await usersCollection.updateOne(
      { _id: req.user._id },
      {
        $set: {
          password: hashedPassword,
          passwordSetAt: new Date()
        }
      }
    );

    res.json({
      success: true,
      message: 'Password set successfully'
    });

  } catch (error) {
    console.error('Error setting password:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to set password',
      error: error.message
    });
  }
});

// Login with email and password
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Find user by email
    const db = client.db('Interest');
    const usersCollection = db.collection('users');
    const user = await usersCollection.findOne({ email: email });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Check if user has set a password
    if (!user.password) {
      return res.status(400).json({
        success: false,
        message: 'Password not set. Please verify your email first and set a password.'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token: token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name || null,
        emailVerified: user.emailVerified,
        credits: (user.credits || []).reduce((sum, c) => sum + (c.amount || 0), 0),
        creditDetails: user.credits
      }
    });

  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
});

export default router;
