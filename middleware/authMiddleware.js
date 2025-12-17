import jwt from 'jsonwebtoken';
import * as dbConnect from '../db/connect.js';
import * as appConfig from '../config.js';
import { ObjectId } from 'mongodb';

var JWT_SECRET = appConfig.JWT_SECRET;
var client = dbConnect.client;

var verifyToken = function (req, res, next) {
  var token = req.headers.authorization && req.headers.authorization.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    var decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

var getUserFromDB = function (req, res, next) {
  try {
    var db = client.db('Interest');
    var usersCollection = db.collection('users');

    usersCollection.findOne({ _id: new ObjectId(req.user.id) })
      .then(function (user) {
        if (!user) {
          return res.status(401).json({ error: 'User not found' });
        }
        req.user = user;
        next();
      })
      .catch(function (err) {
        res.status(500).json({ error: 'Server error' });
      });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

export default {
  verifyToken: verifyToken,
  getUserFromDB: getUserFromDB
};
