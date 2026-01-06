#!/usr/bin/env node

/**
 * Queue Status Diagnostic Script
 * Checks the status of invoice-import queue to see why jobs aren't processing
 * 
 * Usage:
 *   node backend/scripts/check-queue-status.js
 */

// Load environment variables first
const path = require('path');
const fs = require('fs');
const rootEnv = path.join(__dirname, '..', '..', '.env');
const backendEnv = path.join(__dirname, '..', '.env');

if (fs.existsSync(rootEnv)) {
  require('dotenv').config({ path: rootEnv });
} else if (fs.existsSync(backendEnv)) {
  require('dotenv').config({ path: backendEnv });
} else {
  require('dotenv').config();
}

const { invoiceImportQueue } = require('../config/queue');

async function checkQueueStatus() {
  try {
    console.log('🔍 Checking invoice-import queue status...\n');
    
    // Get job counts
    const counts = await invoiceImportQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    
    console.log('📊 Queue Statistics:');
    console.log(`   Waiting: ${counts.waiting || 0}`);
    console.log(`   Active: ${counts.active || 0}`);
    console.log(`   Completed: ${counts.completed || 0}`);
    console.log(`   Failed: ${counts.failed || 0}`);
    console.log(`   Delayed: ${counts.delayed || 0}`);
    console.log('');
    
    // Get sample waiting jobs
    if (counts.waiting > 0) {
      console.log('⏳ Waiting Jobs (first 10):');
      const waitingJobs = await invoiceImportQueue.getJobs(['waiting', 'wait'], 0, 10);
      for (const job of waitingJobs) {
        const fileName = job.data?.fileName || 'Unknown';
        const queuedAt = job.timestamp ? new Date(job.timestamp).toISOString() : 'Unknown';
        console.log(`   - ${fileName} (queued: ${queuedAt})`);
      }
      console.log('');
    }
    
    // Get active jobs
    if (counts.active > 0) {
      console.log('🔄 Active Jobs:');
      const activeJobs = await invoiceImportQueue.getJobs(['active'], 0, 10);
      for (const job of activeJobs) {
        const fileName = job.data?.fileName || 'Unknown';
        const startedAt = job.processedOn ? new Date(job.processedOn).toISOString() : 'Unknown';
        console.log(`   - ${fileName} (started: ${startedAt})`);
      }
      console.log('');
    }
    
    // Get recent failed jobs
    if (counts.failed > 0) {
      console.log('❌ Recent Failed Jobs (first 5):');
      const failedJobs = await invoiceImportQueue.getJobs(['failed'], 0, 5);
      for (const job of failedJobs) {
        const fileName = job.data?.fileName || 'Unknown';
        const error = job.failedReason || 'Unknown error';
        const failedAt = job.finishedOn ? new Date(job.finishedOn).toISOString() : 'Unknown';
        console.log(`   - ${fileName}`);
        console.log(`     Error: ${error}`);
        console.log(`     Failed at: ${failedAt}`);
        console.log('');
      }
    }
    
    // Check if worker is running (check Redis for worker heartbeat)
    const IORedis = require('ioredis');
    const redisHost = process.env.REDIS_HOST || 'localhost';
    const redisPort = parseInt(process.env.REDIS_PORT) || 6379;
    const redisPassword = process.env.REDIS_PASSWORD || undefined;
    
    const redis = new IORedis({
      host: redisHost,
      port: redisPort,
      password: redisPassword,
      maxRetriesPerRequest: 3
    });
    
    try {
      const heartbeat = await redis.get('worker:heartbeat');
      if (heartbeat) {
        const heartbeatTime = new Date(parseInt(heartbeat));
        const age = Date.now() - heartbeatTime.getTime();
        console.log(`✅ Queue worker is running (last heartbeat: ${Math.round(age/1000)}s ago)`);
      } else {
        console.log('⚠️  Queue worker heartbeat not found - worker may not be running!');
        console.log('   Check PM2: pm2 list');
        console.log('   Restart worker: pm2 restart invoice-portal-queue-worker');
      }
    } catch (redisError) {
      console.log(`⚠️  Could not check worker heartbeat: ${redisError.message}`);
    }
    
    await redis.quit();
    
    // Recommendations
    console.log('\n💡 Recommendations:');
    if (counts.waiting > 0 && counts.active === 0) {
      console.log('   ⚠️  Jobs are waiting but none are active - worker may be stuck or not processing');
      console.log('   → Check queue worker logs: pm2 logs invoice-portal-queue-worker');
      console.log('   → Restart worker: pm2 restart invoice-portal-queue-worker');
    } else if (counts.waiting > 100) {
      console.log('   ⚠️  Large number of waiting jobs - processing may be slow');
      console.log('   → Consider increasing worker concurrency (currently 2)');
    } else if (counts.failed > 0) {
      console.log('   ⚠️  Some jobs have failed - check errors above');
      console.log('   → Review failed jobs and fix underlying issues');
    } else if (counts.waiting === 0 && counts.active === 0) {
      console.log('   ✅ Queue is empty - all jobs processed or no jobs queued');
    }
    
  } catch (error) {
    console.error('❌ Error checking queue status:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

checkQueueStatus().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
