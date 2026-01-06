const { Queue } = require('bullmq');
const IORedis = require('ioredis');

/**
 * BullMQ queue configuration for file import jobs
 * Note: Queue will not work without Redis, but app will continue to function
 */

// Redis connection configuration
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT) || 6379;
const redisPassword = process.env.REDIS_PASSWORD || undefined;

// Email rate limiting configuration
// Default: 10 emails per 10 seconds (matches Mailtrap's rate limit)
// Can be overridden via environment variables for different providers
const EMAIL_RATE_MAX = parseInt(process.env.EMAIL_RATE_MAX) || 10;
const EMAIL_RATE_DURATION_MS = parseInt(process.env.EMAIL_RATE_DURATION_MS) || 10000;

// Provider-specific worker concurrency
const EMAIL_WORKER_CONCURRENCY_OFFICE365 = parseInt(process.env.EMAIL_WORKER_CONCURRENCY_OFFICE365) || 10;
const EMAIL_WORKER_CONCURRENCY_SMTP2GO = parseInt(process.env.EMAIL_WORKER_CONCURRENCY_SMTP2GO) || 20;
const EMAIL_WORKER_CONCURRENCY_SMTP = parseInt(process.env.EMAIL_WORKER_CONCURRENCY_SMTP) || 10;
const EMAIL_WORKER_CONCURRENCY_RESEND = parseInt(process.env.EMAIL_WORKER_CONCURRENCY_RESEND) || 10;
const EMAIL_WORKER_CONCURRENCY_DEFAULT = parseInt(process.env.EMAIL_WORKER_CONCURRENCY) || 1;

// Provider-specific rate limiters
// Office 365: 30 messages/min = 2 per 4 seconds (conservative)
const EMAIL_RATE_MAX_OFFICE365 = parseInt(process.env.EMAIL_RATE_MAX_OFFICE365) || 2;
const EMAIL_RATE_DURATION_MS_OFFICE365 = parseInt(process.env.EMAIL_RATE_DURATION_MS_OFFICE365) || 4000;

// SMTP2Go: Higher limits (40 concurrent connections)
const EMAIL_RATE_MAX_SMTP2GO = parseInt(process.env.EMAIL_RATE_MAX_SMTP2GO) || 40;
const EMAIL_RATE_DURATION_MS_SMTP2GO = parseInt(process.env.EMAIL_RATE_DURATION_MS_SMTP2GO) || 1000;

// Generic SMTP: Configurable
// Using Office 365 pattern: 3 per 4 seconds = 45 per minute (conservative to avoid bounceback errors)
// More conservative than Office 365's 2 per 4 seconds (30/min) but safer than 5 per 4 seconds
const EMAIL_RATE_MAX_SMTP = parseInt(process.env.EMAIL_RATE_MAX_SMTP) || 3;
const EMAIL_RATE_DURATION_MS_SMTP = parseInt(process.env.EMAIL_RATE_DURATION_MS_SMTP) || 4000;

// Resend: API-based, moderate limits
const EMAIL_RATE_MAX_RESEND = parseInt(process.env.EMAIL_RATE_MAX_RESEND) || 10;
const EMAIL_RATE_DURATION_MS_RESEND = parseInt(process.env.EMAIL_RATE_DURATION_MS_RESEND) || 1000;

// Create shared Redis connection for all queues
let connection = null;
let redisAvailable = false;

try {
  connection = new IORedis({
    host: redisHost,
    port: redisPort,
    password: redisPassword,
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
  
  // Check if Redis is available
  connection.on('connect', () => {
    redisAvailable = true;
    console.log('✅ BullMQ Redis connection established');
  });
  
  connection.on('error', (err) => {
    if (redisAvailable) {
      console.error('❌ BullMQ Redis connection error:', err.message);
    }
    redisAvailable = false;
  });
} catch (err) {
  console.log('ℹ️  BullMQ: Redis not configured, queues disabled');
  connection = null;
}

// Default job options for different queue types
const defaultFileImportOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000
  },
  removeOnComplete: {
    age: 24 * 3600, // Keep completed jobs for 24 hours
    count: 1000 // Keep max 1000 completed jobs
  },
  removeOnFail: {
    age: 7 * 24 * 3600 // Keep failed jobs for 7 days
  }
};

