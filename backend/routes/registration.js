const express = require('express');
const { PendingRegistration, Settings, User, Company } = require('../models');
const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
const { logActivity, ActivityType } = require('../services/activityLogger');
const { Op } = require('sequelize');
const recaptchaMiddleware = require('../middleware/recaptcha');
const router = express.Router();

// Get registration form configuration (public) - kept for backwards compatibility
router.get('/form-config', async (req, res) => {
  try {
    res.json({
      customFields: []
    });
  } catch (error) {
    console.error('Error fetching registration form config:', error);
    res.status(500).json({ message: error.message });
  }
});

// Submit registration (public)
router.post('/submit', recaptchaMiddleware({ minScore: 0.5 }), async (req, res) => {
  try {
    const { firstName, lastName, companyName, accountNumber, email } = req.body;
    
    // Validate required fields
    if (!firstName || !lastName || !companyName || !email) {
      return res.status(400).json({ 
        message: 'First Name, Last Name, Company Name, and Email are required' 
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email address' });
    }
    
    // Check if user with this email already exists
    const existingUser = await User.findOne({ 
      where: { email: email.toLowerCase().trim() } 
    });
    if (existingUser) {
      return res.status(400).json({ 
        message: 'An account with this email address already exists' 
      });
    }
    
    // Check if there's already a pending registration with this email
    const existingPending = await PendingRegistration.findOne({
      where: { 
        email: email.toLowerCase().trim(),
        status: 'pending'
      }
    });
    if (existingPending) {
      return res.status(400).json({ 
        message: 'A registration request with this email is already pending review' 
      });
    }
    
    // Create pending registration
    const registration = await PendingRegistration.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      companyName: companyName.trim(),
      accountNumber: accountNumber?.trim() || null,
      email: email.toLowerCase().trim(),
      customFields: {},
      status: 'pending',
      metadata: {
        submittedAt: new Date().toISOString(),
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent')
      }
    });
    
    // Get settings for email sending
    const settings = await Settings.getSettings();
    
    // Get all global admins and administrators to notify
    const admins = await User.findAll({
      where: {
        role: { [Op.in]: ['global_admin', 'administrator'] },
        isActive: true
      },
      attributes: ['id', 'name', 'email']
    });
    
    // Send notification email to each admin
    const { getFrontendUrl } = require('../utils/urlConfig');
    const frontendUrl = getFrontendUrl();
    const reviewUrl = `${frontendUrl}/users/pending-accounts/${registration.id}`;
    
    for (const admin of admins) {
      try {
        await sendTemplatedEmail(
          'registration-request',
          admin.email,
          {
            userName: admin.name,
            applicantName: `${firstName} ${lastName}`,
            applicantFirstName: firstName,
            applicantLastName: lastName,
            applicantEmail: email,
            applicantCompanyName: companyName,
            accountNumber: accountNumber || 'N/A',
            reviewUrl: reviewUrl,
            registrationId: registration.id
          },
          settings,
          { 
            ipAddress: req.ip, 
            userAgent: req.get('user-agent'),
            userId: null // Public registration
          }
        );
      } catch (emailError) {
        console.error(`Failed to send registration notification to ${admin.email}:`, emailError);
        // Don't fail the registration if email fails
      }
    }
    
    // Send confirmation email to the user
    try {
      await sendTemplatedEmail(
        'registration-submitted',
        email,
        {
          userName: `${firstName} ${lastName}`,
          userEmail: email,
          userCompanyName: companyName,
          accountNumber: accountNumber || null,
          companyName: settings.companyName
        },
        settings,
        { 
          ipAddress: req.ip, 
          userAgent: req.get('user-agent'),
          userId: null // Public registration
        }
      );
    } catch (emailError) {
      console.error(`Failed to send registration confirmation to ${email}:`, emailError);
      // Don't fail the registration if email fails
    }
    
    // Log activity
    await logActivity({
      type: ActivityType.USER_REGISTRATION_SUBMITTED,
      userId: null,
      userEmail: email,
      userRole: null,
      action: `New registration request submitted: ${firstName} ${lastName} (${email})`,
      details: {
        registrationId: registration.id,
        firstName,
        lastName,
        companyName,
        accountNumber,
        email
      },
      companyId: null,
      companyName: companyName,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.status(201).json({
      success: true,
      message: 'Registration submitted successfully. You will receive an email once your account has been reviewed.',
      registrationId: registration.id
    });
  } catch (error) {
    console.error('Error submitting registration:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get pending registration by ID (for review page)
router.get('/:id', async (req, res) => {
  try {
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

module.exports = router;

