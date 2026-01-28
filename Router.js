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
      let { jd } = req.body;
      const creditsToDeduct = jd ? pdfCount * 2 : pdfCount;

      // Sum valid (non-expired) credits
      const now = new Date();
      const validCredits = (req.user.credits || []).filter(c => new Date(c.expiresAt) > now);
      const totalCredits = validCredits.reduce((sum, c) => sum + c.amount, 0);

      if (totalCredits < creditsToDeduct) {
        return res.status(402).json({
          success: false,
          message: `Not enough credits. Available: ${totalCredits}, Required: ${creditsToDeduct}`
        });
      }

      // 🔥 Deduct credits sequentially starting from blocks expiring soonest
      const db = client.db('Interest');
      const usersCollection = db.collection('users');

      // Sort by expiry date ascending
      let credits = [...(req.user.credits || [])].sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt));
      let remainingToDeduct = creditsToDeduct;

      for (let i = 0; i < credits.length && remainingToDeduct > 0; i++) {
        if (new Date(credits[i].expiresAt) <= now) continue; // Skip expired

        if (credits[i].amount <= remainingToDeduct) {
          remainingToDeduct -= credits[i].amount;
          credits[i].amount = 0;
        } else {
          credits[i].amount -= remainingToDeduct;
          remainingToDeduct = 0;
        }
      }

      // Filter out empty and expired blocks
      const updatedCredits = credits.filter(c => c.amount > 0 && new Date(c.expiresAt) > now);

      await usersCollection.updateOne(
        { _id: req.user._id },
        { $set: { credits: updatedCredits } }
      );

      // Update req.user for subsequent use in the same request if needed
      req.user.credits = updatedCredits;
      const currentTotalCredits = updatedCredits.reduce((sum, c) => sum + (c.amount || 0), 0);

      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: {
          responseMimeType: "application/json"
        }
      });

      const limit = pLimit(3); // only 3 parallel resumes

      const tasks = req.files.map(file =>
        limit(async () => {
          try {
            // Convert PDF buffer to base64 for Gemini
            const pdfBase64 = file.buffer.toString('base64');

            // Build prompt for resume extraction
            let prompt = `
Extract the following details from this resume PDF into a JSON object:

Extract these fields:
- name
- email
- mobile_number
- github_link
- linkedin_link
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

            if (jd) {
              prompt += `
ADDITIONAL TASK:
Commonly referred to as a "Fit Analysis" against the provided Job Description (JD) below.

Job Description:
"""
${jd}
"""

Include these two extra fields in the JSON object:
1. summary: A concise 2-sentence summary of why the candidate is or isn't a good fit.
2. fitStatus: One of these values: "Highly Recommended", "Good Fit", "Average", "Not a Match".
`;
            }

            const result = await model.generateContent([
              {
                inlineData: {
                  mimeType: 'application/pdf',
                  data: pdfBase64
                }
              },
              { text: prompt }
            ]);

            const aiText = result.response.text();
            const parsed = JSON.parse(aiText);

            console.log("Prompt tokens:", result.response.usageMetadata.promptTokenCount);
            console.log("Response tokens:", result.response.usageMetadata.candidatesTokenCount);
            console.log("Total tokens:", result.response.usageMetadata.totalTokenCount);

            parsed.experience = normalizeExperience(parsed.experience);

            return {
              filename: file.originalname,
              parsedData: parsed
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

      let { folderId = 'pdf-to-text' } = req.body;
      const folderIdArray = Array.isArray(folderId) ? folderId : [folderId];

      // If no JD provided in body, try to find it from the folder settings
      if (!jd && req.user.folderTypes && folderId !== 'pdf-to-text') {
        const primaryFolder = folderIdArray[0];
        // Handle both legacy string array and new object array
        const folderObj = req.user.folderTypes.find(f =>
          (typeof f === 'string' && f === primaryFolder) ||
          (typeof f === 'object' && f.foldername === primaryFolder)
        );

        if (folderObj && typeof folderObj === 'object' && folderObj.JD) {
          jd = folderObj.JD;
          console.log(`Using JD from folder ${primaryFolder}`);
        }
      }

      // 🔥 Save history for each processed document if user is premium or JD provided
      // if (req.user.isPremium || jd) {
      if (true) {
        const historyCollection = db.collection('history');
        // Filter out results with errors - only save successful entries
        const successfulResults = results.filter(result => !result.error);
        const historyEntries = successfulResults.map(result => ({
          userId: req.user._id,
          userEmail: req.user.email,
          userName: req.user.name || null,
          folderId: folderIdArray,
          filename: result.filename,
          parsedData: result.parsedData || null,
          error: result.error || null,
          status: result.error ? 'failed' : 'success',
          creditsUsed: jd ? 2 : 1,
          timestamp: new Date(),
          metadata: {
            totalFiles: pdfCount,
            remainingCredits: currentTotalCredits,
            jdProvided: !!jd,
            jdText: jd ? (jd.length > 500 ? jd.substring(0, 500) + '...' : jd) : null
          }
        }));

        // Insert all history entries
        if (historyEntries.length > 0) {
          await historyCollection.insertMany(historyEntries);
        }
      }

      res.json({
        success: true,
        results,
        creditsUsed: creditsToDeduct,
        remainingCredits: currentTotalCredits
      });

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

      const { page = 1, limit = 20, folderId, status } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Build query filter
      const filter = { userId: req.user._id };
      if (folderId) filter.folderId = Array.isArray(folderId) ? { $in: folderId } : folderId;
      if (status) filter.status = status;

      console.log('Filter being used:', filter);

      // Get history with pagination
      const history = await historyCollection
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      console.log(`Found ${history.length} history entries for user:`, req.user._id);
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

// Get history by folder ID
router.get('/history/:folderId',
  authMiddleware.verifyToken,
  authMiddleware.getUserFromDB,
  async (req, res) => {
    try {
      const db = client.db('Interest');
      const historyCollection = db.collection('history');

      const { folderId } = req.params;
      const { page = 1, limit = 20 } = req.query;
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const history = await historyCollection
        .find({
          userId: req.user._id,
          folderId: Array.isArray(folderId) ? { $in: folderId } : folderId
        })
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      const total = await historyCollection.countDocuments({
        userId: req.user._id,
        folderId: folderId
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

// Search history by resume fields (name, email, skills, company, mobile)
router.post('/search-history',
  authMiddleware.verifyToken,
  authMiddleware.getUserFromDB,
  async (req, res) => {
    try {
      const db = client.db('Interest');
      const historyCollection = db.collection('history');

      const { query, page = 1, limit = 20, folderId } = req.body;

      // Validate search query
      if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Search query is required and must be a non-empty string'
        });
      }

      const trimmedQuery = query.trim();
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Build base filter with userId
      const baseFilter = {
        userId: req.user._id,
        status: 'success' // Only search in successful entries
      };

      // Add folderId filter if provided
      if (folderId) {
        baseFilter.folderId = Array.isArray(folderId) ? { $in: folderId } : folderId;
      }

      // Build search filter with $or for multiple fields
      const searchFilter = {
        ...baseFilter,
        $or: [
          { "parsedData.name": { $regex: trimmedQuery, $options: "i" } },
          { "parsedData.email": { $regex: trimmedQuery, $options: "i" } },
          { "parsedData.mobile": { $regex: trimmedQuery } },
          { "parsedData.skillsets": { $regex: trimmedQuery, $options: "i" } },
          { "parsedData.experience.company": { $regex: trimmedQuery, $options: "i" } },
          { "parsedData.current_company": { $regex: trimmedQuery, $options: "i" } },
          { "parsedData.collegename": { $regex: trimmedQuery, $options: "i" } }
        ]
      };

      // Execute search with pagination
      const results = await historyCollection
        .find(searchFilter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      // Get total count for pagination
      const total = await historyCollection.countDocuments(searchFilter);

      res.json({
        success: true,
        query: trimmedQuery,
        data: results,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / parseInt(limit))
        }
      });

    } catch (err) {
      console.error('Error searching history:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to search history',
        error: err.message
      });
    }
  }
);



// Update activeColumn endpoint - stores activeColumn inside specific folder in folderTypes
router.post('/update-active-column',
  authMiddleware.verifyToken,
  authMiddleware.getUserFromDB,
  async (req, res) => {
    try {
      const { activeColumn, folderName } = req.body;

      if (!Array.isArray(activeColumn)) {
        return res.status(400).json({
          success: false,
          message: 'activeColumn must be an array'
        });
      }

      if (!folderName) {
        return res.status(400).json({
          success: false,
          message: 'folderName is required'
        });
      }

      const db = client.db('Interest');
      const usersCollection = db.collection('users');

      // Get user's current folderTypes
      const user = await usersCollection.findOne({ _id: req.user._id });

      if (!user || !user.folderTypes) {
        return res.status(404).json({
          success: false,
          message: 'User or folderTypes not found'
        });
      }

      // Update the specific folder's activeColumn
      const updatedFolderTypes = user.folderTypes.map(folder => {
        if (typeof folder === 'object' && folder.foldername === folderName) {
          return {
            ...folder,
            activeColumn: activeColumn
          };
        } else if (typeof folder === 'string' && folder === folderName) {
          // Convert string to object if needed
          return {
            foldername: folder,
            activeColumn: activeColumn
          };
        }
        return folder;
      });

      // Update the entire folderTypes array
      await usersCollection.updateOne(
        { _id: req.user._id },
        { $set: { folderTypes: updatedFolderTypes } }
      );

      res.json({
        success: true,
        message: 'Active column updated successfully for folder',
        folderName,
        activeColumn
      });

    } catch (err) {
      console.error('Error updating active column:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to update active column',
        error: err.message
      });
    }
  }
);

// Get activeColumn for a specific folder
router.get('/get-active-column/:folderName',
  authMiddleware.verifyToken,
  authMiddleware.getUserFromDB,
  async (req, res) => {
    try {
      const { folderName } = req.params;

      if (!folderName) {
        return res.status(400).json({
          success: false,
          message: 'folderName is required'
        });
      }

      const db = client.db('Interest');
      const usersCollection = db.collection('users');

      const user = await usersCollection.findOne({ _id: req.user._id });

      if (!user || !user.folderTypes) {
        return res.status(404).json({
          success: false,
          message: 'User or folderTypes not found'
        });
      }

      // Find the specific folder and get its activeColumn
      const folder = user.folderTypes.find(f => {
        if (typeof f === 'object') {
          return f.foldername === folderName;
        }
        return f === folderName;
      });

      if (!folder) {
        return res.status(404).json({
          success: false,
          message: 'Folder not found'
        });
      }

      const activeColumn = typeof folder === 'object' ? folder.activeColumn : null;

      res.json({
        success: true,
        folderName,
        activeColumn: activeColumn || []
      });

    } catch (err) {
      console.error('Error getting active column:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to get active column',
        error: err.message
      });
    }
  }
);

// Create folder endpoint - adds folder name to user's folderTypes array
router.post('/create-folder',
  authMiddleware.verifyToken,
  authMiddleware.getUserFromDB,
  async (req, res) => {
    try {
      const { folderName, jd } = req.body;

      // Validate folderName
      if (!folderName || typeof folderName !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Folder name is required and must be a string'
        });
      }

      // Trim and validate folderName is not empty
      const trimmedFolderName = folderName.trim();
      if (trimmedFolderName.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Folder name cannot be empty'
        });
      }

      const db = client.db('Interest');
      const usersCollection = db.collection('users');

      // Check if folder name already exists
      const folderExists = req.user.folderTypes && req.user.folderTypes.some(f => {
        if (typeof f === 'string') return f === trimmedFolderName;
        return f.foldername === trimmedFolderName;
      });

      if (folderExists) {
        return res.status(405).json({
          success: false,
          message: 'folder already exist'
        });
      }

      const newFolder = {
        foldername: trimmedFolderName,
        JD: jd || "",
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
      };

      // Add folderName to user's folderTypes array
      const result = await usersCollection.updateOne(
        { _id: req.user._id },
        {
          $push: { folderTypes: newFolder }
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Fetch updated user to return the folderTypes array
      const updatedUser = await usersCollection.findOne(
        { _id: req.user._id },
        { projection: { folderTypes: 1 } }
      );

      res.json({
        success: true,
        message: 'Folder created successfully',
        folderTypes: updatedUser.folderTypes || []
      });

    } catch (err) {
      console.error('Error creating folder:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to create folder',
        error: err.message
      });
    }
  }
);

// Get user's folders
router.get('/folders',
  authMiddleware.verifyToken,
  authMiddleware.getUserFromDB,
  async (req, res) => {
    try {
      const db = client.db('Interest');
      const usersCollection = db.collection('users');

      const user = await usersCollection.findOne(
        { _id: req.user._id },
        { projection: { folderTypes: 1 } }
      );

      res.json({
        success: true,
        folderTypes: user?.folderTypes || []
      });

    } catch (err) {
      console.error('Error fetching folders:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch folders',
        error: err.message
      });
    }
  }
);

// Delete folder endpoint - removes folder name from user's folderTypes array
router.post('/delete-folder',
  authMiddleware.verifyToken,
  authMiddleware.getUserFromDB,
  async (req, res) => {
    try {
      const { folderName } = req.body;

      // Validate folderName
      if (!folderName || typeof folderName !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Folder name is required and must be a string'
        });
      }

      const trimmedFolderName = folderName.trim();
      const db = client.db('Interest');
      const usersCollection = db.collection('users');

      // Remove folderName from user's folderTypes array using $pull
      // Handle both legacy strings and new objects
      await usersCollection.updateOne(
        { _id: req.user._id },
        {
          $pull: { folderTypes: trimmedFolderName }
        }
      );

      const result = await usersCollection.updateOne(
        { _id: req.user._id },
        {
          $pull: { folderTypes: { foldername: trimmedFolderName } }
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      // Fetch updated user to return the updated folderTypes array
      const updatedUser = await usersCollection.findOne(
        { _id: req.user._id },
        { projection: { folderTypes: 1 } }
      );

      res.json({
        success: true,
        message: 'Folder deleted successfully',
        folderTypes: updatedUser.folderTypes || []
      });

    } catch (err) {
      console.error('Error deleting folder:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to delete folder',
        error: err.message
      });
    }
  }
);

// Delete a single history entry by ID
router.delete('/history/:id',
  authMiddleware.verifyToken,
  authMiddleware.getUserFromDB,
  async (req, res) => {
    try {
      const db = client.db('Interest');
      const historyCollection = db.collection('history');
      const { ObjectId } = await import('mongodb');

      const { folderId } = req.body;
      if (!folderId) {
        return res.status(400).json({ success: false, message: 'folderId is required' });
      }

      const result = await historyCollection.updateOne(
        {
          _id: new ObjectId(req.params.id),
          userId: req.user._id
        },
        { $pull: { folderId: folderId } }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: 'History entry not found or unauthorized'
        });
      }

      res.json({
        success: true,
        message: `History entry removed from ${folderId}`
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Delete all history for the authenticated user (Bulk Delete)
router.delete('/history',
  authMiddleware.verifyToken,
  authMiddleware.getUserFromDB,
  async (req, res) => {
    try {
      const db = client.db('Interest');
      const historyCollection = db.collection('history');

      const { ids, folderId } = req.body;
      const { ObjectId } = await import('mongodb');

      if (!ids || !Array.isArray(ids) || ids.length === 0 || !folderId) {
        return res.status(400).json({
          success: false,
          message: 'An array of IDs and folderId are required'
        });
      }

      const filter = {
        userId: req.user._id,
        _id: { $in: ids.map(id => new ObjectId(id)) }
      };

      const result = await historyCollection.updateMany(filter, {
        $pull: { folderId: folderId }
      });

      res.json({
        success: true,
        message: `Removed ${result.modifiedCount} history entries from ${folderId}`,
        modifiedCount: result.modifiedCount
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Copy history entries to another folder
router.post('/copy-history',
  authMiddleware.verifyToken,
  authMiddleware.getUserFromDB,
  async (req, res) => {
    try {
      const { ids, targetFolder } = req.body;
      if (!ids || !Array.isArray(ids) || !targetFolder) {
        return res.status(400).json({ success: false, message: 'IDs and targetFolder are required' });
      }

      const db = client.db('Interest');
      const historyCollection = db.collection('history');
      const { ObjectId } = await import('mongodb');

      const result = await historyCollection.updateMany(
        {
          _id: { $in: ids.map(id => new ObjectId(id)) },
          userId: req.user._id
        },
        { $addToSet: { folderId: targetFolder } }
      );

      res.json({
        success: true,
        message: `Copied ${result.modifiedCount} entries to ${targetFolder}`,
        modifiedCount: result.modifiedCount
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Move history entries from one folder to another
router.post('/move-history',
  authMiddleware.verifyToken,
  authMiddleware.getUserFromDB,
  async (req, res) => {
    try {
      const { ids, sourceFolder, targetFolder } = req.body;
      if (!ids || !Array.isArray(ids) || !sourceFolder || !targetFolder) {
        return res.status(400).json({ success: false, message: 'IDs, sourceFolder, and targetFolder are required' });
      }

      const db = client.db('Interest');
      const historyCollection = db.collection('history');
      const { ObjectId } = await import('mongodb');

      // 1. Remove sourceFolder
      // 2. Add targetFolder
      const filter = {
        _id: { $in: ids.map(id => new ObjectId(id)) },
        userId: req.user._id
      };

      const result = await historyCollection.updateMany(filter, {
        $pull: { folderId: sourceFolder },
      });

      await historyCollection.updateMany(filter, {
        $addToSet: { folderId: targetFolder }
      });

      res.json({
        success: true,
        message: `Moved entries from ${sourceFolder} to ${targetFolder}`,
        modifiedCount: result.modifiedCount
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Delete account (Clear tokens but keep email and credits)
router.post('/delete-account',
  authMiddleware.verifyToken,
  authMiddleware.getUserFromDB,
  async (req, res) => {
    try {
      const db = client.db('Interest');
      const usersCollection = db.collection('users');

      // Find the user and update to remove all OAuth related fields
      // We keep: email, credits, isPremium (since credits/premium are tied to email/payment)
      // We remove: googleId, msId, zoomId, all tokens and scopes
      const updateResult = await usersCollection.updateOne(
        { _id: req.user._id },
        {
          $set: {
            googleId: null,
            accessToken: null,
            refreshToken: null,
            gmailGrantedScopes: [],
            gmailAccessToken: null,
            gmailRefreshToken: null,
            gmailGrantedScopes: [],
            msId: null,
            msEmail: null,
            msAccessToken: null,
            msRefreshToken: null,
            msIdToken: null,
            msGrantedScopes: [],
            zoomId: null,
            zoomEmail: null,
            zoomAccessToken: null,
            zoomRefreshToken: null,
            zoomGrantedScopes: [],
            slackId: null,
            slackEmail: null,
            slackAccessToken: null,
            slackTeamId: null,
            slackTeamName: null,
            slackGrantedScopes: [],
            instagramId: null,
            instagramUsername: null,
            instagramAccessToken: null,
            instagramGrantedScopes: [],
            metaId: null,
            metaEmail: null,
            metaAccessToken: null,
            metaGrantedScopes: [],
            metaPageTokens: [],
            passwordHash: null
          }
        }
      );

      if (updateResult.matchedCount === 0) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      res.json({
        success: true,
        message: 'Account sensitive data removed. Email and credits preserved.'
      });
    } catch (err) {
      console.error('Error deleting account:', err);
      res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
    }
  }
);

// Mount payment routes
router.use('/api/payment', paymentRouter);

export default router;

