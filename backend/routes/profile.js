const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { User } = require('../models');
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
      attributes: { exclude: ['password', 'twoFactorSecret', 'resetPasswordToken', 'resetPasswordExpires'] },
      include: [{
        model: Company,
        as: 'companies',
        attributes: ['id', 'name', 'referenceNo', 'type', 'code'],
        through: { attributes: [] }
      }]
    });
    res.json(user);
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

