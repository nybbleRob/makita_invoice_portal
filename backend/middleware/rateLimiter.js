const { redis } = require('../config/redis');
const { increment, expire } = require('../utils/cache');

/**
 * Rate limiting middleware using Redis
 * Prevents abuse by limiting requests per IP/user
 */

/**
 * Create rate limiter middleware
 * @param {Object} options - Rate limit options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.max - Maximum requests per window
 * @param {string} options.message - Error message
 * @param {Function} options.keyGenerator - Function to generate key (default: uses IP)
 * @returns {Function} Express middleware
 */
const createRateLimiter = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes default
    max = 100, // 100 requests default
    message = 'Too many requests, please try again later.',
    keyGenerator = (req) => {
      // Default: use IP address
      return req.ip || req.connection.remoteAddress || 'unknown';
    },
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
  } = options;

  return async (req, res, next) => {
    try {
      // Skip rate limiting if skip function returns true
      if (options.skip && options.skip(req)) {
        return next();
      }
      
      const key = `ratelimit:${keyGenerator(req)}`;
      const windowSeconds = Math.ceil(windowMs / 1000);

      // Increment counter
      const count = await increment(key, 1);

      // Set expiration on first request
      if (count === 1) {
        await expire(key, windowSeconds);
      }

      // Set rate limit headers
      const remaining = Math.max(0, max - count);
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + windowMs).toISOString());

      // Check if limit exceeded
      if (count > max) {
        return res.status(429).json({
          message,
          retryAfter: windowSeconds,
        });
      }

      // Store count in request for logging
      req.rateLimitCount = count;
      req.rateLimitRemaining = remaining;

      next();
    } catch (error) {
      // If Redis fails, allow request (graceful degradation)
      console.error('Rate limiter error:', error.message);
      next();
    }
  };
};

/**
 * Pre-configured rate limiters for common use cases
 */
const rateLimiters = {
  // General API rate limiter
  api: createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per 15 minutes (increased for development)
    message: 'Too many API requests, please try again later.',
  }),

  // Strict rate limiter for auth endpoints (login, register, password reset)
  auth: createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // 50 login attempts per 15 minutes (increased for testing)
    message: 'Too many login attempts, please try again later.',
    keyGenerator: (req) => {
      // Use email if available, otherwise IP
      return req.body?.email || req.ip || 'unknown';
    },
    // Skip rate limiting for read-only operations and password change
    skip: (req) => {
      return req.path === '/me' || 
             req.originalUrl === '/api/auth/me' ||
             req.path === '/validate-reset-token' ||
             req.originalUrl === '/api/auth/validate-reset-token' ||
             req.path === '/validate-email-change' ||
             req.originalUrl === '/api/auth/validate-email-change' ||
             req.path === '/change-password' ||
             req.originalUrl === '/api/auth/change-password';
    },
  }),
  
  // Lenient rate limiter for /me endpoint (read-only user info)
  authMe: createRateLimiter({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute (very lenient for frequent polling)
    message: 'Too many requests, please try again later.',
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise IP
      return req.user?.userId || req.ip || 'unknown';
    },
  }),

  // Rate limiter for password reset
  passwordReset: createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 password reset requests per hour
    message: 'Too many password reset requests, please try again later.',
    keyGenerator: (req) => {
      return req.body?.email || req.ip || 'unknown';
    },
  }),

  // Rate limiter for registration
  registration: createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 registration attempts per hour
    message: 'Too many registration attempts, please try again later.',
    keyGenerator: (req) => {
      return req.body?.email || req.ip || 'unknown';
    },
  }),

  // Rate limiter for 2FA
  twoFactor: createRateLimiter({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // 10 2FA attempts per 5 minutes
    message: 'Too many 2FA verification attempts, please try again later.',
    keyGenerator: (req) => {
      return req.user?.id || req.body?.email || req.ip || 'unknown';
    },
  }),

  // Rate limiter for file uploads
  upload: createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50, // 50 uploads per hour
    message: 'Too many file uploads, please try again later.',
  }),
};

module.exports = {
  createRateLimiter,
  rateLimiters,
};

