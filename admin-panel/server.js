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
    const balancesCollection = mongoose.connection.db.collection('balances');
    
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
    
    // For each user, calculate token usage and total cost
    const enhancedUsers = await Promise.all(
      users.map(async (user) => {
        const userId = user._id.toString();
        
        // Get balance information
        const balance = await balancesCollection.findOne({
          user: user._id
        });
        
        // Get messages from this user in the time period (for filtered stats)
        const userMessages = await messagesCollection.find({
          user: userId,
          ...dateFilter
        }, {
          projection: { tokenCount: 1, isCreatedByUser: 1, model: 1, endpoint: 1, messageId: 1, parentMessageId: 1 }
        }).sort({ createdAt: 1 }).toArray();
        
        // Get ALL messages from this user (for lifetime stats)
        const allUserMessages = await messagesCollection.find({
          user: userId
        }, {
          projection: { tokenCount: 1, isCreatedByUser: 1, model: 1, endpoint: 1, messageId: 1, parentMessageId: 1 }
        }).sort({ createdAt: 1 }).toArray();
        
        // Create message lookup map for inferring models
        const messageMap = new Map();
        userMessages.forEach(msg => messageMap.set(msg.messageId, msg));
        
        // Sum up tokens and calculate total cost (for time period)
        let tokensUsed = 0;
        let totalCost = 0;
        let balanceDeducted = 0; // Actual tokenCredits deducted
        
        userMessages.forEach(msg => {
          const tokens = msg.tokenCount || 0;
          tokensUsed += tokens;
          
          // Determine the model for this message
          let model = msg.model;
          
          // If user message has no model, infer it from the AI's response
          if (!model && msg.isCreatedByUser) {
            // Find the AI response (child message where this message is the parent)
            const aiResponse = userMessages.find(m => 
              !m.isCreatedByUser && m.parentMessageId === msg.messageId
            );
            if (aiResponse && aiResponse.model) {
              model = aiResponse.model;
            }
          }
          
          // Calculate cost and balance deduction for this message
          if (tokens > 0 && model) {
            const endpoint = msg.endpoint;
            const tokenType = msg.isCreatedByUser ? 'prompt' : 'completion';
            
            const multiplier = getMultiplier({
              model: model,
              endpoint: endpoint,
              tokenType: tokenType
            });
            
            // Cost in USD
            totalCost += (tokens / 1000000) * multiplier;
            
            // Balance deduction (tokenValue = rawAmount * multiplier)
            balanceDeducted += tokens * multiplier;
          }
        });
        
        // Calculate lifetime tokens and cost
        let lifetimeTokens = 0;
        let lifetimeCost = 0;
        let lifetimeBalanceDeducted = 0; // Actual tokenCredits deducted lifetime
        
        allUserMessages.forEach(msg => {
          const tokens = msg.tokenCount || 0;
          lifetimeTokens += tokens;
          
          // Determine the model for this message
          let model = msg.model;
          
          // If user message has no model, infer it from the AI's response
          if (!model && msg.isCreatedByUser) {
            // Find the AI response (child message where this message is the parent)
            const aiResponse = allUserMessages.find(m => 
              !m.isCreatedByUser && m.parentMessageId === msg.messageId
            );
            if (aiResponse && aiResponse.model) {
              model = aiResponse.model;
            }
          }
          
          // Calculate cost and balance deduction
          if (tokens > 0 && model) {
            const endpoint = msg.endpoint;
            const tokenType = msg.isCreatedByUser ? 'prompt' : 'completion';
            
            const multiplier = getMultiplier({
              model: model,
              endpoint: endpoint,
              tokenType: tokenType
            });
            
            // Cost in USD
            lifetimeCost += (tokens / 1000000) * multiplier;
            
            // Balance deduction (tokenValue = rawAmount * multiplier)
            lifetimeBalanceDeducted += tokens * multiplier;
          }
        });
        
        // Get token credits directly from balance
        const tokenCredits = balance?.tokenCredits || 0;
        
        return {
          _id: user._id,
          name: user.name || 'N/A',
          username: user.username || 'N/A',
          email: user.email || 'N/A',
          role: user.role || 'user',
          tokensUsed: tokensUsed,
          lifetimeTokens: lifetimeTokens,
          balanceDeducted: balanceDeducted,
          lifetimeBalanceDeducted: lifetimeBalanceDeducted,
          totalCost: totalCost,
          lifetimeCost: lifetimeCost,
          tokenCredits: tokenCredits,
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
    
    // Get all messages in the displayed conversations to infer models
    const conversationIds = [...new Set(messages.map(m => m.conversationId))];
    const allConvMessages = await messagesCollection.find(
      { conversationId: { $in: conversationIds } },
      { projection: { messageId: 1, parentMessageId: 1, model: 1, conversationId: 1, isCreatedByUser: 1 } }
    ).toArray();
    
    // Create lookup map
    const messageModelMap = new Map();
    allConvMessages.forEach(m => {
      messageModelMap.set(m.messageId, m);
    });
    
    // Calculate cost for each message
    const enhancedMessages = messages.map(msg => {
      const tokens = msg.tokenCount || 0;
      let model = msg.model;
      const endpoint = msg.endpoint;
      const isUserMessage = msg.isCreatedByUser;
      
      // Infer model from AI response if user message has no model
      if (!model && isUserMessage && msg.messageId) {
        const aiResponse = allConvMessages.find(m => 
          !m.isCreatedByUser && 
          m.parentMessageId === msg.messageId &&
          m.conversationId === msg.conversationId
        );
        if (aiResponse && aiResponse.model) {
          model = aiResponse.model + ' (inferred)';
        } else {
          model = 'unknown';
        }
      } else if (!model) {
        model = 'unknown';
      }
      
      // Calculate cost based on message type
      let cost = 0;
      if (tokens > 0 && model && model !== 'unknown') {
        const cleanModel = model.replace(' (inferred)', '');
        const tokenType = isUserMessage ? 'prompt' : 'completion';
        const multiplier = getMultiplier({
          model: cleanModel,
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

// Balance Management API Endpoints

// Get all balances with user info
app.get('/api/balances', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';

    const balancesCollection = mongoose.connection.db.collection('balances');

    // Build aggregation pipeline
    const pipeline = [
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'userInfo'
        }
      },
      {
        $unwind: {
          path: '$userInfo',
          preserveNullAndEmptyArrays: true
        }
      }
    ];

    if (search) {
      pipeline.push({
        $match: {
          $or: [
            { 'userInfo.name': { $regex: search, $options: 'i' } },
            { 'userInfo.email': { $regex: search, $options: 'i' } }
          ]
        }
      });
    }

    pipeline.push(
      { $sort: { 'userInfo.name': 1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limit }]
        }
      }
    );

    const result = await balancesCollection.aggregate(pipeline).toArray();
    const balances = result[0].data;
    const total = result[0].metadata[0]?.total || 0;

    const formattedBalances = balances.map(balance => ({
      _id: balance._id,
      userId: balance.user,
      userName: balance.userInfo?.name || 'Unknown',
      userEmail: balance.userInfo?.email || 'N/A',
      tokenCredits: balance.tokenCredits || 0,
      autoRefillEnabled: balance.autoRefillEnabled || false,
      refillAmount: balance.refillAmount || 0,
      refillIntervalValue: balance.refillIntervalValue || 30,
      refillIntervalUnit: balance.refillIntervalUnit || 'days',
      lastRefill: balance.lastRefill
    }));

    res.json({
      documents: formattedBalances,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (error) {
    console.error('Error fetching balances:', error);
    res.status(500).json({ error: error.message });
  }
});

// Top up balance
app.post('/api/balances/topup', requireAuth, async (req, res) => {
  try {
    const { userId, amount, reason } = req.body;
    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid user ID or amount' });
    }

    const balancesCollection = mongoose.connection.db.collection('balances');
    const transactionsCollection = mongoose.connection.db.collection('transactions');
    const userObjectId = mongoose.Types.ObjectId.isValid(userId) 
      ? new mongoose.Types.ObjectId(userId) : userId;

    const result = await balancesCollection.findOneAndUpdate(
      { user: userObjectId },
      { $inc: { tokenCredits: amount } },
      { returnDocument: 'after', upsert: true }
    );

    await transactionsCollection.insertOne({
      user: userObjectId,
      tokenType: 'credit',
      context: 'admin_topup',
      rawAmount: amount,
      tokenValue: amount,
      rate: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      note: reason || 'Manual admin top-up',
      __v: 0
    });

    res.json({ success: true, newBalance: result.tokenCredits });
  } catch (error) {
    console.error('Error topping up:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update refill settings
app.put('/api/balances/refill-settings', requireAuth, async (req, res) => {
  try {
    const { userId, autoRefillEnabled, refillAmount, refillIntervalValue, refillIntervalUnit } = req.body;
    if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

    const balancesCollection = mongoose.connection.db.collection('balances');
    const userObjectId = mongoose.Types.ObjectId.isValid(userId) 
      ? new mongoose.Types.ObjectId(userId) : userId;

    const updateFields = {};
    if (typeof autoRefillEnabled === 'boolean') updateFields.autoRefillEnabled = autoRefillEnabled;
    if (refillAmount) updateFields.refillAmount = refillAmount;
    if (refillIntervalValue) updateFields.refillIntervalValue = refillIntervalValue;
    if (refillIntervalUnit) updateFields.refillIntervalUnit = refillIntervalUnit;

    await balancesCollection.findOneAndUpdate(
      { user: userObjectId },
      { $set: updateFields },
      { returnDocument: 'after' }
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Admin Panel running on http://localhost:${PORT}`);
  console.log(`Login credentials: username=${ADMIN_USERNAME}`);
  console.log(`Access at: https://admin-ai.180marketing.com`);
});

