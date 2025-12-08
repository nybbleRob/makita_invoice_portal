const { redis } = require('../config/redis');

/**
 * Cache utility functions using Redis
 * Provides caching layer for frequently accessed data
 */

/**
 * Get cached value
 * @param {string} key - Cache key
 * @returns {Promise<any|null>} - Cached value or null
 */
const get = async (key) => {
  try {
    const value = await redis.get(key);
    if (value) {
      return JSON.parse(value);
    }
    return null;
  } catch (error) {
    console.error(`Cache GET error for key "${key}":`, error.message);
    return null; // Graceful degradation - return null if Redis fails
  }
};

/**
 * Set cached value
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} ttl - Time to live in seconds (default: 3600 = 1 hour)
 * @returns {Promise<boolean>} - Success status
 */
const set = async (key, value, ttl = 3600) => {
  try {
    const serialized = JSON.stringify(value);
    await redis.setex(key, ttl, serialized);
    return true;
  } catch (error) {
    console.error(`Cache SET error for key "${key}":`, error.message);
    return false; // Graceful degradation - return false if Redis fails
  }
};

/**
 * Delete cached value
 * @param {string} key - Cache key
 * @returns {Promise<boolean>} - Success status
 */
const del = async (key) => {
  try {
    await redis.del(key);
    return true;
  } catch (error) {
    console.error(`Cache DEL error for key "${key}":`, error.message);
    return false;
  }
};

/**
 * Delete multiple cached values by pattern
 * @param {string} pattern - Pattern to match (e.g., 'user:*')
 * @returns {Promise<number>} - Number of keys deleted
 */
const delPattern = async (pattern) => {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      return await redis.del(...keys);
    }
    return 0;
  } catch (error) {
    console.error(`Cache DEL PATTERN error for pattern "${pattern}":`, error.message);
    return 0;
  }
};

/**
 * Check if key exists in cache
 * @param {string} key - Cache key
 * @returns {Promise<boolean>} - Whether key exists
 */
const exists = async (key) => {
  try {
    const result = await redis.exists(key);
    return result === 1;
  } catch (error) {
    console.error(`Cache EXISTS error for key "${key}":`, error.message);
    return false;
  }
};

/**
 * Get or set cached value (cache-aside pattern)
 * @param {string} key - Cache key
 * @param {Function} fetchFn - Function to fetch data if not cached
 * @param {number} ttl - Time to live in seconds
 * @returns {Promise<any>} - Cached or fetched value
 */
const getOrSet = async (key, fetchFn, ttl = 3600) => {
  try {
    // Try to get from cache
    const cached = await get(key);
    if (cached !== null) {
      return cached;
    }

    // Fetch fresh data
    const fresh = await fetchFn();
    
    // Cache it
    await set(key, fresh, ttl);
    
    return fresh;
  } catch (error) {
    console.error(`Cache GETORSET error for key "${key}":`, error.message);
    // If cache fails, still try to fetch fresh data
    return await fetchFn();
  }
};

/**
 * Increment a counter in cache
 * @param {string} key - Cache key
 * @param {number} increment - Increment amount (default: 1)
 * @returns {Promise<number>} - New value
 */
const increment = async (key, increment = 1) => {
  try {
    return await redis.incrby(key, increment);
  } catch (error) {
    console.error(`Cache INCREMENT error for key "${key}":`, error.message);
    return 0;
  }
};

/**
 * Set expiration on a key
 * @param {string} key - Cache key
 * @param {number} ttl - Time to live in seconds
 * @returns {Promise<boolean>} - Success status
 */
const expire = async (key, ttl) => {
  try {
    const result = await redis.expire(key, ttl);
    return result === 1;
  } catch (error) {
    console.error(`Cache EXPIRE error for key "${key}":`, error.message);
    return false;
  }
};

/**
 * Cache key generators (for consistency)
 */
const keys = {
  user: (userId) => `user:${userId}`,
  userSettings: (userId) => `user:${userId}:settings`,
  report: (reportId) => `report:${reportId}`,
  reports: (filters) => `reports:${JSON.stringify(filters)}`,
  settings: () => 'settings:global',
  session: (token) => `session:${token}`,
  rateLimit: (identifier) => `ratelimit:${identifier}`,
};

module.exports = {
  get,
  set,
  del,
  delPattern,
  exists,
  getOrSet,
  increment,
  expire,
  keys
};

