const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const path = require('path');
const fs = require('fs/promises');
const config = require('./config');
const {
  cleanupOrphans,
  deleteUserData,
  resolveStoredFile,
  scanOrphans,
} = require('./lib/orphan-cleanup');

const app = express();
app.set('trust proxy', 1);

const READ_COLLECTIONS = new Set([
  'users', 'balances', 'transactions', 'conversations', 'messages', 'files', 'sessions',
  'sharedlinks', 'presets', 'projects', 'promptgroups', 'prompts', 'groups', 'roles',
  'accessroles', 'aclentries', 'agents', 'agentcategories', 'conversationtags', 'memoryentries',
]);
const EDITABLE_COLLECTIONS = new Set([
  'presets', 'projects', 'promptgroups', 'prompts', 'groups', 'roles',
  'accessroles', 'aclentries', 'agents', 'agentcategories',
]);
const SORT_FIELDS = new Set([
  '_id', 'createdAt', 'updatedAt', 'name', 'email', 'title', 'filename', 'tokenCredits',
  'lastRefill', 'expiration', 'rawAmount', 'tokenValue', 'model', 'type', 'usage',
]);
const COLLECTION_DATE_FIELDS = {
  users: 'createdAt',
  transactions: 'createdAt',
  conversations: 'createdAt',
  messages: 'createdAt',
  files: 'createdAt',
  sessions: 'expiration',
  sharedlinks: 'createdAt',
  presets: 'createdAt',
  projects: 'createdAt',
  promptgroups: 'createdAt',
  prompts: 'createdAt',
  agents: 'createdAt',
  conversationtags: 'createdAt',
  memoryentries: 'createdAt',
};
const roots = { images: config.IMAGES_ROOT, uploads: config.UPLOADS_ROOT };
const deleteRoots = { images: config.DELETE_IMAGES_ROOT, uploads: config.DELETE_UPLOADS_ROOT };

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      objectSrc: ["'self'"],
      frameSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      styleSrcAttr: ["'unsafe-inline'"],
    },
  },
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(session({
  name: 'librechat.admin.sid',
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: MongoStore.create({
    mongoUrl: config.MONGO_URI,
    collectionName: 'adminSessions',
    ttl: 24 * 60 * 60,
    autoRemove: 'native',
  }),
  cookie: {
    secure: config.COOKIE_SECURE,
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000,
  },
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireAuth(req, res, next) {
  if (req.session?.authenticated === true) {
    return next();
  }
  return res.status(401).json({ error: 'Authentication required' });
}

function requireSameOrigin(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }
  const origin = req.get('origin');
  if (!origin) {
    return next();
  }
  const expected = `${req.protocol}://${req.get('host')}`;
  if (origin !== expected) {
    return res.status(403).json({ error: 'Cross-origin request rejected' });
  }
  return next();
}

function paging(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

function parseDate(value, endOfDay = false) {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateQuery(query, field = 'createdAt') {
  const start = parseDate(query.startDate);
  const end = parseDate(query.endDate, true);
  if (!start && !end) return {};
  const range = {};
  if (start) range.$gte = start;
  if (end) range.$lte = end;
  return { [field]: range };
}

function sortQuery(query, fallback = 'createdAt') {
  const requested = SORT_FIELDS.has(query.sortBy) ? query.sortBy : fallback;
  return { [requested]: query.sortOrder === 'asc' ? 1 : -1 };
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function messageText(message) {
  if (typeof message.text === 'string' && message.text.trim()) return message.text;
  const content = Array.isArray(message.content)
    ? message.content
    : message.content == null
      ? []
      : [message.content];
  return content.map((block) => {
    if (typeof block === 'string') return block;
    if (!block || typeof block !== 'object') return '';
    if (typeof block.text === 'string') return block.text;
    if (typeof block.error === 'string') return `Error: ${block.error}`;
    if (block.type === 'tool_use') return `[Tool call: ${block.name || 'unnamed tool'}]`;
    if (block.type === 'tool_result') return '[Tool result]';
    return '';
  }).filter(Boolean).join('\n\n');
}

function messageKind(message) {
  return Array.isArray(message.content) && message.content.some((block) => block?.type === 'error')
    ? 'error'
    : 'message';
}

function messageAttachments(message, fileMap) {
  if (!Array.isArray(message.files)) return [];
  return message.files.map((attachment) => {
    const fileId = String(attachment?.file_id || attachment?.fileId || '');
    const storedFile = fileMap.get(fileId);
    return {
      id: storedFile ? String(storedFile._id) : null,
      filename: attachment?.filename || storedFile?.filename || 'Unnamed attachment',
      type: attachment?.type || storedFile?.type || 'application/octet-stream',
      width: attachment?.width || storedFile?.width || null,
      height: attachment?.height || storedFile?.height || null,
      available: Boolean(storedFile && resolveStoredFile(storedFile, roots)),
    };
  });
}

function pagination(page, limit, total) {
  return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

function objectId(value) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    const error = new Error('Invalid document ID');
    error.status = 400;
    throw error;
  }
  return new mongoose.Types.ObjectId(value);
}

function collectionOr404(name) {
  if (!READ_COLLECTIONS.has(name)) {
    const error = new Error('Collection is not available in the admin panel');
    error.status = 404;
    throw error;
  }
  return mongoose.connection.db.collection(name);
}

function mutationLog(req, action, target, details = {}) {
  console.info(JSON.stringify({
    event: 'admin_mutation',
    at: new Date().toISOString(),
    admin: req.session.username,
    ip: req.ip,
    action,
    target,
    ...details,
  }));
}

async function ensureIndexes(db) {
  const definitions = [
    ['users', { createdAt: -1 }, { name: 'admin_createdAt' }],
    ['transactions', { user: 1, createdAt: -1 }, { name: 'admin_user_createdAt' }],
    ['transactions', { conversationId: 1, createdAt: -1 }, { name: 'admin_conversation_createdAt' }],
    ['messages', { user: 1, createdAt: -1 }, { name: 'admin_user_createdAt' }],
    ['messages', { conversationId: 1, createdAt: -1 }, { name: 'admin_conversation_createdAt' }],
    ['conversations', { user: 1, createdAt: -1 }, { name: 'admin_user_createdAt' }],
    ['files', { user: 1, createdAt: -1 }, { name: 'admin_user_createdAt' }],
    ['balances', { lastRefill: -1 }, { name: 'admin_lastRefill' }],
  ];

  for (const [name, key, options] of definitions) {
    await db.collection(name).createIndex(key, options);
  }

  const duplicates = await db.collection('balances').aggregate([
    { $group: { _id: '$user', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
  ]).toArray();

  if (duplicates.length === 0) {
    await db.collection('balances').createIndex(
      { user: 1 },
      { name: 'admin_unique_user', unique: true },
    );
  } else {
    console.warn('Skipped unique balances.user index because duplicate balance records exist');
  }
}

app.get('/healthz', (_req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({ status: connected ? 'ok' : 'unavailable' });
});

app.post('/api/login', loginLimiter, asyncRoute(async (req, res) => {
  const username = String(req.body.username || '');
  const password = String(req.body.password || '');
  const validUser = username === config.ADMIN_USERNAME;
  const validPassword = await bcrypt.compare(password, config.ADMIN_PASSWORD_HASH);

  if (!validUser || !validPassword) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  await new Promise((resolve, reject) => req.session.regenerate((error) => (
    error ? reject(error) : resolve()
  )));
  req.session.authenticated = true;
  req.session.username = username;
  return res.json({ success: true, username });
}));

app.post('/api/logout', requireSameOrigin, requireAuth, asyncRoute(async (req, res) => {
  await new Promise((resolve, reject) => req.session.destroy((error) => (
    error ? reject(error) : resolve()
  )));
  res.clearCookie('librechat.admin.sid');
  res.json({ success: true });
}));

app.get('/api/auth/status', (req, res) => {
  res.json({
    authenticated: req.session?.authenticated === true,
    username: req.session?.authenticated ? req.session.username : null,
  });
});

app.use('/api', requireAuth, requireSameOrigin);

app.get('/api/collections', asyncRoute(async (_req, res) => {
  const existing = new Set(
    (await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray())
      .map((item) => item.name),
  );
  const collections = await Promise.all(
    [...READ_COLLECTIONS]
      .filter((name) => existing.has(name))
      .map(async (name) => ({
        name,
        count: await mongoose.connection.db.collection(name).countDocuments(),
      })),
  );
  collections.sort((a, b) => a.name.localeCompare(b.name));
  res.json(collections);
}));

app.get('/api/users/names', asyncRoute(async (_req, res) => {
  const users = await mongoose.connection.db.collection('users')
    .find({}, { projection: { name: 1, username: 1, email: 1 } })
    .sort({ name: 1 })
    .toArray();
  res.json(users);
}));

async function aggregateUsage(transactions, userIds, dateMatch = {}) {
  if (userIds.length === 0) return new Map();
  const rows = await transactions.aggregate([
    {
      $match: {
        user: { $in: userIds },
        tokenType: { $in: ['prompt', 'completion', 'credit', 'credits'] },
        ...dateMatch,
      },
    },
    {
      $group: {
        _id: '$user',
        promptTokens: {
          $sum: { $cond: [{ $eq: ['$tokenType', 'prompt'] }, { $multiply: ['$rawAmount', -1] }, 0] },
        },
        completionTokens: {
          $sum: { $cond: [{ $eq: ['$tokenType', 'completion'] }, { $multiply: ['$rawAmount', -1] }, 0] },
        },
        inputTokens: { $sum: { $multiply: [{ $ifNull: ['$inputTokens', 0] }, -1] } },
        cacheReadTokens: { $sum: { $multiply: [{ $ifNull: ['$readTokens', 0] }, -1] } },
        cacheWriteTokens: { $sum: { $multiply: [{ $ifNull: ['$writeTokens', 0] }, -1] } },
        spentCredits: {
          $sum: {
            $cond: [
              { $in: ['$tokenType', ['prompt', 'completion']] },
              { $multiply: ['$tokenValue', -1] },
              0,
            ],
          },
        },
        creditsGranted: {
          $sum: {
            $cond: [{ $in: ['$tokenType', ['credit', 'credits']] }, '$tokenValue', 0],
          },
        },
        messageCredits: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$context', 'message'] },
                  { $in: ['$tokenType', ['prompt', 'completion']] },
                ],
              },
              { $multiply: ['$tokenValue', -1] },
              0,
            ],
          },
        },
        titleCredits: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$context', 'title'] },
                  { $in: ['$tokenType', ['prompt', 'completion']] },
                ],
              },
              { $multiply: ['$tokenValue', -1] },
              0,
            ],
          },
        },
        transactionCount: { $sum: 1 },
      },
    },
  ]).toArray();
  return new Map(rows.map((row) => [String(row._id), row]));
}

