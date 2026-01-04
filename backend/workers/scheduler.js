/**
 * Scheduler Worker Process
 * Handles scheduled tasks like file cleanup using BullMQ repeatable jobs
 * Run this as a separate PM2 process
 * 
 * Features:
 * - Redis connection validation with retry
 * - Health check heartbeat
 * - Missed job detection
 * - Graceful shutdown with interval cleanup
 */

require('dotenv').config();

const IORedis = require('ioredis');
const { scheduledTasksQueue } = require('../config/queue');

console.log('🔧 Initializing BullMQ scheduler worker...');

// Store interval references for cleanup on shutdown
let statusInterval = null;
let heartbeatInterval = null;

// Health check Redis key
const SCHEDULER_HEARTBEAT_KEY = 'scheduler:heartbeat';
const SCHEDULER_LAST_RUN_KEY = 'scheduler:last_run';
const HEARTBEAT_TTL = 60; // seconds

// Create Redis connection for health checks
let healthRedis = null;
try {
  healthRedis = new IORedis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true
  });
} catch (err) {
  console.warn('⚠️  Could not create health check Redis connection:', err.message);
}

/**
 * Wait for Redis to be ready with retry logic
 */
async function waitForRedis(maxRetries = 10, retryDelay = 2000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      // Check if the queue can perform operations by getting job counts
      // This is a simple way to verify the Redis connection is working
      await scheduledTasksQueue.getJobCounts();
      console.log('✅ Redis connection verified');
      return true;
    } catch (error) {
      console.log(`⏳ Waiting for Redis... (${i + 1}/${maxRetries}): ${error.message}`);
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }
  throw new Error('Redis connection failed after maximum retries');
}

/**
 * Check for missed scheduled jobs
 * Logs a warning if the last run was longer ago than expected
 */
async function checkMissedJobs() {
  if (!healthRedis) return;
  
  try {
    await healthRedis.connect();
    const lastRunStr = await healthRedis.get(SCHEDULER_LAST_RUN_KEY);
    
    if (lastRunStr) {
      const lastRun = new Date(lastRunStr);
      const now = new Date();
      const hoursSinceLastRun = (now - lastRun) / (1000 * 60 * 60);
      
      // If more than 25 hours since last run, jobs might have been missed
      if (hoursSinceLastRun > 25) {
        console.warn(`⚠️  Scheduler was down for ${hoursSinceLastRun.toFixed(1)} hours`);
        console.warn('   Some scheduled jobs may have been missed');
        console.warn(`   Last run: ${lastRun.toISOString()}`);
      }
    }
    
    // Update last run time
    await healthRedis.set(SCHEDULER_LAST_RUN_KEY, new Date().toISOString());
  } catch (error) {
    // Non-critical error, just log
    console.warn('⚠️  Could not check for missed jobs:', error.message);
  }
}

/**
 * Update heartbeat in Redis for health monitoring
 */
async function updateHeartbeat() {
  if (!healthRedis) return;
  
  try {
    const heartbeatData = JSON.stringify({
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: process.uptime()
    });
    await healthRedis.setex(SCHEDULER_HEARTBEAT_KEY, HEARTBEAT_TTL, heartbeatData);
  } catch (error) {
    // Non-critical, don't log every failure
  }
}

/**
 * Get scheduler health status
 */
async function getHealthStatus() {
  const status = {
    healthy: false,
    uptime: process.uptime(),
    pid: process.pid,
    scheduledJobs: [],
    redisConnected: false
  };
  
  try {
    const repeatableJobs = await scheduledTasksQueue.getRepeatableJobs();
    status.scheduledJobs = repeatableJobs.map(job => ({
      name: job.name,
      pattern: job.pattern,
      nextRun: job.next ? new Date(job.next).toISOString() : null
    }));
    status.redisConnected = true;
    status.healthy = true;
  } catch (error) {
    status.error = error.message;
  }
  
  return status;
}

/**
 * Get cron pattern from frequency in minutes
 */
function getCronPattern(frequencyMinutes) {
  if (frequencyMinutes < 60) {
    // Every X minutes
    return `*/${frequencyMinutes} * * * *`;
  } else if (frequencyMinutes === 60) {
    // Every hour at minute 0
    return '0 * * * *';
  } else if (frequencyMinutes < 1440) {
    // Every X hours
    const hours = frequencyMinutes / 60;
    return `0 */${hours} * * *`;
  } else {
    // Daily at midnight
    return '0 0 * * *';
  }
}

/**
 * Get frequency label for logging
 */
function getFrequencyLabel(frequencyMinutes) {
  if (frequencyMinutes < 60) {
    return `every ${frequencyMinutes} minutes`;
  } else if (frequencyMinutes === 60) {
    return 'hourly';
  } else if (frequencyMinutes < 1440) {
    return `every ${frequencyMinutes / 60} hours`;
  } else {
    return 'daily';
  }
}

/**
 * Schedule repeatable jobs
 */
