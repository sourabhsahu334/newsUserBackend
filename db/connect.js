// const mongoose = require('mongoose');
import dotenv from 'dotenv';
dotenv.config();

// mongoose.Promise = global.Promise;
const db = process.env.DATABASE_URL
const local = "mongodb://127.0.0.1:27017/AssignmentZedblock";
import { MongoClient } from 'mongodb';

// Connect MongoDB at default port 27017.
// mongoose.set('strictQuery', false);
// mongoose.connect(db, {
//     useNewUrlParser: true,
//     useUnifiedTopology: true,



// }).then(()=>{
//     console.log('connection succes');
// }).catch((e)=>{
//     console.log('no connect'+e);
// })
// Use environment variable for MongoDB URI, fallback to hardcoded for backward compatibility
const uri = process.env.MONGODB_URI || 'mongodb+srv://sourabhsahu3394:18jan2002@cluster0.wzbzchk.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const dbName = 'Interest';
const collectionName = ['Politics', 'Tech', 'Sports'];

// MongoDB client with connection options
const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
    socketTimeoutMS: 45000,
});

// Connect with better error handling
async function connectDB() {
    try {
        await client.connect();
        // Verify connection
        await client.db("admin").command({ ping: 1 });
        console.log("✅ Successfully connected to MongoDB Atlas!");
    } catch (error) {
        console.error("❌ MongoDB connection error:", error.message);
        console.error("\nPossible solutions:");
        console.error("1. Check if your IP address is whitelisted in MongoDB Atlas");
        console.error("2. Verify your MongoDB credentials");
        console.error("3. Check your internet connection");
        console.error("4. Ensure MONGODB_URI in .env is correct\n");
        // Don't exit, let the app continue but log the error
    }
}

// Initialize connection
connectDB();

export { collectionName, client, dbName };






