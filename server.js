import express from 'express';
import cors from 'cors';
import multer from 'multer';
import routes from "./Router.js"; // Import the router module
import googleroutes from "./es.js";
import paymentroutes from "./paymentRouter.js";
import './db/connect.js';

const app = express();

// Enable CORS for all origins
app.use(cors());

// Middleware to parse JSON bodies
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Request logging middleware - logs method, URL, response time
app.use((req, res, next) => {
  const start = Date.now();
  const timestamp = new Date().toISOString();


  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const color = status >= 500 ? '\x1b[31m' : status >= 400 ? '\x1b[33m' : '\x1b[32m';
    const reset = '\x1b[0m';

    console.log(`${timestamp} | ${color}${status}${reset} | ${req.method.padEnd(6)} | ${duration.toString().padStart(5)}ms | ${req.originalUrl}`);

    // Log slow requests (> 1000ms) with warning
    if (duration > 1000) {
      console.log(`⚠️  SLOW REQUEST: ${req.method} ${req.originalUrl} took ${duration}ms`);
    }
  });

  next();
});

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Use the router for the specified routes
app.use('/st', routes);
app.use('/auth', googleroutes);
app.use('/payment', paymentroutes);
app.get('/', (req, res) => {
  res.send('Welcome to the Express API! webhook updated33');
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
