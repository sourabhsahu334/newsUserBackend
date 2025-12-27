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
                folderTypes: ["default"],
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
