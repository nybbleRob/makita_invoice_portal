/**
 * reCAPTCHA Middleware
 * 
 * Verifies Google reCAPTCHA v3 tokens for authentication endpoints.
 * Skips verification in development mode if keys are not configured.
 */

const https = require('https');
const querystring = require('querystring');

/**
 * Verify reCAPTCHA token with Google
 * @param {string} token - reCAPTCHA token from frontend
 * @param {string} secretKey - reCAPTCHA secret key
 * @returns {Promise<Object>} - { success: boolean, score: number, action: string }
 */
function verifyRecaptchaToken(token, secretKey) {
  return new Promise((resolve, reject) => {
    if (!token) {
      return resolve({ success: false, error: 'Token is required' });
    }
    
    if (!secretKey) {
      // In development, allow if secret key not set
      if (process.env.NODE_ENV === 'development') {
        console.warn('⚠️  reCAPTCHA secret key not set - skipping verification in development mode');
        return resolve({ success: true, score: 1.0, action: 'login' });
      }
      return resolve({ success: false, error: 'reCAPTCHA secret key not configured' });
    }
    
    const postData = querystring.stringify({
      secret: secretKey,
      response: token
    });
    
    const options = {
      hostname: 'www.google.com',
      port: 443,
      path: '/recaptcha/api/siteverify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (error) {
          reject(new Error('Failed to parse reCAPTCHA response'));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.write(postData);
    req.end();
  });
}

/**
 * reCAPTCHA verification middleware
 * @param {Object} options - Middleware options
 * @param {number} options.minScore - Minimum score threshold (default: 0.5)
 * @param {boolean} options.skipInDevelopment - Skip verification in development if keys not set (default: true)
 * @returns {Function} Express middleware
 */
const recaptchaMiddleware = (options = {}) => {
  const {
    minScore = 0.5,
    skipInDevelopment = true
  } = options;
  
  return async (req, res, next) => {
    try {
      const secretKey = process.env.RECAPTCHA_SECRET_KEY;
      const enabled = process.env.RECAPTCHA_ENABLED !== 'false'; // Default to true if not set
      
      // Skip if disabled
      if (!enabled) {
        return next();
      }
      
      // Skip in development if keys not set and skipInDevelopment is true
      if (skipInDevelopment && process.env.NODE_ENV === 'development' && !secretKey) {
        console.warn('⚠️  reCAPTCHA verification skipped - keys not configured in development');
        return next();
      }
      
      // Get token from request body
      const token = req.body.recaptchaToken || req.body.recaptcha_token;
      
      if (!token) {
        return res.status(400).json({ 
          message: 'reCAPTCHA verification required',
          recaptchaRequired: true
        });
      }
      
      // Verify token
      const verification = await verifyRecaptchaToken(token, secretKey);
      
      if (!verification.success) {
        console.warn('reCAPTCHA verification failed:', verification['error-codes'] || 'Unknown error');
        return res.status(400).json({ 
          message: 'reCAPTCHA verification failed. Please try again.',
          recaptchaFailed: true
        });
      }
      
      // Check score (v3 returns a score from 0.0 to 1.0)
      if (verification.score !== undefined && verification.score < minScore) {
        console.warn(`reCAPTCHA score too low: ${verification.score} (minimum: ${minScore})`);
        return res.status(400).json({ 
          message: 'reCAPTCHA verification failed. Please try again.',
          recaptchaFailed: true,
          score: verification.score
        });
      }
      
      // Store verification result in request for logging
      req.recaptchaVerification = {
        success: true,
        score: verification.score,
        action: verification.action
      };
      
      next();
    } catch (error) {
      console.error('reCAPTCHA verification error:', error);
      // In development, allow request to proceed if verification fails
      if (process.env.NODE_ENV === 'development' && skipInDevelopment) {
        console.warn('⚠️  reCAPTCHA verification error - allowing request in development mode');
        return next();
      }
      return res.status(500).json({ 
        message: 'reCAPTCHA verification error. Please try again.',
        recaptchaError: true
      });
    }
  };
};

module.exports = recaptchaMiddleware;
