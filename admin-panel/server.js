const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const config = require('./config');

const app = express();
const PORT = config.PORT;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// MongoDB connection
const MONGO_URI = config.MONGO_URI;
mongoose.connect(MONGO_URI)
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Admin credentials (change in config.js for production!)
const ADMIN_USERNAME = config.ADMIN_USERNAME;
const ADMIN_PASSWORD = config.ADMIN_PASSWORD;

// Routes

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    req.session.username = username;
    res.json({ success: true, message: 'Login successful' });
  } else {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check auth status
app.get('/api/auth/status', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

// Get all collections
app.get('/api/collections', requireAuth, async (req, res) => {
  try {
    const collections = await mongoose.connection.db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    // Get counts for each collection
    const collectionsWithCounts = await Promise.all(
      collectionNames.map(async (name) => {
        const count = await mongoose.connection.db.collection(name).countDocuments();
        return { name, count };
      })
    );
    
    // Sort collections with 'users' first, then alphabetically
    collectionsWithCounts.sort((a, b) => {
      if (a.name === 'users') return -1;
      if (b.name === 'users') return 1;
      return a.name.localeCompare(b.name);
    });
    
    res.json(collectionsWithCounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get documents from a collection with pagination
app.get('/api/collection/:name', requireAuth, async (req, res) => {
  try {
    const { name } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    
    const collection = mongoose.connection.db.collection(name);
    
    let query = {};
    if (search) {
      // Simple text search across all fields
      query = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { username: { $regex: search, $options: 'i' } },
          { title: { $regex: search, $options: 'i' } },
          { text: { $regex: search, $options: 'i' } }
        ]
      };
    }
    
    // Collections that have user references
    const collectionsWithUsers = ['balances', 'transactions', 'conversations', 'messages', 'sessions'];
    
    let documents;
    
    if (collectionsWithUsers.includes(name)) {
      // Use aggregation to join user data
      const pipeline = [
        { $match: query },
        { $skip: skip },
        { $limit: limit },
        {
          $lookup: {
            from: 'users',
            let: { userId: { $toObjectId: '$user' } },
            pipeline: [
              { $match: { $expr: { $eq: ['$_id', '$$userId'] } } },
              { $project: { name: 1, username: 1, email: 1 } }
            ],
            as: 'userDetails'
          }
        },
        {
          $addFields: {
            userName: { $arrayElemAt: ['$userDetails.name', 0] },
            userUsername: { $arrayElemAt: ['$userDetails.username', 0] },
            userEmail: { $arrayElemAt: ['$userDetails.email', 0] }
          }
        },
        {
          $project: {
            userDetails: 0
          }
        }
      ];
      
      documents = await collection.aggregate(pipeline).toArray();
    } else {
      documents = await collection.find(query).skip(skip).limit(limit).toArray();
    }
    
    const total = await collection.countDocuments(query);
    
    res.json({
      documents,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single document by ID
app.get('/api/collection/:name/:id', requireAuth, async (req, res) => {
  try {
    const { name, id } = req.params;
    const collection = mongoose.connection.db.collection(name);
    
    const document = await collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
    
    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    res.json(document);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new document
app.post('/api/collection/:name', requireAuth, async (req, res) => {
  try {
    const { name } = req.params;
    const data = req.body;
    const collection = mongoose.connection.db.collection(name);
    
    const result = await collection.insertOne(data);
    res.json({ success: true, insertedId: result.insertedId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update document
app.put('/api/collection/:name/:id', requireAuth, async (req, res) => {
  try {
    const { name, id } = req.params;
    const data = req.body;
    const collection = mongoose.connection.db.collection(name);
    
    // Remove _id from update data if present
    delete data._id;
    
    const result = await collection.updateOne(
      { _id: new mongoose.Types.ObjectId(id) },
      { $set: data }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete document
app.delete('/api/collection/:name/:id', requireAuth, async (req, res) => {
  try {
    const { name, id } = req.params;
    const collection = mongoose.connection.db.collection(name);
    
    const result = await collection.deleteOne({ _id: new mongoose.Types.ObjectId(id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get database stats
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const stats = await mongoose.connection.db.stats();
    const collections = await mongoose.connection.db.listCollections().toArray();
    
    const collectionStats = await Promise.all(
      collections.map(async (col) => {
        const count = await mongoose.connection.db.collection(col.name).countDocuments();
        const colStats = await mongoose.connection.db.collection(col.name).stats();
        return {
          name: col.name,
          count,
          size: colStats.size,
          avgObjSize: colStats.avgObjSize
        };
      })
    );
    
    res.json({
      database: stats.db,
      collections: stats.collections,
      dataSize: stats.dataSize,
      storageSize: stats.storageSize,
      indexes: stats.indexes,
      collectionStats
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Admin Panel running on http://localhost:${PORT}`);
  console.log(`Login credentials: username=${ADMIN_USERNAME}`);
  console.log(`Access at: https://admin-ai.180marketing.com`);
});

