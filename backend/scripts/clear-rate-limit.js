/**
 * Script to clear rate limit for a specific email or IP
 * Usage: node scripts/clear-rate-limit.js <email_or_ip>
 * Example: node scripts/clear-rate-limit.js user@example.com
 */

require('dotenv').config();
const { redis } = require('../config/redis');
const { del } = require('../utils/cache');

async function clearRateLimit(identifier) {
  try {
    if (!identifier) {
      console.error('❌ Please provide an email or IP address');
      console.log('\nUsage: node scripts/clear-rate-limit.js <email_or_ip>');
      console.log('Example: node scripts/clear-rate-limit.js user@example.com');
      process.exit(1);
    }

    // Try to clear rate limit for both email and IP
    const keys = [
      `ratelimit:${identifier}`,
      `ratelimit:${identifier.toLowerCase()}`,
    ];

    console.log(`🔍 Clearing rate limit for: ${identifier}`);
    
    let cleared = 0;
    for (const key of keys) {
      const result = await del(key);
      if (result) {
        cleared++;
        console.log(`✅ Cleared: ${key}`);
      }
    }

    if (cleared === 0) {
      console.log(`ℹ️  No rate limit found for: ${identifier}`);
      console.log('   (Rate limit may have already expired or never existed)');
    } else {
      console.log(`\n✅ Cleared ${cleared} rate limit key(s)`);
      console.log('   You can now try logging in again.');
    }

    await redis.quit();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('Redis')) {
      console.error('   Redis may not be running. Rate limits are stored in Redis.');
      console.error('   If Redis is not available, rate limits use in-memory fallback.');
    }
    process.exit(1);
  }
}

// Get identifier from command line
const identifier = process.argv[2];
clearRateLimit(identifier);

