/**
 * Import Logger Service
 * Stores import logs in Redis with 7-day retention for the terminal-style log viewer
 */

const { redis } = require('../config/redis');

const IMPORT_LOGS_KEY = 'import:logs';
const IMPORT_STATS_KEY = 'import:stats';
const IMPORT_LAST_RUN_KEY = 'import:lastRun';
const MAX_LOGS = 500; // Keep last 500 log entries
const LOG_RETENTION_SECONDS = 7 * 24 * 60 * 60; // 7 days

// Log levels with colors for terminal display
const LogLevel = {
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
  DEBUG: 'debug'
};

/**
 * Add a log entry to Redis
 * @param {string} level - Log level (info, success, warning, error, debug)
 * @param {string} message - Log message
 * @param {Object} metadata - Optional metadata
 */
async function addLog(level, message, metadata = {}) {
  if (!redis) {
    console.log(`[ImportLog] ${level.toUpperCase()}: ${message}`);
    return;
  }

  try {
    const logEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata
    };

    // Add to list (push to front)
    await redis.lpush(IMPORT_LOGS_KEY, JSON.stringify(logEntry));

    // Trim to max entries
    await redis.ltrim(IMPORT_LOGS_KEY, 0, MAX_LOGS - 1);

    // Set expiry on the key
    await redis.expire(IMPORT_LOGS_KEY, LOG_RETENTION_SECONDS);

    // Also log to console for debugging
    const icon = level === 'success' ? '✅' : 
                 level === 'error' ? '❌' : 
                 level === 'warning' ? '⚠️' : 
                 level === 'debug' ? '🔍' : 'ℹ️';
    console.log(`${icon} [ImportLog] ${message}`);
  } catch (error) {
    console.error('Failed to add import log:', error.message);
  }
}

/**
 * Get recent log entries
 * @param {number} count - Number of entries to retrieve (default 100)
 * @returns {Promise<Array>} Array of log entries (newest first)
 */
