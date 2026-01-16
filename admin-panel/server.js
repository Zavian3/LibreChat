const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const config = require('./config');

const app = express();
const PORT = config.PORT;

// Import pricing logic (local module for Docker compatibility)
const { getMultiplier } = require('./pricing.js');

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

// Get all users for filtering
app.get('/api/users/names', requireAuth, async (req, res) => {
  try {
    const users = await mongoose.connection.db.collection('users')
      .find({}, { projection: { _id: 1, name: 1, username: 1, email: 1 } })
      .sort({ name: 1 })
      .toArray();
    
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get users with token usage stats
app.get('/api/users/enhanced', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const timePeriod = req.query.timePeriod || '30days'; // 24hours, 30days, 90days
    
    const usersCollection = mongoose.connection.db.collection('users');
    const messagesCollection = mongoose.connection.db.collection('messages');
    
    // Calculate time filter
    let dateFilter = {};
    const now = new Date();
    if (timePeriod === '24hours') {
      dateFilter.createdAt = { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) };
    } else if (timePeriod === '30days') {
      dateFilter.createdAt = { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
    } else if (timePeriod === '90days') {
      dateFilter.createdAt = { $gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) };
    }
    
    // Build match query for users
    let matchQuery = {};
    if (search) {
      matchQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Get users with pagination
    const users = await usersCollection
      .find(matchQuery)
      .skip(skip)
      .limit(limit)
      .toArray();
    
    const total = await usersCollection.countDocuments(matchQuery);
    
    // For each user, calculate token usage
    const enhancedUsers = await Promise.all(
      users.map(async (user) => {
        const userId = user._id.toString();
        
        // Get all messages from this user in the time period
        const userMessages = await messagesCollection.find({
          user: userId,
          ...dateFilter
        }, {
          projection: { tokenCount: 1 }
        }).toArray();
        
        // Sum up tokens
        const tokensUsed = userMessages.reduce((sum, msg) => {
          return sum + (msg.tokenCount || 0);
        }, 0);
        
        return {
          _id: user._id,
          name: user.name || 'N/A',
          username: user.username || 'N/A',
          email: user.email || 'N/A',
          role: user.role || 'user',
          tokensUsed: tokensUsed,
          createdAt: user.createdAt
        };
      })
    );
    
    res.json({
      documents: enhancedUsers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      timePeriod
    });
  } catch (error) {
    console.error('Error in enhanced users:', error);
    res.status(500).json({ error: error.message });
  }
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

// Enhanced conversations endpoint with initial prompt and cost calculation
app.get('/api/conversations/enhanced', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const userNameFilter = req.query.userName || '';
    
    const conversationsCollection = mongoose.connection.db.collection('conversations');
    const messagesCollection = mongoose.connection.db.collection('messages');
    
    // Build match query
    let matchQuery = {};
    
    // Add search filter
    if (search) {
      matchQuery.$or = [
        { title: { $regex: search, $options: 'i' } },
        { conversationId: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Build aggregation pipeline
    const pipeline = [
      // Join with users to get user details
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
      // Filter by userName if provided
      ...(userNameFilter ? [{ 
        $match: { userName: { $regex: userNameFilter, $options: 'i' } } 
      }] : []),
      // Apply search filter
      ...(Object.keys(matchQuery).length > 0 ? [{ $match: matchQuery }] : []),
      // Sort by most recent first
      { $sort: { createdAt: -1 } },
      // Get total count for pagination
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: limit }
          ]
        }
      }
    ];
    
    const result = await conversationsCollection.aggregate(pipeline).toArray();
    const conversations = result[0].data;
    const total = result[0].metadata[0]?.total || 0;
    
    // For each conversation, get ALL messages and calculate total cost
    const enhancedConversations = await Promise.all(
      conversations.map(async (conv) => {
        // Get first user message for initial prompt display
        const firstUserMessage = await messagesCollection.findOne(
          {
            conversationId: conv.conversationId,
            isCreatedByUser: true
          },
          {
            sort: { createdAt: 1 },
            projection: { text: 1, createdAt: 1 }
          }
        );
        
        // Get ALL messages in the conversation to calculate total cost
        const allMessages = await messagesCollection.find(
          { conversationId: conv.conversationId },
          { projection: { isCreatedByUser: 1, tokenCount: 1, model: 1, endpoint: 1 } }
        ).toArray();
        
        // Calculate total tokens and cost
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCost = 0;
        
        allMessages.forEach(msg => {
          const tokens = msg.tokenCount || 0;
          const msgModel = msg.model || conv.model;
          const msgEndpoint = msg.endpoint || conv.endpoint;
          
          if (msg.isCreatedByUser) {
            // User message = input tokens
            totalInputTokens += tokens;
            const promptMultiplier = getMultiplier({
              model: msgModel,
              endpoint: msgEndpoint,
              tokenType: 'prompt'
            });
            totalCost += (tokens / 1000000) * promptMultiplier;
          } else {
            // AI message = output tokens
            totalOutputTokens += tokens;
            const completionMultiplier = getMultiplier({
              model: msgModel,
              endpoint: msgEndpoint,
              tokenType: 'completion'
            });
            totalCost += (tokens / 1000000) * completionMultiplier;
          }
        });
        
        return {
          _id: conv._id,
          conversationId: conv.conversationId,
          title: conv.title || 'Untitled',
          userName: conv.userName || 'Unknown',
          model: conv.model || '-',
          createdAt: conv.createdAt,
          totalInputTokens: totalInputTokens,
          totalOutputTokens: totalOutputTokens,
          totalCost: totalCost,
          messageCount: allMessages.length,
          initialPrompt: firstUserMessage?.text || 'No message found'
        };
      })
    );
    
    res.json({
      documents: enhancedConversations,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error in enhanced conversations:', error);
    res.status(500).json({ error: error.message });
  }
});

// Enhanced messages endpoint with filters and cost calculation
app.get('/api/messages/enhanced', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    const userNameFilter = req.query.userName || '';
    const conversationIdFilter = req.query.conversationId || '';
    
    const messagesCollection = mongoose.connection.db.collection('messages');
    
    // Build match query
    let matchQuery = {};
    
    // Add search filter
    if (search) {
      matchQuery.$or = [
        { text: { $regex: search, $options: 'i' } },
        { messageId: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Add conversation filter
    if (conversationIdFilter) {
      matchQuery.conversationId = conversationIdFilter;
    }
    
    // Build aggregation pipeline
    const pipeline = [
      // Join with users to get user details
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
      // Filter by userName if provided
      ...(userNameFilter ? [{ 
        $match: { userName: { $regex: userNameFilter, $options: 'i' } } 
      }] : []),
      // Apply search and conversation filter
      ...(Object.keys(matchQuery).length > 0 ? [{ $match: matchQuery }] : []),
      // Sort by most recent first
      { $sort: { createdAt: -1 } },
      // Get total count for pagination
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $skip: skip },
            { $limit: limit }
          ]
        }
      }
    ];
    
    const result = await messagesCollection.aggregate(pipeline).toArray();
    const messages = result[0].data;
    const total = result[0].metadata[0]?.total || 0;
    
    // Calculate cost for each message
    const enhancedMessages = messages.map(msg => {
      const tokens = msg.tokenCount || 0;
      const model = msg.model || 'unknown';
      const endpoint = msg.endpoint;
      const isUserMessage = msg.isCreatedByUser;
      
      // Calculate cost based on message type
      let cost = 0;
      if (tokens > 0 && model) {
        const tokenType = isUserMessage ? 'prompt' : 'completion';
        const multiplier = getMultiplier({
          model: model,
          endpoint: endpoint,
          tokenType: tokenType
        });
        cost = (tokens / 1000000) * multiplier;
      }
      
      return {
        _id: msg._id,
        conversationId: msg.conversationId,
        userName: msg.userName || 'Unknown',
        model: model,
        sender: msg.sender || (isUserMessage ? 'User' : 'Assistant'),
        text: msg.text || '',
        tokenCount: tokens,
        cost: cost,
        isCreatedByUser: isUserMessage,
        createdAt: msg.createdAt
      };
    });
    
    res.json({
      documents: enhancedMessages,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error in enhanced messages:', error);
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
          { text: { $regex: search, $options: 'i' } },
          { filename: { $regex: search, $options: 'i' } }
        ]
      };
    }
    
    // Collections that have user references
    const collectionsWithUsers = ['balances', 'transactions', 'conversations', 'messages', 'sessions', 'files'];
    
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

