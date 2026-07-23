const crypto = require('crypto');
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
 * @param {string} options.prefix - Bucket namespace. MUST be unique per limiter:
 *   limiters that share a prefix and produce the same key share one counter, so
 *   traffic to one endpoint consumes another endpoint's allowance.
 * @param {Function} options.keyGenerator - Function to generate key (default: uses IP)
 * @returns {Function} Express middleware
 */
const createRateLimiter = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes default
    max = 100, // 100 requests default
    message = 'Too many requests, please try again later.',
    prefix = 'general',
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

      const key = `ratelimit:${prefix}:${keyGenerator(req)}`;
      const windowSeconds = Math.ceil(windowMs / 1000);

      // Increment counter
      const count = await increment(key, 1);

      // Set expiration on first request. Also repair keys that somehow have no
      // TTL (e.g. a Redis error swallowed the first expire call) - without this
      // the counter would stay above `max` forever and permanently 429 the user.
      if (count === 1) {
        await expire(key, windowSeconds);
      } else {
        const ttl = await redis.ttl(key).catch(() => -2);
        if (ttl < 0) {
          await expire(key, windowSeconds);
        }
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
    prefix: 'api',
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per 15 minutes (increased for development)
    message: 'Too many API requests, please try again later.',
  }),

  // Strict rate limiter for auth endpoints (login, register)
  auth: createRateLimiter({
    prefix: 'auth',
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // 50 login attempts per 15 minutes (increased for testing)
    message: 'Too many login attempts, please try again later.',
    keyGenerator: (req) => {
      // Use email if available, otherwise IP
      return req.body?.email || req.ip || 'unknown';
    },
    // Skip rate limiting for read-only operations and for the password-change
    // and password-reset endpoints. Those carry a single-use token rather than
    // credentials, so they are guarded by their own token-keyed limiter -
    // charging them to the shared IP bucket locks out everyone behind a
    // corporate NAT as soon as one person browses the portal.
    skip: (req) => {
      return req.path === '/me' ||
             req.originalUrl === '/api/auth/me' ||
             req.path === '/validate-reset-token' ||
             req.originalUrl === '/api/auth/validate-reset-token' ||
             req.path === '/validate-email-change' ||
             req.originalUrl === '/api/auth/validate-email-change' ||
             req.path === '/change-password' ||
             req.originalUrl === '/api/auth/change-password' ||
             req.path === '/reset-password' ||
             req.originalUrl === '/api/auth/reset-password';
    },
  }),

  // Lenient rate limiter for /me endpoint (read-only user info)
  authMe: createRateLimiter({
    prefix: 'authme',
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute (very lenient for frequent polling)
    message: 'Too many requests, please try again later.',
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise IP
      return req.user?.userId || req.ip || 'unknown';
    },
  }),

  // Rate limiter for requesting a password reset email
  passwordReset: createRateLimiter({
    prefix: 'pwreset-request',
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 password reset requests per hour
    message: 'Too many password reset requests, please try again later.',
    keyGenerator: (req) => {
      return req.body?.email || req.ip || 'unknown';
    },
  }),

  // Rate limiter for submitting a new password against a reset token.
  // Keyed by the token itself, NOT the IP: a whole office shares one public IP,
  // and after a password-expiry sweep they all reset at the same time.
  passwordResetSubmit: createRateLimiter({
    prefix: 'pwreset-submit',
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per token per 15 minutes
    message: 'Too many password reset attempts for this link, please request a new reset email.',
    keyGenerator: (req) => {
      const token = req.body?.token;
      return token
        ? crypto.createHash('sha256').update(token).digest('hex')
        : (req.ip || 'unknown');
    },
  }),

  // Rate limiter for registration
  registration: createRateLimiter({
    prefix: 'registration',
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 registration attempts per hour
    message: 'Too many registration attempts, please try again later.',
    keyGenerator: (req) => {
      return req.body?.email || req.ip || 'unknown';
    },
  }),

  // Rate limiter for 2FA
  twoFactor: createRateLimiter({
    prefix: '2fa',
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // 10 2FA attempts per 5 minutes
    message: 'Too many 2FA verification attempts, please try again later.',
    keyGenerator: (req) => {
      return req.user?.id || req.body?.email || req.ip || 'unknown';
    },
  }),

  // Rate limiter for file uploads
  upload: createRateLimiter({
    prefix: 'upload',
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50, // 50 uploads per hour
    message: 'Too many file uploads, please try again later.',
  }),
};

module.exports = {
  createRateLimiter,
  rateLimiters,
};

