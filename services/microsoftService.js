import { ConfidentialClientApplication } from '@azure/msal-node';
import axios from 'axios';
import { client } from '../db/connect.js';
import { ObjectId } from 'mongodb';

const msalConfig = {
    auth: {
        clientId: process.env.MS_CLIENT_ID,
        authority: 'https://login.microsoftonline.com/common',
        clientSecret: process.env.MS_CLIENT_SECRET,
    }
};

const msalClient = new ConfidentialClientApplication(msalConfig);
const REDIRECT_URI = process.env.MS_REDIRECT_URI || 'http://localhost:3001/auth/microsoft/callback';

export const getAuthUrl = async (scopes = ['User.Read', 'Mail.Read', 'offline_access']) => {
    return await msalClient.getAuthCodeUrl({
        scopes,
        redirectUri: REDIRECT_URI,
    });
};

export const getTokenByCode = async (code, scopes = ['User.Read', 'Mail.Read', 'offline_access']) => {
    return await msalClient.acquireTokenByCode({
        code,
        scopes,
        redirectUri: REDIRECT_URI,
    });
};

export const callGraphApi = async (accessToken, endpoint, method = 'GET', data = null) => {
    const url = `https://graph.microsoft.com/v1.0${endpoint}`;
    // console.log(`[Microsoft Graph] Request: ${method} ${url}`); // This line was removed as per the instruction's snippet

    const config = {
        method,
        url,
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json'
        }
    };

    if (data && method !== 'GET') {
        config.data = data;
        config.headers['Content-Type'] = 'application/json';
    }

    // The try-catch block was removed from here as per the instruction's snippet
    const response = await axios(config);
    return response.data;
};

/**
 * Robust wrapper for callGraphApi that handles token refresh automatically
 */
export const callGraphApiWithRefresh = async (userId, accessToken, refreshToken, endpoint, method = 'GET', data = null) => {
    try {
        return await callGraphApi(accessToken, endpoint, method, data);
    } catch (err) {
        if (err.response && err.response.status === 401 && refreshToken) {
            console.log(`[Microsoft Graph] Token expired for user ${userId}, attempting refresh...`);
            try {
                const tokenResponse = await refreshMicrosoftToken(refreshToken);

                // Update database with new tokens
                const db = client.db('Interest');
                const usersCollection = db.collection('users');

                await usersCollection.updateOne(
                    { _id: new ObjectId(userId) },
                    {
                        $set: {
                            msAccessToken: tokenResponse.accessToken,
                            msRefreshToken: tokenResponse.refreshToken || refreshToken,
                            msIdToken: tokenResponse.idToken,
                            updatedAt: new Date()
                        }
                    }
                );

                console.log(`[Microsoft Graph] Token refreshed for ${userId}. Retrying request...`);
                return await callGraphApi(tokenResponse.accessToken, endpoint, method, data);
            } catch (refreshErr) {
                console.error(`[Microsoft Graph] Refresh failed for ${userId}:`, refreshErr.message);
                throw refreshErr;
            }
        }
        throw err;
    }
};

export const refreshMicrosoftToken = async (refreshToken, scopes = ['User.Read', 'Mail.Read', 'offline_access']) => {
    return await msalClient.acquireTokenByRefreshToken({
        refreshToken,
        scopes,
    });
};

export { msalClient };
