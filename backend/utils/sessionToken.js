const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { redis } = require('../config/redis');

// Use Redis for session tokens (supports distributed systems)
// Falls back to in-memory Map if Redis is unavailable
const useRedis = process.env.REDIS_HOST || process.env.REDIS_URL;
const sessionTokens = new Map(); // Fallback for when Redis is unavailable

/**
 * Generate a temporary session token for 2FA setup
 * This allows us to avoid passing passwords around
 */
const generateSessionToken = async (userId, email) => {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
  const sessionData = {
    userId,
    email,
    expiresAt,
    createdAt: Date.now()
  };
  
  if (useRedis) {
    try {
      // Store in Redis with expiration
      const ttl = Math.ceil((expiresAt - Date.now()) / 1000); // Convert to seconds
      await redis.setex(`session:${token}`, ttl, JSON.stringify(sessionData));
      return token;
    } catch (error) {
      console.error('Redis error in generateSessionToken, falling back to memory:', error.message);
      // Fall through to in-memory storage
    }
  }
  
  // Fallback to in-memory storage
  sessionTokens.set(token, sessionData);
  cleanupExpiredTokens();
  
  return token;
};

/**
 * Verify a session token (without consuming it)
 * Returns user data if valid, null if invalid/expired
 */
const verifySessionToken = async (token, consume = false) => {
  let session = null;
  
  if (useRedis) {
    try {
      const sessionData = await redis.get(`session:${token}`);
      if (sessionData) {
        session = JSON.parse(sessionData);
        
        // Check expiration
        if (Date.now() > session.expiresAt) {
          await redis.del(`session:${token}`);
          return null;
        }
        
        // Consume token if requested
        if (consume) {
          await redis.del(`session:${token}`);
        }
        
        return {
          userId: session.userId,
          email: session.email
        };
      }
      return null;
    } catch (error) {
      console.error('Redis error in verifySessionToken, falling back to memory:', error.message);
      // Fall through to in-memory check
    }
  }
  
  // Fallback to in-memory storage
  session = sessionTokens.get(token);
  
  if (!session) {
    return null;
  }
  
  if (Date.now() > session.expiresAt) {
    sessionTokens.delete(token);
    return null;
  }
  
  // Only consume token if requested (for one-time use scenarios)
  if (consume) {
    sessionTokens.delete(token);
  }
  
  return {
    userId: session.userId,
    email: session.email
  };
};

/**
 * Clean up expired tokens
 */
const cleanupExpiredTokens = () => {
  const now = Date.now();
  for (const [token, session] of sessionTokens.entries()) {
    if (now > session.expiresAt) {
      sessionTokens.delete(token);
    }
  }
};

// Clean up expired tokens every 5 minutes
setInterval(cleanupExpiredTokens, 5 * 60 * 1000);

module.exports = {
  generateSessionToken,
  verifySessionToken
};