async function setupScheduledJobs() {
  try {
    // Remove any existing repeatable jobs to avoid duplicates
    const existingJobs = await scheduledTasksQueue.getRepeatableJobs();
    for (const job of existingJobs) {
      await scheduledTasksQueue.removeRepeatableByKey(job.key);
      console.log(`🗑️  Removed existing repeatable job: ${job.name}`);
    }
    
    // Schedule file cleanup - daily at 2 AM
    // Cron pattern: minute hour day-of-month month day-of-week
    await scheduledTasksQueue.add(
      'file-cleanup',
      { task: 'file-cleanup' },
      {
        repeat: {
          pattern: '0 2 * * *', // Daily at 2:00 AM
          tz: process.env.TZ || 'UTC'
        },
        removeOnComplete: {
          age: 7 * 24 * 3600, // Keep completed jobs for 7 days
          count: 100
        },
        removeOnFail: {
          age: 30 * 24 * 3600 // Keep failed jobs for 30 days
        }
      }
    );
    console.log('✅ File cleanup scheduled: Daily at 2:00 AM');
    
    // Schedule document retention cleanup - hourly
    // This deletes documents that have passed their retentionExpiryDate
    await scheduledTasksQueue.add(
      'document-retention-cleanup',
      { task: 'document-retention-cleanup' },
      {
        repeat: {
          pattern: '0 * * * *', // Every hour at :00
          tz: process.env.TZ || 'UTC'
        },
        removeOnComplete: {
          age: 7 * 24 * 3600, // Keep completed jobs for 7 days
          count: 168 // Keep ~1 week of hourly runs
        },
        removeOnFail: {
          age: 30 * 24 * 3600 // Keep failed jobs for 30 days
        }
      }
    );
    console.log('✅ Document retention cleanup scheduled: Hourly at :00');
    
    // Get import frequency from settings
    let frequencyMinutes = 60; // Default: hourly
    let importEnabled = true;
    
    try {
      // Load settings from database
      const { Settings } = require('../models');
      const settings = await Settings.getSettings();
      if (settings.importSettings) {
        frequencyMinutes = settings.importSettings.frequency || 60;
        importEnabled = settings.importSettings.enabled !== false;
      }
    } catch (settingsError) {
      console.warn('⚠️  Could not load import settings, using defaults:', settingsError.message);
    }
    
    // Schedule local folder scan based on settings
    if (importEnabled) {
      const cronPattern = getCronPattern(frequencyMinutes);
      const frequencyLabel = getFrequencyLabel(frequencyMinutes);
      
      await scheduledTasksQueue.add(
        'local-folder-scan',
        { task: 'local-folder-scan' },
        {
          repeat: {
            pattern: cronPattern,
            tz: process.env.TZ || 'UTC'
          },
          removeOnComplete: {
            age: 24 * 3600, // Keep completed jobs for 24 hours
            count: 50
          },
          removeOnFail: {
            age: 7 * 24 * 3600 // Keep failed jobs for 7 days
          }
        }
      );
      console.log(`✅ Local folder scan scheduled: ${frequencyLabel} (${cronPattern})`);
    } else {
      console.log('ℹ️  Local folder scan is disabled in settings');
    }
    
    console.log('✅ All scheduled jobs configured');
    return true;
  } catch (error) {
    console.error('❌ Error setting up scheduled jobs:', error.message);
    if (error.stack) {
      console.error('   Stack:', error.stack);
    }
    return false;
  }
}

/**
 * Main initialization function
 */
async function initialize() {
  try {
    // Step 1: Wait for Redis to be ready
    console.log('🔄 Checking Redis connection...');
    await waitForRedis();
    
    // Step 2: Check for missed jobs
    await checkMissedJobs();
    
    // Step 3: Setup scheduled jobs
    const success = await setupScheduledJobs();
    if (!success) {
      console.error('❌ Failed to setup scheduled jobs, will retry on next restart');
    }
    
    console.log('✅ BullMQ scheduler worker initialized');
    console.log('   Scheduled jobs are now managed by BullMQ');
    console.log('   Workers in queueWorker.js will process the jobs');
    
    // Step 4: Start heartbeat updates
    heartbeatInterval = setInterval(updateHeartbeat, 30000); // Every 30 seconds
    updateHeartbeat(); // Initial heartbeat
    
    // Step 5: Start status logging interval
    statusInterval = setInterval(async () => {
      try {
        // Log scheduled job status periodically
        const repeatableJobs = await scheduledTasksQueue.getRepeatableJobs();
        if (repeatableJobs.length > 0) {
          console.log(`📅 Active scheduled jobs: ${repeatableJobs.length}`);
          for (const job of repeatableJobs) {
            const nextRun = job.next ? new Date(job.next).toISOString() : 'unknown';
            console.log(`   - ${job.name}: next run at ${nextRun}`);
          }
        }
        
        // Update last run timestamp
        if (healthRedis && healthRedis.status === 'ready') {
          await healthRedis.set(SCHEDULER_LAST_RUN_KEY, new Date().toISOString());
        }
      } catch (error) {
        console.warn('⚠️  Error in status interval:', error.message);
      }
    }, 3600000); // Every hour
    
  } catch (error) {
    console.error('❌ Failed to initialize scheduler:', error.message);
    console.error('   Scheduler will exit and PM2 will restart it');
    process.exit(1);
  }
}

// Graceful shutdown function
async function gracefulShutdown(signal) {
  console.log(`🛑 Received ${signal}, stopping scheduler...`);
  
  try {
    // Clear intervals to prevent further execution
    if (statusInterval) {
      clearInterval(statusInterval);
      statusInterval = null;
      console.log('   ✅ Status interval cleared');
    }
    
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
      console.log('   ✅ Heartbeat interval cleared');
    }
    
    // Close health Redis connection
    if (healthRedis && healthRedis.status !== 'end') {
      await healthRedis.quit();
      console.log('   ✅ Health Redis connection closed');
    }
    
    // Close queue connection
    // Note: We don't remove the repeatable jobs on shutdown
    // They will persist and be picked up when the scheduler restarts
    await scheduledTasksQueue.close();
    console.log('✅ Scheduler stopped gracefully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error stopping scheduler:', error);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception in scheduler:', error);
  console.error('   Stack:', error.stack);
  // Don't exit - let PM2 handle restart
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection in scheduler:', reason);
  // Don't exit - let PM2 handle restart
});

// Export health status function for potential IPC or HTTP endpoint
module.exports = { getHealthStatus };

// Start initialization
initialize();