const defaultBulkParsingOptions = {
  attempts: 2,
  backoff: {
    type: 'exponential',
    delay: 1000
  },
  removeOnComplete: {
    age: 3600, // Keep completed jobs for 1 hour (temp testing)
    count: 100 // Keep max 100 completed jobs
  },
  removeOnFail: {
    age: 3600 // Keep failed jobs for 1 hour
  }
};

const defaultInvoiceImportOptions = {
  attempts: 2,
  backoff: {
    type: 'exponential',
    delay: 2000
  },
  removeOnComplete: {
    age: 24 * 3600, // Keep completed jobs for 24 hours
    count: 500 // Keep max 500 completed jobs
  },
  removeOnFail: {
    age: 7 * 24 * 3600 // Keep failed jobs for 7 days
  }
};

const defaultEmailOptions = {
  attempts: 10, // 10 attempts with exponential backoff for reliable delivery
  backoff: {
    type: 'exponential',
    delay: 60000 // Start with 1 minute delay, then 2m, 4m, 8m, 16m, 32m, capped at ~60m
  },
  removeOnComplete: {
    age: 7 * 24 * 3600, // Keep completed jobs for 7 days
    count: 5000 // Keep max 5000 completed jobs
  },
  removeOnFail: {
    age: 30 * 24 * 3600 // Keep failed jobs for 30 days (for debugging)
  }
};

const defaultScheduledTaskOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000
  },
  removeOnComplete: {
    age: 7 * 24 * 3600, // Keep completed jobs for 7 days
    count: 100 // Keep max 100 completed jobs
  },
  removeOnFail: {
    age: 30 * 24 * 3600 // Keep failed jobs for 30 days
  }
};

// Create dummy queue object for when Redis is not available
function createDummyQueue() {
  return {
    add: () => Promise.resolve({ id: 'no-redis', name: 'no-redis' }),
    addBulk: () => Promise.resolve([]),
    close: () => Promise.resolve(),
    getJobs: () => Promise.resolve([]),
    getJob: () => Promise.resolve(null),
    getJobCounts: () => Promise.resolve({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }),
    getWaitingCount: () => Promise.resolve(0),
    getActiveCount: () => Promise.resolve(0),
    getCompletedCount: () => Promise.resolve(0),
    getFailedCount: () => Promise.resolve(0),
    getDelayedCount: () => Promise.resolve(0),
    getWaiting: () => Promise.resolve([]),
    getActive: () => Promise.resolve([]),
    getCompleted: () => Promise.resolve([]),
    getFailed: () => Promise.resolve([]),
    obliterate: () => Promise.resolve(),
    drain: () => Promise.resolve(),
    clean: () => Promise.resolve([]),
    remove: () => Promise.resolve()
  };
}

// File import queue
let fileImportQueue = null;
if (connection) {
  fileImportQueue = new Queue('file-import', {
    connection,
    defaultJobOptions: defaultFileImportOptions
  });
  console.log('✅ File import queue initialized');
} else {
  console.log('ℹ️  File import queue: Not initialized (Redis not configured)');
  fileImportQueue = createDummyQueue();
}

// Bulk parsing test queue
let bulkParsingQueue = null;
if (connection) {
  bulkParsingQueue = new Queue('bulk-parsing-test', {
    connection,
    defaultJobOptions: defaultBulkParsingOptions
  });
  console.log('✅ Bulk parsing queue initialized');
} else {
  console.log('ℹ️  Bulk parsing queue: Not initialized (Redis not configured)');
  bulkParsingQueue = createDummyQueue();
}

// Invoice import queue
let invoiceImportQueue = null;
if (connection) {
  invoiceImportQueue = new Queue('invoice-import', {
    connection,
    defaultJobOptions: defaultInvoiceImportOptions
  });
  console.log('✅ Invoice import queue initialized');
} else {
  console.log('ℹ️  Invoice import queue: Not initialized (Redis not configured)');
  invoiceImportQueue = createDummyQueue();
}

// Email queue with rate limiting
let emailQueue = null;
if (connection) {
  emailQueue = new Queue('email', {
    connection,
    defaultJobOptions: defaultEmailOptions
  });
  console.log(`✅ Email queue initialized (rate limit: ${EMAIL_RATE_MAX} per ${EMAIL_RATE_DURATION_MS}ms)`);
} else {
  console.log('ℹ️  Email queue: Not initialized (Redis not configured)');
  emailQueue = createDummyQueue();
}

