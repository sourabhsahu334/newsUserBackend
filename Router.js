// routes.js

const express = require('express');
const { client } = require('./db/connect');
const { youtube } = require('scrape-youtube');
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');
const multer = require('multer');
const { PdfReader } = require("pdfreader");

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });



// 1. Setup - Paste your API key here (Keep this secret!)

// Change this import
const { GoogleGenerativeAI } = require("@google/generative-ai");
// const { PdfReader } = require("pdfreader");

// Initialize with the correct class for API Keys
// Ideally, put the key in process.env.GEMINI_API_KEY
const genAI = new GoogleGenerativeAI(process.env.API_KEY); 

router.post('/pdf-to-text', upload.array('pdfs', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No PDF files uploaded' });
    }

    const results = [];
    
    // Initialize the model instance here
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash-lite-001",
        // CRITICAL: This forces the model to return actual JSON, preventing parsing errors
        generationConfig: { responseMimeType: "application/json" } 
    });

    for (const file of req.files) {
      try {
        // --- 1. Validation ---
        if (!file.originalname.toLowerCase().endsWith('.pdf')) {
          results.push({ filename: file.originalname, error: 'File is not a PDF' });
          continue;
        }

        // --- 2. Extract Text ---
        const textChunks = [];
        await new Promise((resolve, reject) => {
          new PdfReader().parseBuffer(file.buffer, (err, item) => {
            if (err) return reject(err);
            if (!item) return resolve();
            if (item.text) textChunks.push(item.text);
          });
        });

        const rawText = textChunks.join(" ");

        // --- 3. AI Extraction ---
        if (rawText.trim().length > 0) {
            
          const prompt = `
            Extract the following details from the resume below into a JSON object:
            - name
            - current_company
            - skillssets (array of strings)
            - collegename
            - total_experience_months: array of objects with { company: string, months: number }

            If a field is not found, use null.
            
            RESUME TEXT:
            ${rawText}
          `;
          // Generate content
          const result = await model.generateContent(prompt);
          const response = await result.response;
          const aiText = response.text();

          let parsedJSON;
          try {
            parsedJSON = JSON.parse(aiText);
          } catch (e) {
            parsedJSON = { error: "AI JSON parsing failed", raw: aiText };
          }

          results.push({
            filename: file.originalname,
            parsed_data: parsedJSON
          });
        }

      } catch (error) {
        console.error(`Error processing ${file.originalname}:`, error);
        results.push({
          filename: file.originalname,
          error: `Processing failed: ${error.message}`
        });
      }
    }

    res.json({ success: true, results });

  } catch (error) {
    console.error('Batch processing error:', error);
    res.status(500).json({ error: error.message });
  }
});
// Define routes for the router
router.get('/normalNews', async(req, res) => {
    const db = client.db("NewsList");
    const collection = db.collection("Student");
    const documents = await collection.find().limit(15);
    res.json({res:documents[0]?.object})
});

router.get('/getCollectionData', async(req, res) => {
  const {collectionName}= req.query;
  const db = client.db("NewsList");
  const collection = db.collection(collectionName);
const latestDoc = await collection
      .find()
      .sort({ _id: -1 }) // Sort by _id descending
      .limit(1)
      .toArray();

    res.json({ res: latestDoc });

});

router.get('/astrolings', async(req, res) => {
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
  collectionNames= collectionNames?.filter((item)=>item!=='Dataset')
  collectionNames= collectionNames?.filter((item)=>item!=='Student')
  res.json({ collections: collectionNames });
  console.log("done");
});

router.get('/about', async(req, res) => {
const url = `https://www.youtube.com/results?search_query=${req.query.topic}`
  const html= await axios.get(url);
  const $=cheerio.load(html.data);
  const plainText = $.root().text();
  let currentIndex = plainText.indexOf('/shorts')
  const searchString = '/shorts';
  const substringLength = 10;
  const resultArray = [];  while (currentIndex !== -1) {
    // const start = Math.max(0, currentIndex - substringLength);
    const substring = plainText.substring(currentIndex, currentIndex+20);
    resultArray.push(substring); 
    // Move to the next occurrence of the search string
    currentIndex = plainText.indexOf(searchString, currentIndex + 1);
  }
  console.log(resultArray);

  res.send({res:plainText.indexOf('shorts'),r:plainText.substring(currentIndex,currentIndex+20),res3:resultArray})

// Print the plain text content
console.log(resultArray);

  // console.log(html);
  const links = [ ]
  const mainlist= $('.yt-spec-icon-shape')
  // console.log(html)

  mainlist.each((index,element)=>{
    const article = $(element);

    console.log("sd");
  });
});

// PDF to text conversion endpoint
// const { PdfReader } = require("pdfreader");

// PDF to text conversion endpoint



module.exports = router;