const emptyUsage = () => ({
  promptTokens: 0,
  completionTokens: 0,
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  spentCredits: 0,
  creditsGranted: 0,
  messageCredits: 0,
  titleCredits: 0,
  transactionCount: 0,
});

app.get('/api/users/enhanced', asyncRoute(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const search = escapeRegex(req.query.search);
  const query = search
    ? { $or: [{ name: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }] }
    : {};
  const usersCollection = mongoose.connection.db.collection('users');
  const allUsers = await usersCollection.find(query).toArray();
  const ids = allUsers.map((user) => user._id);
  const transactions = mongoose.connection.db.collection('transactions');
  const [rangeUsage, lifetimeUsage, balances] = await Promise.all([
    aggregateUsage(transactions, ids, dateQuery(req.query)),
    aggregateUsage(transactions, ids),
    mongoose.connection.db.collection('balances').find({ user: { $in: ids } }).toArray(),
  ]);
  const balanceMap = new Map(balances.map((item) => [String(item.user), item]));

  const rows = allUsers.map((user) => {
    const id = String(user._id);
    const usage = { ...emptyUsage(), ...rangeUsage.get(id) };
    const lifetime = { ...emptyUsage(), ...lifetimeUsage.get(id) };
    const balance = balanceMap.get(id);
    const currentBalance = Number(balance?.tokenCredits || 0);
    return {
      _id: user._id,
      name: user.name || user.username || 'Unnamed user',
      email: user.email || 'N/A',
      role: user.role || 'USER',
      createdAt: user.createdAt,
      currentBalance,
      ...usage,
      costUsd: usage.spentCredits / 1_000_000,
      lifetimeSpentCredits: lifetime.spentCredits,
      lifetimeCreditsGranted: lifetime.creditsGranted,
      reconciliationDelta: currentBalance - (lifetime.creditsGranted - lifetime.spentCredits),
    };
  });

  const sortBy = [
    'name', 'email', 'createdAt', 'spentCredits', 'currentBalance', 'promptTokens',
  ].includes(req.query.sortBy) ? req.query.sortBy : 'createdAt';
  const direction = req.query.sortOrder === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const left = a[sortBy] ?? '';
    const right = b[sortBy] ?? '';
    return (typeof left === 'string' ? left.localeCompare(right) : left - right) * direction;
  });

  res.json({
    documents: rows.slice(skip, skip + limit),
    pagination: pagination(page, limit, rows.length),
    source: 'transactions',
  });
}));

