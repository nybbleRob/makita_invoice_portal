/**
 * Settings Cache Utility
 * Caches settings in Redis for improved performance
 * Falls back to direct database access if Redis is unavailable
 */

const { redis } = require('../config/redis');

const SETTINGS_CACHE_KEY = 'cache:settings';
const TEMPLATES_CACHE_KEY = 'cache:templates';
const CACHE_TTL = 60; // 60 seconds

/**
 * Get cached settings or fetch from database
 * @param {Function} getSettingsFromDb - Function to get settings from database
 * @returns {Promise<Object>} Settings object
 */
async function getCachedSettings(getSettingsFromDb) {
  // Try to get from cache first
  if (redis) {
    try {
      const cached = await redis.get(SETTINGS_CACHE_KEY);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      // Redis error, fall through to database
      console.warn('⚠️  Settings cache read error:', error.message);
    }
  }
  
  // Fetch from database
  const settings = await getSettingsFromDb();
  
  // Cache the result
  if (redis && settings) {
    try {
      // Convert Sequelize instance to plain object for caching
      const settingsData = settings.toJSON ? settings.toJSON() : settings;
      await redis.setex(SETTINGS_CACHE_KEY, CACHE_TTL, JSON.stringify(settingsData));
    } catch (error) {
      // Non-critical, just log
      console.warn('⚠️  Settings cache write error:', error.message);
    }
  }
  
  return settings;
}

/**
 * Invalidate settings cache (call this when settings are updated)
 */
async function invalidateSettingsCache() {
  if (redis) {
    try {
      await redis.del(SETTINGS_CACHE_KEY);
    } catch (error) {
      console.warn('⚠️  Settings cache invalidation error:', error.message);
    }
  }
}

/**
 * Get cached templates or fetch from database
 * @param {Function} getTemplatesFromDb - Function to get templates from database
 * @param {string} cacheKeySuffix - Optional suffix for cache key (e.g., 'enabled', 'company-123')
 * @returns {Promise<Array>} Templates array
 */
async function getCachedTemplates(getTemplatesFromDb, cacheKeySuffix = 'all') {
  const cacheKey = `${TEMPLATES_CACHE_KEY}:${cacheKeySuffix}`;
  
  // Try to get from cache first
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      // Redis error, fall through to database
      console.warn('⚠️  Templates cache read error:', error.message);
    }
  }
  
  // Fetch from database
  const templates = await getTemplatesFromDb();
  
  // Cache the result
  if (redis && templates) {
    try {
      // Convert Sequelize instances to plain objects for caching
      const templatesData = Array.isArray(templates) 
        ? templates.map(t => t.toJSON ? t.toJSON() : t)
        : templates;
      await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(templatesData));
    } catch (error) {
      // Non-critical, just log
      console.warn('⚠️  Templates cache write error:', error.message);
    }
  }
  
  return templates;
}

/**
 * Invalidate templates cache (call this when templates are updated)
 * @param {string} cacheKeySuffix - Optional suffix to invalidate specific cache
 */
async function invalidateTemplatesCache(cacheKeySuffix = null) {
  if (redis) {
    try {
      if (cacheKeySuffix) {
        await redis.del(`${TEMPLATES_CACHE_KEY}:${cacheKeySuffix}`);
      } else {
        // Invalidate all template caches
        const keys = await redis.keys(`${TEMPLATES_CACHE_KEY}:*`);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      }
    } catch (error) {
      console.warn('⚠️  Templates cache invalidation error:', error.message);
    }
  }
}

module.exports = {
  getCachedSettings,
  invalidateSettingsCache,
  getCachedTemplates,
  invalidateTemplatesCache,
  CACHE_TTL
};

