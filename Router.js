// routes.js

const express = require('express');
const { client } = require('./db/connect');
const { youtube } = require('scrape-youtube');
const router = express.Router();
const axios = require('axios');
const cheerio = require('cheerio');
const url = 'https://www.youtube.com/results?search_query=mppsc'; // Replace with the URL you want to scrape



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
  })






module.exports = router;
