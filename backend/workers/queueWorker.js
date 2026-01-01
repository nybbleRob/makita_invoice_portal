/**
 * Queue Worker Process
 * Handles file import queue processing using BullMQ
 * Run this as a separate PM2 process
 * 
 * Features:
 * - Stalled job handling configuration
 * - Dead letter queue for permanently failed jobs
 * - Health monitoring with queue stats alerting
 * - Worker heartbeat via Redis
 * - Graceful shutdown with interval cleanup
 */

require('dotenv').config();

const { Worker, Queue } = require('bullmq');
const IORedis = require('ioredis');
const { processFileImport } = require('../jobs/fileImport');
const { processBulkParsingTest } = require('../jobs/bulkParsingTest');
const { processInvoiceImport } = require('../jobs/invoiceImport');
const { processEmailJob } = require('../jobs/emailJob');
const { cleanupOldFiles } = require('../jobs/fileCleanup');
const { processLocalFolderScan } = require('../jobs/localFolderScanner');
const { 
  fileImportQueue, 
  bulkParsingQueue, 
  invoiceImportQueue, 
  emailQueue,
  scheduledTasksQueue,
  EMAIL_RATE_MAX,
  EMAIL_RATE_DURATION_MS
} = require('../config/queue');

console.log('🔧 Initializing BullMQ queue worker...');

// Redis connection configuration
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT) || 6379;
const redisPassword = process.env.REDIS_PASSWORD || undefined;

// Email worker configuration
const EMAIL_WORKER_CONCURRENCY = parseInt(process.env.EMAIL_WORKER_CONCURRENCY) || 1;

// Create shared Redis connection for all workers
let connection = null;
let healthRedis = null;

try {
  connection = new IORedis({
    host: redisHost,
    port: redisPort,
    password: redisPassword,
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
  
  // Separate connection for health checks
  healthRedis = new IORedis({
    host: redisHost,
    port: redisPort,
    password: redisPassword,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true
  });
} catch (err) {
  console.error('❌ Failed to create Redis connection for workers:', err.message);
  process.exit(1);
}

// Health check constants
const WORKER_HEARTBEAT_KEY = 'worker:heartbeat';
const HEARTBEAT_TTL = 60; // seconds
const QUEUE_ALERT_THRESHOLD = 100; // Alert if more than 100 jobs waiting
const FAILED_ALERT_THRESHOLD = 10; // Alert if failed jobs increase by 10

// Store interval references for cleanup
let statsInterval = null;
let heartbeatInterval = null;
let healthMonitorInterval = null;

// Track failed job counts for alerting
let lastFailedCounts = {};

// Store all workers for graceful shutdown
const workers = [];

// Dead letter queue for permanently failed jobs
let deadLetterQueue = null;
try {
  deadLetterQueue = new Queue('dead-letter', {
    connection,
    defaultJobOptions: {
      removeOnComplete: false, // Keep all failed jobs for review
      removeOnFail: false
    }
  });
  console.log('✅ Dead letter queue initialized');
} catch (err) {
  console.warn('⚠️  Could not create dead letter queue:', err.message);
}

/**
 * Move job to dead letter queue when permanently failed
 */
async function moveToDeadLetterQueue(job, error, queueName) {
  if (!deadLetterQueue) return;
  
  try {
    await deadLetterQueue.add(`failed-${queueName}`, {
      originalQueue: queueName,
      originalJobId: job.id,
      originalData: job.data,
      error: error.message,
      stack: error.stack,
      failedAt: new Date().toISOString(),
      attemptsMade: job.attemptsMade
    }, {
      removeOnComplete: false,
      removeOnFail: false
    });
    console.log(`📦 Moved permanently failed job ${job.id} to dead letter queue`);
  } catch (dlqError) {
    console.error('❌ Failed to move job to dead letter queue:', dlqError.message);
  }
}

/**
 * Update worker heartbeat in Redis
 */
async function updateHeartbeat() {
  if (!healthRedis) return;
  
  try {
    const heartbeatData = JSON.stringify({
      timestamp: new Date().toISOString(),
      pid: process.pid,
      uptime: process.uptime(),
      workers: workers.length
    });
    await healthRedis.setex(WORKER_HEARTBEAT_KEY, HEARTBEAT_TTL, heartbeatData);
  } catch (error) {
    // Non-critical, don't log every failure
  }
}

/**
 * Monitor queue health and alert on issues
 */
async function monitorQueueHealth() {
  try {
    const queues = [
      { name: 'file-import', queue: fileImportQueue },
      { name: 'bulk-parsing', queue: bulkParsingQueue },
      { name: 'invoice-import', queue: invoiceImportQueue },
      { name: 'email', queue: emailQueue },
      { name: 'scheduled-tasks', queue: scheduledTasksQueue }
    ];
    
    for (const { name, queue } of queues) {
      if (!queue) continue;
      
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed');
        
        // Alert if too many jobs waiting
        if (counts.waiting > QUEUE_ALERT_THRESHOLD) {
          console.warn(`⚠️  ALERT: ${name} queue has ${counts.waiting} waiting jobs (threshold: ${QUEUE_ALERT_THRESHOLD})`);
        }
        
        // Alert if failed jobs are increasing
        const lastFailed = lastFailedCounts[name] || 0;
        if (counts.failed > lastFailed + FAILED_ALERT_THRESHOLD) {
          console.warn(`⚠️  ALERT: ${name} queue has ${counts.failed - lastFailed} new failed jobs`);
        }
        lastFailedCounts[name] = counts.failed;
      } catch (error) {
        // Queue might not be available
      }
    }
  } catch (error) {
    console.warn('⚠️  Error monitoring queue health:', error.message);
  }
}

/**
 * Get comprehensive worker health status
 */
async function getHealthStatus() {
  const status = {
    healthy: false,
    uptime: process.uptime(),
    pid: process.pid,
    workers: workers.length,
    queues: {},
    redisConnected: false
  };
  
  try {
    // Check Redis connection
    await connection.ping();
    status.redisConnected = true;
    
    // Get queue stats
    const queues = [
      { name: 'file-import', queue: fileImportQueue },
      { name: 'bulk-parsing', queue: bulkParsingQueue },
      { name: 'invoice-import', queue: invoiceImportQueue },
      { name: 'email', queue: emailQueue },
      { name: 'scheduled-tasks', queue: scheduledTasksQueue }
    ];
    
    for (const { name, queue } of queues) {
      if (!queue) continue;
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        status.queues[name] = counts;
      } catch (error) {
        status.queues[name] = { error: error.message };
      }
    }
    
    // Get dead letter queue count
    if (deadLetterQueue) {
      try {
        const dlqCounts = await deadLetterQueue.getJobCounts('waiting');
        status.deadLetterQueue = dlqCounts;
      } catch (error) {
        status.deadLetterQueue = { error: error.message };
      }
    }
    
    status.healthy = true;
  } catch (error) {
    status.error = error.message;
  }
  
  return status;
}

