// routes.js

const express = require('express');
const { client } = require('./db/connect');
const router = express.Router();

// Define routes for the router
router.get('/ab', async(req, res) => {
    const db = client.db("NewsList");
    const collection = db.collection("Student");
    const documents = await collection.find().toArray();
    res.json({res:documents})
});

router.get('/about', (req, res) => {
  res.send('This is the about page.');
});

module.exports = router;
