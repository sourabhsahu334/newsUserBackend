const express = require('express');
const cors = require('cors');
const routes = require("./Router"); // Import the router module
require('./db/connect');

const app = express();

// Enable CORS for all origins
app.use(cors());

// Middleware to parse JSON bodies
app.use(express.json());

// Use the router for the specified routes
app.use('/st', routes);
app.get('/', (req, res) => {
  res.send('Welcome to the Express API! webhook updated');
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0',() => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
