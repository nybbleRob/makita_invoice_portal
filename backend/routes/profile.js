const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { User, Settings } = require('../models');
const auth = require('../middleware/auth');
const router = express.Router();

// Storage configuration
const { ensureStorageDirs, getStorageDir } = require('../config/storage');
ensureStorageDirs();
const avatarsDir = getStorageDir('avatars');

// Configure multer for avatar uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, avatarsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `avatar-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Get current user profile
router.get('/', auth, async (req, res) => {
  try {
    const { Company } = require('../models');
    const user = await User.findByPk(req.user.userId, {
      attributes: { exclude: ['password', 'twoFactorSecret', 'resetPasswordToken', 'resetPasswordExpires', 'emailChangeToken'] },
      include: [{
        model: Company,
        as: 'companies',
        attributes: ['id', 'name', 'referenceNo', 'type', 'code'],
        through: { attributes: [] }
      }]
    });
    
    // Include pendingEmail in response (but not emailChangeToken)
    const userObj = user.toSafeObject ? user.toSafeObject() : user.toJSON();
    if (user.pendingEmail) {
      userObj.pendingEmail = user.pendingEmail;
    }
    res.json(userObj);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update current user profile
router.put('/', auth, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Users can only update their own name
    if (req.body.name !== undefined) {
      user.name = req.body.name;
    }
    
    // Users cannot change their own email or role
    await user.save();
    
    const userObj = user.toSafeObject ? user.toSafeObject() : user.toJSON();
    delete userObj.password;
    
    res.json(userObj);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Change own password
router.put('/password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }
    
    const user = await User.findByPk(req.user.userId);
    
    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    
    // Update password (pre-save hook will hash it and set expiry date)
    user.password = newPassword;
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
    res.status(400).json({ message: error.message });
  }
});

// Upload avatar
router.post('/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    const user = await User.findByPk(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Resize avatar to 128x128px
    const originalPath = req.file.path;
    const resizedFilename = `avatar-${Date.now()}-128x128.png`;
    const resizedPath = path.join(avatarsDir, resizedFilename);
    
    try {
      await sharp(originalPath)
        .resize(128, 128, {
          fit: 'cover'
        })
        .png()
        .toFile(resizedPath);
      
      // Delete original file
      fs.unlinkSync(originalPath);
      
      // Delete old avatar if exists
      if (user.avatar) {
        const oldPath = path.join(avatarsDir, path.basename(user.avatar));
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      
      user.avatar = `/uploads/avatars/${resizedFilename}`;
      await user.save();
      
      const userObj = user.toObject();
      delete userObj.password;
      
      res.json({ message: 'Avatar uploaded successfully', user: userObj });
    } catch (resizeError) {
      // If resize fails, use original file
      console.error('Avatar resize error:', resizeError);
      user.avatar = `/uploads/avatars/${req.file.filename}`;
      await user.save();
      
      const userObj = user.toObject();
      delete userObj.password;
      
      res.json({ message: 'Avatar uploaded successfully (resize failed)', user: userObj });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Cancel pending email change
router.post('/cancel-email-change', auth, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (!user.pendingEmail) {
      return res.status(400).json({ message: 'No pending email change to cancel' });
    }
    
    const cancelledEmail = user.pendingEmail;
    
    // Clear pending email change
    user.pendingEmail = null;
    user.emailChangeToken = null;
    user.emailChangeExpires = null;
    await user.save();
    
    // Log activity
    const { logActivity, ActivityType } = require('../services/activityLogger');
    await logActivity({
      type: ActivityType.EMAIL_CHANGE_REQUESTED,
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: `Cancelled pending email change to ${cancelledEmail}`,
      details: {
        cancelledEmail: cancelledEmail
      },
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json({ message: 'Pending email change cancelled successfully' });
  } catch (error) {
    console.error('Cancel email change error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Resend email change validation email
router.post('/resend-email-change', auth, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (!user.pendingEmail || !user.emailChangeToken) {
      return res.status(400).json({ message: 'No pending email change found' });
    }
    
    // Check if token is expired
    if (user.emailChangeExpires && new Date(user.emailChangeExpires) < new Date()) {
      return res.status(400).json({ message: 'Email change token has expired. Please request a new email change.' });
    }
    
    // Get settings for email configuration
    const settings = await Settings.getSettings();
    const { isEmailEnabled } = require('../utils/emailService');
    const { getEmailChangeValidationUrl } = require('../utils/urlConfig');
    const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
    
    if (!isEmailEnabled(settings)) {
      return res.status(400).json({ message: 'Email service is not configured' });
    }
    
    // We need to generate a new token since we only store the hash
    const crypto = require('crypto');
    const changeToken = crypto.randomBytes(32).toString('hex');
    const changeTokenHash = crypto.createHash('sha256').update(changeToken).digest('hex');
    
    // Update token and extend expiration (30 minutes from now)
    user.emailChangeToken = changeTokenHash;
    user.emailChangeExpires = Date.now() + 1800000; // 30 minutes
    await user.save();
    
    // Send validation email
    const validationUrl = getEmailChangeValidationUrl(changeToken);
    const expiryMs = user.emailChangeExpires - Date.now();
    const expiryMinutes = Math.floor(expiryMs / (1000 * 60));
    const expiryTime = expiryMinutes === 1 ? '1 minute' : `${expiryMinutes} minutes`;
    
    await sendTemplatedEmail(
      'email-change-validation',
      user.pendingEmail.toLowerCase(),
      {
        userName: user.name || user.email,
        oldEmail: user.email,
        newEmail: user.pendingEmail.toLowerCase(),
        validationUrl: validationUrl,
        expiryTime: expiryTime
      },
      settings
    );
    
    res.json({ 
      message: 'Validation email resent successfully. Please check your email.',
      pendingEmail: user.pendingEmail.toLowerCase()
    });
  } catch (error) {
    console.error('Resend email change error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Request email change
router.post('/request-email-change', auth, async (req, res) => {
  try {
    const { newEmail } = req.body;
    const crypto = require('crypto');
    
    if (!newEmail) {
      return res.status(400).json({ message: 'New email is required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }
    
    const user = await User.findByPk(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if email is the same
    if (user.email.toLowerCase() === newEmail.toLowerCase()) {
      return res.status(400).json({ message: 'New email must be different from current email' });
    }
    
    // Check if email is already in use
    const existingUser = await User.findOne({ where: { email: newEmail.toLowerCase() } });
    if (existingUser && existingUser.id !== user.id) {
      return res.status(400).json({ message: 'Email is already in use' });
    }
    
    // Check if there's already a pending email change
    if (user.pendingEmail) {
      return res.status(400).json({ 
        message: 'You already have a pending email change. Please cancel it first or wait for it to expire.',
        pendingEmail: user.pendingEmail
      });
    }
    
    // Generate token
    const changeToken = crypto.randomBytes(32).toString('hex');
    const changeTokenHash = crypto.createHash('sha256').update(changeToken).digest('hex');
    
    // Set pending email, token, and expiration (30 minutes)
    user.pendingEmail = newEmail.toLowerCase();
    user.emailChangeToken = changeTokenHash;
    user.emailChangeExpires = Date.now() + 1800000; // 30 minutes
    await user.save();
    
    // Get settings for email configuration
    const settings = await Settings.getSettings();
    
    // Send validation email to new email address
    const { isEmailEnabled } = require('../utils/emailService');
    const { getEmailChangeValidationUrl } = require('../utils/urlConfig');
    if (isEmailEnabled(settings)) {
      try {
        const validationUrl = getEmailChangeValidationUrl(changeToken);
        
        // Calculate expiry time for email (30 minutes)
        const expiryMs = user.emailChangeExpires - Date.now();
        const expiryMinutes = Math.floor(expiryMs / (1000 * 60));
        const expiryTime = expiryMinutes === 1 ? '1 minute' : `${expiryMinutes} minutes`;
        
        const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
        await sendTemplatedEmail(
          'email-change-validation',
          newEmail.toLowerCase(),
          {
            userName: user.name || user.email,
            newEmail: newEmail.toLowerCase(),
            validationUrl: validationUrl,
            expiryTime: expiryTime
          },
          settings
        );
      } catch (emailError) {
        // Don't fail the request if email fails, but log it
        console.warn('Failed to send email change validation email:', emailError.message);
      }
    }
    
    // Log activity
    const { logActivity, ActivityType } = require('../services/activityLogger');
    await logActivity({
      type: ActivityType.EMAIL_CHANGE_REQUESTED,
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: `Requested email change to ${newEmail.toLowerCase()}`,
      details: {
        oldEmail: user.email,
        newEmail: newEmail.toLowerCase()
      },
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json({ 
      message: 'Validation email sent to new email address. Please check your email and click the validation link.',
      pendingEmail: newEmail.toLowerCase()
    });
  } catch (error) {
    console.error('Request email change error:', error);
    console.error('Error stack:', error.stack);
    // Provide more detailed error message for debugging
    const errorMessage = error.message || 'An error occurred while requesting email change';
    res.status(500).json({ 
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Validate email change
router.post('/validate-email-change', async (req, res) => {
  try {
    const { token } = req.body;
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
    
    const oldEmail = user.email;
    const newEmail = user.pendingEmail;
    
    // Update email
    user.email = newEmail;
    user.pendingEmail = null;
    user.emailChangeToken = null;
    user.emailChangeExpires = null;
    await user.save();
    
    // Get settings for email configuration
    const settings = await Settings.getSettings();
    
    // Send confirmation email to new email address
    const { isEmailEnabled } = require('../utils/emailService');
    if (isEmailEnabled(settings)) {
      try {
        const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
        await sendTemplatedEmail(
          'email-change-confirmed',
          newEmail,
          {
            userName: user.name || newEmail,
            newEmail: newEmail,
            oldEmail: oldEmail
          },
          settings
        );
      } catch (emailError) {
        // Don't fail the validation if email fails
        console.warn('Failed to send email change confirmation email:', emailError.message);
      }
    }
    
    // Log activity
    const { logActivity, ActivityType } = require('../services/activityLogger');
    await logActivity({
      type: ActivityType.EMAIL_CHANGE_VALIDATED,
      userId: user.id,
      userEmail: newEmail,
      userRole: user.role,
      action: `Email changed from ${oldEmail} to ${newEmail}`,
      details: {
        oldEmail: oldEmail,
        newEmail: newEmail
      },
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json({ 
      message: 'Email change validated successfully. Please login with your new email address.',
      newEmail: newEmail
    });
  } catch (error) {
    console.error('Validate email change error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Reset own 2FA (user can reset their own 2FA)
router.post('/reset-2fa', auth, async (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ message: 'Password is required to reset 2FA' });
    }
    
    const user = await User.findByPk(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Verify password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid password' });
    }
    
    // Reset 2FA
    user.twoFactorSecret = null;
    user.twoFactorEnabled = false;
    user.twoFactorVerified = false;
    await user.save();
    
    const userObj = user.toSafeObject ? user.toSafeObject() : user.toJSON();
    delete userObj.password;
    delete userObj.twoFactorSecret;
    
    res.json({ 
      message: '2FA reset successfully. You will need to set it up again on next login if 2FA is required.',
      user: userObj
    });
  } catch (error) {
    console.error('Reset 2FA error:', error);
    res.status(500).json({ message: error.message });
  }
});

// Delete avatar
router.delete('/avatar', auth, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Delete avatar file if exists
    if (user.avatar) {
      const avatarPath = path.join(avatarsDir, path.basename(user.avatar));
      if (fs.existsSync(avatarPath)) {
        fs.unlinkSync(avatarPath);
      }
    }
    
    // Clear avatar field
    user.avatar = null;
    await user.save();
    
    const userObj = user.toSafeObject ? user.toSafeObject() : user.toJSON();
    delete userObj.password;
    
    res.json({ message: 'Avatar deleted successfully', user: userObj });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

