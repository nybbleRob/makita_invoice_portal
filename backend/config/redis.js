const Redis = require('ioredis');
require('dotenv').config();

// Check if Redis is configured
const isRedisConfigured = !!(process.env.REDIS_HOST || process.env.REDIS_URL);

// Create Redis client (only if configured)
let redis = null;
if (isRedisConfigured) {
  redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: process.env.REDIS_DB || 0,
    retryStrategy: (times) => {
      // Stop retrying after 20 attempts (about 1 minute)
      if (times > 20) {
        console.log('⚠️ Redis: Stopping reconnection attempts after 20 tries');
        console.log('⚠️ Redis: App will continue without Redis (graceful degradation)');
        return null; // Stop retrying
      }
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: null, // Unlimited retries for better resilience
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
} else {
  console.log('ℹ️  Redis: Not configured (optional - using in-memory fallback)');
}

// Connection state tracking
let connectionState = 'disconnected';
let reconnectAttempts = 0;
let lastErrorTime = 0;
const ERROR_THROTTLE_MS = 5000; // Only log errors every 5 seconds

// Event handlers (only if Redis is configured)
if (redis) {
  redis.on('connect', () => {
    connectionState = 'connecting';
    reconnectAttempts = 0;
    console.log('🔄 Redis: Connecting...');
  });

  redis.on('ready', () => {
    connectionState = 'ready';
    reconnectAttempts = 0;
    console.log('✅ Redis: Connected Successfully');
  });

  redis.on('error', (err) => {
    connectionState = 'error';
    const now = Date.now();
    
    // Throttle error logging to reduce noise
    if (now - lastErrorTime > ERROR_THROTTLE_MS) {
      const errorMsg = err?.message || err?.toString() || 'Unknown error';
      const errorCode = err?.code || 'NO_CODE';
      console.error(`❌ Redis Error [${errorCode}]:`, errorMsg);
      
      // Provide helpful context for common errors
      if (errorCode === 'ECONNREFUSED') {
        console.error('   💡 Redis server is not running or not accessible');
        console.error('   💡 Start Redis: redis-server (or check your REDIS_HOST/REDIS_PORT)');
        console.error('   💡 Or remove REDIS_HOST from .env to disable Redis');
      } else if (errorCode === 'ENOTFOUND') {
        console.error('   💡 Redis host not found. Check REDIS_HOST in .env');
      } else if (errorCode === 'ETIMEDOUT') {
        console.error('   💡 Redis connection timeout. Check network/firewall');
      }
      
      lastErrorTime = now;
    }
    // Don't exit - app can work without Redis (graceful degradation)
  });

  redis.on('close', () => {
    const wasReady = connectionState === 'ready';
    connectionState = 'closed';
    // Only log if we were previously connected (not during initial connection failures)
    if (wasReady) {
      console.log('⚠️ Redis: Connection Closed');
    }
  });

  redis.on('reconnecting', (delay) => {
    reconnectAttempts++;
    connectionState = 'reconnecting';
    
    // Only log every 10th reconnection attempt to reduce noise
    if (reconnectAttempts % 10 === 0) {
      console.log(`🔄 Redis: Reconnecting... (attempt ${reconnectAttempts}, delay: ${delay}ms)`);
    }
  });
}

// Test connection
const testConnection = async () => {
  if (!redis) {
    return false;
  }
  try {
    await redis.ping();
    console.log('✅ Redis: Connection Test Successful');
    return true;
  } catch (error) {
    const errorMsg = error?.message || error?.toString() || 'Unknown error';
    console.error('❌ Redis: Connection Test Failed:', errorMsg);
    return false;
  }
};

// Graceful shutdown
const closeConnection = async () => {
  if (!redis) {
    return;
  }
  try {
    await redis.quit();
    console.log('✅ Redis: Connection Closed Gracefully');
  } catch (error) {
    const errorMsg = error?.message || error?.toString() || 'Unknown error';
    console.error('❌ Redis: Error Closing Connection:', errorMsg);
  }
};

module.exports = {
  redis,
  testConnection,
  closeConnection
};