app.get('/api/conversations/enhanced', asyncRoute(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const search = escapeRegex(req.query.search);
  const match = { ...dateQuery(req.query) };
  if (search) {
    match.$or = [
      { title: { $regex: search, $options: 'i' } },
      { conversationId: { $regex: search, $options: 'i' } },
    ];
  }
  if (req.query.userId) {
    match.user = String(objectId(req.query.userId));
  }

  const pipeline = [
    { $match: match },
    { $sort: sortQuery(req.query) },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [{ $skip: skip }, { $limit: limit }],
      },
    },
  ];
  const [result] = await mongoose.connection.db.collection('conversations')
    .aggregate(pipeline)
    .toArray();
  const conversations = result.data;
  const conversationIds = conversations.map((item) => item.conversationId);
  const userIds = [...new Set(conversations.map((item) => item.user))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const [users, costs, messageStats] = await Promise.all([
    mongoose.connection.db.collection('users')
      .find({ _id: { $in: userIds } }, { projection: { name: 1, email: 1 } })
      .toArray(),
    mongoose.connection.db.collection('transactions').aggregate([
      {
        $match: {
          conversationId: { $in: conversationIds },
          tokenType: { $in: ['prompt', 'completion'] },
        },
      },
      {
        $group: {
          _id: '$conversationId',
          spentCredits: { $sum: { $multiply: ['$tokenValue', -1] } },
          promptTokens: {
            $sum: { $cond: [{ $eq: ['$tokenType', 'prompt'] }, { $multiply: ['$rawAmount', -1] }, 0] },
          },
          completionTokens: {
            $sum: { $cond: [{ $eq: ['$tokenType', 'completion'] }, { $multiply: ['$rawAmount', -1] }, 0] },
          },
        },
      },
    ]).toArray(),
    mongoose.connection.db.collection('messages').aggregate([
      { $match: { conversationId: { $in: conversationIds } } },
      { $sort: { createdAt: 1 } },
      {
        $group: {
          _id: '$conversationId',
          messageCount: { $sum: 1 },
          initialPrompt: {
            $first: { $cond: ['$isCreatedByUser', '$text', '$$REMOVE'] },
          },
        },
      },
    ]).toArray(),
  ]);

  const userMap = new Map(users.map((user) => [String(user._id), user]));
  const costMap = new Map(costs.map((item) => [item._id, item]));
  const messageMap = new Map(messageStats.map((item) => [item._id, item]));
  const documents = conversations.map((conversation) => {
    const cost = costMap.get(conversation.conversationId) || {};
    const stats = messageMap.get(conversation.conversationId) || {};
    return {
      _id: conversation._id,
      conversationId: conversation.conversationId,
      title: conversation.title || 'Untitled',
      userName: userMap.get(conversation.user)?.name || 'Deleted user',
      model: conversation.model || '-',
      messageCount: stats.messageCount || 0,
      promptTokens: cost.promptTokens || 0,
      completionTokens: cost.completionTokens || 0,
      spentCredits: cost.spentCredits || 0,
      costUsd: (cost.spentCredits || 0) / 1_000_000,
      initialPrompt: stats.initialPrompt || '',
      createdAt: conversation.createdAt,
    };
  });

  res.json({
    documents,
    pagination: pagination(page, limit, result.metadata[0]?.total || 0),
    source: 'transactions',
  });
}));

