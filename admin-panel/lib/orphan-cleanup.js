const fs = require('fs/promises');
const path = require('path');
const { EJSON, ObjectId } = require('bson');

const COLLECTION_SPECS = [
  { name: 'balances', type: 'objectId' },
  { name: 'transactions', type: 'objectId' },
  { name: 'files', type: 'objectId' },
  { name: 'sessions', type: 'objectId' },
  { name: 'messages', type: 'string' },
  { name: 'conversations', type: 'string' },
  { name: 'sharedlinks', type: 'string' },
  { name: 'presets', type: 'string' },
  { name: 'conversationtags', type: 'string' },
];

function orphanQuery(spec, objectIds, stringIds) {
  return {
    user: {
      $exists: true,
      $nin: spec.type === 'objectId' ? objectIds : stringIds,
    },
  };
}

async function scanOrphans(db) {
  const objectIds = await db.collection('users').distinct('_id');
  const stringIds = objectIds.map(String);
  const collections = {};

  for (const spec of COLLECTION_SPECS) {
    const collection = db.collection(spec.name);
    const query = orphanQuery(spec, objectIds, stringIds);
    const count = await collection.countDocuments(query);
    collections[spec.name] = { count, userType: spec.type };
  }

  const orphanFiles = await db.collection('files')
    .find(orphanQuery(COLLECTION_SPECS.find((item) => item.name === 'files'), objectIds, stringIds))
    .project({ bytes: 1 })
    .toArray();

  return {
    scannedAt: new Date(),
    activeUsers: objectIds.length,
    totalOrphans: Object.values(collections).reduce((sum, item) => sum + item.count, 0),
    orphanFileBytes: orphanFiles.reduce((sum, file) => sum + (Number(file.bytes) || 0), 0),
    collections,
  };
}

function resolveStoredFile(file, roots) {
  if (!file?.filepath || typeof file.filepath !== 'string') {
    return null;
  }

  const normalized = file.filepath.replace(/\\/g, '/');
  let root;
  let relative;

  if (normalized.startsWith('/images/')) {
    root = roots.images;
    relative = normalized.slice('/images/'.length);
  } else if (normalized.startsWith('/app/client/public/images/')) {
    root = roots.images;
    relative = normalized.slice('/app/client/public/images/'.length);
  } else if (normalized.startsWith('/app/uploads/')) {
    root = roots.uploads;
    relative = normalized.slice('/app/uploads/'.length);
  } else if (normalized.startsWith('/uploads/')) {
    root = roots.uploads;
    relative = normalized.slice('/uploads/'.length);
  } else {
    return null;
  }

  const safeRoot = path.resolve(root);
  const resolved = path.resolve(safeRoot, relative);
  if (resolved !== safeRoot && !resolved.startsWith(`${safeRoot}${path.sep}`)) {
    return null;
  }
  return resolved;
}

async function writeBackup(db, queries, backupRoot, label) {
  const payload = {
    metadata: {
      createdAt: new Date(),
      database: db.databaseName,
      label,
    },
    collections: {},
  };

  for (const [name, query] of Object.entries(queries)) {
    payload.collections[name] = await db.collection(name).find(query).toArray();
  }

  await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupRoot, `${label}-${stamp}.ejson`);
  await fs.writeFile(backupPath, EJSON.stringify(payload, null, 2), { mode: 0o600 });
  return backupPath;
}

async function removePhysicalFiles(files, roots) {
  const result = { removed: 0, missing: 0, skipped: 0, errors: [] };

  for (const file of files) {
    const filePath = resolveStoredFile(file, roots);
    if (!filePath) {
      result.skipped += 1;
      continue;
    }
    try {
      await fs.unlink(filePath);
      result.removed += 1;
    } catch (error) {
      if (error.code === 'ENOENT') {
        result.missing += 1;
      } else {
        result.errors.push({ fileId: String(file._id), message: error.message });
      }
    }
  }
  return result;
}

async function cleanupOrphans(db, options) {
  const {
    backupRoot,
    roots,
    keepTransactions = false,
    apply = false,
  } = options;

  const objectIds = await db.collection('users').distinct('_id');
  const stringIds = objectIds.map(String);
  const queries = Object.fromEntries(
    COLLECTION_SPECS
      .filter((spec) => !(keepTransactions && spec.name === 'transactions'))
      .map((spec) => [spec.name, orphanQuery(spec, objectIds, stringIds)]),
  );
  const report = await scanOrphans(db);

  if (!apply) {
    return { applied: false, report };
  }

  const backupPath = await writeBackup(db, queries, backupRoot, 'orphan-cleanup');
  const orphanFiles = queries.files
    ? await db.collection('files').find(queries.files).toArray()
    : [];
  const physicalFiles = await removePhysicalFiles(orphanFiles, roots);
  const deleted = {};

  for (const [name, query] of Object.entries(queries)) {
    const result = await db.collection(name).deleteMany(query);
    deleted[name] = result.deletedCount;
  }

  return {
    applied: true,
    backupPath,
    keepTransactions,
    deleted,
    physicalFiles,
    before: report,
    after: await scanOrphans(db),
  };
}

async function deleteUserData(db, userId, options) {
  const objectId = userId instanceof ObjectId ? userId : new ObjectId(userId);
  const stringId = String(objectId);
  const objectCollections = COLLECTION_SPECS.filter((spec) => spec.type === 'objectId');
  const stringCollections = COLLECTION_SPECS.filter((spec) => spec.type === 'string');
  const files = await db.collection('files').find({ user: objectId }).toArray();
  const physicalFiles = await removePhysicalFiles(files, options.roots);
  const deleted = {};

  for (const spec of [...objectCollections, ...stringCollections]) {
    const value = spec.type === 'objectId' ? objectId : stringId;
    const result = await db.collection(spec.name).deleteMany({ user: value });
    deleted[spec.name] = result.deletedCount;
  }

  await db.collection('groups').updateMany(
    { members: { $in: [objectId, stringId] } },
    { $pull: { members: { $in: [objectId, stringId] } } },
  );

  const userResult = await db.collection('users').deleteOne({ _id: objectId });
  deleted.users = userResult.deletedCount;
  return { deleted, physicalFiles };
}

module.exports = {
  COLLECTION_SPECS,
  cleanupOrphans,
  deleteUserData,
  resolveStoredFile,
  scanOrphans,
};
