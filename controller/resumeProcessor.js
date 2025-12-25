import { google } from 'googleapis';
import { client } from '../db/connect.js';
import { ObjectId } from 'mongodb';
import getOAuth2Client from '../services/googleService.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.API_KEY);

// Normalize experience function (same as in Router.js)
function normalizeExperience(experienceArray) {
    if (!Array.isArray(experienceArray)) return [];

    const parseDate = (dateStr) => {
        if (!dateStr) return null;

        if (typeof dateStr === "string" && dateStr.toLowerCase() === "present") {
            return new Date();
        }

        const clean = dateStr.trim();

        // MM/YYYY
        if (/^\d{2}\/\d{4}$/.test(clean)) {
            const [m, y] = clean.split("/").map(Number);
            return new Date(y, m - 1);
        }

        // Month YYYY / Mon YYYY (June 2024, Nov 2023)
        const parsed = Date.parse(clean);
        if (!isNaN(parsed)) {
            return new Date(parsed);
        }

        return null;
    };

    return experienceArray.map(exp => {
        const startDate = parseDate(exp.start_date);
        const endDate = parseDate(exp.end_date);

        let months = null;
        if (startDate && endDate) {
            months =
                (endDate.getFullYear() - startDate.getFullYear()) * 12 +
                (endDate.getMonth() - startDate.getMonth());

            if (months < 0) months = 0;
        }

        return {
            company: exp.company,
            start_date: exp.start_date ?? null,
            end_date: exp.end_date ?? null,
            months
        };
    });
}

const processResumes = async (req, res) => {
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
                message: 'Upgrade to premium to process resumes.'
            });
        }

        const { emails } = req.body;

        if (!emails || !Array.isArray(emails) || emails.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No emails provided'
            });
        }

        const oAuth2Client = getOAuth2Client(user);
        const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

        const results = [];

        // Process each email
        for (const email of emails) {
            try {
                // Get email details to access attachments
                const messageDetails = await gmail.users.messages.get({
                    userId: 'me',
                    id: email.id
                });

                const payload = messageDetails.data.payload;
                const parts = payload.parts || [];

                // Find PDF/DOC attachments
                const resumeAttachments = [];
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
                            resumeAttachments.push({
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

                // Process only PDF attachments with Gemini
                for (const attachment of resumeAttachments) {
                    if (attachment.mimeType === 'application/pdf') {
                        try {
                            // Download attachment
                            const attachmentData = await gmail.users.messages.attachments.get({
                                userId: 'me',
                                messageId: email.id,
                                id: attachment.attachmentId
                            });

                            // Decode base64 data
                            const buffer = Buffer.from(attachmentData.data.data, 'base64');

                            // Process with Gemini
                            const model = genAI.getGenerativeModel({
                                model: "gemini-2.0-flash",
                                generationConfig: {
                                    responseMimeType: "application/json"
                                }
                            });

                            const prompt = `
Extract the following details from this resume PDF into a JSON object:

- name
- email
- mobile number
- github link
- linkedin link
- current_company
- skillsets (array of strings)
- collegename
- experience: array of objects with:
    - company (string)
    - start_date (string in MM/YYYY format)
    - end_date (string in MM/YYYY format OR "Present")

STRICT RULES:
- Extract dates EXACTLY as written in the resume.
- Do NOT calculate months or years.
- If end date is "Present", return "Present" exactly.
- If a date is missing, use null.
- Do NOT guess or infer dates.

Return ONLY valid JSON.
`;

                            const result = await model.generateContent([
                                { text: prompt },
                                {
                                    inlineData: {
                                        mimeType: "application/pdf",
                                        data: buffer.toString("base64")
                                    }
                                }
                            ]);

                            const aiText = result.response.text();
                            const parsed = JSON.parse(aiText);
                            parsed.experience = normalizeExperience(parsed.experience);

                            results.push({
                                emailId: email.id,
                                emailSubject: email.subject,
                                filename: attachment.filename,
                                parsedData: parsed,
                                status: 'success'
                            });

                        } catch (err) {
                            results.push({
                                emailId: email.id,
                                emailSubject: email.subject,
                                filename: attachment.filename,
                                error: err.message,
                                status: 'failed'
                            });
                        }
                    }
                }

            } catch (err) {
                results.push({
                    emailId: email.id,
                    emailSubject: email.subject,
                    error: err.message,
                    status: 'failed'
                });
            }
        }

        // Save to history if premium
        if (user.isPremium) {
            const historyCollection = db.collection('history');
            const historyEntries = results.map(result => ({
                userId: user._id,
                userEmail: user.email,
                userName: user.name || null,
                folderId: 'gmail-resumes',
                filename: result.filename || 'N/A',
                parsedData: result.parsedData || null,
                error: result.error || null,
                status: result.status,
                emailId: result.emailId,
                emailSubject: result.emailSubject,
                timestamp: new Date(),
                metadata: {
                    source: 'gmail',
                    totalProcessed: results.length
                }
            }));

            if (historyEntries.length > 0) {
                await historyCollection.insertMany(historyEntries);
            }
        }

        return res.json({
            success: true,
            message: `Processed ${results.length} resumes`,
            results
        });

    } catch (err) {
        console.error('Process resumes error:', err);

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
            error: 'FAILED_TO_PROCESS_RESUMES',
            details: err.message
        });
    }
};

export { processResumes };