// Common worker options with stalled job handling
const commonWorkerOptions = {
  connection,
  lockDuration: 60000,       // 60 seconds - time a job is locked before considered stalled
  stalledInterval: 30000,    // 30 seconds - how often to check for stalled jobs
  maxStalledCount: 2         // Retry stalled jobs up to 2 times before failing
};

// File import worker
const fileImportWorker = new Worker('file-import', async (job) => {
  console.log(`📥 Processing file import job ${job.id}: ${job.data.fileName || 'Unknown'}`);
  return await processFileImport(job);
}, {
  ...commonWorkerOptions,
  concurrency: 1
});

fileImportWorker.on('completed', (job, result) => {
  console.log(`✅ File import job ${job.id} completed:`, result?.fileName || 'Unknown');
});

fileImportWorker.on('failed', async (job, err) => {
  console.error(`❌ File import job ${job.id} failed:`, err.message);
  if (err.stack) {
    console.error('   Stack:', err.stack);
  }
  
  // Move to dead letter queue if permanently failed
  const maxAttempts = job.opts?.attempts || 3;
  if (job.attemptsMade >= maxAttempts) {
    await moveToDeadLetterQueue(job, err, 'file-import');
  }
});

fileImportWorker.on('error', (error) => {
  console.error('❌ File import worker error:', error.message);
});

fileImportWorker.on('active', (job) => {
  console.log(`🔄 File import job ${job.id} is now active`);
});

fileImportWorker.on('stalled', (jobId) => {
  console.warn(`⚠️  File import job ${jobId} stalled - will be retried`);
});

workers.push(fileImportWorker);
console.log('✅ File import worker initialized');

// Bulk parsing test worker (concurrency 2 for parallel processing)
const bulkParsingWorker = new Worker('bulk-parsing-test', async (job) => {
  console.log(`📥 Processing bulk parsing test job ${job.id}: ${job.data.fileName || 'Unknown'}`);
  return await processBulkParsingTest(job);
}, {
  ...commonWorkerOptions,
  concurrency: 2,
  lockDuration: 120000 // 2 minutes for parsing operations
});

