const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User, Settings, Sequelize } = require('../models');
const { Op } = Sequelize;
const auth = require('../middleware/auth');
const { logActivity, ActivityType } = require('../services/activityLogger');
const recaptchaMiddleware = require('../middleware/recaptcha');
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
router.post('/login', recaptchaMiddleware({ minScore: 0.5 }), async (req, res) => {
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

    // Check account lockout status BEFORE password verification
    const { checkAccountLockout, incrementFailedAttempts, resetFailedAttempts } = require('../utils/accountLockout');
    const lockoutStatus = await checkAccountLockout(user);
    
    if (lockoutStatus.isLocked) {
      const remainingMinutes = Math.ceil((lockoutStatus.lockedUntil - new Date()) / (1000 * 60));
      await logActivity({
        type: ActivityType.LOGIN_FAILED,
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: 'Failed login attempt - account locked',
        details: { 
          reason: 'Account is locked',
          lockReason: lockoutStatus.reason,
          lockedUntil: lockoutStatus.lockedUntil.toISOString(),
          remainingMinutes: remainingMinutes
        },
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent')
      });
      
      return res.status(423).json({ 
        message: `Account is locked. Please try again in ${remainingMinutes} minute(s) or contact an administrator.`,
        accountLocked: true,
        lockedUntil: lockoutStatus.lockedUntil.toISOString(),
        remainingMinutes: remainingMinutes
      });
    }

    // Check if user has a password set
    if (!user.password) {
      console.log('[LOGIN DEBUG] User has no password set:', user.email);
      return res.status(401).json({ 
        message: 'No password set. Please contact an administrator to set your password.',
        requiresPasswordSetup: true
      });
    }

    // DEBUG: Log password comparison details
    console.log('[LOGIN DEBUG] ===== Password Check =====');
    console.log('[LOGIN DEBUG] Email:', user.email);
    console.log('[LOGIN DEBUG] User ID:', user.id);
    console.log('[LOGIN DEBUG] Password provided length:', password.length);
    console.log('[LOGIN DEBUG] Password provided (first 3 chars):', password.substring(0, 3));
    console.log('[LOGIN DEBUG] Stored hash exists:', !!user.password);
    console.log('[LOGIN DEBUG] Stored hash length:', user.password ? user.password.length : 0);
    console.log('[LOGIN DEBUG] Stored hash starts with $2:', user.password ? user.password.startsWith('$2') : false);
    console.log('[LOGIN DEBUG] mustChangePassword:', user.mustChangePassword);
    
    // Check password
    const isMatch = await user.comparePassword(password);
    console.log('[LOGIN DEBUG] Password match result:', isMatch);
    console.log('[LOGIN DEBUG] ===========================');
    
    if (!isMatch) {
      // Increment failed login attempts
      const lockoutResult = await incrementFailedAttempts(
        user,
        req.ip || req.connection.remoteAddress,
        req.get('user-agent')
      );
      
      // Log failed login attempt
      await logActivity({
        type: ActivityType.LOGIN_FAILED,
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: 'Failed login attempt - invalid password',
        details: { 
          reason: 'Invalid password',
          failedAttempts: user.failedLoginAttempts,
          attemptsRemaining: lockoutResult.attemptsRemaining,
          wasLocked: lockoutResult.wasLocked
        },
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent')
      });
      
      // Track for security monitoring
      const { trackFailedLogin, trackAccountLockout } = require('../services/securityMonitor');
      await trackFailedLogin(user.email, req.ip || req.connection.remoteAddress, req.get('user-agent'));
      
      // If account was just locked, track it
      if (lockoutResult.wasLocked) {
        await trackAccountLockout(user, req.ip || req.connection.remoteAddress, req.get('user-agent'), 'brute_force');
      }
      
      // If account was just locked, return lockout message
      if (lockoutResult.wasLocked) {
        await logActivity({
          type: ActivityType.ACCOUNT_LOCKED,
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          action: 'Account locked due to failed login attempts',
          details: { 
            reason: 'brute_force',
            failedAttempts: user.failedLoginAttempts,
            lockedUntil: lockoutResult.lockedUntil.toISOString()
          },
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent')
        });
        
        const remainingMinutes = Math.ceil((lockoutResult.lockedUntil - new Date()) / (1000 * 60));
        return res.status(423).json({ 
          message: `Account has been locked due to too many failed login attempts. Please try again in ${remainingMinutes} minute(s) or contact an administrator.`,
          accountLocked: true,
          lockedUntil: lockoutResult.lockedUntil.toISOString(),
          remainingMinutes: remainingMinutes
        });
      }
      
      // Return generic error (don't reveal if account exists)
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    // Password is correct - reset failed attempts
    await resetFailedAttempts(user);

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
    const allowedMethods = settings.twoFactorAuth.allowedMethods || ['authenticator', 'email'];

    if (requires2FA) {
      // Check if user has 2FA enabled and verified
      if (!user.twoFactorEnabled || !user.twoFactorVerified) {
        // Generate temporary session token for 2FA setup (avoids passing password)
        const { generateSessionToken } = require('../utils/sessionToken');
        const sessionToken = await generateSessionToken(user.id, user.email);
        
        // User needs to setup 2FA first - redirect to method selection
        return res.status(200).json({
          requires2FASetup: true,
          message: '2FA setup required. Please choose your preferred 2FA method.',
          sessionToken: sessionToken, // Temporary token for 2FA setup
          allowedMethods: allowedMethods, // Available 2FA methods
          user: {
            id: user.id,
            email: user.email,
            name: user.name
          }
        });
      }

      // User has 2FA enabled - check if code was provided
      if (!req.body.twoFactorCode) {
        // Generate temporary session token for 2FA verification (avoids passing password)
        const { generateSessionToken } = require('../utils/sessionToken');
        const sessionToken = await generateSessionToken(user.id, user.email);
        
        const twoFactorMethod = user.twoFactorMethod || 'authenticator';
        
        // For email method, auto-send a code
        if (twoFactorMethod === 'email') {
          const crypto = require('crypto');
          const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
          
          // Generate 6-digit code
          const code = crypto.randomInt(100000, 999999).toString();
          const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
          
          // Store code
          user.emailTwoFactorCode = code;
          user.emailTwoFactorExpires = expiresAt;
          await user.save();
          
          // Send email
          try {
            const emailSettings = await Settings.getSettings();
            await sendTemplatedEmail(
              'two-factor-code',
              user.email,
              {
                userName: user.name,
                verificationCode: code,
                expiryMinutes: '10'
              },
              emailSettings,
              { context: { type: '2fa-login', userId: user.id } }
            );
          } catch (emailError) {
            console.error('Failed to send 2FA email:', emailError);
            // Continue anyway - user can request resend
          }
        }
        
        return res.status(200).json({
          requires2FA: true,
          message: twoFactorMethod === 'email' 
            ? 'Verification code sent to your email' 
            : '2FA verification code required',
          twoFactorMethod: twoFactorMethod,
          sessionToken: sessionToken, // Temporary token for 2FA verification
          user: {
            id: user.id,
            email: user.email, // Keep full email for re-authentication
            maskedEmail: user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3'), // Masked for display
            name: user.name
          }
        });
      }

      // Verify 2FA code based on method
      const speakeasy = require('speakeasy');
      const twoFactorMethod = user.twoFactorMethod || 'authenticator';
      let verified = false;
      
      if (twoFactorMethod === 'email') {
        // Verify email code
        if (!user.emailTwoFactorCode || !user.emailTwoFactorExpires) {
          return res.status(401).json({ message: 'No verification code found. Please request a new code.' });
        }
        
        if (new Date() > new Date(user.emailTwoFactorExpires)) {
          return res.status(401).json({ message: 'Verification code has expired. Please request a new code.' });
        }
        
        verified = user.emailTwoFactorCode === req.body.twoFactorCode;
        
        // Clear code after verification attempt
        if (verified) {
          user.emailTwoFactorCode = null;
          user.emailTwoFactorExpires = null;
        }
      } else {
        // Verify authenticator TOTP code
        if (!user.twoFactorSecret) {
          return res.status(401).json({ message: '2FA not configured' });
        }
        
        verified = speakeasy.totp.verify({
          secret: user.twoFactorSecret,
          encoding: 'base32',
          token: req.body.twoFactorCode,
          window: 2 // Allow 2 time steps (60 seconds) tolerance
        });
      }

      if (!verified) {
        return res.status(401).json({ message: 'Invalid 2FA code' });
      }
    }

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
router.post('/forgot-password', recaptchaMiddleware({ minScore: 0.5 }), async (req, res) => {
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
            'Makita EDI Portal';
          
          // Calculate expiry time for email (1 hour = 3600000ms)
          const expiryMs = user.resetPasswordExpires - Date.now();
          const expiryHours = Math.floor(expiryMs / (1000 * 60 * 60));
          const expiryMinutes = Math.floor((expiryMs % (1000 * 60 * 60)) / (1000 * 60));
          let expiryTime = '1 hour'; // Default
          if (expiryHours > 0) {
            expiryTime = expiryHours === 1 ? '1 hour' : `${expiryHours} hours`;
          } else if (expiryMinutes > 0) {
            expiryTime = expiryMinutes === 1 ? '1 minute' : `${expiryMinutes} minutes`;
          }
          
          // Try to use email template, fallback to hardcoded if template not found
          try {
            const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
            await sendTemplatedEmail(
              'password-reset',
              user.email,
              {
                userName: user.name,
                userEmail: user.email,
                resetUrl: resetUrl,
                expiryTime: expiryTime
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

// Validate email change token
router.get('/validate-email-change', async (req, res) => {
  try {
    const { token } = req.query;
    const crypto = require('crypto');
    
    if (!token) {
      return res.status(400).json({ message: 'Validation token is required' });
    }
    
    // Hash the token
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    // Find user with matching token and valid expiration
    const user = await User.findOne({
      where: {
        emailChangeToken: tokenHash,
        emailChangeExpires: {
          [require('sequelize').Op.gt]: new Date()
        }
      }
    });
    
    if (!user || !user.pendingEmail) {
      return res.status(400).json({ message: 'Invalid or expired validation token' });
    }
    
    res.json({ 
      valid: true,
      message: 'Token is valid',
      pendingEmail: user.pendingEmail
    });
  } catch (error) {
    console.error('Validate email change token error:', error);
    res.status(500).json({ message: error.message });
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

