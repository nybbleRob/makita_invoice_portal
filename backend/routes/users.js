const express = require('express');
const { User, Company, UserCompany, Sequelize } = require('../models');
const { Op } = Sequelize;
const { canManageUsers } = require('../middleware/roleCheck');
const { canManageRole, getManageableRoles, getRoleLabel, ROLE_HIERARCHY } = require('../utils/roleHierarchy');
const auth = require('../middleware/auth');
const { redis } = require('../config/redis');
const { logActivity, ActivityType } = require('../services/activityLogger');
const router = express.Router();

// Helper function to validate UUID
const validateUUID = (id, fieldName = 'ID') => {
  // Log for debugging
  if (id === undefined || id === null) {
    console.error(`[UUID Validation] ${fieldName} is ${id}`);
    return { valid: false, error: `Invalid ${fieldName}: value is ${id}` };
  }
  
  const idString = String(id).trim();
  
  if (!idString || idString === 'undefined' || idString === 'null' || idString === '') {
    console.error(`[UUID Validation] ${fieldName} is invalid: "${idString}"`);
    return { valid: false, error: `Invalid ${fieldName}: "${idString}"` };
  }
  
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(idString)) {
    console.error(`[UUID Validation] ${fieldName} format is invalid: "${idString}"`);
    return { valid: false, error: `Invalid ${fieldName} format: "${idString}"` };
  }
  
  return { valid: true, value: idString };
};

// Get all users (users can only see users they can manage)
router.get('/', canManageUsers, async (req, res) => {
  try {
    const manageableRoles = getManageableRoles(req.user.role);
    
    // Filter by manageable roles (global admins can see all users)
    const where = manageableRoles.length === Object.keys(ROLE_HIERARCHY).length
      ? {} 
      : { role: { [Op.in]: manageableRoles } };
    
    const users = await User.findAll({
      where,
      attributes: { exclude: ['password', 'twoFactorSecret', 'resetPasswordToken', 'resetPasswordExpires'] },
      include: [
        {
          model: User,
          as: 'addedByUser',
          attributes: ['id', 'name', 'email'],
          required: false
        },
        {
          model: Company,
          as: 'companies',
          attributes: ['id', 'name', 'referenceNo', 'type'],
          through: { attributes: [] },
          required: false
        }
      ],
      order: [['createdAt', 'DESC']]
    });
    
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Bulk update user status (MUST come before /:id routes)
router.post('/bulk-status', canManageUsers, async (req, res) => {
  try {
    const { userIds, isActive } = req.body;
    
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ message: 'User IDs array is required' });
    }
    
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ message: 'isActive must be a boolean' });
    }
    
    // Validate and filter out invalid UUIDs
    const validUserIds = userIds.filter(id => {
      if (!id || id === 'undefined' || id === 'null') {
        return false;
      }
      // Basic UUID format validation (8-4-4-4-12 hex characters)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return uuidRegex.test(id);
    });
    
    if (validUserIds.length === 0) {
      return res.status(400).json({ message: 'No valid user IDs provided' });
    }
    
    // Prevent deactivating yourself
    if (isActive === false && validUserIds.includes(req.user.userId)) {
      return res.status(400).json({ message: 'You cannot deactivate your own account' });
    }
    
    // Get manageable roles
    const manageableRoles = getManageableRoles(req.user.role);
    
    // Update users (only those the current user can manage)
    const where = manageableRoles.length === Object.keys(ROLE_HIERARCHY).length
      ? { id: { [Op.in]: validUserIds } }
      : { id: { [Op.in]: validUserIds }, role: { [Op.in]: manageableRoles } };
    
    const [affectedCount] = await User.update({ isActive }, { where });
    
    res.json({
      message: `${affectedCount} user(s) ${isActive ? 'activated' : 'deactivated'} successfully`,
      modifiedCount: affectedCount
    });
  } catch (error) {
    console.error('Bulk status update error:', error);
    res.status(400).json({ message: error.message });
  }
});