app.get('/api/conversations/:conversationId/messages', asyncRoute(async (req, res) => {
  const conversationId = String(req.params.conversationId || '').trim();
  if (!conversationId || conversationId.length > 200) {
    return res.status(400).json({ error: 'Invalid conversation ID' });
  }

  const conversations = mongoose.connection.db.collection('conversations');
  const messages = mongoose.connection.db.collection('messages');
  const conversation = await conversations.findOne(
    { conversationId },
    { projection: { title: 1, model: 1, user: 1, createdAt: 1 } },
  );
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

  const limit = 2_000;
  const records = await messages.find(
    { conversationId },
    {
      projection: {
        messageId: 1,
        sender: 1,
        isCreatedByUser: 1,
        model: 1,
        text: 1,
        content: 1,
        files: 1,
        tokenCount: 1,
        createdAt: 1,
      },
    },
  ).sort({ createdAt: 1, _id: 1 }).limit(limit + 1).toArray();
  const truncated = records.length > limit;
  const visibleRecords = truncated ? records.slice(0, limit) : records;
  const attachmentIds = visibleRecords
    .flatMap((message) => Array.isArray(message.files) ? message.files : [])
    .map((attachment) => attachment?.file_id || attachment?.fileId)
    .filter(Boolean);
  const storedFiles = attachmentIds.length
    ? await mongoose.connection.db.collection('files')
      .find({ file_id: { $in: attachmentIds } }, {
        projection: { file_id: 1, filename: 1, type: 1, filepath: 1, width: 1, height: 1 },
      })
      .toArray()
    : [];
  const fileMap = new Map(storedFiles.map((file) => [String(file.file_id), file]));

  res.json({
    conversation: {
      conversationId,
      title: conversation.title || 'Untitled',
      model: conversation.model || '-',
      createdAt: conversation.createdAt,
    },
    messages: visibleRecords.map((message) => ({
      _id: message._id,
      messageId: message.messageId,
      sender: message.sender || (message.isCreatedByUser ? 'User' : 'Assistant'),
      isCreatedByUser: message.isCreatedByUser === true,
      model: message.model || null,
      text: messageText(message),
      kind: messageKind(message),
      attachments: messageAttachments(message, fileMap),
      recordedTokens: message.tokenCount || 0,
      createdAt: message.createdAt,
    })),
    truncated,
  });
}));