async function getLogs(count = 100) {
  if (!redis) {
    return [];
  }

  try {
    const logs = await redis.lrange(IMPORT_LOGS_KEY, 0, count - 1);
    return logs.map(log => {
      try {
        return JSON.parse(log);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch (error) {
    console.error('Failed to get import logs:', error.message);
    return [];
  }
}

/**
 * Clear all logs
 */
async function clearLogs() {
  if (!redis) return;

  try {
    await redis.del(IMPORT_LOGS_KEY);
    await addLog(LogLevel.INFO, 'Import logs cleared');
  } catch (error) {
    console.error('Failed to clear import logs:', error.message);
  }
}

/**
 * Update import statistics
 * @param {Object} stats - Statistics object
 */
async function updateStats(stats) {
  if (!redis) return;

  try {
    const existingStats = await getStats();
    const updatedStats = {
      ...existingStats,
      ...stats,
      updatedAt: new Date().toISOString()
    };

    await redis.set(IMPORT_STATS_KEY, JSON.stringify(updatedStats));
    await redis.expire(IMPORT_STATS_KEY, LOG_RETENTION_SECONDS);
  } catch (error) {
    console.error('Failed to update import stats:', error.message);
  }
}

/**
 * Get import statistics
 * @returns {Promise<Object>} Statistics object
 */
async function getStats() {
  if (!redis) {
    return {
      totalScans: 0,
      totalFilesProcessed: 0,
      totalSuccessful: 0,
      totalFailed: 0,
      lastRunAt: null,
      lastRunDuration: null,
      lastRunStats: null
    };
  }

  try {
    const stats = await redis.get(IMPORT_STATS_KEY);
    if (stats) {
      return JSON.parse(stats);
    }
    return {
      totalScans: 0,
      totalFilesProcessed: 0,
      totalSuccessful: 0,
      totalFailed: 0,
      lastRunAt: null,
      lastRunDuration: null,
      lastRunStats: null
    };
  } catch (error) {
    console.error('Failed to get import stats:', error.message);
    return {};
  }
}

/**
 * Record the start of an import run
 * @returns {Object} Run context with startTime
 */
async function startRun() {
  const runContext = {
    runId: `run-${Date.now()}`,
    startTime: Date.now(),
    startTimestamp: new Date().toISOString()
  };

  await addLog(LogLevel.INFO, `Import scan started (Run ID: ${runContext.runId})`);

  if (redis) {
    try {
      await redis.set(IMPORT_LAST_RUN_KEY, JSON.stringify({
        runId: runContext.runId,
        startedAt: runContext.startTimestamp,
        status: 'running'
      }));
    } catch (error) {
      console.error('Failed to record run start:', error.message);
    }
  }

  return runContext;
}

/**
 * Record the end of an import run
 * @param {Object} runContext - Context from startRun()
 * @param {Object} results - Import results
 */
async function endRun(runContext, results) {
  const endTime = Date.now();
  const duration = endTime - runContext.startTime;
  const durationStr = duration > 60000 
    ? `${(duration / 60000).toFixed(1)} minutes`
    : `${(duration / 1000).toFixed(1)} seconds`;

  // Log summary
  await addLog(
    results.errors && results.errors.length > 0 ? LogLevel.WARNING : LogLevel.SUCCESS,
    `Import scan completed in ${durationStr}`,
    {
      runId: runContext.runId,
      duration,
      ...results
    }
  );

  // Log individual stats
  if (results.scanned > 0) {
    await addLog(LogLevel.INFO, `  Files scanned: ${results.scanned}`);
  }
  if (results.queued > 0) {
    await addLog(LogLevel.SUCCESS, `  Files queued for processing: ${results.queued}`);
  }
  if (results.duplicates > 0) {
    await addLog(LogLevel.INFO, `  Duplicates skipped: ${results.duplicates}`);
  }
  if (results.skipped > 0) {
    await addLog(LogLevel.INFO, `  Files skipped: ${results.skipped}`);
  }
  if (results.errors && results.errors.length > 0) {
    await addLog(LogLevel.ERROR, `  Errors: ${results.errors.length}`);
    for (const error of results.errors.slice(0, 5)) { // Log first 5 errors
      await addLog(LogLevel.ERROR, `    - ${error.fileName || 'Unknown'}: ${error.error}`);
    }
  }

  // Update stats
  const existingStats = await getStats();
  await updateStats({
    totalScans: (existingStats.totalScans || 0) + 1,
    totalFilesProcessed: (existingStats.totalFilesProcessed || 0) + (results.queued || 0),
    totalSuccessful: (existingStats.totalSuccessful || 0) + (results.queued || 0),
    totalFailed: (existingStats.totalFailed || 0) + (results.errors?.length || 0),
    lastRunAt: new Date().toISOString(),
    lastRunDuration: duration,
    lastRunStats: results
  });

  // Update last run info
  if (redis) {
    try {
      await redis.set(IMPORT_LAST_RUN_KEY, JSON.stringify({
        runId: runContext.runId,
        startedAt: runContext.startTimestamp,
        endedAt: new Date().toISOString(),
        duration,
        status: 'completed',
        results
      }));
    } catch (error) {
      console.error('Failed to record run end:', error.message);
    }
  }

  return { duration, durationStr };
}

/**
 * Get last run information
 * @returns {Promise<Object|null>} Last run info or null
 */
async function getLastRun() {
  if (!redis) return null;

  try {
    const lastRun = await redis.get(IMPORT_LAST_RUN_KEY);
    return lastRun ? JSON.parse(lastRun) : null;
  } catch (error) {
    console.error('Failed to get last run:', error.message);
    return null;
  }
}

// Convenience methods for different log levels
const log = {
  info: (message, metadata) => addLog(LogLevel.INFO, message, metadata),
  success: (message, metadata) => addLog(LogLevel.SUCCESS, message, metadata),
  warning: (message, metadata) => addLog(LogLevel.WARNING, message, metadata),
  error: (message, metadata) => addLog(LogLevel.ERROR, message, metadata),
  debug: (message, metadata) => addLog(LogLevel.DEBUG, message, metadata)
};

module.exports = {
  LogLevel,
  addLog,
  getLogs,
  clearLogs,
  updateStats,
  getStats,
  startRun,
  endRun,
  getLastRun,
  log
};

