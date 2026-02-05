const express = require('express');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User, Settings } = require('../models');
const auth = require('../middleware/auth');
const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
const router = express.Router();

// Rate limiting storage for email 2FA (in-memory, could be Redis in production)
const emailCodeRateLimits = new Map();

// Helper function to generate 6-digit code
function generateEmailCode() {
  return crypto.randomInt(100000, 999999).toString();
}

// Helper function to check rate limit for email codes (1 per 60 seconds)
function checkEmailRateLimit(userId) {
  const lastSent = emailCodeRateLimits.get(userId);
  if (lastSent) {
    const elapsed = Date.now() - lastSent;
    const remaining = 60000 - elapsed; // 60 seconds
    if (remaining > 0) {
      return { allowed: false, waitSeconds: Math.ceil(remaining / 1000) };
    }
  }
  return { allowed: true };
}

// Helper function to set rate limit
function setEmailRateLimit(userId) {
  emailCodeRateLimits.set(userId, Date.now());
  // Clean up old entries after 2 minutes
  setTimeout(() => emailCodeRateLimits.delete(userId), 120000);
}

// Generate 2FA secret and QR code (for setup)
// Uses session token (from login) OR auth token for security
router.post('/setup', async (req, res) => {
  try {
    let user;
    
    // SECURITY: Prefer session token over password
    const { verifySessionToken } = require('../utils/sessionToken');
    
    // Check session token first (from login flow)
    // Don't consume it yet - we need it for verify-setup too
    if (req.body.sessionToken) {
      console.log('2FA Setup - Received session token:', req.body.sessionToken.substring(0, 10) + '...');
      const sessionData = await verifySessionToken(req.body.sessionToken, false);
      console.log('2FA Setup - Session data:', sessionData ? 'Valid' : 'Invalid/Expired');
      if (sessionData) {
        user = await User.findByPk(sessionData.userId);
        if (!user) {
          console.error('2FA Setup - User not found for ID:', sessionData.userId);
          return res.status(404).json({ message: 'User not found' });
        }
        console.log('2FA Setup - User found:', user.email);
      } else {
        console.error('2FA Setup - Invalid or expired session token');
        return res.status(401).json({ message: 'Invalid or expired session token. Please try logging in again.' });
      }
    }
    
    // Fallback: Check if authenticated via JWT token
    if (!user && req.headers.authorization) {
      try {
        const authToken = req.headers.authorization.replace('Bearer ', '');
        const decoded = jwt.verify(authToken, process.env.JWT_SECRET);
        user = await User.findByPk(decoded.userId);
      } catch (err) {
        // Token invalid
      }
    }
    
    if (!user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Check if 2FA is enabled globally (required check removed to allow user-initiated setup)
    const settings = await Settings.getSettings();
    console.log('2FA Setup - Settings check:', {
      enabled: settings.twoFactorAuth?.enabled,
      required: settings.twoFactorAuth?.required
    });
    
    if (!settings.twoFactorAuth || !settings.twoFactorAuth.enabled) {
      console.error('2FA Setup - 2FA not enabled in settings');
      return res.status(400).json({ message: '2FA is not enabled. Please contact your administrator.' });
    }
    
    // If user already has 2FA enabled, they need to reset it first
    if (user.twoFactorEnabled && user.twoFactorVerified) {
      console.log('2FA Setup - User already has 2FA enabled');
      return res.status(400).json({ message: '2FA is already enabled. Please reset it first if you want to change it.' });
    }
    
    console.log('2FA Setup - User 2FA status:', {
      enabled: user.twoFactorEnabled,
      verified: user.twoFactorVerified,
      hasSecret: !!user.twoFactorSecret
    });

    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `${settings.twoFactorAuth.issuer} (${user.email})`,
      length: 32
    });

    // Store temporary secret (not enabled yet)
    user.twoFactorSecret = secret.base32;
    await user.save();

    // Generate QR code
    try {
      console.log('2FA Setup - Generating secret and QR code');
      const otpauthUrl = secret.otpauth_url;
      if (!otpauthUrl) {
        console.error('2FA Setup - OTP auth URL is missing');
        throw new Error('Failed to generate OTP auth URL');
      }
      
      console.log('2FA Setup - Generating QR code from URL');
      const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
      if (!qrCodeDataUrl) {
        console.error('2FA Setup - QR code data URL is missing');
        throw new Error('Failed to generate QR code data URL');
      }

      console.log('2FA Setup - QR code generated successfully, length:', qrCodeDataUrl.length);

      // SECURITY: Only return secret once during setup, never expose it again
      // The secret is stored in the database, but we return it here ONLY for manual entry
      // After this, the secret should never be exposed in API responses
      res.json({
        qrCode: qrCodeDataUrl,
        manualEntryKey: secret.base32 // Only for manual entry if QR scan fails
      });
    } catch (qrError) {
      console.error('2FA Setup - QR code generation error:', qrError);
      console.error('2FA Setup - Error stack:', qrError.stack);
      // Revert the secret if QR generation failed
      user.twoFactorSecret = null;
      await user.save();
      throw new Error(`Failed to generate QR code: ${qrError.message}`);
    }
  } catch (error) {
    console.error('2FA setup error:', error);
    // Provide more detailed error message
    const errorMessage = error.message || 'Unknown error occurred';
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ 
      message: errorMessage.includes('QR code') ? errorMessage : `Error generating QR code: ${errorMessage}`,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Verify 2FA setup (user enters code to confirm setup)
// Uses session token (from login) OR auth token for security
// Supports both authenticator and email methods
router.post('/verify-setup', async (req, res) => {
  try {
    const { token, sessionToken, method } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Verification code is required' });
    }

    let user;
    
    // SECURITY: Prefer session token over password
    const { verifySessionToken } = require('../utils/sessionToken');
    
    // Check session token first (from login flow)
    // Consume it here since this is the final step (verify-setup)
    if (sessionToken) {
      const sessionData = await verifySessionToken(sessionToken, true); // Consume on verify
      if (sessionData) {
        user = await User.findByPk(sessionData.userId);
        if (!user) {
          return res.status(404).json({ message: 'User not found' });
        }
      } else {
        return res.status(401).json({ message: 'Invalid or expired session token' });
      }
    }
    
    // Fallback: Check if authenticated via JWT token
    if (!user && req.headers.authorization) {
      try {
        const authToken = req.headers.authorization.replace('Bearer ', '');
        const decoded = jwt.verify(authToken, process.env.JWT_SECRET);
        user = await User.findByPk(decoded.userId);
      } catch (err) {
        // Token invalid
      }
    }
    
    if (!user) {
      return res.status(400).json({ message: '2FA setup not initiated' });
    }

    // Determine method - use provided method or detect from user
    const twoFactorMethod = method || user.twoFactorMethod || 'authenticator';
    let verified = false;

    if (twoFactorMethod === 'email') {
      // Verify email code
      if (!user.emailTwoFactorCode || !user.emailTwoFactorExpires) {
        return res.status(400).json({ message: 'No email verification code found. Please request a new code.' });
      }

      // Check expiry
      if (new Date() > new Date(user.emailTwoFactorExpires)) {
        return res.status(400).json({ message: 'Verification code has expired. Please request a new code.' });
      }

      // Verify code
      verified = user.emailTwoFactorCode === token;
    } else {
      // Verify authenticator TOTP code
      if (!user.twoFactorSecret) {
        return res.status(400).json({ message: '2FA setup not initiated' });
      }

      verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: token,
        window: 2 // Allow 2 time steps (60 seconds) tolerance
      });
    }

    if (!verified) {
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    // Enable 2FA and mark as verified
    user.twoFactorEnabled = true;
    user.twoFactorVerified = true;
    user.twoFactorMethod = twoFactorMethod;
    user.lastLogin = new Date(); // Update last login
    
    // Clear email code if used
    if (twoFactorMethod === 'email') {
      user.emailTwoFactorCode = null;
      user.emailTwoFactorExpires = null;
    }
    
    await user.save();

    // Generate JWT token for immediate login (user already verified password + 2FA)
    const jwtToken = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // SECURITY: Never expose sensitive data in responses
    const userObj = user.toSafeObject ? user.toSafeObject() : user.toJSON();
    delete userObj.password;
    delete userObj.twoFactorSecret; // Never expose 2FA secret after setup
    delete userObj.resetPasswordToken;
    delete userObj.resetPasswordExpires;

    res.json({
      message: '2FA enabled successfully',
      token: jwtToken, // Return JWT token for immediate login
      user: userObj
    });
  } catch (error) {
    console.error('2FA verify setup error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Verify 2FA code during login
// Supports both authenticator and email methods
router.post('/verify-login', async (req, res) => {
  try {
    const { email, token } = req.body;

    if (!email || !token) {
      return res.status(400).json({ message: 'Email and verification code are required' });
    }

    const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (!user || !user.twoFactorEnabled) {
      return res.status(400).json({ message: '2FA not enabled for this user' });
    }

    let verified = false;
    const method = user.twoFactorMethod || 'authenticator';

    if (method === 'email') {
      // Verify email code
      if (!user.emailTwoFactorCode || !user.emailTwoFactorExpires) {
        return res.status(400).json({ message: 'No email verification code found. Please request a new code.' });
      }

      // Check expiry
      if (new Date() > new Date(user.emailTwoFactorExpires)) {
        return res.status(400).json({ message: 'Verification code has expired. Please request a new code.' });
      }

      // Verify code
      verified = user.emailTwoFactorCode === token;

      // Clear code after successful verification
      if (verified) {
        user.emailTwoFactorCode = null;
        user.emailTwoFactorExpires = null;
        await user.save();
      }
    } else {
      // Verify authenticator TOTP code
      if (!user.twoFactorSecret) {
        return res.status(400).json({ message: '2FA not configured properly' });
      }

      verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: token,
        window: 2
      });
    }

    if (!verified) {
      return res.status(401).json({ message: 'Invalid verification code' });
    }

    // Return success - login will complete
    res.json({
      message: '2FA verified successfully',
      verified: true
    });
  } catch (error) {
    console.error('2FA verify login error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Remove 2FA (admin and manager)
router.delete('/:userId', auth, async (req, res) => {
  try {
    const currentUser = await User.findByPk(req.user.userId);
    if (!currentUser) {
      return res.status(404).json({ message: 'Current user not found' });
    }

    // Only global_admin, administrator, and manager can remove 2FA
    if (!['global_admin', 'administrator', 'manager'].includes(currentUser.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const targetUser = await User.findByPk(req.params.userId);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Remove 2FA
    targetUser.twoFactorSecret = null;
    targetUser.twoFactorEnabled = false;
    targetUser.twoFactorVerified = false;
    targetUser.twoFactorMethod = null;
    targetUser.emailTwoFactorCode = null;
    targetUser.emailTwoFactorExpires = null;
    await targetUser.save();

    res.json({ message: '2FA removed successfully' });
  } catch (error) {
    console.error('2FA remove error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Setup email 2FA (choose email method and send first code)
router.post('/setup-email', async (req, res) => {
  try {
    let user;
    
    const { verifySessionToken } = require('../utils/sessionToken');
    
    // Check session token (from login flow)
    if (req.body.sessionToken) {
      const sessionData = await verifySessionToken(req.body.sessionToken, false);
      if (sessionData) {
        user = await User.findByPk(sessionData.userId);
        if (!user) {
          return res.status(404).json({ message: 'User not found' });
        }
      } else {
        return res.status(401).json({ message: 'Invalid or expired session token. Please try logging in again.' });
      }
    }
    
    // Fallback: Check if authenticated via JWT token
    if (!user && req.headers.authorization) {
      try {
        const authToken = req.headers.authorization.replace('Bearer ', '');
        const decoded = jwt.verify(authToken, process.env.JWT_SECRET);
        user = await User.findByPk(decoded.userId);
      } catch (err) {
        // Token invalid
      }
    }
    
    if (!user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Check if 2FA is enabled globally
    const settings = await Settings.getSettings();
    if (!settings.twoFactorAuth || !settings.twoFactorAuth.enabled) {
      return res.status(400).json({ message: '2FA is not enabled. Please contact your administrator.' });
    }
    
    // Check if email method is allowed
    const allowedMethods = settings.twoFactorAuth.allowedMethods || ['authenticator', 'email'];
    if (!allowedMethods.includes('email')) {
      return res.status(400).json({ message: 'Email 2FA is not enabled. Please use an authenticator app.' });
    }
    
    // If user already has 2FA enabled, they need to reset it first
    if (user.twoFactorEnabled && user.twoFactorVerified) {
      return res.status(400).json({ message: '2FA is already enabled. Please reset it first if you want to change it.' });
    }

    // Check rate limit
    const rateCheck = checkEmailRateLimit(user.id);
    if (!rateCheck.allowed) {
      return res.status(429).json({ 
        message: `Please wait ${rateCheck.waitSeconds} seconds before requesting another code.`,
        waitSeconds: rateCheck.waitSeconds
      });
    }

    // Generate 6-digit code
    const code = generateEmailCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store code and set method
    user.twoFactorMethod = 'email';
    user.emailTwoFactorCode = code;
    user.emailTwoFactorExpires = expiresAt;
    await user.save();

    // Set rate limit
    setEmailRateLimit(user.id);

    // Send email
    await sendTemplatedEmail(
      'two-factor-code',
      user.email,
      {
        userName: user.name,
        verificationCode: code,
        expiryMinutes: '10'
      },
      { context: { type: '2fa-setup', userId: user.id } }
    );

    res.json({
      message: 'Verification code sent to your email',
      email: user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') // Mask email
    });
  } catch (error) {
    console.error('Email 2FA setup error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Send/resend email 2FA code (during login)
router.post('/send-email-code', async (req, res) => {
  try {
    const { email, sessionToken } = req.body;
    let user;

    // Try session token first
    if (sessionToken) {
      const { verifySessionToken } = require('../utils/sessionToken');
      const sessionData = await verifySessionToken(sessionToken, false);
      if (sessionData) {
        user = await User.findByPk(sessionData.userId);
      }
    }

    // Fallback to email lookup (for resend during login)
    if (!user && email) {
      user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    }

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user has email 2FA method
    if (user.twoFactorMethod !== 'email') {
      return res.status(400).json({ message: 'Email 2FA is not configured for this user' });
    }

    // Check rate limit
    const rateCheck = checkEmailRateLimit(user.id);
    if (!rateCheck.allowed) {
      return res.status(429).json({ 
        message: `Please wait ${rateCheck.waitSeconds} seconds before requesting another code.`,
        waitSeconds: rateCheck.waitSeconds
      });
    }

    // Generate new 6-digit code
    const code = generateEmailCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store code
    user.emailTwoFactorCode = code;
    user.emailTwoFactorExpires = expiresAt;
    await user.save();

    // Set rate limit
    setEmailRateLimit(user.id);

    // Send email
    await sendTemplatedEmail(
      'two-factor-code',
      user.email,
      {
        userName: user.name,
        verificationCode: code,
        expiryMinutes: '10'
      },
      { context: { type: '2fa-login', userId: user.id } }
    );

    res.json({
      message: 'Verification code sent to your email',
      email: user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') // Mask email
    });
  } catch (error) {
    console.error('Send email code error:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