app.get('/api/messages/enhanced', asyncRoute(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const search = escapeRegex(req.query.search);
  const match = { ...dateQuery(req.query) };
  if (search) {
    match.$or = [
      { text: { $regex: search, $options: 'i' } },
      { 'content.text': { $regex: search, $options: 'i' } },
      { 'content.error': { $regex: search, $options: 'i' } },
      { messageId: { $regex: search, $options: 'i' } },
    ];
  }
  if (req.query.userId) match.user = String(objectId(req.query.userId));
  if (req.query.conversationId) match.conversationId = String(req.query.conversationId);

  const [result] = await mongoose.connection.db.collection('messages').aggregate([
    { $match: match },
    { $sort: sortQuery(req.query) },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [{ $skip: skip }, { $limit: limit }],
      },
    },
  ]).toArray();
  const userIds = [...new Set(result.data.map((item) => item.user))]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  const users = await mongoose.connection.db.collection('users')
    .find({ _id: { $in: userIds } }, { projection: { name: 1 } })
    .toArray();
  const userMap = new Map(users.map((user) => [String(user._id), user.name]));
  const documents = result.data.map((message) => ({
    _id: message._id,
    conversationId: message.conversationId,
    userName: userMap.get(message.user) || 'Deleted user',
    model: message.model || '-',
    sender: message.sender || (message.isCreatedByUser ? 'User' : 'Assistant'),
    text: messageText(message),
    kind: messageKind(message),
    recordedTokens: message.tokenCount || 0,
    createdAt: message.createdAt,
  }));
  res.json({
    documents,
    pagination: pagination(page, limit, result.metadata[0]?.total || 0),
    tokenNotice: 'Recorded message tokens are informational and are not the billable context total.',
  });
}));

app.get('/api/balances', asyncRoute(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const search = escapeRegex(req.query.search);
  const pipeline = [];
  const refillRange = dateQuery(req.query, 'lastRefill');
  if (Object.keys(refillRange).length) pipeline.push({ $match: refillRange });
  pipeline.push(
    {
      $lookup: {
        from: 'users',
        localField: 'user',
        foreignField: '_id',
        as: 'userInfo',
      },
    },
    { $unwind: '$userInfo' },
  );
  if (search) {
    pipeline.push({
      $match: {
        $or: [
          { 'userInfo.name': { $regex: search, $options: 'i' } },
          { 'userInfo.email': { $regex: search, $options: 'i' } },
        ],
      },
    });
  }
  const requestedSort = req.query.sortBy;
  const sort = requestedSort === 'name'
    ? { 'userInfo.name': req.query.sortOrder === 'asc' ? 1 : -1 }
    : sortQuery(req.query, 'lastRefill');
  pipeline.push(
    { $sort: sort },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [{ $skip: skip }, { $limit: limit }],
      },
    },
  );
  const [result] = await mongoose.connection.db.collection('balances').aggregate(pipeline).toArray();
  res.json({
    documents: result.data.map((balance) => ({
      _id: balance._id,
      userId: balance.user,
      userName: balance.userInfo.name || balance.userInfo.username || 'Unnamed user',
      userEmail: balance.userInfo.email || 'N/A',
      tokenCredits: balance.tokenCredits || 0,
      autoRefillEnabled: Boolean(balance.autoRefillEnabled),
      refillAmount: balance.refillAmount || 0,
      refillIntervalValue: balance.refillIntervalValue || 30,
      refillIntervalUnit: balance.refillIntervalUnit || 'days',
      lastRefill: balance.lastRefill,
    })),
    pagination: pagination(page, limit, result.metadata[0]?.total || 0),
  });
}));

app.post('/api/balances/topup', asyncRoute(async (req, res) => {
  const userId = objectId(req.body.userId);
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
    return res.status(400).json({ error: 'Amount must be between 0 and 1,000,000,000 credits' });
  }
  const user = await mongoose.connection.db.collection('users').findOne({ _id: userId });
  if (!user) return res.status(404).json({ error: 'User not found' });
  const now = new Date();
  const result = await mongoose.connection.db.collection('balances').findOneAndUpdate(
    { user: userId },
    { $inc: { tokenCredits: amount }, $setOnInsert: { user: userId } },
    { returnDocument: 'after', upsert: true },
  );
  await mongoose.connection.db.collection('transactions').insertOne({
    user: userId,
    tokenType: 'credit',
    context: 'admin_topup',
    rawAmount: amount,
    tokenValue: amount,
    rate: 1,
    createdAt: now,
    updatedAt: now,
    note: String(req.body.reason || 'Manual admin top-up').slice(0, 300),
    __v: 0,
  });
  mutationLog(req, 'balance_topup', String(userId), { amount });
  res.json({ success: true, newBalance: result.tokenCredits });
}));