// Get single user
router.get('/:id', canManageUsers, async (req, res) => {
  try {
    const userId = req.params.id;
    const validation = validateUUID(userId, 'user ID');
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }
    
    const user = await User.findByPk(userId, {
      attributes: { exclude: ['password', 'twoFactorSecret', 'resetPasswordToken', 'resetPasswordExpires'] },
      include: [
        {
          model: User,
          as: 'addedByUser',
          attributes: ['id', 'name', 'email'],
          required: false
        },
        {
          model: Company,
          as: 'companies',
          attributes: ['id', 'name', 'referenceNo', 'type'],
          through: { attributes: [] }
        }
      ]
    });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if current user can manage this user (global admins can manage all roles)
    if (!canManageRole(req.user.role, user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create user
router.post('/', canManageUsers, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    
    // Validate role - global admins can create any role including other global admins
    const manageableRoles = getManageableRoles(req.user.role);
    if (!manageableRoles.includes(role)) {
      return res.status(403).json({ 
        message: `You cannot create users with role: ${getRoleLabel(role)}` 
      });
    }
    
    // Check if user exists
    const existingUser = await User.findOne({ where: { email: email.toLowerCase().trim() } });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }
    
    // Generate temporary password if not provided
    const { generateReadableTemporaryPassword } = require('../utils/passwordGenerator');
    const tempPassword = password || generateReadableTemporaryPassword();
    const passwordWasGenerated = !password;
    
    // Extract email preferences and company assignments
    const {
      allCompanies,
      sendInvoiceEmail,
      sendInvoiceAttachment,
      sendStatementEmail,
      sendStatementAttachment,
      sendEmailAsSummary,
      companyIds
    } = req.body;
    
    // Validate email preferences
    if (sendInvoiceAttachment && !sendInvoiceEmail) {
      return res.status(400).json({ message: 'Cannot send invoice attachments without enabling invoice emails' });
    }
    if (sendStatementAttachment && !sendStatementEmail) {
      return res.status(400).json({ message: 'Cannot send statement attachments without enabling statement emails' });
    }
    if (sendEmailAsSummary && !sendInvoiceEmail && !sendStatementEmail) {
      return res.status(400).json({ message: 'Cannot send summary emails without enabling at least invoice or statement emails' });
    }
    
    // Create user
    const user = await User.create({
      name,
      email: email.toLowerCase().trim(),
      password: tempPassword,
      role,
      addedById: req.user.userId,
      mustChangePassword: passwordWasGenerated,
      allCompanies: allCompanies || false,
      sendInvoiceEmail: sendInvoiceEmail || false,
      sendInvoiceAttachment: sendInvoiceAttachment || false,
      sendStatementEmail: sendStatementEmail || false,
      sendStatementAttachment: sendStatementAttachment || false,
      sendEmailAsSummary: sendEmailAsSummary || false
    });
    
    // Assign companies if provided (for ALL user roles)
    if (companyIds && Array.isArray(companyIds) && companyIds.length > 0) {
      // Validate company IDs exist
      const companies = await Company.findAll({
        where: { id: { [Op.in]: companyIds } }
      });
      
      if (companies.length !== companyIds.length) {
        return res.status(400).json({ message: 'One or more company IDs are invalid' });
      }
      
      // Create associations
      await user.setCompanies(companies);
    }
    
    // Reload user with companies
    await user.reload({
      include: [{
        model: Company,
        as: 'companies',
        attributes: ['id', 'name', 'referenceNo', 'type'],
        through: { attributes: [] }
      }]
    });
    
    // Send welcome email if email provider is configured
    const settings = await Settings.getSettings();
    if (settings.emailProvider?.enabled || settings.smtp?.enabled) {
      try {
        const { sendEmail } = require('../utils/emailService');
        const { renderEmailTemplate } = require('../utils/emailTemplateRenderer');
        const { EmailTemplate } = require('../models');
        
        const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;
        const companyName = settings.companyName || 'eInvoice Portal';
        
        // Try to use email template, fallback to hardcoded if template not found
        try {
          const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
          await sendTemplatedEmail(
            'welcome',
            user.email,
            {
              userName: user.name,
              userEmail: user.email,
              temporaryPassword: passwordWasGenerated ? tempPassword : null
            },
            settings
          );
        } catch (templateError) {
          console.warn('Welcome email template not found, using default:', templateError.message);
          // Fallback to simple welcome email
          const { sendEmail } = require('../utils/emailService');
          await sendEmail({
            to: user.email,
            subject: `Welcome to ${companyName}`,
            html: `
              <h2>Welcome to ${companyName}!</h2>
              <p>Hello ${user.name},</p>
              <p>Your account has been created successfully. You can now access the ${companyName} portal.</p>
              ${passwordWasGenerated ? `
                <p><strong>Your temporary password:</strong> ${tempPassword}</p>
                <p>You will be required to change this password on your first login.</p>
              ` : ''}
              <p><a href="${loginUrl}" style="background-color: #066fd1; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">Login to Portal</a></p>
              <p>Best regards,<br>${companyName} Team</p>
            `,
            text: `
              Welcome to ${companyName}!
              
              Hello ${user.name},
              
              Your account has been created successfully. You can now access the ${companyName} portal.
              
              ${passwordWasGenerated ? `Your temporary password: ${tempPassword}\nYou will be required to change this password on your first login.\n` : ''}
              Login URL: ${loginUrl}
              
              Best regards,
              ${companyName} Team
            `
          }, settings);
        }
      } catch (emailError) {
        console.error('Error sending welcome email:', emailError);
        // Don't fail user creation if email fails
      }
    }
    
    // Return user without password
    const userObj = user.toSafeObject ? user.toSafeObject() : user.toJSON();
    delete userObj.password;
    
    // Include temporary password in response if it was auto-generated (so admin can share it)
    const response = { ...userObj };
    if (passwordWasGenerated) {
      response.tempPassword = tempPassword;
      response.message = 'User created successfully. Temporary password generated. User must change password on first login.';
    }
    
    // Log user creation
    await logActivity({
      type: ActivityType.USER_CREATED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Created user ${user.name} (${user.email})`,
      details: { 
        createdUserId: user.id,
        createdUserName: user.name,
        createdUserEmail: user.email,
        createdUserRole: user.role,
        allCompanies: user.allCompanies,
        passwordWasGenerated: passwordWasGenerated
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.status(201).json(response);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Toggle user active status (MUST come before /:id route)
router.put('/:id/status', canManageUsers, async (req, res) => {
  try {
    const { isActive } = req.body;
    const userId = req.params.id;
    
    // Debug logging
    console.log('[Status Update] Request params:', { id: userId, isActive });
    console.log('[Status Update] Full request:', { 
      params: req.params, 
      body: req.body, 
      user: req.user ? { userId: req.user.userId, role: req.user.role } : 'no user' 
    });
    
    // Validate userId
    const validation = validateUUID(userId, 'user ID');
    if (!validation.valid) {
      console.error('[Status Update] Validation failed:', validation.error);
      return res.status(400).json({ message: validation.error });
    }
    
    const validatedUserId = validation.value;
    
    // Validate req.user.userId exists
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    const user = await User.findByPk(validatedUserId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if current user can manage this user (global admins can manage all roles)
    if (!canManageRole(req.user.role, user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Prevent deactivating yourself
    if (user.id === req.user.userId && isActive === false) {
      return res.status(400).json({ message: 'You cannot deactivate your own account' });
    }
    
    user.isActive = isActive;
    await user.save();
    
    // Log user status change
    await logActivity({
      type: ActivityType.USER_UPDATED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `${isActive ? 'Activated' : 'Deactivated'} user ${user.name} (${user.email})`,
      details: { 
        updatedUserId: user.id,
        updatedUserName: user.name,
        updatedUserEmail: user.email,
        updatedUserRole: user.role,
        isActive: isActive
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    const userObj = user.toSafeObject ? user.toSafeObject() : user.toJSON();
    delete userObj.password;
    delete userObj.twoFactorSecret;
    delete userObj.resetPasswordToken;
    delete userObj.resetPasswordExpires;
    
    res.json({
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      user: userObj
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update user
router.put('/:id', canManageUsers, async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Debug logging
    console.log('[Update User] Request params:', { id: userId });
    console.log('[Update User] Request body:', req.body);
    console.log('[Update User] Current user:', req.user ? { userId: req.user.userId, role: req.user.role } : 'no user');
    
    // Validate userId
    const validation = validateUUID(userId, 'user ID');
    if (!validation.valid) {
      console.error('[Update User] Validation failed:', validation.error);
      return res.status(400).json({ message: validation.error });
    }
    
    const validatedUserId = validation.value;
    
    // Validate req.user.userId exists
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    const user = await User.findByPk(validatedUserId);
    
    if (!user) {
      console.error('[Update User] User not found:', validatedUserId);
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log('[Update User] Target user:', { id: user.id, name: user.name, role: user.role });
    
    // Check if current user can manage this user (global admins can manage all roles)
    const canManage = canManageRole(req.user.role, user.role);
    console.log('[Update User] Permission check:', { 
      currentRole: req.user.role, 
      targetRole: user.role, 
      canManage 
    });
    
    if (!canManage) {
      console.error('[Update User] Access denied: Cannot manage this user');
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Check role change permission - global admins can change to any role including global_admin
    if (req.body.role && req.body.role !== user.role) {
      const manageableRoles = getManageableRoles(req.user.role);
      if (!manageableRoles.includes(req.body.role)) {
        return res.status(403).json({ 
          message: `You cannot change role to: ${getRoleLabel(req.body.role)}` 
        });
      }
    }
    
    // Extract email preferences and company assignments
    const {
      allCompanies,
      sendInvoiceEmail,
      sendInvoiceAttachment,
      sendStatementEmail,
      sendStatementAttachment,
      sendEmailAsSummary,
      companyIds
    } = req.body;
    
    // Validate email preferences
    if (sendInvoiceAttachment !== undefined && sendInvoiceAttachment && 
        (sendInvoiceEmail === false || (sendInvoiceEmail === undefined && !user.sendInvoiceEmail))) {
      return res.status(400).json({ message: 'Cannot send invoice attachments without enabling invoice emails' });
    }
    if (sendStatementAttachment !== undefined && sendStatementAttachment && 
        (sendStatementEmail === false || (sendStatementEmail === undefined && !user.sendStatementEmail))) {
      return res.status(400).json({ message: 'Cannot send statement attachments without enabling statement emails' });
    }
    
    // Validate summary email preference
    if (sendEmailAsSummary !== undefined && sendEmailAsSummary && 
        ((sendInvoiceEmail === false || (sendInvoiceEmail === undefined && !user.sendInvoiceEmail)) &&
         (sendStatementEmail === false || (sendStatementEmail === undefined && !user.sendStatementEmail)))) {
      return res.status(400).json({ message: 'Cannot send summary emails without enabling at least invoice or statement emails' });
    }
    
    // Update fields
    if (req.body.name !== undefined) user.name = req.body.name;
    if (req.body.email !== undefined) user.email = req.body.email;
    if (req.body.role !== undefined) user.role = req.body.role;
    if (req.body.isActive !== undefined) user.isActive = req.body.isActive;
    if (allCompanies !== undefined) user.allCompanies = allCompanies;
    if (sendInvoiceEmail !== undefined) user.sendInvoiceEmail = sendInvoiceEmail;
    if (sendInvoiceAttachment !== undefined) user.sendInvoiceAttachment = sendInvoiceAttachment;
    if (sendStatementEmail !== undefined) user.sendStatementEmail = sendStatementEmail;
    if (sendStatementAttachment !== undefined) user.sendStatementAttachment = sendStatementAttachment;
    if (sendEmailAsSummary !== undefined) user.sendEmailAsSummary = sendEmailAsSummary;
    
    await user.save();
    
    // Log user update
    await logActivity({
      type: ActivityType.USER_UPDATED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Updated user ${user.name} (${user.email})`,
      details: { 
        updatedUserId: user.id,
        updatedUserName: user.name,
        updatedUserEmail: user.email,
        updatedUserRole: user.role,
        changes: {
          name: req.body.name !== undefined ? req.body.name : undefined,
          email: req.body.email !== undefined ? req.body.email : undefined,
          role: req.body.role !== undefined ? req.body.role : undefined,
          allCompanies: allCompanies !== undefined ? allCompanies : undefined,
          isActive: req.body.isActive !== undefined ? req.body.isActive : undefined
        }
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    // Update company assignments if provided (for ALL user roles)
    if (companyIds !== undefined) {
      if (Array.isArray(companyIds) && companyIds.length > 0) {
        // Validate company IDs exist
        const companies = await Company.findAll({
          where: { id: { [Op.in]: companyIds } }
        });
        
        if (companies.length !== companyIds.length) {
          return res.status(400).json({ message: 'One or more company IDs are invalid' });
        }
        
        // Update associations
        await user.setCompanies(companies);
      } else {
        // Clear all associations
        await user.setCompanies([]);
      }
    }
    
    // Reload user with companies
    await user.reload({
      include: [{
        model: Company,
        as: 'companies',
        attributes: ['id', 'name', 'referenceNo', 'type'],
        through: { attributes: [] }
      }]
    });
    
    // Return user without password
    const userObj = user.toSafeObject ? user.toSafeObject() : user.toJSON();
    delete userObj.password;
    
    res.json(userObj);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Set password (admin sets password for user)
router.put('/:id/password', canManageUsers, async (req, res) => {
  try {
    const userId = req.params.id;
    const validation = validateUUID(userId, 'user ID');
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }
    
    const { password } = req.body;
    
    // Password complexity validation
    if (!password || password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
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
    
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      return res.status(400).json({ message: 'Password must contain at least one symbol (!@#$%^&*()_+-=[]{};\':"|,.<>/? etc.)' });
    }
    
    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if current user can manage this user (global admins can manage all roles)
    if (!canManageRole(req.user.role, user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    user.password = password; // Will be hashed by pre-save hook
    user.mustChangePassword = false; // Clear flag when admin sets password
    await user.save();
    
    // Log password reset by admin
    await logActivity({
      type: ActivityType.PASSWORD_RESET_ADMIN,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Set password for user ${user.name} (${user.email})`,
      details: { 
        targetUserId: user.id,
        targetUserName: user.name,
        targetUserEmail: user.email
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Reset password (generates temporary password)
router.post('/:id/reset-password', canManageUsers, async (req, res) => {
  try {
    const userId = req.params.id;
    const validation = validateUUID(userId, 'user ID');
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }
    
    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if current user can manage this user (global admins can manage all roles)
    if (!canManageRole(req.user.role, user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Generate temporary password
    const { generateReadableTemporaryPassword } = require('../utils/passwordGenerator');
    const tempPassword = generateReadableTemporaryPassword();
    user.password = tempPassword; // Will be hashed by pre-save hook
    user.mustChangePassword = true; // Force password change on next login
    await user.save();
    
    // Send email with temporary password
    try {
      const Settings = require('../models/Settings');
      const { sendEmail } = require('../utils/emailService');
      const { renderEmailTemplate } = require('../utils/emailTemplateRenderer');
      const { EmailTemplate } = require('../models');
      
      const settings = await Settings.getSettings();
      const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;
      const companyName = settings.companyName || 'eInvoice Portal';
      
      // Try to use email template, fallback to hardcoded if template not found
      let emailContent;
      try {
        const template = await EmailTemplate.findOne({ where: { name: 'password-reset' } });
        if (template && template.enabled) {
          emailContent = await renderEmailTemplate('password-reset', {
            userName: user.name,
            tempPassword: tempPassword,
            loginUrl: loginUrl,
            companyName: companyName
          }, settings);
        } else {
          throw new Error('Template not found or disabled');
        }
      } catch (templateError) {
        // Fallback to hardcoded email
        emailContent = `
          Hello ${user.name},
          
          Your password has been reset by an administrator.
          
          Your temporary password: ${tempPassword}
          You will be required to change this password on your next login.
          
          Login URL: ${loginUrl}
          
          Best regards,
          ${companyName} Team
        `;
      }
      
      await sendEmail({
        to: user.email,
        subject: `Password Reset - ${companyName}`,
        html: emailContent,
        text: emailContent.replace(/<[^>]*>/g, '')
      }, settings);
    } catch (emailError) {
      console.error('Error sending password reset email:', emailError);
      // Don't fail password reset if email fails, but log it
    }
    
    // Log password reset by admin
    await logActivity({
      type: ActivityType.PASSWORD_RESET_ADMIN,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Reset password for user ${user.name} (${user.email})`,
      details: { 
        targetUserId: user.id,
        targetUserName: user.name,
        targetUserEmail: user.email,
        temporaryPasswordGenerated: true
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json({ 
      message: 'Password reset successfully. Temporary password sent to user via email.',
      tempPassword: tempPassword // Return temp password so admin can share it if needed
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete user
router.delete('/:id', canManageUsers, async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Debug logging
    console.log('[Delete User] Request params:', { id: userId });
    console.log('[Delete User] Current user:', req.user ? { userId: req.user.userId, role: req.user.role } : 'no user');
    
    const validation = validateUUID(userId, 'user ID');
    if (!validation.valid) {
      console.error('[Delete User] Validation failed:', validation.error);
      return res.status(400).json({ message: validation.error });
    }
    
    const validatedUserId = validation.value;
    
    // Validate req.user.userId exists
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    const user = await User.findByPk(validatedUserId);
    
    if (!user) {
      console.error('[Delete User] User not found:', validatedUserId);
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log('[Delete User] Target user:', { id: user.id, name: user.name, role: user.role });
    
    // Prevent deleting yourself
    if (user.id === req.user.userId) {
      console.log('[Delete User] Blocked: User trying to delete themselves');
      return res.status(400).json({ message: 'You cannot delete your own account' });
    }
    
    // Check if current user can manage this user (global admins can manage all roles)
    const canManage = canManageRole(req.user.role, user.role);
    console.log('[Delete User] Permission check:', { 
      currentRole: req.user.role, 
      targetRole: user.role, 
      canManage 
    });
    
    if (!canManage) {
      console.error('[Delete User] Access denied: Cannot manage this user');
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Store user info before deletion for logging
    const deletedUserName = user.name;
    const deletedUserEmail = user.email;
    const deletedUserRole = user.role;
    
    await user.destroy();
    console.log('[Delete User] Success: User deleted');
    
    // Log user deletion
    await logActivity({
      type: ActivityType.USER_DELETED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Deleted user ${deletedUserName} (${deletedUserEmail})`,
      details: { 
        deletedUserId: validatedUserId,
        deletedUserName: deletedUserName,
        deletedUserEmail: deletedUserEmail,
        deletedUserRole: deletedUserRole
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('[Delete User] Error:', error.message);
    console.error('[Delete User] Stack:', error.stack);
    res.status(500).json({ message: error.message });
  }
});

// Remove 2FA from user (admin only)
router.delete('/:id/two-factor', canManageUsers, async (req, res) => {
  try {
    const userId = req.params.id;
    const validation = validateUUID(userId, 'user ID');
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }
    
    // Validate req.user.userId exists
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    
    const currentUser = await User.findByPk(req.user.userId);
    if (!currentUser) {
      return res.status(404).json({ message: 'Current user not found' });
    }

    // Only global_admin and administrator can remove 2FA
    if (currentUser.role !== 'global_admin' && currentUser.role !== 'administrator') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const targetUser = await User.findByPk(userId);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if current user can manage this user (global admins can manage all roles)
    if (!canManageRole(currentUser.role, targetUser.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Remove 2FA
    targetUser.twoFactorSecret = null;
    targetUser.twoFactorEnabled = false;
    targetUser.twoFactorVerified = false;
    await targetUser.save();

    // Log 2FA removal
    await logActivity({
      type: ActivityType.TWO_FACTOR_REMOVED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Removed 2FA for user ${targetUser.name} (${targetUser.email})`,
      details: { 
        targetUserId: targetUser.id,
        targetUserName: targetUser.name,
        targetUserEmail: targetUser.email
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });

    res.json({ message: '2FA removed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get manageable roles for current user
router.get('/roles/manageable', canManageUsers, (req, res) => {
  try {
    const manageableRoles = getManageableRoles(req.user.role);
    res.json(manageableRoles.map(role => ({
      value: role,
      label: getRoleLabel(role)
    })));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get companies assigned to a user (with pagination support)
router.get('/:id/companies', canManageUsers, async (req, res) => {
  try {
    const userId = req.params.id;
    const validation = validateUUID(userId, 'user ID');
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }
    
    const { page = 1, limit = 50 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    
    // First check if user exists and get allCompanies status
    const user = await User.findByPk(userId, {
      attributes: ['id', 'name', 'role', 'allCompanies']
    });
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if current user can manage this user
    if (!canManageRole(req.user.role, user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Get total count of companies for this user
    const { UserCompany } = require('../models');
    const totalCount = await UserCompany.count({ where: { userId } });
    
    // Get paginated companies
    const userWithCompanies = await User.findByPk(userId, {
      include: [{
        model: Company,
        as: 'companies',
        attributes: ['id', 'name', 'referenceNo', 'type', 'isActive'],
        through: { attributes: [] }
      }]
    });
    
    // Apply pagination to companies array (since Sequelize doesn't paginate through associations easily)
    const allCompanies = userWithCompanies.companies || [];
    const paginatedCompanies = allCompanies.slice(offset, offset + limitNum);
    
    res.json({
      allCompanies: user.allCompanies,
      companies: paginatedCompanies,
      total: allCompanies.length,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: allCompanies.length,
        pages: Math.ceil(allCompanies.length / limitNum)
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Assign companies to a user
router.post('/:id/companies', canManageUsers, async (req, res) => {
  try {
    const userId = req.params.id;
    const validation = validateUUID(userId, 'user ID');
    if (!validation.valid) {
      return res.status(400).json({ message: validation.error });
    }
    
    const { companyIds } = req.body;
    
    if (!Array.isArray(companyIds)) {
      return res.status(400).json({ message: 'companyIds must be an array' });
    }
    
    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Check if current user can manage this user
    if (!canManageRole(req.user.role, user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Company assignment is now available for ALL user roles
    
    // Validate company IDs exist
    if (companyIds.length > 0) {
      const companies = await Company.findAll({
        where: { id: { [Op.in]: companyIds } }
      });
      
      if (companies.length !== companyIds.length) {
        return res.status(400).json({ message: 'One or more company IDs are invalid' });
      }
      
      // Set associations
      await user.setCompanies(companies);
    } else {
      // Clear all associations
      await user.setCompanies([]);
    }
    
    // Reload user with companies
    await user.reload({
      include: [{
        model: Company,
        as: 'companies',
        attributes: ['id', 'name', 'referenceNo', 'type'],
        through: { attributes: [] }
      }]
    });
    
    res.json({
      message: 'Companies assigned successfully',
      allCompanies: user.allCompanies,
      companies: user.companies || []
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

