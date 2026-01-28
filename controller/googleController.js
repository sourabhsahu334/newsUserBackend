import { getGoogleAuthUrl } from '../services/googleService.js';

export const googleCustomAuth = async (req, res) => {
    const { scopes } = req.body;
    if (!Array.isArray(scopes) || scopes.length === 0) {
        return res.status(400).json({ error: 'Scopes array is required.' });
    }
    try {
        const url = await getGoogleAuthUrl(scopes);
        res.json({ redirectUrl: url });
    } catch (err) {
        res.status(500).json({ error: 'Failed to initiate Google login', details: err.message });
    }
};