app.put('/api/balances/refill-settings', asyncRoute(async (req, res) => {
  const userId = objectId(req.body.userId);
  const refillAmount = Number(req.body.refillAmount);
  const refillIntervalValue = Number.parseInt(req.body.refillIntervalValue, 10);
  const refillIntervalUnit = String(req.body.refillIntervalUnit || '');
  if (!Number.isFinite(refillAmount) || refillAmount <= 0) {
    return res.status(400).json({ error: 'Refill amount must be positive' });
  }
  if (!Number.isInteger(refillIntervalValue) || refillIntervalValue < 1 || refillIntervalValue > 365) {
    return res.status(400).json({ error: 'Refill interval must be between 1 and 365' });
  }
  if (!['days', 'weeks', 'months'].includes(refillIntervalUnit)) {
    return res.status(400).json({ error: 'Invalid refill interval unit' });
  }
  const result = await mongoose.connection.db.collection('balances').updateOne(
    { user: userId },
    {
      $set: {
        autoRefillEnabled: req.body.autoRefillEnabled === true,
        refillAmount,
        refillIntervalValue,
        refillIntervalUnit,
      },
    },
  );
  if (!result.matchedCount) return res.status(404).json({ error: 'Balance not found' });
  mutationLog(req, 'balance_refill_update', String(userId));
  res.json({ success: true });
}));

app.get('/api/files', asyncRoute(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const search = escapeRegex(req.query.search);
  const match = { ...dateQuery(req.query) };
  if (search) {
    match.$or = [
      { filename: { $regex: search, $options: 'i' } },
      { type: { $regex: search, $options: 'i' } },
    ];
  }
  if (req.query.userId) match.user = objectId(req.query.userId);
  const pipeline = [
    { $match: match },
    { $sort: sortQuery(req.query) },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: 'users',
              localField: 'user',
              foreignField: '_id',
              as: 'userInfo',
            },
          },
          { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },
        ],
      },
    },
  ];
  const [result] = await mongoose.connection.db.collection('files').aggregate(pipeline).toArray();
  res.json({
    documents: result.data.map((file) => ({
      _id: file._id,
      filename: file.filename,
      userName: file.userInfo?.name || 'Deleted user',
      type: file.type,
      bytes: file.bytes || 0,
      source: file.source,
      usage: file.usage || 0,
      width: file.width,
      height: file.height,
      createdAt: file.createdAt,
      canPreview: Boolean(resolveStoredFile(file, roots)),
    })),
    pagination: pagination(page, limit, result.metadata[0]?.total || 0),
  });
}));

