// index.js

const express = require('express');
const routes = require("./Router"); // Import the router module
require('./db/connect')
const app = express();

// Use the router for the specified routes
app.use('/st', routes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