// Scheduled tasks queue (for cron-like jobs)
let scheduledTasksQueue = null;
if (connection) {
  scheduledTasksQueue = new Queue('scheduled-tasks', {
    connection,
    defaultJobOptions: defaultScheduledTaskOptions
  });
  console.log('✅ Scheduled tasks queue initialized');
} else {
  console.log('ℹ️  Scheduled tasks queue: Not initialized (Redis not configured)');
  scheduledTasksQueue = createDummyQueue();
}

// Nested set update queue (for background hierarchy reindexing)
const defaultNestedSetOptions = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: 100
};

let nestedSetQueue = null;
if (connection) {
  nestedSetQueue = new Queue('nested-set', {
    connection,
    defaultJobOptions: defaultNestedSetOptions
  });
  console.log('✅ Nested set queue initialized');
} else {
  console.log('ℹ️  Nested set queue: Not initialized (Redis not configured)');
  nestedSetQueue = createDummyQueue();
}

// Graceful shutdown - close all queues
async function closeAllQueues() {
  console.log('🔄 Closing all queues...');
  const closePromises = [];
  
  if (fileImportQueue && fileImportQueue.close) {
    closePromises.push(fileImportQueue.close().catch(err => console.error('Error closing fileImportQueue:', err.message)));
  }
  if (bulkParsingQueue && bulkParsingQueue.close) {
    closePromises.push(bulkParsingQueue.close().catch(err => console.error('Error closing bulkParsingQueue:', err.message)));
  }
  if (invoiceImportQueue && invoiceImportQueue.close) {
    closePromises.push(invoiceImportQueue.close().catch(err => console.error('Error closing invoiceImportQueue:', err.message)));
  }
  if (emailQueue && emailQueue.close) {
    closePromises.push(emailQueue.close().catch(err => console.error('Error closing emailQueue:', err.message)));
  }
  if (scheduledTasksQueue && scheduledTasksQueue.close) {
    closePromises.push(scheduledTasksQueue.close().catch(err => console.error('Error closing scheduledTasksQueue:', err.message)));
  }
  if (nestedSetQueue && nestedSetQueue.close) {
    closePromises.push(nestedSetQueue.close().catch(err => console.error('Error closing nestedSetQueue:', err.message)));
  }
  if (connection && connection.quit) {
    closePromises.push(connection.quit().catch(err => console.error('Error closing Redis connection:', err.message)));
  }
  
  await Promise.all(closePromises);
  console.log('✅ All queues closed');
}

process.on('SIGTERM', async () => {
  await closeAllQueues();
});

process.on('SIGINT', async () => {
  await closeAllQueues();
});

module.exports = {
  fileImportQueue,
  bulkParsingQueue,
  invoiceImportQueue,
  emailQueue,
  scheduledTasksQueue,
  nestedSetQueue,
  connection,
  closeAllQueues,
  // Export default options for workers to use
  defaultFileImportOptions,
  defaultBulkParsingOptions,
  defaultInvoiceImportOptions,
  defaultEmailOptions,
  defaultScheduledTaskOptions,
  defaultNestedSetOptions,
  // Export email rate limiting config for worker
  EMAIL_RATE_MAX,
  EMAIL_RATE_DURATION_MS,
  // Export provider-specific concurrency
  EMAIL_WORKER_CONCURRENCY_OFFICE365,
  EMAIL_WORKER_CONCURRENCY_SMTP2GO,
  EMAIL_WORKER_CONCURRENCY_SMTP,
  EMAIL_WORKER_CONCURRENCY_RESEND,
  EMAIL_WORKER_CONCURRENCY_DEFAULT,
  // Export provider-specific rate limiters
  EMAIL_RATE_MAX_OFFICE365,
  EMAIL_RATE_DURATION_MS_OFFICE365,
  EMAIL_RATE_MAX_SMTP2GO,
  EMAIL_RATE_DURATION_MS_SMTP2GO,
  EMAIL_RATE_MAX_SMTP,
  EMAIL_RATE_DURATION_MS_SMTP,
  EMAIL_RATE_MAX_RESEND,
  EMAIL_RATE_DURATION_MS_RESEND
};
