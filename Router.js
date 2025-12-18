// routes.js

import express from 'express';
import { client } from './db/connect.js';
// const { youtube } = require('scrape-youtube');
const router = express.Router();
import axios from 'axios';
import multer from 'multer';
import { PdfReader } from 'pdfreader';
import authMiddleware from './middleware/authMiddleware.js';
import paymentRouter from './paymentRouter.js';
let pLimit;
(async () => {
  pLimit = (await import('p-limit')).default;
})();


// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });



// 1. Setup - Paste your API key here (Keep this secret!)
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

// Change this import
import { GoogleGenerativeAI } from '@google/generative-ai';
// const { PdfReader } = require("pdfreader");

// Initialize with the correct class for API Keys
// Ideally, put the key in process.env.GEMINI_API_KEY
const genAI = new GoogleGenerativeAI(process.env.API_KEY);

router.post(
  '/pdf-to-text',
  authMiddleware.verifyToken,
  authMiddleware.getUserFromDB,
  upload.array('pdfs', 10),
  async (req, res) => {
    try {

      const pdfCount = req.files.length;

      if (req.user.credits < pdfCount) {
        return res.status(402).json({
          success: false,
          message: `Not enough credits`
        });
      }

      // 🔥 Deduct credits first
      const db = client.db('Interest');
      const usersCollection = db.collection('users');

      await usersCollection.updateOne(
        { _id: req.user._id },
        { $inc: { credits: -pdfCount } }
      );

      const model = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        generationConfig: {
          responseMimeType: "application/json"
        }
      });

      const limit = pLimit(3); // only 3 parallel resumes

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

      const tasks = req.files.map(file =>
        limit(async () => {
          try {
            const result = await model.generateContent([
              { text: prompt },
              {
                inlineData: {
                  mimeType: "application/pdf",
                  data: file.buffer.toString("base64")
                }
              }
            ]);

            const aiText = result.response.text();
            const parsed = JSON.parse(aiText);

            console.log("Prompt tokens:", result.response.usageMetadata.promptTokenCount);
            console.log("Response tokens:", result.response.usageMetadata.candidatesTokenCount);
            console.log("Total tokens:", result.response.usageMetadata.totalTokenCount);

            parsed.experience = normalizeExperience(parsed.experience);

            return {
              filename: file.originalname,
              parsed_data: parsed
            };

          } catch (err) {
            return {
              filename: file.originalname,
              error: err.message
            };
          }
        })
      );

      const results = await Promise.all(tasks);

      // 🔥 Save history for each processed document
      const historyCollection = db.collection('history');
      const historyEntries = results.map(result => ({
        userId: req.user._id,
        userEmail: req.user.email,
        userName: req.user.name || null,
        processType: 'pdf-to-text',
        filename: result.filename,
        parsedData: result.parsed_data || null,
        error: result.error || null,
        status: result.error ? 'failed' : 'success',
        creditsUsed: 1,
        timestamp: new Date(),
        metadata: {
          totalFiles: pdfCount,
          remainingCredits: req.user.credits - pdfCount
        }
      }));

      // Insert all history entries
      if (historyEntries.length > 0) {
        await historyCollection.insertMany(historyEntries);
      }

      res.json({ success: true, results });

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Define routes for the router
router.get('/normalNews', async (req, res) => {
  const db = client.db("NewsList");
  const collection = db.collection("Student");
  const documents = await collection.find().limit(15);
  res.json({ res: documents[0]?.object })
});

router.get('/getCollectionData', async (req, res) => {
  const { collectionName } = req.query;
  const db = client.db("NewsList");
  const collection = db.collection(collectionName);
  const latestDoc = await collection
    .find()
    .sort({ _id: -1 }) // Sort by _id descending
    .limit(1)
    .toArray();

  res.json({ res: latestDoc });

});

router.get('/astrolings', async (req, res) => {
  // const {collectionName}= req.query;
  const db = client.db("NewsList");
  const collection = db.collection("Astro");
  const latestDocs = await collection.find().toArray();

  res.json({ res: latestDocs });

});



router.get('/categoryList', async (req, res) => {
  const db = client.db("NewsList");

  // Get a list of all collection names
  const collections = await db.listCollections().toArray();
  let collectionNames = collections.map(collection => collection.name);
  collectionNames = collectionNames?.filter((item) => item !== 'Dataset')
  collectionNames = collectionNames?.filter((item) => item !== 'Student')
  res.json({ collections: collectionNames });
  console.log("done");
});

router.get('/about', async (req, res) => {
  const url = `https://www.youtube.com/results?search_query=${req.query.topic}`
  const html = await axios.get(url);
  const $ = cheerio.load(html.data);
  const plainText = $.root().text();
  let currentIndex = plainText.indexOf('/shorts')
  const searchString = '/shorts';
  const substringLength = 10;
  const resultArray = []; while (currentIndex !== -1) {
    // const start = Math.max(0, currentIndex - substringLength);
    const substring = plainText.substring(currentIndex, currentIndex + 20);
    resultArray.push(substring);
    // Move to the next occurrence of the search string
    currentIndex = plainText.indexOf(searchString, currentIndex + 1);
  }
  console.log(resultArray);

  res.send({ res: plainText.indexOf('shorts'), r: plainText.substring(currentIndex, currentIndex + 20), res3: resultArray })

  // Print the plain text content
  console.log(resultArray);

  // console.log(html);
  const links = []
  const mainlist = $('.yt-spec-icon-shape')
  // console.log(html)

  mainlist.each((index, element) => {
    const article = $(element);

    console.log("sd");
  });
});

// PDF to text conversion endpoint
// const { PdfReader } = require("pdfreader");

// PDF to text conversion endpoint



// History routes
// Get all history for the authenticated user
router.get('/history',
  authMiddleware.verifyToken,
  authMiddleware.getUserFromDB,
  async (req, res) => {
    try {
      const db = client.db('Interest');
      const historyCollection = db.collection('history');

      const { page = 1, limit = 20, processType, status } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Build query filter
      const filter = { userId: req.user._id };
      if (processType) filter.processType = processType;
      if (status) filter.status = status;

      // Get history with pagination
      const history = await historyCollection
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      // Get total count for pagination
      const total = await historyCollection.countDocuments(filter);

      res.json({
        success: true,
        data: history,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Get history by process type
router.get('/history/:processType',
  authMiddleware.verifyToken,
  authMiddleware.getUserFromDB,
  async (req, res) => {
    try {
      const db = client.db('Interest');
      const historyCollection = db.collection('history');

      const { processType } = req.params;
      const { page = 1, limit = 20 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const history = await historyCollection
        .find({
          userId: req.user._id,
          processType: processType
        })
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      const total = await historyCollection.countDocuments({
        userId: req.user._id,
        processType: processType
      });

      res.json({
        success: true,
        data: history,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Get single history entry by ID
router.get('/history/entry/:id',
  authMiddleware.verifyToken,
  authMiddleware.getUserFromDB,
  async (req, res) => {
    try {
      const db = client.db('Interest');
      const historyCollection = db.collection('history');
      const { ObjectId } = await import('mongodb');

      const historyEntry = await historyCollection.findOne({
        _id: new ObjectId(req.params.id),
        userId: req.user._id
      });

      if (!historyEntry) {
        return res.status(404).json({
          success: false,
          message: 'History entry not found'
        });
      }

      res.json({
        success: true,
        data: historyEntry
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Mount payment routes
router.use('/api/payment', paymentRouter);

export default router;

