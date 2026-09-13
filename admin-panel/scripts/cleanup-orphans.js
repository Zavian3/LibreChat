#!/usr/bin/env node
require('dotenv').config();
const mongoose = require('mongoose');
const config = require('../config');
const { cleanupOrphans } = require('../lib/orphan-cleanup');

async function main() {
  const apply = process.argv.includes('--apply');
  const keepTransactions = process.argv.includes('--keep-transactions');

  await mongoose.connect(config.MONGO_URI);
  const result = await cleanupOrphans(mongoose.connection.db, {
    apply,
    keepTransactions,
    backupRoot: config.BACKUP_ROOT,
    roots: {
      images: config.DELETE_IMAGES_ROOT,
      uploads: config.DELETE_UPLOADS_ROOT,
    },
  });

  console.log(JSON.stringify(result, null, 2));
  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to back up and remove these records.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
