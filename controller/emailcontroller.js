import { google } from 'googleapis';
import { client } from '../db/connect.js';
import { ObjectId } from 'mongodb';
import getOAuth2Client from '../services/googleService.js';



const RESUME_KEYWORDS = [
    'resume',
    'cv',
    'curriculum vitae',
    'job application',
    'applying',
    'career',
    'hiring',
    'position',
    'opening'
];

// Keyword scoring function
const calculateScore = (text = '') => {
    const lower = text.toLowerCase();
    return RESUME_KEYWORDS.reduce(
        (score, word) => score + (lower.includes(word) ? 1 : 0),
        0
    );
};

const getInbox = async (req, res) => {
    try {
        const db = client.db('Interest');
        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne({
            _id: new ObjectId(req.user.id)
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Premium check
        if (user.isPremium !== true) {
            return res.status(402).json({
                success: false,
                error: 'PREMIUM_REQUIRED',
                message: 'Upgrade to premium to access resume inbox.'
            });
        }

        const oAuth2Client = getOAuth2Client(user);
        const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

        const pageToken = req.query.pageToken;

        /**
         * Gmail advanced search:
         * - has attachment
         * - pdf/doc/docx
         * - resume related keywords
         */
        const listResponse = await gmail.users.messages.list({
            userId: 'me',
            maxResults: 10,
            pageToken: pageToken,
            q: '-from:me has:attachment (filename:pdf OR filename:doc OR filename:docx) (resume OR cv OR "job application" OR hiring)'
        });

        const messages = listResponse.data.messages || [];
        const nextPageToken = listResponse.data.nextPageToken;

        if (!messages.length) {
            return res.json({ messages: [], nextPageToken: null });
        }

        const resumeEmails = [];

        for (const msg of messages) {
            const details = await gmail.users.messages.get({
                userId: 'me',
                id: msg.id
            });

            const payload = details.data.payload;
            const headers = payload.headers || [];

            const getHeader = (name) =>
                headers.find(h => h.name === name)?.value || '';

            const subject = getHeader('Subject');
            const from = getHeader('From');
            const date = getHeader('Date');
            const snippet = details.data.snippet || '';

            // Extract attachments
            const parts = payload.parts || [];
            const attachments = [];

            const traverseParts = (partsArray) => {
                for (const part of partsArray) {
                    if (
                        part.filename &&
                        part.body?.attachmentId &&
                        (
                            part.mimeType === 'application/pdf' ||
                            part.mimeType === 'application/msword' ||
                            part.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                        )
                    ) {
                        attachments.push({
                            filename: part.filename,
                            mimeType: part.mimeType,
                            attachmentId: part.body.attachmentId
                        });
                    }

                    if (part.parts) {
                        traverseParts(part.parts);
                    }
                }
            };

            traverseParts(parts);

            // Skip if no valid resume attachments
            if (attachments.length === 0) continue;

            // Confidence score
            const filenames = attachments.map(a => a.filename).join(' ');
            const score =
                calculateScore(subject) +
                calculateScore(snippet) +
                calculateScore(filenames);

            // Threshold (tuneable)
            if (score < 2) continue;

            resumeEmails.push({
                id: msg.id,
                threadId: msg.threadId,
                subject,
                from,
                date,
                snippet,
                attachments,
                confidenceScore: score
            });
        }

        return res.json({
            success: true,
            count: resumeEmails.length,
            messages: resumeEmails,
            nextPageToken: nextPageToken
        });

    } catch (err) {
        console.error('Resume inbox error:', err);

        if (err.code === 403 || err?.response?.status === 403) {
            return res.status(403).json({
                success: false,
                error: 'INSUFFICIENT_PERMISSIONS',
                message: 'Gmail permissions missing. Please re-authenticate.',
                reauthUrl: '/auth/google/permissions'
            });
        }

        res.status(500).json({
            success: false,
            error: 'FAILED_TO_FETCH_RESUMES',
            details: err.message
        });
    }
};


const sendEmail = async (req, res) => {
    try {
        const db = client.db('Interest');
        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne({ _id: new ObjectId(req.user.id) });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check premium status
        if (user.isPremium !== true) {
            return res.status(402).json({
                success: false,
                error: 'PREMIUM_REQUIRED',
                message: 'This is a premium feature. Please upgrade your plan to access Gmail services.'
            });
        }

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
    } catch (err) {
        console.error('Error in sendEmail:', err);

        // Handle insufficient scopes error
        if (err.code === 403 || (err.response && err.response.status === 403)) {
            return res.status(403).json({
                success: false,
                error: 'INSUFFICIENT_PERMISSIONS',
                message: 'Gmail permissions are missing. Please re-authenticate and grant access to send emails.',
                reauthUrl: '/auth/google/permissions'
            });
        }

        res.status(500).json({ error: 'Failed to send email', details: err.message });
    }
};

export {
    getInbox,
    sendEmail
};