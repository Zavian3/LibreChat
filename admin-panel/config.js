// Configuration for Admin Panel
// Edit these values according to your setup

module.exports = {
  // Server Port
  PORT: process.env.ADMIN_PORT || 3001,
  
  // MongoDB Connection
  // For Docker: use 'chat-mongodb' as hostname
  // For local: use 'localhost'
  MONGO_URI: process.env.MONGO_URI || 'mongodb://chat-mongodb:27017/LibreChat',
  
  // Admin Credentials (CHANGE THESE IN PRODUCTION!)
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin@ai.180marketing.com',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'adminPass@180ai',
  
  // Session Secret (CHANGE THIS IN PRODUCTION!)
  SESSION_SECRET: process.env.ADMIN_SESSION_SECRET || 'librechat-admin-panel-secret-key-2024'
};

