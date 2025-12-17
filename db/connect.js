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
const uri = 'mongodb+srv://sourabhsahu3394:18jan2002@cluster0.wzbzchk.mongodb.net';
const dbName = 'Interest';
const collectionName = ['Politics', 'Tech', 'Sports'];


const client = new MongoClient(uri);
client.connect().then((res) => console.log("connect with client mongo")).catch((error) => console.log(error));

export { collectionName, client, dbName };






