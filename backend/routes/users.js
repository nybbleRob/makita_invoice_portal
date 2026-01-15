const express = require('express');
const multer = require('multer');
const Papa = require('papaparse');
const XLSX = require('xlsx');
const { User, Company, UserCompany, Settings, Sequelize, sequelize } = require('../models');
const { Op, QueryTypes } = Sequelize;
const { canManageUsers } = require('../middleware/roleCheck');
const { canManageRole, getManageableRoles, getRoleLabel, ROLE_HIERARCHY } = require('../utils/roleHierarchy');
const auth = require('../middleware/auth');
const { requirePermission, requireAdmin } = require('../middleware/permissions');
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
    const { page = 1, limit = 50, search = '', role: roleFilter, companyIds } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    
    const manageableRoles = getManageableRoles(req.user.role);
    
    // Filter by manageable roles (global admins can see all users)
    const where = manageableRoles.length === Object.keys(ROLE_HIERARCHY).length
      ? {} 
      : { role: { [Op.in]: manageableRoles } };
    
    // Search filter
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } }
      ];
    }
    
    // Role filter
    if (roleFilter && roleFilter !== 'all') {
      where.role = roleFilter;
    }
    
    // Company filter - if provided, find users associated with these companies
    let userIdsFromCompanyFilter = null;
    if (companyIds) {
      const companyIdArray = companyIds.split(',').filter(id => id);
      if (companyIdArray.length > 0) {
        const usersWithCompanies = await User.findAll({
          attributes: ['id'],
          include: [{
            model: Company,
            as: 'companies',
            where: { id: { [Op.in]: companyIdArray } },
            attributes: [],
            through: { attributes: [] }
          }]
        });
        userIdsFromCompanyFilter = usersWithCompanies.map(u => u.id);
        
        // If no users found with these companies, return empty result
        if (userIdsFromCompanyFilter.length === 0) {
          return res.json({
            users: [],
            pagination: {
              total: 0,
              page: pageNum,
              limit: limitNum,
              pages: 0
            }
          });
        }
        
        where.id = { [Op.in]: userIdsFromCompanyFilter };
      }
    }
    
    // Get users with company count (much faster than loading all company data)
    const { count, rows: users } = await User.findAndCountAll({
      where,
      attributes: { 
        exclude: ['password', 'twoFactorSecret', 'resetPasswordToken', 'resetPasswordExpires', 'emailChangeToken'],
        include: [
          // Add company count as a subquery
          [
            sequelize.literal(`(
              SELECT COUNT(*) FROM user_companies 
              WHERE user_companies."userId" = "User"."id"
            )`),
            'companyCount'
          ]
        ]
      },
      include: [
        {
          model: User,
          as: 'addedByUser',
          attributes: ['id', 'name', 'email'],
          required: false
        }
        // Don't include companies here - we'll use companyCount instead
      ],
      order: [['createdAt', 'DESC']],
      limit: limitNum,
      offset: offset,
      distinct: true
    });
    
    // Transform users to include companies array with just the count for frontend compatibility
    const usersWithCompanyInfo = users.map(user => {
      const userData = user.toJSON();
      // Create a fake companies array with the correct length for frontend compatibility
      const companyCount = parseInt(userData.companyCount) || 0;
      userData.companies = Array(companyCount).fill({ id: null, name: '', referenceNo: '', type: '' });
      delete userData.companyCount;
      return userData;
    });
    
    res.json({
      users: usersWithCompanyInfo,
      pagination: {
        total: count,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(count / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
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

// Get manageable roles for current user
// MUST be defined BEFORE /:id route to avoid "roles" being treated as a UUID
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

/**
 * Export users to CSV/XLS
 * GET /api/users/export?format=csv|xlsx
 * MUST be defined BEFORE /:id route to avoid "export" being treated as a UUID
 */
router.get('/export', canManageUsers, async (req, res) => {
  try {
    const format = (req.query.format || 'csv').toLowerCase();
    if (format !== 'csv' && format !== 'xls' && format !== 'xlsx') {
      return res.status(400).json({ message: 'Invalid format. Use csv, xls, or xlsx' });
    }

    // Get manageable roles
    const manageableRoles = getManageableRoles(req.user.role);
    
    // Filter by manageable roles (global admins can see all users)
    const where = manageableRoles.length === Object.keys(ROLE_HIERARCHY).length
      ? {} 
      : { role: { [Op.in]: manageableRoles } };

    // Get all users with companies
    const users = await User.findAll({
      where,
      attributes: { exclude: ['password', 'twoFactorSecret', 'resetPasswordToken', 'resetPasswordExpires', 'emailChangeToken'] },
      include: [
        {
          model: Company,
          as: 'companies',
          attributes: ['id', 'name', 'referenceNo'],
          through: { attributes: [] },
          required: false
        }
      ],
      order: [['name', 'ASC']]
    });

    // Format data for export
    const exportData = users.map(user => {
      const companyAccountNumbers = user.companies
        ? user.companies.map(c => c.referenceNo).filter(refNo => refNo !== null && refNo !== undefined).join(', ')
        : '';

      return {
        id: user.id || '',
        name: user.name || '',
        email: user.email || '',
        role: user.role || '',
        active: user.isActive ? 'TRUE' : 'FALSE',
        all_companies: user.allCompanies ? 'TRUE' : 'FALSE',
        company_account_numbers: companyAccountNumbers,
        send_invoice_email: user.sendInvoiceEmail ? 'TRUE' : 'FALSE',
        send_invoice_attachment: user.sendInvoiceAttachment ? 'TRUE' : 'FALSE',
        send_statement_email: user.sendStatementEmail ? 'TRUE' : 'FALSE',
        send_statement_attachment: user.sendStatementAttachment ? 'TRUE' : 'FALSE',
        send_email_as_summary: user.sendEmailAsSummary ? 'TRUE' : 'FALSE',
        send_import_summary_report: user.sendImportSummaryReport ? 'TRUE' : 'FALSE'
      };
    });

    if (format === 'csv') {
      // Generate CSV using Papa.parse
      const csv = Papa.unparse(exportData, {
        header: true,
        columns: ['id', 'name', 'email', 'role', 'active', 'all_companies', 'company_account_numbers', 'send_invoice_email', 'send_invoice_attachment', 'send_statement_email', 'send_statement_attachment', 'send_email_as_summary', 'send_import_summary_report']
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="users-export-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } else {
      // Generate XLS/XLSX using XLSX library
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Users');
      
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: format === 'xls' ? 'xls' : 'xlsx' });
      
      res.setHeader('Content-Type', format === 'xls' ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="users-export-${new Date().toISOString().split('T')[0]}.${format}"`);
      res.send(buffer);
    }

    // Log export activity (fire-and-forget)
    logActivity({
      type: ActivityType.USERS_EXPORTED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Exported ${users.length} users to ${format.toUpperCase()}`,
      details: {
        format: format,
        userCount: users.length
      },
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    }).catch(err => console.error('Error logging export activity:', err));
  } catch (error) {
    console.error('Error exporting users:', error);
    res.status(500).json({ message: error.message });
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
      attributes: { exclude: ['password', 'twoFactorSecret', 'resetPasswordToken', 'resetPasswordExpires', 'emailChangeToken'] },
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
    
    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ message: 'Name is required' });
    }
    
    // Validate name length
    const trimmedName = name.trim();
    if (trimmedName.length > 255) {
      return res.status(400).json({ message: 'Name must be 255 characters or less' });
    }
    
    if (!email || typeof email !== 'string' || email.trim() === '') {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    // Validate email format and length
    const trimmedEmail = email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }
    if (trimmedEmail.length > 255) {
      return res.status(400).json({ message: 'Email must be 255 characters or less' });
    }
    
    if (!role || typeof role !== 'string') {
      return res.status(400).json({ message: 'Role is required' });
    }
    
    // Validate role - global admins can create any role including other global admins
    const manageableRoles = getManageableRoles(req.user.role);
    if (!manageableRoles.includes(role)) {
      return res.status(403).json({ 
        message: `You cannot create users with role: ${getRoleLabel(role)}` 
      });
    }
    
    // Validate addedById (req.user.userId should exist from auth middleware, but double-check)
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    const addedByIdValidation = validateUUID(req.user.userId, 'addedById');
    if (!addedByIdValidation.valid) {
      return res.status(400).json({ message: `Invalid user ID: ${addedByIdValidation.error}` });
    }
    
    // Generate temporary password if not provided
    const { generateReadableTemporaryPassword } = require('../utils/passwordGenerator');
    const tempPassword = password || generateReadableTemporaryPassword();
    const passwordWasGenerated = !password;
    
    // Validate password strength if provided
    if (password) {
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
    }
    
    // Extract email preferences and company assignments
    const {
      allCompanies,
      sendInvoiceEmail,
      sendInvoiceAttachment,
      sendStatementEmail,
      sendStatementAttachment,
      sendEmailAsSummary,
      sendImportSummaryReport,
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
    
    // Validate company IDs BEFORE creating user (to avoid orphaned users on validation failure)
    let validatedCompanies = [];
    if (companyIds && Array.isArray(companyIds) && companyIds.length > 0) {
      // Validate all company IDs are valid UUIDs
      const invalidCompanyIds = [];
      for (const companyId of companyIds) {
        const uuidValidation = validateUUID(companyId, 'companyId');
        if (!uuidValidation.valid) {
          invalidCompanyIds.push(companyId);
        }
      }
      if (invalidCompanyIds.length > 0) {
        return res.status(400).json({ 
          message: `Invalid company ID format: ${invalidCompanyIds.join(', ')}` 
        });
      }
      
      // Find companies, excluding soft-deleted ones
      const whereClause = { 
        id: { [Op.in]: companyIds }
      };
      // Check if Company model has deletedAt field (soft deletes)
      const companyAttributes = Company.rawAttributes;
      if (companyAttributes && companyAttributes.deletedAt) {
        whereClause.deletedAt = null;
      }
      
      validatedCompanies = await Company.findAll({
        where: whereClause
      });
      
      if (validatedCompanies.length !== companyIds.length) {
        return res.status(400).json({ 
          message: 'One or more company IDs are invalid or have been deleted' 
        });
      }
    }
    
    // Wrap all database operations in a transaction for atomicity
    const transaction = await sequelize.transaction();
    
    try {
      // Create user (removed duplicate email check - let database unique constraint handle it)
      const user = await User.create({
        name: trimmedName,
        email: trimmedEmail.toLowerCase(),
        password: tempPassword,
        role,
        addedById: req.user.userId,
        mustChangePassword: passwordWasGenerated,
        allCompanies: Boolean(allCompanies),
        sendInvoiceEmail: Boolean(sendInvoiceEmail),
        sendInvoiceAttachment: Boolean(sendInvoiceAttachment),
        sendStatementEmail: Boolean(sendStatementEmail),
        sendStatementAttachment: Boolean(sendStatementAttachment),
        sendEmailAsSummary: Boolean(sendEmailAsSummary),
        sendImportSummaryReport: Boolean(sendImportSummaryReport)
      }, { transaction });
      
      // Assign companies if provided (for ALL user roles) - already validated above
      if (validatedCompanies.length > 0) {
        await user.setCompanies(validatedCompanies, { transaction });
      }
      
      // Reload user with companies
      await user.reload({
        include: [{
          model: Company,
          as: 'companies',
          attributes: ['id', 'name', 'referenceNo', 'type'],
          through: { attributes: [] }
        }],
        transaction
      });
      
      // Commit transaction - all database operations succeeded
      await transaction.commit();
      
      // Log user creation (outside transaction - uses Redis, not database)
      try {
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
      } catch (logError) {
        console.error('Error logging user creation activity:', logError);
        // Don't fail user creation if logging fails
      }
      
      // Send welcome email if email provider is configured (outside transaction - email is not critical)
      const settings = await Settings.getSettings();
      const { isEmailEnabled } = require('../utils/emailService');
      if (isEmailEnabled(settings)) {
        try {
          const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
          await sendTemplatedEmail(
            'welcome',
            user.email,
            {
              userName: user.name,
              userEmail: user.email,
              tempPassword: passwordWasGenerated ? tempPassword : null
            },
            settings,
            {
              ipAddress: req.ip,
              userAgent: req.get('user-agent'),
              userId: req.user.userId
            }
          );
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
      
      res.status(201).json(response);
    } catch (dbError) {
      // Rollback transaction on any error
      await transaction.rollback();
      throw dbError; // Re-throw to be handled by outer catch block
    }
  } catch (error) {
    console.error('Error creating user:', error);
    
    // Handle Sequelize validation errors
    if (error.name === 'SequelizeValidationError') {
      const validationErrors = error.errors.map(e => e.message).join(', ');
      const fieldErrors = error.errors.map(e => ({ 
        field: e.path || 'unknown', 
        message: e.message 
      }));
      return res.status(400).json({ 
        message: `Validation error: ${validationErrors}`,
        errors: fieldErrors
      });
    }
    
    // Handle unique constraint violations (duplicate email) - race condition protection
    if (error.name === 'SequelizeUniqueConstraintError') {
      if (error.errors && error.errors.some(e => e.path === 'email')) {
        return res.status(400).json({ 
          message: 'User with this email already exists',
          field: 'email'
        });
      }
      // Handle other unique constraint violations
      const constraintFields = error.errors.map(e => e.path).filter(Boolean);
      return res.status(400).json({ 
        message: `Duplicate value for field(s): ${constraintFields.join(', ')}`,
        fields: constraintFields
      });
    }
    
    // Handle foreign key constraint violations
    if (error.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(400).json({ 
        message: 'Invalid reference: One or more related records do not exist',
        details: error.message
      });
    }
    
    // Handle other Sequelize errors
    if (error.name && error.name.startsWith('Sequelize')) {
      return res.status(400).json({ 
        message: error.message || 'Database error occurred while creating user',
        errorType: error.name
      });
    }
    
    // Generic error
    res.status(400).json({ 
      message: error.message || 'An error occurred while creating the user'
    });
  }
});

// Unlock user account (MUST come before /:id route)
router.post('/:id/unlock', canManageUsers, async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Validate userId
    const validation = validateUUID(userId, 'user ID');
    if (!validation.valid) {
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
    
    // Check if current user can manage this user
    if (!canManageRole(req.user.role, user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Check if account is actually locked
    const { checkAccountLockout, unlockAccount } = require('../utils/accountLockout');
    const lockoutStatus = await checkAccountLockout(user);
    
    if (!lockoutStatus.isLocked) {
      return res.status(400).json({ message: 'Account is not locked' });
    }
    
    // Unlock the account
    await unlockAccount(user, req.user.userId);
    
    // Log unlock action
    await logActivity({
      type: ActivityType.ACCOUNT_UNLOCKED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Unlocked account for user ${user.name} (${user.email})`,
      details: { 
        unlockedUserId: user.id,
        unlockedUserName: user.name,
        unlockedUserEmail: user.email,
        previousLockReason: user.lockReason,
        previousLockedUntil: lockoutStatus.lockedUntil ? lockoutStatus.lockedUntil.toISOString() : null
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    // Reload user to get fresh data
    await user.reload();
    
    const userObj = user.toSafeObject ? user.toSafeObject() : user.toJSON();
    delete userObj.password;
    delete userObj.twoFactorSecret;
    delete userObj.resetPasswordToken;
    delete userObj.resetPasswordExpires;
    
    res.json({
      message: 'Account unlocked successfully',
      user: userObj
    });
  } catch (error) {
    console.error('Error unlocking account:', error);
    res.status(500).json({ message: error.message || 'An error occurred while unlocking the account' });
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
      sendImportSummaryReport,
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
    
    // Track email change for notification
    const oldEmail = user.email;
    let emailChanged = false;
    
    // Update fields
    if (req.body.name !== undefined) user.name = req.body.name;
    if (req.body.email !== undefined) {
      const newEmail = req.body.email.trim().toLowerCase();
      
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(newEmail)) {
        return res.status(400).json({ message: 'Invalid email format' });
      }
      
      // Check if email is the same
      if (user.email.toLowerCase() === newEmail) {
        // Email unchanged, no need to update
      } else {
        // Check if email is already in use by another user
        const existingUser = await User.findOne({ where: { email: newEmail } });
        if (existingUser && existingUser.id !== user.id) {
          return res.status(400).json({ message: 'Email is already in use' });
        }
        
        user.email = newEmail;
        emailChanged = true;
        
        // Clear any pending email change tokens
        user.pendingEmail = null;
        user.emailChangeToken = null;
        user.emailChangeExpires = null;
      }
    }
    if (req.body.role !== undefined) user.role = req.body.role;
    if (req.body.isActive !== undefined) user.isActive = req.body.isActive;
    if (allCompanies !== undefined) user.allCompanies = allCompanies;
    if (sendInvoiceEmail !== undefined) user.sendInvoiceEmail = sendInvoiceEmail;
    if (sendInvoiceAttachment !== undefined) user.sendInvoiceAttachment = sendInvoiceAttachment;
    if (sendStatementEmail !== undefined) user.sendStatementEmail = sendStatementEmail;
    if (sendStatementAttachment !== undefined) user.sendStatementAttachment = sendStatementAttachment;
    if (sendEmailAsSummary !== undefined) user.sendEmailAsSummary = sendEmailAsSummary;
    if (sendImportSummaryReport !== undefined) user.sendImportSummaryReport = sendImportSummaryReport;
    
    await user.save();
    
    // Send email notification if email was changed by admin
    if (emailChanged) {
      try {
        const Settings = require('../models/Settings');
        const settings = await Settings.getSettings();
        
        const { isEmailEnabled } = require('../utils/emailService');
        if (isEmailEnabled(settings)) {
          const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
          await sendTemplatedEmail(
            'email-change-admin',
            user.email,
            {
              userName: user.name || user.email,
              newEmail: user.email,
              oldEmail: oldEmail,
              changedBy: req.user.email || 'Administrator'
            },
            settings
          );
        }
      } catch (emailError) {
        // Don't fail the update if email fails
        console.warn('Failed to send email change notification:', emailError.message);
      }
      
      // Log email change activity
      await logActivity({
        type: ActivityType.EMAIL_CHANGE_ADMIN,
        userId: req.user.userId,
        userEmail: req.user.email,
        userRole: req.user.role,
        action: `Changed email for user ${user.name} from ${oldEmail} to ${user.email}`,
        details: {
          targetUserId: user.id,
          targetUserName: user.name,
          oldEmail: oldEmail,
          newEmail: user.email
        },
        companyId: null,
        companyName: null,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent')
      });
    }
    
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
      const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
      
      const settings = await Settings.getSettings();
      
      await sendTemplatedEmail(
        'password-reset',
        user.email,
        {
          userName: user.name,
          tempPassword: tempPassword,
          resetUrl: require('../utils/urlConfig').getLoginUrl(),
          expiryTime: '24 hours'
        },
        settings,
        {
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          userId: req.user.userId
        }
      );
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

// Delete user - GA + Admin only
router.delete('/:id', requirePermission('USERS_DELETE'), async (req, res) => {
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
    
    // Only Global Admins can delete Administrators
    if (user.role === 'administrator' && req.user.role !== 'global_admin') {
      console.error('[Delete User] Access denied: Only Global Administrators can delete Administrators');
      return res.status(403).json({ message: 'Only Global Administrators can delete Administrators' });
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

// Configure multer for file uploads (for import)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowedMimes.includes(file.mimetype) || 
        file.originalname.endsWith('.csv') || 
        file.originalname.endsWith('.xls') || 
        file.originalname.endsWith('.xlsx')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only CSV, XLS, and XLSX files are allowed.'));
    }
  }
});

/**
 * Parse and validate import file (CSV, XLS, XLSX)
 * Returns array of row objects
 */
async function parseUserImportFile(file) {
  let rows = [];
  const fileExtension = file.originalname.split('.').pop().toLowerCase();

  if (fileExtension === 'csv') {
    const csvText = file.buffer.toString('utf8');
    const result = Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim()
    });
    
    if (result.errors.length > 0) {
      throw new Error(`CSV parsing errors: ${result.errors.map(e => e.message).join(', ')}`);
    }
    
    rows = result.data;
  } else if (fileExtension === 'xls' || fileExtension === 'xlsx') {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json(worksheet, { 
      defval: null,
      raw: false
    });
  } else {
    throw new Error('Unsupported file format. Use CSV, XLS, or XLSX.');
  }

  if (!rows || rows.length === 0) {
    throw new Error('File is empty or contains no data');
  }

  return rows;
}

/**
 * Parse boolean value from various formats
 */
function parseBooleanValue(value) {
  if (value === undefined || value === null || value === '') return false;
  const v = String(value).trim().toUpperCase();
  return v === 'TRUE' || v === 'YES' || v === 'Y' || v === '1';
}

/**
 * Process a single user row and return preview data
 */
// Helper function to check if user data has actually changed
function hasUserDataChanged(existingUser, newData, newEmail, newCompanyIds = null) {
  // Compare basic fields
  if ((existingUser.name || '').trim() !== (newData.name || '').trim()) {
    return true;
  }
  if (existingUser.role !== newData.role) {
    return true;
  }
  if (existingUser.isActive !== newData.isActive) {
    return true;
  }
  if (existingUser.allCompanies !== newData.allCompanies) {
    return true;
  }
  
  // Compare email (handle case sensitivity)
  const existingEmail = (existingUser.email || '').toLowerCase();
  const newEmailLower = (newEmail || '').toLowerCase();
  if (existingEmail !== newEmailLower) {
    return true;
  }
  
  // Compare email notification preferences
  if (existingUser.sendInvoiceEmail !== newData.sendInvoiceEmail) {
    return true;
  }
  if (existingUser.sendInvoiceAttachment !== newData.sendInvoiceAttachment) {
    return true;
  }
  if (existingUser.sendStatementEmail !== newData.sendStatementEmail) {
    return true;
  }
  if (existingUser.sendStatementAttachment !== newData.sendStatementAttachment) {
    return true;
  }
  if (existingUser.sendEmailAsSummary !== newData.sendEmailAsSummary) {
    return true;
  }
  if (existingUser.sendImportSummaryReport !== newData.sendImportSummaryReport) {
    return true;
  }
  
  // Compare company assignments if provided
  if (newCompanyIds !== null) {
    // Get existing company IDs
    const existingCompanyIds = existingUser.companies 
      ? existingUser.companies.map(c => c.id).sort()
      : [];
    const newCompanyIdsSorted = [...newCompanyIds].sort();
    
    // Compare arrays
    if (existingCompanyIds.length !== newCompanyIdsSorted.length) {
      return true;
    }
    for (let i = 0; i < existingCompanyIds.length; i++) {
      if (existingCompanyIds[i] !== newCompanyIdsSorted[i]) {
        return true;
      }
    }
  }
  
  return false;
}

async function processUserRowForPreview(row, rowNum, existingUsersMap, existingUsersByIdMap, existingCompaniesMap, manageableRoles) {
  const result = {
    rowNum,
    status: 'valid',
    errors: [],
    warnings: [],
    action: 'create',
    data: {},
    existingData: null,
    emailChangeRequired: false,
    companyAccountNumbers: []
  };

  try {
    // Extract fields from row (support multiple column name formats)
    const userId = row['id'] || row['ID'] || row['Id'] || row['user_id'] || null;
    const name = row['name'] || row['Name'] || row['NAME'] || '';
    const email = row['email'] || row['Email'] || row['EMAIL'] || '';
    const role = (row['role'] || row['Role'] || row['ROLE'] || 'external_user').toLowerCase();
    const active = parseBooleanValue(row['active'] || row['Active'] || row['ACTIVE'] || row['isActive'] || 'TRUE');
    const allCompanies = parseBooleanValue(row['all_companies'] || row['allCompanies'] || row['All Companies'] || 'FALSE');
    const companyAccountNumbersRaw = row['company_account_numbers'] || row['companyAccountNumbers'] || row['Company Account Numbers'] || row['companies'] || '';
    
    // Email notification preferences
    const sendInvoiceEmail = parseBooleanValue(row['send_invoice_email'] || row['sendInvoiceEmail'] || 'FALSE');
    const sendInvoiceAttachment = parseBooleanValue(row['send_invoice_attachment'] || row['sendInvoiceAttachment'] || 'FALSE');
    const sendStatementEmail = parseBooleanValue(row['send_statement_email'] || row['sendStatementEmail'] || 'FALSE');
    const sendStatementAttachment = parseBooleanValue(row['send_statement_attachment'] || row['sendStatementAttachment'] || 'FALSE');
    const sendEmailAsSummary = parseBooleanValue(row['send_email_as_summary'] || row['sendEmailAsSummary'] || 'FALSE');
    const sendImportSummaryReport = parseBooleanValue(row['send_import_summary_report'] || row['sendImportSummaryReport'] || 'FALSE');

    // Validate required fields
    if (!name || !name.trim()) {
      result.status = 'error';
      result.errors.push('Name is required');
      return result;
    }

    if (!email || !email.trim()) {
      result.status = 'error';
      result.errors.push('Email is required');
      return result;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const trimmedEmail = email.trim().toLowerCase();
    if (!emailRegex.test(trimmedEmail)) {
      result.status = 'error';
      result.errors.push(`Invalid email format: ${email}`);
      return result;
    }

    // Validate role
    const validRoles = ['global_admin', 'administrator', 'manager', 'credit_senior', 'credit_controller', 'external_user', 'notification_contact'];
    if (!validRoles.includes(role)) {
      result.status = 'error';
      result.errors.push(`Invalid role: ${role}. Valid roles: ${validRoles.join(', ')}`);
      return result;
    }

    // Check if current user can manage this role
    if (!manageableRoles.includes(role)) {
      result.status = 'error';
      result.errors.push(`You cannot import users with role: ${getRoleLabel(role)}`);
      return result;
    }

    // Validate email preferences
    if (sendInvoiceAttachment && !sendInvoiceEmail) {
      result.warnings.push('Invoice attachment enabled without invoice email - will be ignored');
    }
    if (sendStatementAttachment && !sendStatementEmail) {
      result.warnings.push('Statement attachment enabled without statement email - will be ignored');
    }
    if (sendEmailAsSummary && !sendInvoiceEmail && !sendStatementEmail) {
      result.warnings.push('Email summary enabled without any email types - will be ignored');
    }

    // Parse company account numbers
    const companyAccountNumbers = [];
    if (companyAccountNumbersRaw && !allCompanies) {
      const parts = String(companyAccountNumbersRaw).split(',').map(s => s.trim()).filter(s => s);
      for (const part of parts) {
        const refNo = parseInt(part);
        if (!isNaN(refNo)) {
          companyAccountNumbers.push(refNo);
          // Check if company exists
          if (!existingCompaniesMap.has(refNo)) {
            result.warnings.push(`Company with account number ${refNo} not found`);
          }
        } else {
          result.warnings.push(`Invalid company account number: ${part}`);
        }
      }
    }

    // Determine if this is a create or update
    let existingUser = null;
    let matchMethod = null;

    // First try to match by ID if provided
    if (userId) {
      const validation = validateUUID(userId, 'user ID');
      if (validation.valid) {
        existingUser = existingUsersByIdMap.get(validation.value);
        if (existingUser) {
          matchMethod = 'ID';
        }
      } else {
        result.warnings.push(`Invalid user ID format "${userId}". Attempting to match by email.`);
      }
    }

    // Fall back to email matching
    if (!existingUser) {
      existingUser = existingUsersMap.get(trimmedEmail);
      if (existingUser) {
        matchMethod = 'Email';
      }
    }

    // Build user data
    const userData = {
      name: name.trim(),
      email: trimmedEmail,
      role: role,
      isActive: active,
      allCompanies: allCompanies,
      sendInvoiceEmail: sendInvoiceEmail,
      sendInvoiceAttachment: sendInvoiceEmail ? sendInvoiceAttachment : false,
      sendStatementEmail: sendStatementEmail,
      sendStatementAttachment: sendStatementEmail ? sendStatementAttachment : false,
      sendEmailAsSummary: (sendInvoiceEmail || sendStatementEmail) ? sendEmailAsSummary : false,
      sendImportSummaryReport: sendImportSummaryReport
    };

    result.data = userData;
    result.companyAccountNumbers = companyAccountNumbers;

    if (existingUser) {
      // Get company IDs for comparison
      const companyIds = [];
      if (!allCompanies && companyAccountNumbers.length > 0) {
        for (const refNo of companyAccountNumbers) {
          const company = existingCompaniesMap.get(refNo);
          if (company) {
            companyIds.push(company.id);
          }
        }
      }
      
      // Check if data has actually changed
      const hasChanged = hasUserDataChanged(existingUser, userData, trimmedEmail, companyIds.length > 0 ? companyIds : null);
      
      if (hasChanged) {
        result.action = `update (matched by ${matchMethod})`;
      } else {
        result.action = 'no_change';
      }
      
      result.existingData = {
        id: existingUser.id,
        name: existingUser.name,
        email: existingUser.email,
        role: existingUser.role,
        isActive: existingUser.isActive,
        allCompanies: existingUser.allCompanies
      };

      // Check if email is being changed
      if (existingUser.email.toLowerCase() !== trimmedEmail) {
        result.emailChangeRequired = true;
        result.warnings.push(`Email will change from ${existingUser.email} to ${trimmedEmail}. User will receive validation email.`);
      }

      // Check if role is being changed
      if (existingUser.role !== role) {
        result.warnings.push(`Role will change from ${getRoleLabel(existingUser.role)} to ${getRoleLabel(role)}`);
      }
    } else {
      result.action = 'create';
      // Check if email already exists (duplicate in file)
      const emailCheck = existingUsersMap.get(trimmedEmail);
      if (emailCheck) {
        result.status = 'error';
        result.errors.push(`Email ${trimmedEmail} already exists in the system`);
        return result;
      }
    }

    if (result.warnings.length > 0 && result.status !== 'error') {
      result.status = 'warning';
    }

  } catch (error) {
    result.status = 'error';
    result.errors.push(error.message);
  }

  return result;
}

/**
 * Preview user import - parses file and returns preview without importing
 * POST /api/users/import/preview
 */
router.post('/import/preview', canManageUsers, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Parse file
    const file = req.file;
    const fileExtension = file.originalname.split('.').pop().toLowerCase();
    let columnNames = [];

    // Get column names for display
    if (fileExtension === 'csv') {
      const csvText = file.buffer.toString('utf8');
      const result = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: false,
        transformHeader: (header) => header.trim()
      });
      columnNames = result.meta.fields || [];
    } else if (fileExtension === 'xls' || fileExtension === 'xlsx') {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        const cell = worksheet[cellAddress];
        if (cell && cell.v) {
          columnNames.push(cell.v.toString().trim());
        }
      }
    }

    const rows = await parseUserImportFile(file);

    // Get all existing users for matching (with companies for comparison)
    const existingUsers = await User.findAll({
      attributes: ['id', 'name', 'email', 'role', 'isActive', 'allCompanies', 
        'sendInvoiceEmail', 'sendInvoiceAttachment', 'sendStatementEmail', 
        'sendStatementAttachment', 'sendEmailAsSummary', 'sendImportSummaryReport'],
      include: [{
        model: Company,
        as: 'companies',
        attributes: ['id'],
        through: { attributes: [] },
        required: false
      }]
    });

    const existingUsersMap = new Map(); // by email
    const existingUsersByIdMap = new Map(); // by ID
    existingUsers.forEach(user => {
      if (user.email) {
        existingUsersMap.set(user.email.toLowerCase(), user);
      }
      existingUsersByIdMap.set(user.id, user);
    });

    // Get all existing companies for company assignment lookup
    const existingCompanies = await Company.findAll({
      attributes: ['id', 'name', 'referenceNo']
    });
    const existingCompaniesMap = new Map();
    existingCompanies.forEach(company => {
      if (company.referenceNo) {
        existingCompaniesMap.set(company.referenceNo, company);
      }
    });

    // Get manageable roles for current user
    const manageableRoles = getManageableRoles(req.user.role);

    // Process each row for preview
    const previewData = [];
    const summary = {
      total: rows.length,
      toCreate: 0,
      toUpdate: 0,
      noChange: 0,
      errors: 0,
      warnings: 0,
      emailChanges: 0
    };

    // Track emails in this import to detect duplicates
    const importEmails = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Account for header row

      const processed = await processUserRowForPreview(
        row, 
        rowNum, 
        existingUsersMap, 
        existingUsersByIdMap, 
        existingCompaniesMap, 
        manageableRoles
      );

      // Check for duplicate emails within the import file
      const rowEmail = processed.data.email;
      if (rowEmail) {
        if (importEmails.has(rowEmail)) {
          processed.status = 'error';
          processed.errors.push(`Duplicate email in import file: ${rowEmail}`);
        } else {
          importEmails.add(rowEmail);
        }
      }

      previewData.push(processed);

      // Update summary
      if (processed.status === 'error') {
        summary.errors++;
      } else {
        if (processed.action === 'create') {
          summary.toCreate++;
        } else if (processed.action === 'update' || processed.action.startsWith('update')) {
          summary.toUpdate++;
        } else if (processed.action === 'no_change') {
          summary.noChange++;
        }
        if (processed.status === 'warning') {
          summary.warnings++;
        }
        if (processed.emailChangeRequired) {
          summary.emailChanges++;
        }
      }
    }

    // Column mapping descriptions
    const columnMappings = {
      'id': 'Database ID (UUID) - Primary matching key. If provided, matches by ID first.',
      'name': 'User Name - Required',
      'email': 'Email Address - Required. Falls back to email matching if no ID.',
      'role': 'User Role - global_admin, administrator, manager, credit_senior, credit_controller, external_user, notification_contact',
      'active': 'Active Status - TRUE or FALSE',
      'all_companies': 'All Companies Access - TRUE or FALSE',
      'company_account_numbers': 'Company Account Numbers - Comma-separated list of account numbers',
      'send_invoice_email': 'Receive Invoice Emails - TRUE or FALSE',
      'send_invoice_attachment': 'Include Invoice Attachments - TRUE or FALSE',
      'send_statement_email': 'Receive Statement Emails - TRUE or FALSE',
      'send_statement_attachment': 'Include Statement Attachments - TRUE or FALSE',
      'send_email_as_summary': 'Send as Summary Email - TRUE or FALSE',
      'send_import_summary_report': 'Receive Import Summary Reports - TRUE or FALSE'
    };

    res.json({
      preview: previewData,
      summary,
      totalRows: rows.length,
      columnNames,
      columnMappings
    });

  } catch (error) {
    console.error('Error previewing user import:', error);
    res.status(400).json({ message: error.message });
  }
});

/**
 * Import users from CSV/XLS/XLSX file
 * POST /api/users/import
 * 
 * Creates new users or updates existing ones.
 * - Matches by ID first (if provided), then falls back to email
 * - New users get a welcome email with temporary password
 * - Email changes trigger validation flow (user must verify new email)
 * - Companies are assigned by account number (referenceNo)
 */
router.post('/import', canManageUsers, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const rows = await parseUserImportFile(req.file);

    // Get all existing users for matching
    const existingUsers = await User.findAll({
      attributes: ['id', 'name', 'email', 'role', 'isActive', 'allCompanies',
        'sendInvoiceEmail', 'sendInvoiceAttachment', 'sendStatementEmail',
        'sendStatementAttachment', 'sendEmailAsSummary', 'sendImportSummaryReport']
    });

    const existingUsersMap = new Map();
    const existingUsersByIdMap = new Map();
    existingUsers.forEach(user => {
      if (user.email) {
        existingUsersMap.set(user.email.toLowerCase(), user);
      }
      existingUsersByIdMap.set(user.id, user);
    });

    // Get all existing companies for company assignment lookup
    const existingCompanies = await Company.findAll({
      attributes: ['id', 'name', 'referenceNo']
    });
    const existingCompaniesMap = new Map();
    existingCompanies.forEach(company => {
      if (company.referenceNo) {
        existingCompaniesMap.set(company.referenceNo, company);
      }
    });

    // Get manageable roles for current user
    const manageableRoles = getManageableRoles(req.user.role);

    // Results tracking
    const results = {
      success: true,
      created: 0,
      updated: 0,
      errors: [],
      warnings: [],
      emailChangesPending: 0,
      details: []
    };

    // Track emails processed in this import to prevent duplicates
    const processedEmails = new Set();

    // Get settings for email sending
    const settings = await Settings.getSettings();
    const { isEmailEnabled } = require('../utils/emailService');
    const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
    const { generateReadableTemporaryPassword } = require('../utils/passwordGenerator');
    const { getEmailChangeValidationUrl } = require('../utils/urlConfig');
    const crypto = require('crypto');

    // Process each row
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // Account for header row

      try {
        // Extract fields
        const userId = row['id'] || row['ID'] || row['Id'] || row['user_id'] || null;
        const name = (row['name'] || row['Name'] || row['NAME'] || '').trim();
        const email = (row['email'] || row['Email'] || row['EMAIL'] || '').trim().toLowerCase();
        const role = (row['role'] || row['Role'] || row['ROLE'] || 'external_user').toLowerCase();
        const active = parseBooleanValue(row['active'] || row['Active'] || row['ACTIVE'] || row['isActive'] || 'TRUE');
        const allCompanies = parseBooleanValue(row['all_companies'] || row['allCompanies'] || row['All Companies'] || 'FALSE');
        const companyAccountNumbersRaw = row['company_account_numbers'] || row['companyAccountNumbers'] || row['Company Account Numbers'] || row['companies'] || '';

        // Email notification preferences
        const sendInvoiceEmail = parseBooleanValue(row['send_invoice_email'] || row['sendInvoiceEmail'] || 'FALSE');
        const sendInvoiceAttachment = parseBooleanValue(row['send_invoice_attachment'] || row['sendInvoiceAttachment'] || 'FALSE');
        const sendStatementEmail = parseBooleanValue(row['send_statement_email'] || row['sendStatementEmail'] || 'FALSE');
        const sendStatementAttachment = parseBooleanValue(row['send_statement_attachment'] || row['sendStatementAttachment'] || 'FALSE');
        const sendEmailAsSummary = parseBooleanValue(row['send_email_as_summary'] || row['sendEmailAsSummary'] || 'FALSE');
        const sendImportSummaryReport = parseBooleanValue(row['send_import_summary_report'] || row['sendImportSummaryReport'] || 'FALSE');

        // Validate required fields
        if (!name) {
          results.errors.push(`Row ${rowNum}: Name is required`);
          continue;
        }

        if (!email) {
          results.errors.push(`Row ${rowNum}: Email is required`);
          continue;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          results.errors.push(`Row ${rowNum}: Invalid email format: ${email}`);
          continue;
        }

        // Check for duplicate in this import
        if (processedEmails.has(email)) {
          results.errors.push(`Row ${rowNum}: Duplicate email in import file: ${email}`);
          continue;
        }

        // Validate role
        const validRoles = ['global_admin', 'administrator', 'manager', 'credit_senior', 'credit_controller', 'external_user', 'notification_contact'];
        if (!validRoles.includes(role)) {
          results.errors.push(`Row ${rowNum}: Invalid role: ${role}`);
          continue;
        }

        // Check if current user can manage this role
        if (!manageableRoles.includes(role)) {
          results.errors.push(`Row ${rowNum}: You cannot import users with role: ${getRoleLabel(role)}`);
          continue;
        }

        // Parse company account numbers
        const companyIds = [];
        if (companyAccountNumbersRaw && !allCompanies) {
          const parts = String(companyAccountNumbersRaw).split(',').map(s => s.trim()).filter(s => s);
          for (const part of parts) {
            const refNo = parseInt(part);
            if (!isNaN(refNo)) {
              const company = existingCompaniesMap.get(refNo);
              if (company) {
                companyIds.push(company.id);
              } else {
                results.warnings.push(`Row ${rowNum}: Company with account number ${refNo} not found - skipping assignment`);
              }
            }
          }
        }

        // Find existing user
        let existingUser = null;

        // First try to match by ID
        if (userId) {
          const validation = validateUUID(userId, 'user ID');
          if (validation.valid) {
            existingUser = await User.findByPk(validation.value, {
              include: [{
                model: Company,
                as: 'companies',
                attributes: ['id'],
                through: { attributes: [] }
              }]
            });
          }
        }

        // Fall back to email matching
        if (!existingUser) {
          existingUser = await User.findOne({ 
            where: { email },
            include: [{
              model: Company,
              as: 'companies',
              attributes: ['id'],
              through: { attributes: [] }
            }]
          });
        }

        if (existingUser) {
          // Prepare new user data for comparison
          const newUserData = {
            name: name.trim(),
            role: role,
            isActive: active,
            allCompanies: allCompanies,
            sendInvoiceEmail: sendInvoiceEmail,
            sendInvoiceAttachment: sendInvoiceEmail ? sendInvoiceAttachment : false,
            sendStatementEmail: sendStatementEmail,
            sendStatementAttachment: sendStatementEmail ? sendStatementAttachment : false,
            sendEmailAsSummary: (sendInvoiceEmail || sendStatementEmail) ? sendEmailAsSummary : false,
            sendImportSummaryReport: sendImportSummaryReport
          };

          // Check if data has actually changed
          const companyIdsForComparison = !allCompanies && companyIds.length > 0 ? companyIds : null;
          const hasChanged = hasUserDataChanged(existingUser, newUserData, email, companyIdsForComparison);

          if (!hasChanged) {
            // No changes, skip update but still track email for duplicate prevention
            processedEmails.add(email);
            continue;
          }

          // UPDATE existing user (data has changed)
          const oldEmail = existingUser.email.toLowerCase();
          const emailChanged = oldEmail !== email;

          // Update user fields
          existingUser.name = name;
          existingUser.role = role;
          existingUser.isActive = active;
          existingUser.allCompanies = allCompanies;
          existingUser.sendInvoiceEmail = sendInvoiceEmail;
          existingUser.sendInvoiceAttachment = sendInvoiceEmail ? sendInvoiceAttachment : false;
          existingUser.sendStatementEmail = sendStatementEmail;
          existingUser.sendStatementAttachment = sendStatementEmail ? sendStatementAttachment : false;
          existingUser.sendEmailAsSummary = (sendInvoiceEmail || sendStatementEmail) ? sendEmailAsSummary : false;
          existingUser.sendImportSummaryReport = sendImportSummaryReport;

          // Handle email change
          if (emailChanged) {
            // Check if new email is already in use (check both email and pendingEmail columns)
            const emailInUse = await User.findOne({ 
              where: { 
                [Op.or]: [
                  { email: email },
                  { pendingEmail: email }
                ]
              }
            });
            if (emailInUse && emailInUse.id !== existingUser.id) {
              results.errors.push(`Row ${rowNum}: Email ${email} is already in use by another user`);
              continue;
            }

            // Set up email change validation flow
            const changeToken = crypto.randomBytes(32).toString('hex');
            const changeTokenHash = crypto.createHash('sha256').update(changeToken).digest('hex');

            existingUser.pendingEmail = email;
            existingUser.emailChangeToken = changeTokenHash;
            existingUser.emailChangeExpires = Date.now() + 1800000; // 30 minutes

            // Send validation email to new address
            if (isEmailEnabled(settings)) {
              try {
                const validationUrl = getEmailChangeValidationUrl(changeToken);
                const expiryTime = '30 minutes';

                await sendTemplatedEmail(
                  'email-change-validation',
                  email,
                  {
                    userName: name,
                    oldEmail: oldEmail,
                    newEmail: email,
                    validationUrl: validationUrl,
                    expiryTime: expiryTime
                  },
                  settings
                );
              } catch (emailError) {
                results.warnings.push(`Row ${rowNum}: Failed to send email change validation to ${email}: ${emailError.message}`);
              }
            }

            results.emailChangesPending++;
            results.warnings.push(`Row ${rowNum}: Email change from ${oldEmail} to ${email} requires validation`);
          }

          await existingUser.save();

          // Update company assignments
          if (!allCompanies && companyIds.length > 0) {
            const companies = await Company.findAll({
              where: { id: { [Op.in]: companyIds } }
            });
            await existingUser.setCompanies(companies);
          } else if (!allCompanies) {
            // Clear company assignments if none specified and not allCompanies
            await existingUser.setCompanies([]);
          }

          // Track both old and new email to prevent duplicates in import file
          processedEmails.add(email);
          if (emailChanged) {
            processedEmails.add(oldEmail);
          }
          results.updated++;
          results.details.push({
            rowNum,
            action: 'updated',
            email: existingUser.email,
            name: name,
            emailChanged: emailChanged
          });

        } else {
          // CREATE new user
          
          // Check if email already exists (check both email and pendingEmail columns)
          const emailExists = await User.findOne({ 
            where: { 
              [Op.or]: [
                { email: email },
                { pendingEmail: email }
              ]
            }
          });
          if (emailExists) {
            results.errors.push(`Row ${rowNum}: Email ${email} already exists`);
            continue;
          }

          // Generate temporary password
          const tempPassword = generateReadableTemporaryPassword();

          // Create user
          const newUser = await User.create({
            name: name,
            email: email,
            password: tempPassword,
            role: role,
            isActive: active,
            allCompanies: allCompanies,
            addedById: req.user.userId,
            mustChangePassword: true,
            sendInvoiceEmail: sendInvoiceEmail,
            sendInvoiceAttachment: sendInvoiceEmail ? sendInvoiceAttachment : false,
            sendStatementEmail: sendStatementEmail,
            sendStatementAttachment: sendStatementEmail ? sendStatementAttachment : false,
            sendEmailAsSummary: (sendInvoiceEmail || sendStatementEmail) ? sendEmailAsSummary : false,
            sendImportSummaryReport: sendImportSummaryReport
          });

          // Assign companies
          if (!allCompanies && companyIds.length > 0) {
            const companies = await Company.findAll({
              where: { id: { [Op.in]: companyIds } }
            });
            await newUser.setCompanies(companies);
          }

          // Send welcome email
          if (isEmailEnabled(settings)) {
            try {
              await sendTemplatedEmail(
                'welcome',
                email,
                {
                  userName: name,
                  userEmail: email,
                  tempPassword: tempPassword
                },
                settings,
                {
                  ipAddress: req.ip,
                  userAgent: req.get('user-agent'),
                  userId: req.user.userId
                }
              );
            } catch (emailError) {
              results.warnings.push(`Row ${rowNum}: Failed to send welcome email to ${email}: ${emailError.message}`);
            }
          }

          processedEmails.add(email);
          results.created++;
          results.details.push({
            rowNum,
            action: 'created',
            email: email,
            name: name,
            userId: newUser.id
          });
        }

      } catch (rowError) {
        results.errors.push(`Row ${rowNum}: ${rowError.message}`);
      }
    }

    // Log import activity
    await logActivity({
      type: ActivityType.USERS_IMPORTED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Imported users: ${results.created} created, ${results.updated} updated`,
      details: {
        totalRows: rows.length,
        created: results.created,
        updated: results.updated,
        errors: results.errors.length,
        warnings: results.warnings.length,
        emailChangesPending: results.emailChangesPending
      },
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    }).catch(err => console.error('Error logging import activity:', err));

    // Determine overall success
    results.success = results.errors.length === 0;

    res.json(results);

  } catch (error) {
    console.error('Error importing users:', error);
    res.status(400).json({ message: error.message });
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

