import { getAuthUrl, getTokenByCode, callGraphApiWithRefresh } from '../services/microsoftService.js';
import { client } from '../db/connect.js';
import { ObjectId } from 'mongodb';
import jwt from 'jsonwebtoken';
import * as appConfig from '../config.js';

const { JWT_SECRET, FRONTEND_URL } = appConfig;

export const microsoftAuth = async (req, res) => {
    try {
        const url = await getAuthUrl();
        res.redirect(url);
    } catch (err) {
        res.status(500).json({ error: 'Failed to initiate Microsoft login', details: err.message });
    }
};

export const microsoftCallback = async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).json({ error: 'No code provided' });

    try {
        const tokenResponse = await getTokenByCode(code);
        const db = client.db('Interest');
        const usersCollection = db.collection('users');

        let user = await usersCollection.findOne({ msId: tokenResponse.account.homeAccountId });
        if (!user) {
            user = await usersCollection.findOne({ email: tokenResponse.account.username });
        }

        const grantedScopes = tokenResponse.scopes || [];

        const updateData = {
            msId: tokenResponse.account.homeAccountId,
            msEmail: tokenResponse.account.username,
            msAccessToken: tokenResponse.accessToken,
            msRefreshToken: tokenResponse.refreshToken,
            msIdToken: tokenResponse.idToken,
            msGrantedScopes: grantedScopes,
            updatedAt: new Date()
        };

        if (!user) {
            const newUser = {
                ...updateData,
                email: tokenResponse.account.username,
                name: tokenResponse.account.name || tokenResponse.account.username,
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
                createdAt: new Date()
            };
            const result = await usersCollection.insertOne(newUser);
            user = { _id: result.insertedId, ...newUser };
        } else {
            await usersCollection.updateOne(
                { _id: user._id },
                { $set: updateData }
            );
            user = { ...user, ...updateData };
        }

        const token = jwt.sign(
            { id: user._id, email: user.email || user.msEmail },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.redirect(`${FRONTEND_URL}/auth/success?token=${token}`);
    } catch (err) {
        console.error('Microsoft callback error:', err);
        res.status(500).json({ error: 'Microsoft callback failed', details: err.message });
    }
};

export const microsoftCustomAuth = async (req, res) => {
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


export const getOutlookInbox = async (req, res) => {
    try {
        const db = client.db('Interest');
        const usersCollection = db.collection('users');
        let user = await usersCollection.findOne({ _id: new ObjectId(req.user.id) });

        if (!user || !user.msAccessToken) {
            console.warn(`[Outlook] User ${req.user.id} has no Microsoft access token.`);
            return res.status(400).json({ error: 'No Microsoft token found' });
        }

        // Search for resume-related emails with attachments
        const searchPath = "/me/messages?$search=\"resume OR cv OR 'job application'\"&$top=10&$expand=attachments";

        const response = await callGraphApiWithRefresh(
            user._id,
            user.msAccessToken,
            user.msRefreshToken,
            searchPath
        );

        const messages = response.value || [];

        const formattedMessages = messages
            .filter(msg => (msg.attachments || []).some(att =>
                att.contentType === 'application/pdf' ||
                att.contentType === 'application/msword' ||
                att.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            ))
            .map(msg => ({
                id: msg.id,
                subject: msg.subject,
                from: msg.from?.emailAddress ? `${msg.from.emailAddress.name} <${msg.from.emailAddress.address}>` : 'Unknown',
                date: msg.receivedDateTime,
                snippet: msg.bodyPreview,
                attachments: (msg.attachments || [])
                    .filter(att =>
                        att.contentType === 'application/pdf' ||
                        att.contentType === 'application/msword' ||
                        att.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                    )
                    .map(att => ({
                        filename: att.name,
                        mimeType: att.contentType,
                        attachmentId: att.id
                    }))
            }));

        res.json({
            success: true,
            messages: formattedMessages
        });
    } catch (err) {
        console.error('Outlook inbox error:', err);
        res.status(500).json({ error: 'Failed to fetch Outlook inbox', details: err.message });
    }
};

export const sendOutlookMail = async (req, res) => {
    try {
        const db = client.db('Interest');
        const usersCollection = db.collection('users');
        let user = await usersCollection.findOne({ _id: new ObjectId(req.user.id) });

        if (!user || !user.msAccessToken) {
            return res.status(400).json({ error: 'No Microsoft token found. Please sign in with Microsoft.' });
        }

        // Check scopes (optional but recommended)
        // Note: callGraphApiWithRefresh handles 401, but explicit scope check is good UI feedback
        // if (!user.msGrantedScopes || !user.msGrantedScopes.includes('Mail.Send')) ...

        const { to, subject, body, historyId, emailType } = req.body;

        if (!to || !subject || !body) {
            return res.status(400).json({ error: 'To, Subject, and Body are required.' });
        }

        const mail = {
            message: {
                subject: subject,
                body: {
                    contentType: 'HTML', // Using HTML to support rich text/templates
                    content: body
                },
                toRecipients: [
                    {
                        emailAddress: {
                            address: to
                        }
                    }
                ]
            },
            saveToSentItems: 'true'
        };

        await callGraphApiWithRefresh(
            user._id,
            user.msAccessToken,
            user.msRefreshToken,
            '/me/sendMail',
            'POST',
            mail
        );

        // Update history with email status if historyId provided
        if (historyId) {
            console.log('Updating history with emailStatus:', { historyId, emailType, to });
            const historyCollection = db.collection('history');
            const emailStatus = emailType === 'rejection' ? 'rejected' : 'accepted';

            const updateResult = await historyCollection.updateOne(
                { _id: new ObjectId(historyId) },
                {
                    $set: {
                        emailStatus: emailStatus,
                        emailSentAt: new Date(),
                        emailSentTo: to
                    }
                }
            );

            console.log('History update result:', updateResult);
            if (updateResult.matchedCount === 0) {
                console.warn('No history document found with ID:', historyId);
            }
        } else {
            console.log('No historyId provided in request');
        }

        res.json({ success: true, message: 'Email sent successfully via Outlook' });

    } catch (err) {
        console.error('Send Outlook mail error:', err);
        res.status(500).json({ error: 'Failed to send Outlook mail', details: err.message });
    }
};