bulkParsingWorker.on('completed', (job, result) => {
  console.log(`✅ Bulk parsing job ${job.id} completed:`, result?.fileName || 'Unknown');
});

bulkParsingWorker.on('failed', async (job, err) => {
  console.error(`❌ Bulk parsing job ${job.id} failed:`, err.message);
  if (err.stack) {
    console.error('   Stack:', err.stack);
  }
  
  const maxAttempts = job.opts?.attempts || 2;
  if (job.attemptsMade >= maxAttempts) {
    await moveToDeadLetterQueue(job, err, 'bulk-parsing');
  }
});

bulkParsingWorker.on('error', (error) => {
  console.error('❌ Bulk parsing worker error:', error.message);
});

bulkParsingWorker.on('stalled', (jobId) => {
  console.warn(`⚠️  Bulk parsing job ${jobId} stalled - will be retried`);
});

workers.push(bulkParsingWorker);
console.log('✅ Bulk parsing worker initialized');

// Invoice import worker (concurrency 2 for parallel processing)
const invoiceImportWorker = new Worker('invoice-import', async (job) => {
  console.log(`📥 Processing invoice import job ${job.id}: ${job.data.fileName || 'Unknown'}`);
  return await processInvoiceImport(job);
}, {
  ...commonWorkerOptions,
  concurrency: 2,
  lockDuration: 120000 // 2 minutes for import operations
});

invoiceImportWorker.on('completed', (job, result) => {
  console.log(`✅ Invoice import job ${job.id} completed:`, result?.fileName || 'Unknown');
});

invoiceImportWorker.on('failed', async (job, err) => {
  console.error(`❌ Invoice import job ${job.id} failed:`, err.message);
  if (err.stack) {
    console.error('   Stack:', err.stack);
  }
  
  const maxAttempts = job.opts?.attempts || 2;
  if (job.attemptsMade >= maxAttempts) {
    await moveToDeadLetterQueue(job, err, 'invoice-import');
  }
});

invoiceImportWorker.on('error', (error) => {
  console.error('❌ Invoice import worker error:', error.message);
});

invoiceImportWorker.on('active', (job) => {
  console.log(`🔄 Invoice import job ${job.id} is now active`);
});

invoiceImportWorker.on('stalled', (jobId) => {
  console.warn(`⚠️  Invoice import job ${jobId} stalled - will be retried`);
});

workers.push(invoiceImportWorker);
console.log('✅ Invoice import worker initialized');

// Email worker with configurable concurrency and rate limiting
const emailWorker = new Worker('email', async (job) => {
  // Clean log: no body content, just job ID and recipient
  return await processEmailJob(job);
}, {
  ...commonWorkerOptions,
  concurrency: EMAIL_WORKER_CONCURRENCY,
  limiter: {
    max: EMAIL_RATE_MAX,
    duration: EMAIL_RATE_DURATION_MS
  }
});

emailWorker.on('completed', (job, result) => {
  // Clean log: only essential info
  if (result?.alreadySent) {
    console.log(`📧 Email job ${job.id} skipped (already sent)`);
  } else {
    console.log(`✅ Email job ${job.id} completed to=${result?.to || 'Unknown'}`);
  }
});

emailWorker.on('failed', async (job, err) => {
  const attemptsMade = job.attemptsMade || 0;
  const maxAttempts = job.opts?.attempts || 10;
  const to = job.data?.to || 'unknown';
  
  // Check if this is a permanent failure (UnrecoverableError)
  const isPermanent = err.message?.includes('Permanent failure') || attemptsMade >= maxAttempts;
  
  if (isPermanent) {
    console.error(`❌ Email job ${job.id} PERMANENT FAILURE to=${to} attempts=${attemptsMade}/${maxAttempts}: ${err.message}`);
    await moveToDeadLetterQueue(job, err, 'email');
  } else {
    // Temporary failure - will retry
    console.warn(`⚠️  Email job ${job.id} DEFERRED to=${to} attempt=${attemptsMade}/${maxAttempts}: ${err.message}`);
  }
});

emailWorker.on('error', (error) => {
  console.error('❌ Email worker error:', error.message);
});

emailWorker.on('active', (job) => {
  const to = job.data?.to || 'Unknown';
  const subject = job.data?.subject || 'No subject';
  console.log(`📧 Email job ${job.id} active: to=${to} subject="${subject.substring(0, 50)}"`);
});

emailWorker.on('stalled', (jobId) => {
  console.warn(`⚠️  Email job ${jobId} stalled - will be retried`);
});

