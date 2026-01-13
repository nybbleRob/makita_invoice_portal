const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User, Settings, Sequelize } = require('../models');
const { Op } = Sequelize;
const auth = require('../middleware/auth');
const { logActivity, ActivityType } = require('../services/activityLogger');
const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create user
    const user = await User.create({ 
      name, 
      email: email.toLowerCase().trim(), 
      password, 
      role: role || 'external_user' 
    });

    // Generate token (expiration configurable via environment)
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Find user (case-insensitive email search)
    const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (!user) {
      // Log failed login attempt
      await logActivity({
        type: ActivityType.LOGIN_FAILED,
        userEmail: email.toLowerCase().trim(),
        action: 'Failed login attempt',
        details: { reason: 'User not found' },
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent')
      });
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Block notification_contact users from logging in
    // They are email-only recipients and do not have portal access
    if (user.role === 'notification_contact') {
      await logActivity({
        type: ActivityType.LOGIN_FAILED,
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: 'Failed login attempt - notification contact',
        details: { reason: 'Notification contacts cannot log in' },
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent')
      });
      return res.status(403).json({ 
        message: 'Notification contacts cannot log in. This account is for email notifications only.' 
      });
    }

    // Check if user has a password set
    if (!user.password) {
      return res.status(401).json({ 
        message: 'No password set. Please contact an administrator to set your password.',
        requiresPasswordSetup: true
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check if user must change password (first time login or admin reset)
    if (user.mustChangePassword) {
      // Generate temporary session token for password change (avoids passing password)
      const { generateSessionToken } = require('../utils/sessionToken');
      const sessionToken = await generateSessionToken(user.id, user.email);
      
      return res.status(200).json({
        mustChangePassword: true,
        message: 'You must change your password before continuing.',
        sessionToken: sessionToken, // Temporary token for password change
        user: {
          id: user.id,
          email: user.email,
          name: user.name
        }
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    // Get settings for password expiry check
    const settings = await Settings.getSettings();
    
    // Check password expiry
    if (settings.passwordExpiryDays && settings.passwordExpiryDays > 0 && user.passwordExpiryDate) {
      const now = new Date();
      if (now > user.passwordExpiryDate) {
        return res.status(401).json({ 
          message: 'Your password has expired. Please reset your password.',
          passwordExpired: true
        });
      }
    }

    // Check 2FA requirements
    const requires2FA = settings.twoFactorAuth.enabled && settings.twoFactorAuth.required;

    if (requires2FA) {
      // Check if user has 2FA enabled and verified
      if (!user.twoFactorEnabled || !user.twoFactorVerified) {
        // Generate temporary session token for 2FA setup (avoids passing password)
        const { generateSessionToken } = require('../utils/sessionToken');
        const sessionToken = await generateSessionToken(user.id, user.email);
        
        // User needs to setup 2FA first
        return res.status(200).json({
          requires2FASetup: true,
          message: '2FA setup required. Please complete 2FA setup to continue.',
          sessionToken: sessionToken, // Temporary token for 2FA setup
          user: {
            id: user.id,
            email: user.email,
            name: user.name
          }
        });
      }

      // Check if 2FA code was provided
      if (!req.body.twoFactorCode) {
        // Generate temporary session token for 2FA verification (avoids passing password)
        const { generateSessionToken } = require('../utils/sessionToken');
        const sessionToken = await generateSessionToken(user.id, user.email);
        
        return res.status(200).json({
          requires2FA: true,
          message: '2FA verification code required',
          sessionToken: sessionToken, // Temporary token for 2FA verification
          user: {
            id: user.id,
            email: user.email,
            name: user.name
          }
        });
      }

      // Verify 2FA code
      const speakeasy = require('speakeasy');
      
      // SECURITY: Ensure 2FA secret exists
      if (!user.twoFactorSecret) {
        return res.status(401).json({ message: '2FA not configured' });
      }
      
      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: req.body.twoFactorCode,
        window: 2 // Allow 2 time steps (60 seconds) tolerance
      });

      if (!verified) {
        return res.status(401).json({ message: 'Invalid 2FA code' });
      }
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token (expiration configurable via environment)
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    // SECURITY: Never expose sensitive data in responses
    const userObj = user.toSafeObject ? user.toSafeObject() : user.toJSON();
    delete userObj.password;
    delete userObj.twoFactorSecret; // Never expose 2FA secret
    delete userObj.resetPasswordToken;
    delete userObj.resetPasswordExpires;
    
    // Log successful login
    await logActivity({
      type: ActivityType.LOGIN,
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: 'User logged in successfully',
      details: { twoFactorEnabled: user.twoFactorEnabled },
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });

    res.json({
      message: 'Login successful',
      token,
      user: userObj
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.userId, {
      attributes: { exclude: ['password', 'twoFactorSecret', 'resetPasswordToken', 'resetPasswordExpires'] }
    });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Forgot password - Request password reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Find user
    const user = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    
    // Always return success to prevent email enumeration
    // But only send email if user exists
    if (user && user.isActive) {
      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
      
      // Set token and expiration (1 hour)
      user.resetPasswordToken = resetTokenHash;
      user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
      await user.save();

      // Get settings for email configuration
      const settings = await Settings.getSettings();
      
      // Send email if email provider is configured
      const { isEmailEnabled, sendEmail } = require('../utils/emailService');
      const { getResetPasswordUrl } = require('../utils/urlConfig');
      if (isEmailEnabled(settings)) {
        try {
          const resetUrl = getResetPasswordUrl(resetToken);
          
          // Use systemEmail if set, otherwise use provider's fromEmail
          const fromEmail = settings.systemEmail || 
            settings.emailProvider?.smtp?.fromEmail || 
            settings.emailProvider?.office365?.fromEmail ||
            settings.emailProvider?.resend?.fromEmail ||
            settings.emailProvider?.smtp2go?.fromEmail;
          
          const fromName = settings.companyName || 
            settings.emailProvider?.smtp?.fromName || 
            settings.emailProvider?.resend?.fromName ||
            settings.emailProvider?.smtp2go?.fromName ||
            'Makita Invoice Portal';
          
          // Try to use email template, fallback to hardcoded if template not found
          try {
            const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
            await sendTemplatedEmail(
              'password-reset',
              user.email,
              {
                userName: user.name,
                userEmail: user.email,
                resetUrl: resetUrl
              },
              settings
            );
          } catch (templateError) {
            console.warn('Email template not found, using Tabler template:', templateError.message);
            // Fallback to Tabler template
            const { renderTemplate } = require('../utils/tablerEmailRenderer');
            
            const html = renderTemplate('password-reset', {
              userName: user.name,
              resetUrl,
              expiryTime: '1 hour'
            }, settings);
            
            await sendEmail({
              to: user.email,
              subject: 'Password Reset Request',
              html,
              text: `
Password Reset Request

Hello ${user.name},

You requested to reset your password. Click the link below to reset it:

${resetUrl}

This link will expire in 1 hour.

If you didn't request this, please ignore this email.

Best regards,
${fromName}
              `.trim()
            }, settings);
          }
        } catch (emailError) {
          console.error('Error sending password reset email:', emailError);
          // Still return success to user, but log the error
        }
      } else {
        // SMTP not configured - log the reset token (for development)
        console.log('\n=== PASSWORD RESET TOKEN ===');
        console.log(`User: ${user.email}`);
        console.log(`Reset Token: ${resetToken}`);
        console.log(`Reset URL: ${getResetPasswordUrl(resetToken)}`);
        console.log('===========================\n');
      }
    }

    // Always return success message
    res.json({ 
      message: 'If an account with that email exists, a password reset link has been sent.' 
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'An error occurred. Please try again later.' });
  }
});

// Validate reset token
router.get('/validate-reset-token', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ message: 'Token is required' });
    }

    // Hash the token
    const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find user with valid token
    const user = await User.findOne({
      where: {
        resetPasswordToken: resetTokenHash,
        resetPasswordExpires: { [Op.gt]: Date.now() }
      }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    res.json({ message: 'Token is valid' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ message: 'Token and password are required' });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }
    if (!/[A-Z]/.test(password)) {
      return res.status(400).json({ message: 'Password must contain at least one uppercase letter' });
    }
    if (!/[a-z]/.test(password)) {
      return res.status(400).json({ message: 'Password must contain at least one lowercase letter' });
    }
    if (!/[0-9]/.test(password)) {
      return res.status(400).json({ message: 'Password must contain at least one number' });
    }

    // Hash the token
    const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Find user with valid token
    const user = await User.findOne({
      where: {
        resetPasswordToken: resetTokenHash,
        resetPasswordExpires: { [Op.gt]: Date.now() }
      }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    // Update password and clear reset token
    user.password = password;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    user.mustChangePassword = false; // Clear the flag since user is setting their own password
    await user.save();

    // Log password reset
    await logActivity({
      type: ActivityType.PASSWORD_RESET,
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: 'Password reset completed',
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Change password (for first-time login or forced password change)
router.post('/change-password', async (req, res) => {
  try {
    const { sessionToken, currentPassword, newPassword } = req.body;

    if (!sessionToken || !newPassword) {
      return res.status(400).json({ message: 'Session token and new password are required' });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }
    if (!/[A-Z]/.test(newPassword)) {
      return res.status(400).json({ message: 'Password must contain at least one uppercase letter' });
    }
    if (!/[a-z]/.test(newPassword)) {
      return res.status(400).json({ message: 'Password must contain at least one lowercase letter' });
    }
    if (!/[0-9]/.test(newPassword)) {
      return res.status(400).json({ message: 'Password must contain at least one number' });
    }

    // Verify session token
    const { verifySessionToken } = require('../utils/sessionToken');
    const tokenData = await verifySessionToken(sessionToken);
    
    if (!tokenData || !tokenData.userId) {
      return res.status(401).json({ message: 'Invalid or expired session token' });
    }

    // Find user
    const user = await User.findByPk(tokenData.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // If current password is provided, verify it (for users changing their own password)
    // If mustChangePassword is true, we allow changing without current password (first-time login)
    if (currentPassword) {
      if (!user.password) {
        return res.status(400).json({ message: 'No password set. Cannot verify current password.' });
      }
      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(401).json({ message: 'Current password is incorrect' });
      }
    } else if (!user.mustChangePassword) {
      // If mustChangePassword is false, current password is required
      return res.status(400).json({ message: 'Current password is required' });
    }

    // Update password
    user.password = newPassword;
    user.mustChangePassword = false; // Clear the flag after password change
    await user.save();

    // Send password changed email notification
    try {
      const Settings = require('../models/Settings');
      const settings = await Settings.getSettings();
      
      const { isEmailEnabled } = require('../utils/emailService');
      if (isEmailEnabled(settings)) {
        const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
        await sendTemplatedEmail(
          'password-changed',
          user.email,
          {
            userName: user.name || user.email,
            userEmail: user.email
          },
          settings
        );
      }
    } catch (emailError) {
      // Don't fail the password change if email fails
      console.warn('Failed to send password changed email:', emailError.message);
    }

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