app.get('/api/files/:id/raw', asyncRoute(async (req, res) => {
  const file = await mongoose.connection.db.collection('files').findOne({ _id: objectId(req.params.id) });
  if (!file) return res.status(404).json({ error: 'File not found' });
  const filePath = resolveStoredFile(file, roots);
  if (!filePath) return res.status(404).json({ error: 'File location is unavailable' });
  try {
    await fs.access(filePath);
  } catch {
    return res.status(404).json({ error: 'File is missing from storage' });
  }
  const safeType = /^[\w.+-]+\/[\w.+-]+$/.test(file.type || '')
    ? file.type
    : 'application/octet-stream';
  res.type(safeType);
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.filename || 'file')}`);
  return res.sendFile(filePath);
}));

app.get('/api/transactions', asyncRoute(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const match = { ...dateQuery(req.query) };
  if (req.query.userId) match.user = objectId(req.query.userId);
  const search = escapeRegex(req.query.search);
  if (search) {
    match.$or = [
      { model: { $regex: search, $options: 'i' } },
      { conversationId: { $regex: search, $options: 'i' } },
      { context: { $regex: search, $options: 'i' } },
    ];
  }
  const [result] = await mongoose.connection.db.collection('transactions').aggregate([
    { $match: match },
    { $sort: sortQuery(req.query) },
    {
      $facet: {
        metadata: [{ $count: 'total' }],
        data: [
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: 'users',
              localField: 'user',
              foreignField: '_id',
              as: 'userInfo',
            },
          },
          { $unwind: { path: '$userInfo', preserveNullAndEmptyArrays: true } },
        ],
      },
    },
  ]).toArray();
  res.json({
    documents: result.data.map((txn) => ({
      _id: txn._id,
      userName: txn.userInfo?.name || 'Deleted user',
      conversationId: txn.conversationId || '-',
      tokenType: txn.tokenType,
      context: txn.context,
      model: txn.model || '-',
      rawAmount: txn.rawAmount,
      tokenValue: txn.tokenValue,
      costUsd: Math.abs(Number(txn.tokenValue || 0)) / 1_000_000,
      createdAt: txn.createdAt,
    })),
    pagination: pagination(page, limit, result.metadata[0]?.total || 0),
  });
}));

app.get('/api/overview', asyncRoute(async (req, res) => {
  const db = mongoose.connection.db;
  const range = dateQuery(req.query);
  const billedMatch = {
    ...range,
    tokenType: { $in: ['prompt', 'completion'] },
  };
  const [users, conversations, files, usage, daily, hotModels] = await Promise.all([
    db.collection('users').countDocuments(),
    db.collection('conversations').countDocuments(range),
    db.collection('files').countDocuments(range),
    db.collection('transactions').aggregate([
      { $match: billedMatch },
      {
        $group: {
          _id: null,
          spentCredits: { $sum: { $multiply: ['$tokenValue', -1] } },
          activeUsers: { $addToSet: '$user' },
          transactions: { $sum: 1 },
        },
      },
    ]).toArray(),
    db.collection('transactions').aggregate([
      { $match: billedMatch },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            user: '$user',
            model: { $ifNull: ['$model', 'Unknown model'] },
            context: { $ifNull: ['$context', 'other'] },
          },
          spentCredits: { $sum: { $multiply: ['$tokenValue', -1] } },
          promptTokens: {
            $sum: {
              $cond: [
                { $eq: ['$tokenType', 'prompt'] },
                { $multiply: ['$rawAmount', -1] },
                0,
              ],
            },
          },
          completionTokens: {
            $sum: {
              $cond: [
                { $eq: ['$tokenType', 'completion'] },
                { $multiply: ['$rawAmount', -1] },
                0,
              ],
            },
          },
          transactionEntries: { $sum: 1 },
          conversations: { $addToSet: '$conversationId' },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id.user',
          foreignField: '_id',
          as: 'userInfo',
        },
      },
      {
        $group: {
          _id: '$_id.date',
          spentCredits: { $sum: '$spentCredits' },
          details: {
            $push: {
              userId: '$_id.user',
              userName: {
                $ifNull: [{ $arrayElemAt: ['$userInfo.name', 0] }, 'Deleted user'],
              },
              model: '$_id.model',
              context: '$_id.context',
              spentCredits: '$spentCredits',
              promptTokens: '$promptTokens',
              completionTokens: '$completionTokens',
              transactionEntries: '$transactionEntries',
              conversationCount: { $size: '$conversations' },
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]).toArray(),
    db.collection('transactions').aggregate([
      {
        $match: {
          ...billedMatch,
          context: 'message',
          model: { $nin: [null, ''] },
        },
      },
      {
        $group: {
          _id: { model: '$model', user: '$user' },
          calls: {
            $sum: { $cond: [{ $eq: ['$tokenType', 'completion'] }, 1, 0] },
          },
          spentCredits: { $sum: { $multiply: ['$tokenValue', -1] } },
          promptTokens: {
            $sum: {
              $cond: [
                { $eq: ['$tokenType', 'prompt'] },
                { $multiply: ['$rawAmount', -1] },
                0,
              ],
            },
          },
          completionTokens: {
            $sum: {
              $cond: [
                { $eq: ['$tokenType', 'completion'] },
                { $multiply: ['$rawAmount', -1] },
                0,
              ],
            },
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id.user',
          foreignField: '_id',
          as: 'userInfo',
        },
      },
      {
        $group: {
          _id: '$_id.model',
          calls: { $sum: '$calls' },
          spentCredits: { $sum: '$spentCredits' },
          promptTokens: { $sum: '$promptTokens' },
          completionTokens: { $sum: '$completionTokens' },
          contributors: {
            $push: {
              userId: '$_id.user',
              userName: {
                $ifNull: [{ $arrayElemAt: ['$userInfo.name', 0] }, 'Deleted user'],
              },
              calls: '$calls',
              spentCredits: '$spentCredits',
            },
          },
        },
      },
      { $sort: { calls: -1, spentCredits: -1 } },
      { $limit: 10 },
    ]).toArray(),
  ]);
  const totals = usage[0] || { spentCredits: 0, activeUsers: [], transactions: 0 };
  res.json({
    users,
    activeUsers: totals.activeUsers.length,
    conversations,
    files,
    transactions: totals.transactions,
    spentCredits: totals.spentCredits,
    costUsd: totals.spentCredits / 1_000_000,
    daily: daily.map((item) => ({
      date: item._id,
      costUsd: item.spentCredits / 1_000_000,
      details: item.details.map((detail) => ({
        ...detail,
        costUsd: detail.spentCredits / 1_000_000,
      })),
    })),
    hotModels: hotModels.map((model) => ({
      model: model._id,
      calls: model.calls,
      spentCredits: model.spentCredits,
      costUsd: model.spentCredits / 1_000_000,
      promptTokens: model.promptTokens,
      completionTokens: model.completionTokens,
      activeUsers: model.contributors.length,
      contributors: model.contributors
        .sort((a, b) => b.calls - a.calls)
        .map((contributor) => ({
          ...contributor,
          costUsd: contributor.spentCredits / 1_000_000,
        })),
    })),
  });
}));

app.get('/api/maintenance/orphans', asyncRoute(async (_req, res) => {
  res.json(await scanOrphans(mongoose.connection.db));
}));

app.post('/api/maintenance/orphans/cleanup', asyncRoute(async (req, res) => {
  if (req.body.confirmation !== 'DELETE ORPHANED DATA') {
    return res.status(400).json({ error: 'Type DELETE ORPHANED DATA to confirm cleanup' });
  }
  const result = await cleanupOrphans(mongoose.connection.db, {
    apply: true,
    keepTransactions: req.body.keepTransactions === true,
    backupRoot: config.BACKUP_ROOT,
    roots: deleteRoots,
  });
  mutationLog(req, 'orphan_cleanup', 'database', { deleted: result.deleted });
  res.json(result);
}));

app.delete('/api/users/:id', asyncRoute(async (req, res) => {
  const id = objectId(req.params.id);
  const user = await mongoose.connection.db.collection('users').findOne({ _id: id });
  if (!user) return res.status(404).json({ error: 'User not found' });
  const result = await deleteUserData(mongoose.connection.db, id, { roots: deleteRoots });
  mutationLog(req, 'user_cascade_delete', String(id), { email: user.email, deleted: result.deleted });
  res.json({ success: true, user: { id, name: user.name, email: user.email }, ...result });
}));

app.get('/api/collection/:name', asyncRoute(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const name = req.params.name;
  const collection = collectionOr404(name);
  const search = escapeRegex(req.query.search);
  const dateField = COLLECTION_DATE_FIELDS[name];
  const query = dateField ? { ...dateQuery(req.query, dateField) } : {};
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { title: { $regex: search, $options: 'i' } },
      { filename: { $regex: search, $options: 'i' } },
    ];
  }
  const requestedSort = req.query.sortBy === 'createdAt' && dateField && dateField !== 'createdAt'
    ? { ...req.query, sortBy: dateField }
    : req.query;
  const [documents, total] = await Promise.all([
    collection.find(query).sort(sortQuery(requestedSort, dateField || '_id')).skip(skip).limit(limit).toArray(),
    collection.countDocuments(query),
  ]);
  res.json({ documents, pagination: pagination(page, limit, total) });
}));

app.get('/api/collection/:name/:id', asyncRoute(async (req, res) => {
  const document = await collectionOr404(req.params.name).findOne({ _id: objectId(req.params.id) });
  if (!document) return res.status(404).json({ error: 'Document not found' });
  res.json(document);
}));

app.put('/api/collection/:name/:id', asyncRoute(async (req, res) => {
  const { name, id } = req.params;
  if (!EDITABLE_COLLECTIONS.has(name)) {
    return res.status(403).json({ error: 'This collection is read-only in the admin panel' });
  }
  const data = { ...req.body };
  delete data._id;
  delete data.user;
  const result = await collectionOr404(name).updateOne({ _id: objectId(id) }, { $set: data });
  if (!result.matchedCount) return res.status(404).json({ error: 'Document not found' });
  mutationLog(req, 'document_update', `${name}/${id}`);
  res.json({ success: true, modifiedCount: result.modifiedCount });
}));

app.delete('/api/collection/:name/:id', asyncRoute(async (req, res) => {
  const { name, id } = req.params;
  if (name === 'users') {
    return res.status(409).json({ error: 'Use the user deletion endpoint so related data is removed safely' });
  }
  if (!EDITABLE_COLLECTIONS.has(name)) {
    return res.status(403).json({ error: 'This collection is read-only in the admin panel' });
  }
  const result = await collectionOr404(name).deleteOne({ _id: objectId(id) });
  if (!result.deletedCount) return res.status(404).json({ error: 'Document not found' });
  mutationLog(req, 'document_delete', `${name}/${id}`);
  res.json({ success: true });
}));

app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: '1h',
  index: 'index.html',
  setHeaders: (res, filePath) => {
    if (path.basename(filePath) === 'index.html') {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

app.use((error, req, res, _next) => {
  console.error(JSON.stringify({
    event: 'admin_error',
    at: new Date().toISOString(),
    method: req.method,
    path: req.path,
    message: error.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
  }));
  res.status(error.status || 500).json({
    error: error.status ? error.message : 'Unexpected server error',
  });
});

async function start() {
  await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
  try {
    await ensureIndexes(mongoose.connection.db);
  } catch (error) {
    console.error('Index initialization failed; server will continue:', error);
  }
  app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`LibreChat Admin Panel listening on port ${config.PORT}`);
  });
}

start().catch((error) => {
  console.error('Failed to start admin panel:', error);
  process.exit(1);
});
