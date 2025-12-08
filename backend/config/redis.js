const Redis = require('ioredis');
require('dotenv').config();

// Create Redis client
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: process.env.REDIS_DB || 0,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  enableOfflineQueue: true, // Changed to true - allows queuing when disconnected
  lazyConnect: false, // Connect immediately
  // For Redis Cloud/Atlas
  ...(process.env.REDIS_URL && { 
    host: undefined,
    port: undefined,
    path: undefined,
    url: process.env.REDIS_URL 
  })
});

// Event handlers
redis.on('connect', () => {
  console.log('🔄 Redis: Connecting...');
});

redis.on('ready', () => {
  console.log('✅ Redis: Connected Successfully');
});

redis.on('error', (err) => {
  console.error('❌ Redis Error:', err.message);
  // Don't exit - app can work without Redis (graceful degradation)
});

redis.on('close', () => {
  console.log('⚠️ Redis: Connection Closed');
});

redis.on('reconnecting', () => {
  console.log('🔄 Redis: Reconnecting...');
});

// Test connection
const testConnection = async () => {
  try {
    await redis.ping();
    console.log('✅ Redis: Connection Test Successful');
    return true;
  } catch (error) {
    console.error('❌ Redis: Connection Test Failed:', error.message);
    return false;
  }
};

// Graceful shutdown
const closeConnection = async () => {
  try {
    await redis.quit();
    console.log('✅ Redis: Connection Closed Gracefully');
  } catch (error) {
    console.error('❌ Redis: Error Closing Connection:', error.message);
  }
};

module.exports = {
  redis,
  testConnection,
  closeConnection
};

