/**
 * Script to clear API rate limit for a specific IP
 * Usage: node scripts/clear-api-rate-limit.js <ip_address>
 * Or run without args to clear all rate limits
 */

require('dotenv').config();
const { redis } = require('../config/redis');
const { delPattern } = require('../utils/cache');

async function clearApiRateLimit(ip) {
  try {
    console.log('🔍 Clearing API rate limits...\n');
    
    if (ip) {
      // Clear specific IP
      const keys = [
        `ratelimit:${ip}`,
      ];
      
      let cleared = 0;
      for (const key of keys) {
        const result = await require('../utils/cache').del(key);
        if (result) {
          cleared++;
          console.log(`✅ Cleared: ${key}`);
        }
      }
      
      if (cleared === 0) {
        console.log(`ℹ️  No rate limit found for IP: ${ip}`);
      } else {
        console.log(`\n✅ Cleared ${cleared} rate limit key(s) for IP: ${ip}`);
      }
    } else {
      // Clear all API rate limits (ratelimit:*)
      const deleted = await delPattern('ratelimit:*');
      
      if (deleted > 0) {
        console.log(`✅ Cleared ${deleted} rate limit key(s)`);
        console.log('   All API rate limits have been reset.');
      } else {
        console.log('ℹ️  No rate limit keys found.');
      }
    }
    
    console.log('\n✅ You can now make API requests again.');
    
    await redis.quit();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('Redis')) {
      console.error('   Redis may not be running. Rate limits are stored in Redis.');
      console.error('   If Redis is not available, rate limits use in-memory fallback.');
      console.error('   Try restarting the server to clear in-memory rate limits.');
    }
    process.exit(1);
  }
}

// Get IP from command line (optional)
const ip = process.argv[2];
clearApiRateLimit(ip);

