/**
 * Redis-backed store for bulk allocation sessions
 * Tracks progress of bulk document allocation operations
 */

const { redis } = require('../config/redis');

const ALLOCATION_PREFIX = 'allocation:';
const ALLOCATION_TTL = 24 * 60 * 60; // 24 hours in seconds

// In-memory fallback if Redis is not available
const memoryFallback = new Map();

/**
 * Create a new allocation session
 */
async function createAllocation(allocationId, totalFiles, fileIds, userId) {
  const allocationSession = {
    allocationId,
    totalFiles,
    processedFiles: 0,
    currentFile: null,
    results: [],
    fileIds, // Store file IDs to process
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
        ALLOCATION_PREFIX + allocationId, 
        ALLOCATION_TTL, 
        JSON.stringify(allocationSession)
      );
      console.log(`📦 [Allocation ${allocationId}] Created allocation session in Redis (${totalFiles} files)`);
    } catch (error) {
      console.error(`⚠️  [Allocation ${allocationId}] Failed to create in Redis, using memory:`, error.message);
      memoryFallback.set(allocationId, allocationSession);
    }
  } else {
    console.log(`📦 [Allocation ${allocationId}] Created allocation session in memory (${totalFiles} files)`);
    memoryFallback.set(allocationId, allocationSession);
  }
  
  return allocationSession;
}

/**
 * Get an allocation session
 */
async function getAllocation(allocationId) {
  if (redis && redis.status === 'ready') {
    try {
      const data = await redis.get(ALLOCATION_PREFIX + allocationId);
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      console.error(`⚠️  [Allocation ${allocationId}] Failed to get from Redis:`, error.message);
    }
  }
  
  // Fallback to memory
  return memoryFallback.get(allocationId) || null;
}

/**
 * Add a result to an allocation session
 */
async function addResult(allocationId, result) {
  const allocationSession = await getAllocation(allocationId);
  if (!allocationSession) {
    console.warn(`⚠️  Allocation session ${allocationId} not found`);
    return;
  }
  
  allocationSession.results.push(result);
  allocationSession.processedFiles++;
  
  // Update status
  if (allocationSession.processedFiles >= allocationSession.totalFiles) {
    allocationSession.status = 'completed';
    allocationSession.completedAt = new Date().toISOString();
  }
  
  await saveAllocation(allocationId, allocationSession);
  
  if (!result.success) {
    allocationSession.errors.push({
      fileId: result.fileId,
      fileName: result.fileName,
      error: result.error
    });
  }
  
  console.log(`📊 [Allocation ${allocationId}] Progress: ${allocationSession.processedFiles}/${allocationSession.totalFiles}`);
}

/**
 * Save an allocation session
 */
async function saveAllocation(allocationId, allocationSession) {
  if (redis && redis.status === 'ready') {
    try {
      await redis.setex(
        ALLOCATION_PREFIX + allocationId,
        ALLOCATION_TTL,
        JSON.stringify(allocationSession)
      );
    } catch (error) {
      console.error(`⚠️  [Allocation ${allocationId}] Failed to save to Redis:`, error.message);
      memoryFallback.set(allocationId, allocationSession);
    }
  } else {
    memoryFallback.set(allocationId, allocationSession);
  }
}

/**
 * Update an allocation session
 */
async function updateAllocation(allocationId, updates) {
  const allocationSession = await getAllocation(allocationId);
  if (!allocationSession) {
    console.warn(`⚠️  Allocation session ${allocationId} not found`);
    return null;
  }
  
  Object.assign(allocationSession, updates);
  await saveAllocation(allocationId, allocationSession);
  return allocationSession;
}

/**
 * Cancel an allocation session
 */
async function cancelAllocation(allocationId) {
  const allocationSession = await getAllocation(allocationId);
  if (!allocationSession) {
    return false;
  }
  
  allocationSession.cancelled = true;
  allocationSession.status = 'cancelled';
  await saveAllocation(allocationId, allocationSession);
  return true;
}

/**
 * Check if an allocation session is cancelled
 */
async function isCancelled(allocationId) {
  const allocationSession = await getAllocation(allocationId);
  return allocationSession ? allocationSession.cancelled : false;
}

/**
 * Delete an allocation session
 */
async function deleteAllocation(allocationId) {
  if (redis && redis.status === 'ready') {
    try {
      await redis.del(ALLOCATION_PREFIX + allocationId);
    } catch (error) {
      console.error(`⚠️  [Allocation ${allocationId}] Failed to delete from Redis:`, error.message);
    }
  }
  
  memoryFallback.delete(allocationId);
}

/**
 * Clean up old allocation sessions (older than 24 hours)
 * Note: Redis TTL handles this automatically, but we still clean memory fallback
 */
async function cleanupOldAllocations() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [allocationId, allocationSession] of memoryFallback.entries()) {
    const createdAt = new Date(allocationSession.createdAt).getTime();
    if (now - createdAt > maxAge) {
      memoryFallback.delete(allocationId);
      console.log(`🧹 Cleaned up old allocation session: ${allocationId}`);
    }
  }
}

// Clean up old allocations every hour (memory fallback only - Redis uses TTL)
setInterval(cleanupOldAllocations, 60 * 60 * 1000);

module.exports = {
  createAllocation,
  addResult,
  updateAllocation,
  getAllocation,
  saveAllocation,
  cancelAllocation,
  isCancelled,
  deleteAllocation,
  cleanupOldAllocations
};
