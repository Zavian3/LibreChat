require('dotenv').config();

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

module.exports = {
  PORT: Number(process.env.ADMIN_PORT || 3001),
  MONGO_URI: process.env.MONGO_URI || 'mongodb://chat-mongodb:27017/LibreChat',
  ADMIN_USERNAME: required('ADMIN_USERNAME'),
  ADMIN_PASSWORD_HASH: required('ADMIN_PASSWORD_HASH'),
  SESSION_SECRET: required('ADMIN_SESSION_SECRET'),
  COOKIE_SECURE: process.env.COOKIE_SECURE !== 'false',
  IMAGES_ROOT: process.env.ADMIN_IMAGES_ROOT || '/data/images',
  UPLOADS_ROOT: process.env.ADMIN_UPLOADS_ROOT || '/data/uploads',
  DELETE_IMAGES_ROOT: process.env.ADMIN_DELETE_IMAGES_ROOT || '/data/cleanup-images',
  DELETE_UPLOADS_ROOT: process.env.ADMIN_DELETE_UPLOADS_ROOT || '/data/cleanup-uploads',
  BACKUP_ROOT: process.env.ADMIN_BACKUP_ROOT || '/data/backups',
};

