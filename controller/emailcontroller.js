const { google } = require('googleapis');
const User = require('../models/User.js');
const { getOAuth2Client } = require('../services/googleService.js');

const getInbox = async (req, res) => {
    const user = await User.findById(req.user.id);
    const oAuth2Client = getOAuth2Client(user);
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    const response = await gmail.users.messages.list({ userId: 'me', maxResults: 10 });
    res.json(response.data);
};

const sendEmail = async (req, res) => {
    const user = await User.findById(req.user.id);
    const oAuth2Client = getOAuth2Client(user);
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    const { to, subject, message } = req.body;
    const raw = Buffer.from(
        `To: ${to}\r\nSubject: ${subject}\r\n\r\n${message}`
    ).toString('base64');

    await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw }
    });

    res.json({ status: 'Email sent' });
};

module.exports = {
    getInbox,
    sendEmail
};