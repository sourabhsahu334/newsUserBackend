// ==========================================
// COMPLETE MICROSOFT LOGIN IMPLEMENTATION
// ==========================================
// This file contains all Microsoft login related code in one place
// Includes: Service, Controller, and Routes
// ES5 Module Syntax (CommonJS)

// ================================
// MICROSOFT SERVICE
// ================================
const { ConfidentialClientApplication } = require('@azure/msal-node');
const fetch = require('node-fetch');

const config = {
  auth: {
    clientId: process.env.MS_CLIENT_ID,
    authority: 'https://login.microsoftonline.com/common',
    clientSecret: process.env.MS_CLIENT_SECRET,
  },
};

const REDIRECT_URI = process.env.MS_REDIRECT_URI || 'http://localhost:3000/auth/microsoft/callback';

module.exports = {
  getAuthUrl,
  getTokenByCode,
  refreshAccessToken,
  callGraphApi,
  msalClient
};

// ================================
// MICROSOFT CONTROLLER
// ================================
const User = require('../models/User.js');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, FRONTEND_URL } = require('../config/app.js');

const microsoftAuth = async (req, res) => {
  try {
    const url = await getAuthUrl();
    res.redirect(url);
  } catch (err) {
    res.status(500).json({ error: 'Failed to initiate Microsoft login', details: err.message });
  }
};

const microsoftCallback = async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).json({ error: 'No code provided' });
  try {
    const tokenResponse = await getTokenByCode(code);
    // Save or update user in DB
    let user = await User.findOne({ msId: tokenResponse.account.homeAccountId });
    const grantedScopes = tokenResponse.scopes || tokenResponse.scope ? (tokenResponse.scopes || tokenResponse.scope.split(' ')) : [];
    if (!user) {
      user = await User.create({
        msId: tokenResponse.account.homeAccountId,
        msEmail: tokenResponse.account.username,
        msAccessToken: tokenResponse.accessToken,
        msRefreshToken: tokenResponse.refreshToken,
        msIdToken: tokenResponse.idToken,
        msGrantedScopes: grantedScopes,
      });
    } else {
      user.msAccessToken = tokenResponse.accessToken;
      user.msRefreshToken = tokenResponse.refreshToken;
      user.msIdToken = tokenResponse.idToken;
      user.msGrantedScopes = grantedScopes;
      await user.save();
    }
    // Generate JWT token
    const token = jwt.sign({ id: user._id, email: user.msEmail }, JWT_SECRET, { expiresIn: '7d' });

    // Redirect to frontend success page
    res.redirect(`${FRONTEND_URL}/auth/success?token=${token}`);
  } catch (err) {
    res.status(500).json({ error: 'Microsoft callback failed', details: err.message });
  }
};

const microsoftCustomAuth = async (req, res) => {
  const { scopes } = req.body;
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return res.status(400).json({ error: 'Scopes array is required.' });
  }
  try {
    const url = await getAuthUrl(scopes);
    res.json({ redirectUrl: url });
  } catch (err) {
    res.status(500).json({ error: 'Failed to initiate Microsoft login', details: err.message });
  }
};

// Example: Get user's profile from Microsoft Graph
const getMicrosoftProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const profile = await callGraphApi(user.msAccessToken, '/me');
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch Microsoft profile', details: err.message });
  }
};

// Read Outlook inbox
const getOutlookInbox = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user.msAccessToken) return res.status(400).json({ error: 'No Microsoft token found' });
    if (!user.msGrantedScopes || !user.msGrantedScopes.includes('Mail.Read')) return res.status(403).json({ error: 'Permission Mail.Read not granted' });
    const inbox = await callGraphApi(user.msAccessToken, '/me/mailfolders/inbox/messages?$top=10');
    res.json(inbox);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch Outlook inbox', details: err.message });
  }
};

// Send Outlook mail
const sendOutlookMail = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user.msAccessToken) return res.status(400).json({ error: 'No Microsoft token found' });
    if (!user.msGrantedScopes || !user.msGrantedScopes.includes('Mail.Send')) return res.status(403).json({ error: 'Permission Mail.Send not granted' });
    const { to, subject, body } = req.body;
    const mail = {
      message: {
        subject,
        body: { contentType: 'Text', content: body },
        toRecipients: [{ emailAddress: { address: to } }],
      },
      saveToSentItems: 'true',
    };
    await callGraphApi(user.msAccessToken, '/me/sendMail', 'POST', mail);
    res.json({ status: 'Email sent' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send Outlook mail', details: err.message });
  }
};

module.exports = {
  microsoftAuth,
  microsoftCallback,
  microsoftCustomAuth,
  getMicrosoftProfile,
  getOutlookInbox,
  sendOutlookMail
};

// ================================
// MICROSOFT ROUTES
// ================================
const express = require('express');
const { requireAuth } = require('../middleware/auth.js');
const {
  microsoftAuth,
  microsoftCallback,
  microsoftCustomAuth,
  getMicrosoftProfile,
  getOutlookInbox,
  sendOutlookMail
} = require('./microsoftController.js');

const router = express.Router();

// Microsoft OAuth routes
router.get('/microsoft', microsoftAuth);
router.get('/microsoft/callback', microsoftCallback);
router.get('/microsoft/profile', requireAuth, getMicrosoftProfile);
router.post('/microsoft/custom', microsoftCustomAuth);
router.get('/microsoft/inbox', requireAuth, getOutlookInbox);
router.post('/microsoft/send', requireAuth, sendOutlookMail);

module.exports = router;

// ================================
// USAGE INSTRUCTIONS
// ================================
/*
1. Install required dependencies:
   npm install @azure/msal-node node-fetch

2. Add these routes to your main app.js:
   import microsoftRoutes from './path/to/this/file';
   app.use('/auth', microsoftRoutes);

3. Environment variables needed:
   MS_REDIRECT_URI=http://localhost:3000/auth/microsoft/callback
   FRONTEND_URL=http://localhost:3001
   JWT_SECRET=your-jwt-secret

4. Microsoft OAuth URLs:
   - Login: GET /auth/microsoft
   - Callback: GET /auth/microsoft/callback
   - Profile: GET /auth/microsoft/profile (requires auth)
   - Custom scopes: POST /auth/microsoft/custom
   - Inbox: GET /auth/microsoft/inbox (requires auth)
   - Send mail: POST /auth/microsoft/send (requires auth)

5. Frontend integration:
   - Redirect users to /auth/microsoft for login
   - Handle callback at /auth/microsoft/callback
   - Store JWT token from callback response
   - Use token for authenticated requests

6. Required User model fields:
   - msId: String
   - msEmail: String
   - msAccessToken: String
   - msRefreshToken: String
   - msIdToken: String
   - msGrantedScopes: [String]

7. Default permissions:
   - User.Read (profile access)
   - Mail.Read (inbox access)
   - Mail.Send (send emails)
   - Calendars.ReadWrite (calendar access)
   - Files.ReadWrite.All (OneDrive access)
*/
