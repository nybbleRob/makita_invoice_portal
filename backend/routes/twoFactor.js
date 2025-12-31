const express = require('express');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const { User, Settings } = require('../models');
const auth = require('../middleware/auth');
const router = express.Router();

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
router.post('/verify-setup', async (req, res) => {
  try {
    const { token, sessionToken } = req.body;

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
    
    if (!user || !user.twoFactorSecret) {
      return res.status(400).json({ message: '2FA setup not initiated' });
    }

    // Verify token
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: token,
      window: 2 // Allow 2 time steps (60 seconds) tolerance
    });

    if (!verified) {
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    // Enable 2FA and mark as verified
    user.twoFactorEnabled = true;
    user.twoFactorVerified = true;
    user.lastLogin = new Date(); // Update last login
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
router.post('/verify-login', async (req, res) => {
  try {
    const { email, token } = req.body;

    if (!email || !token) {
      return res.status(400).json({ message: 'Email and verification code are required' });
    }

    const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return res.status(400).json({ message: '2FA not enabled for this user' });
    }

    // Verify token
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: token,
      window: 2
    });

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

// Remove 2FA (admin only)
router.delete('/:userId', auth, async (req, res) => {
  try {
    const currentUser = await User.findByPk(req.user.userId);
    if (!currentUser) {
      return res.status(404).json({ message: 'Current user not found' });
    }

    // Only global_admin and administrator can remove 2FA
    if (currentUser.role !== 'global_admin' && currentUser.role !== 'administrator') {
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
    await targetUser.save();

    res.json({ message: '2FA removed successfully' });
  } catch (error) {
    console.error('2FA remove error:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