workers.push(emailWorker);
console.log(`✅ Email worker initialized (concurrency=${EMAIL_WORKER_CONCURRENCY}, rate=${EMAIL_RATE_MAX}/${EMAIL_RATE_DURATION_MS}ms)`);

// Scheduled tasks worker (for cron-like jobs)
const scheduledTasksWorker = new Worker('scheduled-tasks', async (job) => {
  console.log(`🔄 Processing scheduled task: ${job.name} (${job.id})`);
  
  switch (job.name) {
    case 'file-cleanup':
      console.log('🧹 Running scheduled file cleanup...');
      const cleanupResult = await cleanupOldFiles();
      console.log(`✅ File cleanup completed: ${cleanupResult.deleted} deleted, ${cleanupResult.errors || 0} errors`);
      return cleanupResult;
    
    case 'local-folder-scan':
      console.log('📂 Running scheduled local folder scan...');
      const scanResult = await processLocalFolderScan(job);
      console.log(`✅ Local folder scan completed: ${scanResult.queued} queued, ${scanResult.skipped} skipped, ${scanResult.errors?.length || 0} errors`);
      return scanResult;
    
    default:
      console.warn(`⚠️  Unknown scheduled task: ${job.name}`);
      return { success: false, message: 'Unknown task' };
  }
}, {
  ...commonWorkerOptions,
  concurrency: 1
});

scheduledTasksWorker.on('completed', (job, result) => {
  console.log(`✅ Scheduled task ${job.name} (${job.id}) completed`);
});

scheduledTasksWorker.on('failed', async (job, err) => {
  console.error(`❌ Scheduled task ${job.name} (${job.id}) failed:`, err.message);
  if (err.stack) {
    console.error('   Stack:', err.stack);
  }
  
  const maxAttempts = job.opts?.attempts || 3;
  if (job.attemptsMade >= maxAttempts) {
    await moveToDeadLetterQueue(job, err, 'scheduled-tasks');
  }
});

scheduledTasksWorker.on('error', (error) => {
  console.error('❌ Scheduled tasks worker error:', error.message);
});

scheduledTasksWorker.on('stalled', (jobId) => {
  console.warn(`⚠️  Scheduled task ${jobId} stalled - will be retried`);
});

workers.push(scheduledTasksWorker);
console.log('✅ Scheduled tasks worker initialized');

// Start intervals for monitoring
heartbeatInterval = setInterval(updateHeartbeat, 30000); // Every 30 seconds
updateHeartbeat(); // Initial heartbeat

healthMonitorInterval = setInterval(monitorQueueHealth, 60000); // Every minute

// Get queue stats periodically
statsInterval = setInterval(async () => {
  try {
    const counts = await fileImportQueue.getJobCounts('waiting', 'active', 'completed', 'failed');
    
    if (counts.waiting > 0 || counts.active > 0) {
      console.log(`📊 Queue Stats: ${counts.waiting} waiting, ${counts.active} active, ${counts.completed} completed, ${counts.failed} failed`);
    }
  } catch (error) {
    // Silently ignore stats errors - queue might not be initialized
  }
}, 60000); // Every minute

console.log('✅ BullMQ queue worker initialized and ready');
console.log('   Waiting for jobs...');

// Graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`🛑 Received ${signal}, closing queue workers...`);
  
  try {
    // Clear intervals first
    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = null;
      console.log('   ✅ Stats interval cleared');
    }
    
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
      console.log('   ✅ Heartbeat interval cleared');
    }
    
    if (healthMonitorInterval) {
      clearInterval(healthMonitorInterval);
      healthMonitorInterval = null;
      console.log('   ✅ Health monitor interval cleared');
    }
    
    // Close all workers
    await Promise.all(workers.map(worker => worker.close()));
    console.log('   ✅ Workers closed');
    
    // Close dead letter queue
    if (deadLetterQueue) {
      await deadLetterQueue.close();
      console.log('   ✅ Dead letter queue closed');
    }
    
    // Close health Redis connection
    if (healthRedis && healthRedis.status !== 'end') {
      await healthRedis.quit();
      console.log('   ✅ Health Redis connection closed');
    }
    
    // Close main Redis connection
    if (connection) {
      await connection.quit();
      console.log('   ✅ Main Redis connection closed');
    }
    
    console.log('✅ Queue workers closed gracefully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error closing queue workers:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception in queue worker:', error);
  console.error('   Stack:', error.stack);
  // Don't exit - let PM2 handle restart
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection in queue worker:', reason);
  // Don't exit - let PM2 handle restart
});

// Export health status function for potential IPC or HTTP endpoint
module.exports = { getHealthStatus };
