import express from "express";
import dotenv from "dotenv";
import twilio from "twilio";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: false }));

const VoiceResponse = twilio.twiml.VoiceResponse;

/* ---------------- GEMINI SETUP ---------------- */
const genAI = new GoogleGenerativeAI(process.env.API_KEY);

const model = genAI.getGenerativeModel({
    model: "gemini-1.5-pro",
    systemInstruction: `
You are a professional real estate call assistant in India.
Rules:
- Speak politely and clearly
- Keep responses under 20 seconds
- Ask clarifying questions
- Never invent prices or availability
- If unsure, say you will connect to a human agent
`
});

/* ---------------- BUSINESS CONTEXT ---------------- */
const BUSINESS_CONTEXT = `
Company: ABC Real Estate
City: Bangalore

Properties:
- 2BHK starting from 45 Lakhs (Whitefield, Electronic City)
- 3BHK starting from 75 Lakhs (Whitefield, Sarjapur)

Amenities:
- Covered parking
- Power backup
- Lift

Site visits available on weekends.
`;

/* ---------------- CALL MEMORY ---------------- */
let callMemory = {
    budget: null,
    location: null,
    purpose: null
};

/* ---------------- AI FUNCTION ---------------- */
async function getAIReply(userText) {
    const prompt = `
CALL MEMORY:
Budget: ${callMemory.budget || "Unknown"}
Location: ${callMemory.location || "Unknown"}
Purpose: ${callMemory.purpose || "Unknown"}

BUSINESS DATA:
${BUSINESS_CONTEXT}

USER SAID:
${userText}

Respond like a real estate consultant.
`;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

/* ---------------- HEALTH CHECK ---------------- */
app.get("/", (req, res) => {
    res.send("✅ AI Real Estate Call Assistant Running");
});

/* ---------------- INCOMING CALL ---------------- */
app.post("/voice", (req, res) => {
    const twiml = new VoiceResponse();

    twiml.say(
        { voice: "alice", language: "en-IN" },
        "Welcome to ABC Real Estate. How may I assist you today?"
    );

    twiml.pause({ length: 1 });

    twiml.gather({
        input: "speech",
        action: "/process",
        method: "POST",
        timeout: 6,
        speechTimeout: "auto",
        actionOnEmptyResult: true
    });

    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());
});

/* ---------------- PROCESS USER SPEECH ---------------- */
app.post("/process", async (req, res) => {
    try {
        const userText = req.body.SpeechResult || "";

        const twiml = new VoiceResponse();

        /* ---- HANDLE SILENCE ---- */
        if (userText.trim() === "") {
            twiml.say(
                { voice: "alice", language: "en-IN" },
                "I did not catch that. Could you please repeat?"
            );

            twiml.gather({
                input: "speech",
                action: "/process",
                method: "POST",
                timeout: 6,
                speechTimeout: "auto",
                actionOnEmptyResult: true
            });

            res.writeHead(200, { "Content-Type": "text/xml" });
            return res.end(twiml.toString());
        }

        /* ---- SIMPLE MEMORY EXTRACTION ---- */
        if (/lakh|crore/i.test(userText)) callMemory.budget = userText;
        if (/whitefield|sarjapur|electronic/i.test(userText)) callMemory.location = userText;
        if (/rent|buy|purchase/i.test(userText)) callMemory.purpose = userText;

        /* ---- AI RESPONSE ---- */
        const aiReply = await getAIReply(userText);

        twiml.say(
            { voice: "alice", language: "en-IN" },
            aiReply
        );

        twiml.pause({ length: 1 });

        twiml.gather({
            input: "speech",
            action: "/process",
            method: "POST",
            timeout: 6,
            speechTimeout: "auto",
            actionOnEmptyResult: true
        });

        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(twiml.toString());

    } catch (error) {
        const twiml = new VoiceResponse();
        twiml.say(
            { voice: "alice", language: "en-IN" },
            "Sorry, I am facing a technical issue. Please try again later."
        );

        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(twiml.toString());
    }
});

/* ---------------- START SERVER ---------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
