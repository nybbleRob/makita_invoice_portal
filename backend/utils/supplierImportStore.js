/**
 * Redis-backed store for supplier document import sessions
 * Allows sharing import state between backend server and queue worker processes
 */

const { redis } = require('../config/redis');

const IMPORT_PREFIX = 'supplier-import:';
const IMPORT_TTL = 24 * 60 * 60; // 24 hours in seconds

// In-memory fallback if Redis is not available
const memoryFallback = new Map();

/**
 * Create a new supplier import session
 */
async function createImport(importId, totalFiles, filePaths, userId) {
  const importSession = {
    importId,
    totalFiles,
    processedFiles: 0,
    currentFile: null,
    results: [],
    filePaths, // Store original file paths for cleanup
    userId,
    status: 'processing',
    cancelled: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
    errors: []
  };
  
  if (redis && redis.status === 'ready') {
    try {
      await redis.setex(
        IMPORT_PREFIX + importId, 
        IMPORT_TTL, 
        JSON.stringify(importSession)
      );
      console.log(`📦 [Supplier Import ${importId}] Created import session in Redis (${totalFiles} files)`);
    } catch (error) {
      console.error(`⚠️  [Supplier Import ${importId}] Failed to create in Redis, using memory:`, error.message);
      memoryFallback.set(importId, importSession);
    }
  } else {
    console.log(`📦 [Supplier Import ${importId}] Created import session in memory (${totalFiles} files)`);
    memoryFallback.set(importId, importSession);
  }
  
  return importSession;
}

/**
 * Get a supplier import session
 */
async function getImport(importId) {
  if (redis && redis.status === 'ready') {
    try {
      const data = await redis.get(IMPORT_PREFIX + importId);
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      console.error(`⚠️  [Supplier Import ${importId}] Failed to get from Redis:`, error.message);
    }
  }
  
  // Fallback to memory
  return memoryFallback.get(importId) || null;
}

/**
 * Add a result to a supplier import session
 */
async function addResult(importId, result) {
  const importSession = await getImport(importId);
  if (!importSession) {
    console.warn(`⚠️  Supplier import session ${importId} not found`);
    return;
  }
  
  importSession.results.push(result);
  importSession.processedFiles++;
  
  // Update status
  if (importSession.processedFiles >= importSession.totalFiles) {
    importSession.status = 'completed';
    importSession.completedAt = new Date().toISOString();
  }
  
  await saveImport(importId, importSession);
  
  if (!result.success) {
    importSession.errors.push({
      fileName: result.fileName,
      error: result.error
    });
  }
  
  console.log(`📊 [Supplier Import ${importId}] Progress: ${importSession.processedFiles}/${importSession.totalFiles}`);
}

/**
 * Save a supplier import session
 */
async function saveImport(importId, importSession) {
  if (redis && redis.status === 'ready') {
    try {
      await redis.setex(
        IMPORT_PREFIX + importId,
        IMPORT_TTL,
        JSON.stringify(importSession)
      );
    } catch (error) {
      console.error(`⚠️  [Supplier Import ${importId}] Failed to save to Redis:`, error.message);
      memoryFallback.set(importId, importSession);
    }
  } else {
    memoryFallback.set(importId, importSession);
  }
}

/**
 * Update a supplier import session
 */
async function updateImport(importId, updates) {
  const importSession = await getImport(importId);
  if (!importSession) {
    console.warn(`⚠️  Supplier import session ${importId} not found`);
    return null;
  }
  
  Object.assign(importSession, updates);
  await saveImport(importId, importSession);
  return importSession;
}

/**
 * Cancel a supplier import session
 */
async function cancelImport(importId) {
  const importSession = await getImport(importId);
  if (!importSession) {
    return false;
  }
  
  importSession.cancelled = true;
  importSession.status = 'cancelled';
  await saveImport(importId, importSession);
  return true;
}

/**
 * Check if a supplier import session is cancelled
 */
async function isCancelled(importId) {
  const importSession = await getImport(importId);
  return importSession ? importSession.cancelled : false;
}

/**
 * Delete a supplier import session and return file paths for cleanup
 */
async function deleteImport(importId) {
  const importSession = await getImport(importId);
  if (!importSession) {
    return [];
  }
  
  const filePaths = importSession.filePaths || [];
  
  if (redis && redis.status === 'ready') {
    try {
      await redis.del(IMPORT_PREFIX + importId);
    } catch (error) {
      console.error(`⚠️  [Supplier Import ${importId}] Failed to delete from Redis:`, error.message);
    }
  }
  
  memoryFallback.delete(importId);
  
  return filePaths;
}

module.exports = {
  createImport,
  addResult,
  updateImport,
  getImport,
  cancelImport,
  isCancelled,
  deleteImport,
  saveImport
};
