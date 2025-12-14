import express from 'express';
import cors from 'cors';
import multer from 'multer';
import routes from "./Router.js"; // Import the router module
import googleroutes from "./es.js";
import './db/connect.js';

const app = express();

// Enable CORS for all origins
app.use(cors());

// Middleware to parse JSON bodies
app.use(express.json());

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Use the router for the specified routes
app.use('/st', routes);
app.use('/auth', googleroutes);
app.get('/', (req, res) => {
  res.send('Welcome to the Express API! webhook updated33');
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0',() => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
