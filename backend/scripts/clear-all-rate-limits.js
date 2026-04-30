/**
 * Script to clear ALL rate limits
 * Use with caution - this clears all rate limit keys
 */

require('dotenv').config();
const { redis } = require('../config/redis');
const { delPattern } = require('../utils/cache');

async function clearAllRateLimits() {
  try {
    console.log('🔍 Finding all rate limit keys...');
    
    // Clear all rate limit keys
    const deleted = await delPattern('ratelimit:*');
    
    if (deleted > 0) {
      console.log(`✅ Cleared ${deleted} rate limit key(s)`);
      console.log('   All rate limits have been reset.');
    } else {
      console.log('ℹ️  No rate limit keys found.');
    }

    await redis.quit();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('Redis')) {
      console.error('   Redis may not be running. Rate limits are stored in Redis.');
    }
    process.exit(1);
  }
}

clearAllRateLimits();

