const express = require('express');
const { PendingRegistration, User, Company, Settings } = require('../models');
const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
const { logActivity, ActivityType } = require('../services/activityLogger');
const { Op } = require('sequelize');
const auth = require('../middleware/auth');
const globalAdmin = require('../middleware/globalAdmin');
const router = express.Router();

// Apply auth to all routes
router.use(auth);

// Get all pending registrations (Global Admin and Administrator only)
router.get('/', async (req, res) => {
  try {
    // Only global admins and administrators can view pending registrations
    if (!['global_admin', 'administrator'].includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Access denied. Only Global Administrators and Administrators can view pending registrations.' 
      });
    }
    
    const { status, page = 1, limit = 50 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    
    const whereConditions = {};
    if (status) {
      whereConditions.status = status;
    }
    
    const { count, rows } = await PendingRegistration.findAndCountAll({
      where: whereConditions,
      include: [{
        model: User,
        as: 'reviewedBy',
        attributes: ['id', 'name', 'email']
      }, {
        model: User,
        as: 'createdUser',
        attributes: ['id', 'name', 'email']
      }],
      limit: limitNum,
      offset: offset,
      order: [['createdAt', 'DESC']]
    });
    
    res.json({
      registrations: rows,
      total: count,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(count / limitNum)
    });
  } catch (error) {
    console.error('Error fetching pending registrations:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get single pending registration
router.get('/:id', async (req, res) => {
  try {
    // Only global admins and administrators can view pending registrations
    if (!['global_admin', 'administrator'].includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Access denied. Only Global Administrators and Administrators can view pending registrations.' 
      });
    }
    
    const registration = await PendingRegistration.findByPk(req.params.id, {
      include: [{
        model: User,
        as: 'reviewedBy',
        attributes: ['id', 'name', 'email']
      }, {
        model: User,
        as: 'createdUser',
        attributes: ['id', 'name', 'email']
      }]
    });
    
    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }
    
    res.json(registration);
  } catch (error) {
    console.error('Error fetching registration:', error);
    res.status(500).json({ message: error.message });
  }
});

// Approve registration and create user
router.post('/:id/approve', async (req, res) => {
  try {
    // Only global admins and administrators can approve registrations
    if (!['global_admin', 'administrator'].includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Access denied. Only Global Administrators and Administrators can approve registrations.' 
      });
    }
    
    const { role, companyIds, rejectionReason } = req.body;
    
    // Validate role
    const allowedRoles = ['external_user', 'staff', 'manager'];
    if (!role || !allowedRoles.includes(role)) {
      return res.status(400).json({ 
        message: `Role must be one of: ${allowedRoles.join(', ')}` 
      });
    }
    
    const registration = await PendingRegistration.findByPk(req.params.id);
    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }
    
    if (registration.status !== 'pending') {
      return res.status(400).json({ 
        message: `Registration has already been ${registration.status}` 
      });
    }
    
    // Check if user with this email already exists
    const existingUser = await User.findOne({ 
      where: { email: registration.email } 
    });
    if (existingUser) {
      return res.status(400).json({ 
        message: 'A user with this email address already exists' 
      });
    }
    
    // Generate temporary password
    const { generateReadableTemporaryPassword } = require('../utils/passwordGenerator');
    const tempPassword = generateReadableTemporaryPassword();
    
    // Create user
    const user = await User.create({
      name: `${registration.firstName} ${registration.lastName || ''}`.trim(),
      email: registration.email,
      password: tempPassword,
      role: role,
      addedById: req.user.userId,
      mustChangePassword: true,
      allCompanies: false,
      sendInvoiceEmail: false,
      sendInvoiceAttachment: false,
      sendStatementEmail: false,
      sendStatementAttachment: false,
      sendEmailAsSummary: false
    });
    
    // Assign companies if provided
    if (companyIds && Array.isArray(companyIds) && companyIds.length > 0) {
      const companies = await Company.findAll({
        where: { id: { [Op.in]: companyIds } }
      });
      
      if (companies.length !== companyIds.length) {
        return res.status(400).json({ message: 'One or more company IDs are invalid' });
      }
      
      await user.setCompanies(companies);
    }
    
    // Update registration status
    registration.status = 'approved';
    registration.reviewedById = req.user.userId;
    registration.reviewedAt = new Date();
    registration.createdUserId = user.id;
    await registration.save();
    
    // Get settings for email
    const settings = await Settings.getSettings();
    const { getFrontendUrl, getLoginUrl } = require('../utils/urlConfig');
    const frontendUrl = getFrontendUrl();
    const loginUrl = getLoginUrl();
    
    // Send approval email to user
    try {
      await sendTemplatedEmail(
        'registration-approved',
        user.email,
        {
          userName: user.name,
          companyName: settings.companyName,
          loginUrl: loginUrl,
          temporaryPassword: tempPassword
        },
        settings,
        { 
          ipAddress: req.ip, 
          userAgent: req.get('user-agent'),
          userId: req.user.userId
        }
      );
    } catch (emailError) {
      console.error('Failed to send approval email:', emailError);
      // Don't fail the approval if email fails
    }
    
    // Log activity
    await logActivity({
      type: ActivityType.USER_REGISTRATION_APPROVED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Approved registration and created user: ${user.name} (${user.email})`,
      details: {
        registrationId: registration.id,
        userId: user.id,
        role: role,
        companyIds: companyIds || []
      },
      companyId: null,
      companyName: registration.companyName,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json({
      success: true,
      message: 'Registration approved and user created successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      },
      registration: registration
    });
  } catch (error) {
    console.error('Error approving registration:', error);
    res.status(500).json({ message: error.message });
  }
});

// Reject registration
router.post('/:id/reject', async (req, res) => {
  try {
    // Only global admins and administrators can reject registrations
    if (!['global_admin', 'administrator'].includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Access denied. Only Global Administrators and Administrators can reject registrations.' 
      });
    }
    
    const { rejectionReason } = req.body;
    
    const registration = await PendingRegistration.findByPk(req.params.id);
    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }
    
    if (registration.status !== 'pending') {
      return res.status(400).json({ 
        message: `Registration has already been ${registration.status}` 
      });
    }
    
    // Update registration status
    registration.status = 'rejected';
    registration.reviewedById = req.user.userId;
    registration.reviewedAt = new Date();
    registration.rejectionReason = rejectionReason || null;
    await registration.save();
    
    // Get settings for email
    const settings = await Settings.getSettings();
    
    // Send rejection email to user
    try {
      await sendTemplatedEmail(
        'registration-rejected',
        registration.email,
        {
          userName: `${registration.firstName} ${registration.lastName || ''}`.trim(),
          companyName: settings.companyName,
          rejectionReason: rejectionReason || 'No reason provided'
        },
        settings,
        { 
          ipAddress: req.ip, 
          userAgent: req.get('user-agent'),
          userId: req.user.userId
        }
      );
    } catch (emailError) {
      console.error('Failed to send rejection email:', emailError);
      // Don't fail the rejection if email fails
    }
    
    // Log activity
    await logActivity({
      type: ActivityType.USER_REGISTRATION_REJECTED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Rejected registration: ${registration.firstName} ${registration.lastName || ''} (${registration.email})`,
      details: {
        registrationId: registration.id,
        rejectionReason: rejectionReason || null
      },
      companyId: null,
      companyName: registration.companyName,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json({
      success: true,
      message: 'Registration rejected successfully',
      registration: registration
    });
  } catch (error) {
    console.error('Error rejecting registration:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

