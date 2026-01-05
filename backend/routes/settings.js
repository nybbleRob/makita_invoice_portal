const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { Settings } = require('../models');
const globalAdmin = require('../middleware/globalAdmin');
const auth = require('../middleware/auth');
const { generateColorShades } = require('../utils/colorGenerator');
const router = express.Router();

// Storage configuration
const { ensureStorageDirs, STORAGE_BASE } = require('../config/storage');
ensureStorageDirs();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, STORAGE_BASE);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Get settings (public, but some fields may be restricted)
router.get('/', async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    
    // Don't expose sensitive data
    // Handle both Sequelize model and plain cached object
    const settingsObj = settings.toJSON ? settings.toJSON() : { ...settings };
    
    // Handle missing emailProvider column gracefully
    if (!settingsObj.emailProvider) {
      settingsObj.emailProvider = {
        enabled: false,
        provider: 'smtp',
        testEmail: '',
        smtp: {
          host: '',
          port: 587,
          secure: false,
          auth: {
            user: '',
            password: ''
          },
          fromEmail: '',
          fromName: 'Makita Invoice Portal',
          rejectUnauthorized: true
        },
        office365: {
          tenantId: '',
          clientId: '',
          clientSecret: '',
          fromEmail: '',
          sendAsUser: ''
        },
        resend: {
          apiKey: '',
          fromEmail: '',
          fromName: 'Makita Invoice Portal'
        },
        smtp2go: {
          apiKey: '',
          fromEmail: '',
          fromName: 'Makita Invoice Portal'
        }
      };
    }
    
    if (settingsObj.smtp && settingsObj.smtp.auth) {
      settingsObj.smtp.auth.password = settingsObj.smtp.auth.password ? '***' : '';
    }
    if (settingsObj.emailProvider) {
      // Mask passwords and API keys
      if (settingsObj.emailProvider.smtp?.auth?.password) {
        settingsObj.emailProvider.smtp.auth.password = '***';
      }
      if (settingsObj.emailProvider.office365?.clientSecret) {
        settingsObj.emailProvider.office365.clientSecret = '***';
      }
      if (settingsObj.emailProvider.resend?.apiKey) {
        settingsObj.emailProvider.resend.apiKey = '***';
      }
      if (settingsObj.emailProvider.smtp2go?.apiKey) {
        settingsObj.emailProvider.smtp2go.apiKey = '***';
      }
    }
    
    // Don't expose credentials JSON (mask it)
    if (settingsObj.parsingProvider) {
      if (settingsObj.parsingProvider.documentai && settingsObj.parsingProvider.documentai.credentialsJson) {
        settingsObj.parsingProvider.documentai.credentialsJson = '***';
      }
    }
    
    // Ensure mandatoryFields exists (for backward compatibility with existing databases)
    if (!settingsObj.mandatoryFields) {
      settingsObj.mandatoryFields = {
        pdf: [
          'document_type',
          'account_number',
          'invoice_number',
          'vat_amount',
          'customer_po',
          'amount',
          'date',
        ],
        excel: [
          'document_type',
          'account_no',
          'invoice_number',
          'vat_amount',
          'invoice_total'
        ]
      };
    }
    
    // Ensure importSettings exists (for backward compatibility with existing databases)
    if (!settingsObj.importSettings) {
      settingsObj.importSettings = {
        enabled: true,
        frequency: 60,
        lastRun: null,
        lastRunDuration: null,
        lastRunStats: {
          scanned: 0,
          queued: 0,
          processed: 0,
          failed: 0,
          duplicates: 0
        },
        nextScheduledRun: null
      };
    }
    
    res.json(settingsObj);
  } catch (error) {
    console.error('Error fetching settings:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ message: error.message });
  }
});

// Update settings (Global Admin only)
router.put('/', globalAdmin, async (req, res) => {
  try {
    // Use getSettingsForUpdate to get Sequelize model instance (bypasses cache)
    const settings = await Settings.getSettingsForUpdate();
    
    // Update basic fields
    if (req.body.companyName !== undefined) {
      settings.companyName = req.body.companyName;
    }
    if (req.body.siteTitle !== undefined) {
      settings.siteTitle = req.body.siteTitle;
      // Keep siteName in sync for backward compatibility
      settings.siteName = req.body.siteTitle;
    }
    // Backward compatibility: if siteName is updated, also update siteTitle
    if (req.body.siteName !== undefined && req.body.siteTitle === undefined) {
      settings.siteTitle = req.body.siteName;
      settings.siteName = req.body.siteName;
    }
    if (req.body.systemEmail !== undefined) {
      settings.systemEmail = req.body.systemEmail;
    }
    
    // Update primary color and generate shades
    if (req.body.primaryColor !== undefined) {
      settings.primaryColor = req.body.primaryColor;
      settings.primaryColorShades = generateColorShades(req.body.primaryColor);
    }
    
    // Update secondary color and generate shades
    if (req.body.secondaryColor !== undefined) {
      settings.secondaryColor = req.body.secondaryColor;
      settings.secondaryColorShades = generateColorShades(req.body.secondaryColor);
    }
    
    // Update 2FA settings
    if (req.body.twoFactorAuth !== undefined) {
      settings.twoFactorAuth = {
        ...settings.twoFactorAuth,
        ...req.body.twoFactorAuth
      };
    }
    
    // Update email provider settings (but don't save credentials if env vars are set)
    if (req.body.emailProvider !== undefined) {
      const newEmailProvider = {
        ...settings.emailProvider,
        ...req.body.emailProvider
      };
      
      // Handle credentials - preserve if masked, otherwise save new values
      // Standard practice: Store credentials in database (env vars are optional override)
      if (newEmailProvider.smtp?.auth) {
        // Preserve password if masked or not provided
        if (req.body.emailProvider.smtp?.auth?.password === '***' || 
            req.body.emailProvider.smtp?.auth?.password === undefined ||
            req.body.emailProvider.smtp?.auth?.password === '') {
          if (settings.emailProvider?.smtp?.auth?.password) {
            newEmailProvider.smtp.auth.password = settings.emailProvider.smtp.auth.password;
          }
        }
      }
      
      if (newEmailProvider.office365) {
        // Preserve clientSecret if masked or not provided
        if (req.body.emailProvider.office365?.clientSecret === '***' || 
            req.body.emailProvider.office365?.clientSecret === undefined ||
            req.body.emailProvider.office365?.clientSecret === '') {
          if (settings.emailProvider?.office365?.clientSecret) {
            newEmailProvider.office365.clientSecret = settings.emailProvider.office365.clientSecret;
          }
        }
      }
      
      if (newEmailProvider.resend) {
        // Preserve apiKey if masked or not provided
        if (req.body.emailProvider.resend?.apiKey === '***' || 
            req.body.emailProvider.resend?.apiKey === undefined ||
            req.body.emailProvider.resend?.apiKey === '') {
          if (settings.emailProvider?.resend?.apiKey) {
            newEmailProvider.resend.apiKey = settings.emailProvider.resend.apiKey;
          }
        }
      }
      
      if (newEmailProvider.smtp2go) {
        // Preserve apiKey if masked or not provided
        if (req.body.emailProvider.smtp2go?.apiKey === '***' || 
            req.body.emailProvider.smtp2go?.apiKey === undefined ||
            req.body.emailProvider.smtp2go?.apiKey === '') {
          if (settings.emailProvider?.smtp2go?.apiKey) {
            newEmailProvider.smtp2go.apiKey = settings.emailProvider.smtp2go.apiKey;
          }
        }
      }
      
      settings.emailProvider = newEmailProvider;
    }
    
    // Update legacy SMTP settings (for backward compatibility)
    if (req.body.smtp !== undefined) {
      settings.smtp = {
        ...settings.smtp,
        ...req.body.smtp
      };
      
      // If emailProvider is not set at all (null/undefined), migrate smtp to emailProvider
      // Note: We only migrate if emailProvider doesn't exist, NOT if enabled is false
      // (enabled: false is a valid state that should be preserved)
      if (settings.emailProvider === null || settings.emailProvider === undefined) {
        settings.emailProvider = {
          enabled: settings.smtp.enabled,
          provider: 'smtp',
          smtp: {
            ...settings.smtp
          }
        };
      }
    }
    
    // Update password expiry settings
    if (req.body.passwordExpiryDays !== undefined) {
      // Convert string to number or null
      const expiryDays = req.body.passwordExpiryDays === '' || req.body.passwordExpiryDays === null || req.body.passwordExpiryDays === 'null' 
        ? null 
        : parseInt(req.body.passwordExpiryDays);
      
      // Validate value
      if (expiryDays !== null && ![0, 14, 30, 60, 90].includes(expiryDays)) {
        return res.status(400).json({ message: 'Password expiry days must be 0, 14, 30, 60, or 90' });
      }
      
      settings.passwordExpiryDays = expiryDays;
    }
    
    // Update document status restriction setting
    if (req.body.onlyExternalUsersChangeDocumentStatus !== undefined) {
      const newValue = req.body.onlyExternalUsersChangeDocumentStatus === true || req.body.onlyExternalUsersChangeDocumentStatus === 'true';
      console.log(`📋 Saving onlyExternalUsersChangeDocumentStatus: ${newValue} (received: ${req.body.onlyExternalUsersChangeDocumentStatus}, type: ${typeof req.body.onlyExternalUsersChangeDocumentStatus})`);
      settings.onlyExternalUsersChangeDocumentStatus = newValue;
    }
    
    // Update queries enabled setting
    if (req.body.queriesEnabled !== undefined) {
      settings.queriesEnabled = req.body.queriesEnabled === true || req.body.queriesEnabled === 'true';
    }
    
    // Update test mode default company ID
    if (req.body.testModeDefaultCompanyId !== undefined) {
      // Allow null to clear the setting, otherwise validate UUID format
      const newCompanyId = req.body.testModeDefaultCompanyId;
      if (newCompanyId === null || newCompanyId === '' || newCompanyId === 'null') {
        settings.testModeDefaultCompanyId = null;
      } else {
        // Validate that it's a valid UUID and the company exists
        const { Company } = require('../models');
        const company = await Company.findByPk(newCompanyId);
        if (!company) {
          return res.status(400).json({ message: 'Invalid company ID for test mode default company' });
        }
        settings.testModeDefaultCompanyId = newCompanyId;
      }
    }
    
    // Update registration form fields
    if (req.body.registrationFormFields !== undefined) {
      settings.registrationFormFields = req.body.registrationFormFields;
    }
    
    
    // Update FTP settings
    if (req.body.ftp !== undefined) {
      const newFtp = {
        ...settings.ftp,
        ...req.body.ftp
      };
      
      // Preserve password if masked or not provided
      if (req.body.ftp.password === '***' || 
          req.body.ftp.password === undefined ||
          req.body.ftp.password === '') {
        if (settings.ftp?.password) {
          newFtp.password = settings.ftp.password;
        }
      }
      
      settings.ftp = newFtp;
    }
    
    // Update file retention days
    if (req.body.fileRetentionDays !== undefined) {
      const retentionDays = req.body.fileRetentionDays === '' || req.body.fileRetentionDays === null || req.body.fileRetentionDays === 'null'
        ? null
        : parseInt(req.body.fileRetentionDays);
      
      if (retentionDays !== null && retentionDays < 1) {
        return res.status(400).json({ message: 'File retention days must be at least 1 or null (never delete)' });
      }
      
      settings.fileRetentionDays = retentionDays;
    }
    
    // Update document retention period
    if (req.body.documentRetentionPeriod !== undefined) {
      const retentionPeriod = req.body.documentRetentionPeriod === '' || req.body.documentRetentionPeriod === null || req.body.documentRetentionPeriod === 'null'
        ? null
        : parseInt(req.body.documentRetentionPeriod);
      
      if (retentionPeriod !== null && ![14, 30, 60, 90].includes(retentionPeriod)) {
        return res.status(400).json({ message: 'Document retention period must be null (disabled), 14, 30, 60, or 90 days' });
      }
      
      settings.documentRetentionPeriod = retentionPeriod;
    }
    
    // Update document retention date trigger
    if (req.body.documentRetentionDateTrigger !== undefined) {
      if (!['upload_date', 'invoice_date'].includes(req.body.documentRetentionDateTrigger)) {
        return res.status(400).json({ message: 'Document retention date trigger must be "upload_date" or "invoice_date"' });
      }
      
      settings.documentRetentionDateTrigger = req.body.documentRetentionDateTrigger;
    }
    
    // Update parsing provider settings
    if (req.body.parsingProvider !== undefined) {
      // Start with existing settings or empty object - use deep clone to avoid reference issues
      const newParsingProvider = settings.parsingProvider ? JSON.parse(JSON.stringify(settings.parsingProvider)) : {};
      
      // Merge top-level settings
      if (req.body.parsingProvider.enabled !== undefined) {
        newParsingProvider.enabled = req.body.parsingProvider.enabled;
      }
      if (req.body.parsingProvider.fallback !== undefined) {
        newParsingProvider.fallback = req.body.parsingProvider.fallback;
      }
      
      // Merge Document AI settings (but preserve credentialsJson if masked or env var is set)
      if (req.body.parsingProvider.documentai !== undefined) {
        newParsingProvider.documentai = {
          ...newParsingProvider.documentai,
          ...req.body.parsingProvider.documentai
        };
        
        // Preserve credentialsJson if masked or not provided
        if (req.body.parsingProvider.documentai.credentialsJson === '***' || 
            req.body.parsingProvider.documentai.credentialsJson === undefined) {
          // Keep existing credentialsJson from database
          if (settings.parsingProvider?.documentai?.credentialsJson) {
            newParsingProvider.documentai.credentialsJson = settings.parsingProvider.documentai.credentialsJson;
          }
        }
        // If credentialsJson is provided and not masked, validate it's valid JSON
        else if (req.body.parsingProvider.documentai.credentialsJson) {
          try {
            const creds = typeof req.body.parsingProvider.documentai.credentialsJson === 'string'
              ? JSON.parse(req.body.parsingProvider.documentai.credentialsJson)
              : req.body.parsingProvider.documentai.credentialsJson;
            // If it parses successfully, store it (as string if it was a string)
            newParsingProvider.documentai.credentialsJson = typeof req.body.parsingProvider.documentai.credentialsJson === 'string'
              ? req.body.parsingProvider.documentai.credentialsJson
              : JSON.stringify(req.body.parsingProvider.documentai.credentialsJson);
          } catch (parseError) {
            return res.status(400).json({ 
              message: `Invalid JSON in Document AI credentials: ${parseError.message}` 
            });
          }
        }
      }
      
      settings.parsingProvider = newParsingProvider;
    }
    
    await settings.save();
    
    // Invalidate cache after save
    await Settings.invalidateCache();
    
    // Don't expose sensitive data in response
    const settingsObj = settings.toJSON();
    if (settingsObj.smtp && settingsObj.smtp.auth) {
      settingsObj.smtp.auth.password = settingsObj.smtp.auth.password ? '***' : '';
    }
    if (settingsObj.emailProvider) {
      // Mask passwords and API keys
      if (settingsObj.emailProvider.smtp?.auth?.password) {
        settingsObj.emailProvider.smtp.auth.password = '***';
      }
      if (settingsObj.emailProvider.office365?.clientSecret) {
        settingsObj.emailProvider.office365.clientSecret = '***';
      }
      if (settingsObj.emailProvider.resend?.apiKey) {
        settingsObj.emailProvider.resend.apiKey = '***';
      }
      if (settingsObj.emailProvider.smtp2go?.apiKey) {
        settingsObj.emailProvider.smtp2go.apiKey = '***';
      }
    }
    
    // Don't expose credentials JSON (mask it)
    if (settingsObj.parsingProvider) {
      if (settingsObj.parsingProvider.documentai && settingsObj.parsingProvider.documentai.credentialsJson) {
        settingsObj.parsingProvider.documentai.credentialsJson = '***';
      }
    }
    
    res.json(settingsObj);
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ message: error.message });
  }
});

// Upload logo (light)
router.post('/upload/logo-light', globalAdmin, upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    // Use getSettingsForUpdate to get Sequelize model instance (bypasses cache)
    const settings = await Settings.getSettingsForUpdate();
    
    // Delete old logo if exists
    if (settings.logoLight) {
      const oldPath = path.join(STORAGE_BASE, path.basename(settings.logoLight));
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }
    
    settings.logoLight = `/uploads/${req.file.filename}`;
    await settings.save();
    await Settings.invalidateCache();
    
    res.json({ 
      message: 'Light logo uploaded successfully',
      path: settings.logoLight
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload favicon
router.post('/upload/favicon', globalAdmin, upload.single('favicon'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    // Use getSettingsForUpdate to get Sequelize model instance (bypasses cache)
    const settings = await Settings.getSettingsForUpdate();
    
    // Delete old favicon if exists
    if (settings.favicon) {
      const oldPath = path.join(STORAGE_BASE, path.basename(settings.favicon));
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }
    
    // Resize favicon to 24x24px
    const originalPath = req.file.path;
    const resizedFilename = `favicon-${Date.now()}-24x24.png`;
    const resizedPath = path.join(STORAGE_BASE, resizedFilename);
    
    try {
      await sharp(originalPath)
        .resize(24, 24, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 0 }
        })
        .png()
        .toFile(resizedPath);
      
      // Delete original file
      fs.unlinkSync(originalPath);
      
      settings.favicon = `/uploads/${resizedFilename}`;
      await settings.save();
      await Settings.invalidateCache();
      
      res.json({ 
        message: 'Favicon uploaded and resized to 24x24px successfully',
        path: settings.favicon
      });
    } catch (resizeError) {
      // If resize fails, use original file
      console.error('Favicon resize error:', resizeError);
      settings.favicon = `/uploads/${req.file.filename}`;
      await settings.save();
      await Settings.invalidateCache();
      
      res.json({ 
        message: 'Favicon uploaded successfully (resize failed, using original)',
        path: settings.favicon
      });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload login background
router.post('/upload/login-background', globalAdmin, upload.single('background'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    
    // Use getSettingsForUpdate to get Sequelize model instance (bypasses cache)
    const settings = await Settings.getSettingsForUpdate();
    
    // Delete old background if exists
    if (settings.loginBackgroundImage) {
      const oldPath = path.join(STORAGE_BASE, path.basename(settings.loginBackgroundImage));
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }
    
    settings.loginBackgroundImage = `/uploads/${req.file.filename}`;
    await settings.save();
    await Settings.invalidateCache();
    
    res.json({ 
      message: 'Login background uploaded successfully',
      path: settings.loginBackgroundImage
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
    }
});

// Delete image (logo, favicon, or login background)
router.delete('/upload/:type', globalAdmin, async (req, res) => {
  try {
    const { type } = req.params;
    // Use getSettingsForUpdate to get Sequelize model instance (bypasses cache)
    const settings = await Settings.getSettingsForUpdate();
    
    const fieldMap = {
      'logo-light': 'logoLight',
      'favicon': 'favicon',
      'login-background': 'loginBackgroundImage'
    };
    
    const field = fieldMap[type];
    if (!field) {
      return res.status(400).json({ message: 'Invalid image type' });
    }
    
    // Delete file if exists
    if (settings[field]) {
      const filePath = path.join(STORAGE_BASE, path.basename(settings[field]));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    
    // Clear field in database
    settings[field] = null;
    await settings.save();
    await Settings.invalidateCache();
    
    res.json({ message: `${type} deleted successfully` });
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({ message: error.message });
  }
});

// Test email provider configuration
router.post('/test-email', auth, globalAdmin, async (req, res) => {
  try {
    const { Settings } = require('../models');
    const { testEmailProvider } = require('../utils/emailService');
    
    const settings = await Settings.getSettings();
    
    // Override test email if provided
    if (req.body.testEmail) {
      settings.emailProvider = {
        ...settings.emailProvider,
        testEmail: req.body.testEmail
      };
    }
    
    // Pass request context for logging
    const requestContext = {
      ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
      userId: req.user?.userId || null
    };
    
    const result = await testEmailProvider(settings, requestContext);
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message
      });
    }
  } catch (error) {
    console.error('Error testing email provider:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to test email provider'
    });
  }
});

// Test a specific email template
router.post('/email-templates/:templateName/test', auth, globalAdmin, async (req, res) => {
  try {
    const { templateName } = req.params;
    const { testEmail, data } = req.body;
    const { Settings } = require('../models');
    const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
    
    // List of valid templates
    const validTemplates = [
      'welcome',
      'password-reset',
      'password-changed',
      'document-notification',
      'document-summary',
      'import-summary',
      'query-notification',
      'document-deleted',
      'retention-cleanup-summary',
      'registration-request',
      'registration-approved',
      'registration-rejected'
    ];
    
    if (!validTemplates.includes(templateName)) {
      return res.status(400).json({
        success: false,
        message: `Invalid template name. Valid templates: ${validTemplates.join(', ')}`
      });
    }
    
    const settings = await Settings.getSettings();
    
    // Get test email from request or settings
    const recipientEmail = testEmail || settings.emailProvider?.testMode?.redirectEmail || settings.emailProvider?.testEmail || settings.systemEmail;
    
    if (!recipientEmail) {
      return res.status(400).json({
        success: false,
        message: 'No test email address provided'
      });
    }
    
    // Build template-specific test data
    const testData = {
      userName: req.user?.name || 'Test User',
      userEmail: recipientEmail,
      companyName: settings.companyName || 'Makita Invoice Portal',
      ...data
    };
    
    // Add template-specific test data
    switch (templateName) {
      case 'welcome':
        testData.tempPassword = testData.temporaryPassword || 'TempPass123!';
        testData.loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/login`;
        break;
      case 'password-reset':
        testData.resetUrl = testData.resetUrl || `${process.env.FRONTEND_URL || 'http://localhost:3001'}/reset-password?token=test-token-123`;
        testData.expiryTime = '1 hour';
        break;
      case 'password-changed':
        // No additional data needed
        break;
      case 'document-notification':
        testData.documentTypeName = 'Invoice';
        testData.documentNumber = 'INV-TEST-001';
        testData.documentDate = new Date().toLocaleDateString('en-GB');
        testData.documentAmount = '£1,234.56';
        testData.supplierName = 'Test Company Ltd';
        testData.documentUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/invoices/test-id`;
        testData.retentionPeriod = settings.documentRetentionPeriod || 90;
        break;
      case 'document-summary':
        testData.totalDocuments = 15;
        testData.invoiceCount = 10;
        testData.creditNoteCount = 3;
        testData.statementCount = 2;
        testData.retentionPeriod = settings.documentRetentionPeriod || 90;
        break;
      case 'import-summary':
        testData.totalFiles = 50;
        testData.successfulCount = 48;
        testData.allocatedCount = 45;
        testData.unallocatedCount = 3;
        testData.failedCount = 2;
        testData.duplicateCount = 5;
        testData.importSource = 'FTP Import';
        testData.startTime = new Date(Date.now() - 300000).toLocaleString('en-GB');
        testData.endTime = new Date().toLocaleString('en-GB');
        testData.processingTime = '5 minutes';
        testData.importDate = new Date().toLocaleDateString('en-GB');
        testData.retentionPeriod = settings.documentRetentionPeriod || 90;
        break;
      case 'query-notification':
        testData.emailTitle = 'New Query on Invoice';
        testData.preheaderText = 'You have a new message regarding Invoice #INV-TEST-001';
        testData.greeting = `Hi ${testData.userName},`;
        testData.introText = 'A new query has been raised on a document in your account.';
        testData.documentTypeName = 'Invoice';
        testData.documentNumber = 'INV-TEST-001';
        testData.querySubject = 'Missing Information';
        testData.queryStatus = 'Open';
        testData.statusColor = '#fef3cd';
        testData.statusTextColor = '#856404';
        testData.messageContent = 'This is a test query message to verify the email template is working correctly.';
        testData.senderName = 'Admin User';
        testData.queryUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/invoices/test-id`;
        testData.buttonText = 'View Query';
        testData.iconColor = settings.primaryColor || '#066FD1';
        break;
      case 'document-deleted':
        testData.documentType = 'Invoice';
        testData.documentNumber = 'INV-TEST-001';
        testData.deletionDate = new Date().toLocaleDateString('en-GB');
        testData.retentionPeriod = settings.documentRetentionPeriod || 90;
        break;
      case 'retention-cleanup-summary':
        testData.deletedCount = 25;
        testData.invoiceCount = 20;
        testData.creditNoteCount = 3;
        testData.statementCount = 2;
        testData.cleanupDate = new Date().toLocaleDateString('en-GB');
        testData.retentionPeriod = settings.documentRetentionPeriod || 90;
        testData.deletions = [
          { documentType: 'Invoice', documentNumber: 'INV-001', companyName: 'Test Co', deletedAt: new Date().toLocaleString('en-GB') },
          { documentType: 'Credit Note', documentNumber: 'CN-001', companyName: 'Test Co', deletedAt: new Date().toLocaleString('en-GB') }
        ];
        testData.hasMoreDeletions = true;
        testData.totalDeletions = 25;
        break;
      case 'registration-request':
        testData.applicantFirstName = 'John';
        testData.applicantLastName = 'Doe';
        testData.applicantEmail = 'john.doe@example.com';
        testData.applicantCompanyName = 'Acme Corporation';
        testData.accountNumber = 'ACC-12345';
        testData.reviewUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/users?tab=pending`;
        testData.applicantName = 'John Doe';
        break;
      case 'registration-approved':
        testData.loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/login`;
        break;
      case 'registration-rejected':
        testData.rejectionReason = 'Unable to verify account details. Please contact support for more information.';
        break;
    }
    
    // Pass request context for logging
    const requestContext = {
      ipAddress: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
      userId: req.user?.userId || null
    };
    
    // Send the test email
    const result = await sendTemplatedEmail(templateName, recipientEmail, testData, settings, requestContext);
    
    res.json({
      success: true,
      message: `Test email (${templateName}) sent to ${recipientEmail}`,
      result
    });
  } catch (error) {
    console.error('Error testing email template:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to send test email'
    });
  }
});

// Bulk email test - sends 60 emails over 10 minutes (1 every 10 seconds)
router.post('/email-templates/bulk-test', auth, globalAdmin, async (req, res) => {
  try {
    const { testEmail } = req.body;
    const { Settings } = require('../models');
    const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
    
    const settings = await Settings.getSettings();
    
    const recipientEmail = testEmail || settings.emailProvider?.testMode?.redirectEmail || settings.emailProvider?.testEmail || settings.systemEmail;
    
    if (!recipientEmail) {
      return res.status(400).json({
        success: false,
        message: 'No test email address provided'
      });
    }
    
    // Queue 60 emails to be sent over 10 minutes
    const totalEmails = 60;
    const intervalSeconds = 10;
    
    console.log(`📧 Starting bulk email test: ${totalEmails} emails to ${recipientEmail} (1 every ${intervalSeconds}s)`);
    
    // Send first email immediately
    let sentCount = 0;
    
    const sendTestEmail = async (index) => {
      try {
        const testData = {
          userName: 'Bulk Test User',
          userEmail: recipientEmail,
          documentTypeName: 'Invoice',
          documentNumber: `BULK-TEST-${String(index).padStart(3, '0')}`,
          documentDate: new Date().toLocaleDateString('en-GB'),
          documentAmount: `£${(Math.random() * 10000).toFixed(2)}`,
          supplierName: 'Bulk Test Company',
          documentUrl: `${process.env.FRONTEND_URL || 'http://localhost:3001'}/invoices/bulk-test-${index}`,
          retentionPeriod: settings.documentRetentionPeriod || 90
        };
        
        await sendTemplatedEmail('document-notification', recipientEmail, testData, settings, {});
        sentCount++;
        console.log(`📧 Bulk test: Sent email ${sentCount}/${totalEmails}`);
      } catch (error) {
        console.error(`❌ Bulk test: Failed to send email ${index}:`, error.message);
      }
    };
    
    // Send first email immediately
    await sendTestEmail(1);
    
    // Schedule remaining emails
    for (let i = 2; i <= totalEmails; i++) {
      const delay = (i - 1) * intervalSeconds * 1000;
      setTimeout(() => sendTestEmail(i), delay);
    }
    
    res.json({
      success: true,
      message: `Bulk email test started: ${totalEmails} emails will be sent to ${recipientEmail} over ${Math.round(totalEmails * intervalSeconds / 60)} minutes (1 every ${intervalSeconds} seconds).`
    });
  } catch (error) {
    console.error('Error starting bulk email test:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to start bulk email test'
    });
  }
});

// Purge all documents (invoices, credit notes, statements) - Only Global Admins and Administrators
// 
// IMPORTANT: This ONLY deletes files in:
//   - Legacy: STORAGE_BASE/documents/invoices/, credit_notes/, statements/
//   - New: /mnt/data/processed/invoices/, creditnotes/, statements/
//   - Failed/Duplicates: /mnt/data/unprocessed/failed/, duplicates/
//
// PROTECTED (will NOT be deleted):
//   - Branding files (logos, favicons) in STORAGE_BASE root
//   - Templates in STORAGE_BASE/templates/
//   - Avatars in STORAGE_BASE/avatars/
//   - FTP upload folder (/mnt/data/invoice-portal/uploads/)
//

// Test Document Retention - Manually trigger retention cleanup
// This runs the same job that the scheduler runs, useful for testing
router.post('/test-retention', auth, globalAdmin, async (req, res) => {
  try {
    const { cleanupExpiredDocuments } = require('../jobs/documentRetentionCleanup');
    const { Invoice, CreditNote, Statement, Settings } = require('../models');
    const { Op } = require('sequelize');
    
    // Get retention settings
    const settings = await Settings.getSettings();
    const retentionPeriod = settings.documentRetentionPeriod;
    
    if (!retentionPeriod) {
      return res.json({
        success: true,
        message: 'Document retention is disabled (no retention period set)',
        retentionEnabled: false,
        expiredCount: 0
      });
    }
    
    // Count documents that would be deleted
    const now = new Date();
    const expiredInvoices = await Invoice.count({
      where: { retentionExpiryDate: { [Op.lte]: now } },
      paranoid: false
    });
    const expiredCreditNotes = await CreditNote.count({
      where: { retentionExpiryDate: { [Op.lte]: now } },
      paranoid: false
    });
    const expiredStatements = await Statement.count({
      where: { retentionExpiryDate: { [Op.lte]: now } },
      paranoid: false
    });
    
    const totalExpired = expiredInvoices + expiredCreditNotes + expiredStatements;
    
    console.log(`🧹 [Test Retention] Found ${totalExpired} expired documents (${expiredInvoices} invoices, ${expiredCreditNotes} credit notes, ${expiredStatements} statements)`);
    
    // Run the cleanup
    const result = await cleanupExpiredDocuments();
    
    res.json({
      success: true,
      message: `Retention cleanup completed. ${result.deleted} documents deleted.`,
      retentionEnabled: true,
      retentionPeriodDays: retentionPeriod,
      expiredBefore: {
        invoices: expiredInvoices,
        creditNotes: expiredCreditNotes,
        statements: expiredStatements,
        total: totalExpired
      },
      result
    });
  } catch (error) {
    console.error('Error testing retention:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get retention status - shows documents due for deletion
router.get('/retention-status', auth, globalAdmin, async (req, res) => {
  try {
    const { Invoice, CreditNote, Statement, Settings } = require('../models');
    const { Op } = require('sequelize');
    
    const settings = await Settings.getSettings();
    const retentionPeriod = settings.documentRetentionPeriod;
    
    if (!retentionPeriod) {
      return res.json({
        retentionEnabled: false,
        message: 'Document retention is disabled'
      });
    }
    
    const now = new Date();
    
    // Count expired documents
    const expiredInvoices = await Invoice.count({
      where: { retentionExpiryDate: { [Op.lte]: now } },
      paranoid: false
    });
    const expiredCreditNotes = await CreditNote.count({
      where: { retentionExpiryDate: { [Op.lte]: now } },
      paranoid: false
    });
    const expiredStatements = await Statement.count({
      where: { retentionExpiryDate: { [Op.lte]: now } },
      paranoid: false
    });
    
    // Count documents expiring soon (next 7 days)
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const expiringInvoices = await Invoice.count({
      where: { 
        retentionExpiryDate: { [Op.gt]: now, [Op.lte]: nextWeek }
      },
      paranoid: false
    });
    const expiringCreditNotes = await CreditNote.count({
      where: { 
        retentionExpiryDate: { [Op.gt]: now, [Op.lte]: nextWeek }
      },
      paranoid: false
    });
    const expiringStatements = await Statement.count({
      where: { 
        retentionExpiryDate: { [Op.gt]: now, [Op.lte]: nextWeek }
      },
      paranoid: false
    });
    
    res.json({
      retentionEnabled: true,
      retentionPeriodDays: retentionPeriod,
      expired: {
        invoices: expiredInvoices,
        creditNotes: expiredCreditNotes,
        statements: expiredStatements,
        total: expiredInvoices + expiredCreditNotes + expiredStatements
      },
      expiringIn7Days: {
        invoices: expiringInvoices,
        creditNotes: expiringCreditNotes,
        statements: expiringStatements,
        total: expiringInvoices + expiringCreditNotes + expiringStatements
      }
    });
  } catch (error) {
    console.error('Error getting retention status:', error);
    res.status(500).json({ message: error.message });
  }
});

router.post('/purge-files', auth, async (req, res) => {
  try {
    // Only global_admin and administrator can purge files
    if (!['global_admin', 'administrator'].includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Access denied. Only Global Administrators and Administrators can purge files.' 
      });
    }
    
    const { reason } = req.body;
    
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ 
        message: 'Deletion reason is required for accountability.' 
      });
    }
    
    const { Invoice, CreditNote, Statement, File } = require('../models');
    const { logActivity, ActivityType } = require('../services/activityLogger');
    const { STORAGE_BASE, PROCESSED_BASE, UNPROCESSED_BASE } = require('../config/storage');
    const { Op } = require('sequelize');
    
    const deletionReason = reason.trim();
    const deletedBy = req.user.userId;
    const deletedAt = new Date();
    
    // Statistics
    let invoicesDeleted = 0;
    let creditNotesDeleted = 0;
    let statementsDeleted = 0;
    let unallocatedFilesDeleted = 0;
    let filesDeleted = 0;
    let filesFailed = 0;
    
    // Helper function to delete file - ONLY deletes files in allowed folders
    const deleteFile = (fileUrl) => {
      if (!fileUrl) return false;
      
      try {
        let filePath;
        if (path.isAbsolute(fileUrl)) {
          filePath = fileUrl;
        } else {
          // Try relative to backend directory first
          filePath = path.join(__dirname, '..', fileUrl);
          if (!fs.existsSync(filePath)) {
            // Try relative to storage base
            filePath = path.join(STORAGE_BASE, fileUrl.replace(/^\//, ''));
          }
        }
        
        // SECURITY: Only delete files that are in allowed folder structures
        // This prevents accidental deletion of branding files, templates, etc.
        const normalizedPath = path.normalize(filePath);
        
        // Define all allowed directories for document purge
        const legacyDocumentsDir = path.normalize(path.join(STORAGE_BASE, 'documents'));
        const processedDir = path.normalize(PROCESSED_BASE);
        const unprocessedDir = path.normalize(UNPROCESSED_BASE);
        
        // Check if file is within any allowed directory
        const isInLegacyDocs = normalizedPath.startsWith(legacyDocumentsDir + path.sep);
        const isInProcessed = normalizedPath.startsWith(processedDir + path.sep);
        const isInUnprocessed = normalizedPath.startsWith(unprocessedDir + path.sep);
        
        if (!isInLegacyDocs && !isInProcessed && !isInUnprocessed) {
          console.warn(`⚠️  Skipping file outside allowed folders: ${filePath}`);
          return false;
        }
        
        // Additional check for legacy docs: ensure it's in invoices, credit_notes, or statements subfolder
        if (isInLegacyDocs) {
          const relativePath = path.relative(legacyDocumentsDir, normalizedPath);
          const firstSegment = relativePath.split(path.sep)[0];
          if (!['invoices', 'credit_notes', 'statements'].includes(firstSegment)) {
            console.warn(`⚠️  Skipping file not in document type folder: ${filePath}`);
            return false;
          }
        }
        
        // Additional check for processed: ensure it's in invoices, creditnotes, or statements subfolder
        if (isInProcessed) {
          const relativePath = path.relative(processedDir, normalizedPath);
          const firstSegment = relativePath.split(path.sep)[0];
          if (!['invoices', 'creditnotes', 'statements'].includes(firstSegment)) {
            console.warn(`⚠️  Skipping file not in document type folder: ${filePath}`);
            return false;
          }
        }
        
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          return true;
        }
        return false;
      } catch (error) {
        console.error(`⚠️  Failed to delete file ${fileUrl}:`, error.message);
        return false;
      }
    };
    
    // Delete all invoices
    console.log('🗑️  Starting invoice purge...');
    const invoices = await Invoice.findAll();
    for (const invoice of invoices) {
      try {
        // Delete physical file
        if (invoice.fileUrl && deleteFile(invoice.fileUrl)) {
          filesDeleted++;
        } else if (invoice.fileUrl) {
          filesFailed++;
        }
        
        // Also delete the linked File record if it exists (match by filename)
        if (invoice.fileUrl) {
          const fileName = path.basename(invoice.fileUrl);
          const linkedFile = await File.findOne({
            where: {
              [Op.or]: [
                { filePath: { [Op.like]: `%${fileName}%` } },
                { fileName: fileName }
              ],
              deletedAt: null
            }
          });
          if (linkedFile) {
            try {
              // Soft delete to preserve hash for duplicate detection
              linkedFile.deletedAt = new Date();
              await linkedFile.save();
              console.log(`   ✅ Soft deleted linked File record (hash preserved): ${linkedFile.id} (${linkedFile.fileName})`);
            } catch (fileError) {
              console.error(`   ⚠️  Failed to soft delete linked File record ${linkedFile.id}:`, fileError.message);
            }
          }
        }
        
        // Hard delete from database
        await invoice.destroy({ force: true });
        invoicesDeleted++;
      } catch (error) {
        console.error(`❌ Error deleting invoice ${invoice.id}:`, error.message);
        filesFailed++;
      }
    }
    
    // Delete all credit notes
    console.log('🗑️  Starting credit note purge...');
    const creditNotes = await CreditNote.findAll();
    for (const creditNote of creditNotes) {
      try {
        // Delete physical file
        if (creditNote.fileUrl && deleteFile(creditNote.fileUrl)) {
          filesDeleted++;
        } else if (creditNote.fileUrl) {
          filesFailed++;
        }
        
        // Also delete the linked File record if it exists (match by filename)
        if (creditNote.fileUrl) {
          const fileName = path.basename(creditNote.fileUrl);
          const linkedFile = await File.findOne({
            where: {
              [Op.or]: [
                { filePath: { [Op.like]: `%${fileName}%` } },
                { fileName: fileName }
              ],
              deletedAt: null
            }
          });
          if (linkedFile) {
            try {
              // Soft delete to preserve hash for duplicate detection
              linkedFile.deletedAt = new Date();
              await linkedFile.save();
              console.log(`   ✅ Soft deleted linked File record (hash preserved): ${linkedFile.id} (${linkedFile.fileName})`);
            } catch (fileError) {
              console.error(`   ⚠️  Failed to soft delete linked File record ${linkedFile.id}:`, fileError.message);
            }
          }
        }
        
        // Hard delete from database
        await creditNote.destroy({ force: true });
        creditNotesDeleted++;
      } catch (error) {
        console.error(`❌ Error deleting credit note ${creditNote.id}:`, error.message);
        filesFailed++;
      }
    }
    
    // Delete all statements
    console.log('🗑️  Starting statement purge...');
    const statements = await Statement.findAll();
    for (const statement of statements) {
      try {
        // Delete physical file
        if (statement.fileUrl && deleteFile(statement.fileUrl)) {
          filesDeleted++;
        } else if (statement.fileUrl) {
          filesFailed++;
        }
        
        // Also delete the linked File record if it exists (match by filename)
        if (statement.fileUrl) {
          const fileName = path.basename(statement.fileUrl);
          const linkedFile = await File.findOne({
            where: {
              [Op.or]: [
                { filePath: { [Op.like]: `%${fileName}%` } },
                { fileName: fileName }
              ],
              deletedAt: null
            }
          });
          if (linkedFile) {
            try {
              // Soft delete to preserve hash for duplicate detection
              linkedFile.deletedAt = new Date();
              await linkedFile.save();
              console.log(`   ✅ Soft deleted linked File record (hash preserved): ${linkedFile.id} (${linkedFile.fileName})`);
            } catch (fileError) {
              console.error(`   ⚠️  Failed to soft delete linked File record ${linkedFile.id}:`, fileError.message);
            }
          }
        }
        
        // Hard delete from database
        await statement.destroy({ force: true });
        statementsDeleted++;
      } catch (error) {
        console.error(`❌ Error deleting statement ${statement.id}:`, error.message);
        filesFailed++;
      }
    }
    
    // Also scan and delete orphaned files in documents folders ONLY
    // This ensures we never touch branding files, templates, avatars, test, or temp files
    // Structure: documents/{invoices|credit_notes|statements}/{status}/{year}/{month}/{filename}
    console.log('🗑️  Scanning for orphaned files in documents folders only...');
    const documentsDir = path.join(STORAGE_BASE, 'documents');
    if (fs.existsSync(documentsDir)) {
      const scanAndDelete = (dir, allowedFolders) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              // Only recurse into allowed folders (invoices, credit_notes, statements)
              const relativePath = path.relative(documentsDir, fullPath);
              const firstSegment = relativePath.split(path.sep)[0];
              if (allowedFolders.includes(firstSegment)) {
                scanAndDelete(fullPath, allowedFolders);
              } else {
                console.log(`🔒 Skipping protected folder: ${fullPath}`);
              }
            } else if (entry.isFile() && (entry.name.endsWith('.pdf') || entry.name.endsWith('.xlsx') || entry.name.endsWith('.xls'))) {
              try {
                fs.unlinkSync(fullPath);
                filesDeleted++;
                console.log(`🗑️  Deleted orphaned file: ${fullPath}`);
              } catch (error) {
                console.error(`⚠️  Failed to delete orphaned file ${fullPath}:`, error.message);
                filesFailed++;
              }
            }
          }
        } catch (error) {
          console.error(`⚠️  Error scanning directory ${dir}:`, error.message);
        }
      };
      
      // ONLY scan invoices, credit_notes, and statements folders
      // PROTECTED: templates/, avatars/, test/, temp/, and root uploads/ files are NEVER touched
      const allowedFolders = ['invoices', 'credit_notes', 'statements'];
      allowedFolders.forEach(folder => {
        const folderPath = path.join(documentsDir, folder);
        if (fs.existsSync(folderPath)) {
          scanAndDelete(folderPath, allowedFolders);
        }
      });
    }
    
    // Also delete all File records (unallocated, failed, duplicate) and their physical files
    console.log('🗑️  Starting unallocated/failed/duplicate File records purge...');
    const unallocatedFiles = await File.findAll({
      where: {
        status: { [Op.in]: ['unallocated', 'failed', 'duplicate'] },
        deletedAt: null
      }
    });
    
    // Also delete ALL orphaned File records (any status, but no linked invoice/credit note/statement)
    // This ensures we clean up File records that might have been orphaned by the purge
    console.log('🗑️  Cleaning up orphaned File records (any status without linked documents)...');
    const allFiles = await File.findAll({
      where: {
        deletedAt: null
      }
    });
    
    // Filter to find orphaned files (no linked documents)
    const orphanedFiles = [];
    for (const file of allFiles) {
      let hasLinkedDocument = false;
      
      if (file.filePath || file.fileName) {
        const searchPattern = file.filePath || file.fileName;
        
        // Check for linked invoice
        const linkedInvoice = await Invoice.findOne({
          where: {
            [Op.or]: [
              { fileUrl: { [Op.like]: `%${searchPattern}%` } },
              { 'metadata.fileName': { [Op.like]: `%${file.fileName}%` } }
            ],
            deletedAt: null
          }
        });
        
        // Check for linked credit note
        const linkedCreditNote = await CreditNote.findOne({
          where: {
            [Op.or]: [
              { fileUrl: { [Op.like]: `%${searchPattern}%` } },
              { 'metadata.fileName': { [Op.like]: `%${file.fileName}%` } }
            ]
          }
        });
        
        // Check for linked statement
        const linkedStatement = await Statement.findOne({
          where: {
            [Op.or]: [
              { fileUrl: { [Op.like]: `%${searchPattern}%` } },
              { 'metadata.fileName': { [Op.like]: `%${file.fileName}%` } }
            ]
          }
        });
        
        hasLinkedDocument = !!(linkedInvoice || linkedCreditNote || linkedStatement);
      }
      
      if (!hasLinkedDocument) {
        orphanedFiles.push(file);
      }
    }
    
    let orphanedDeleted = 0;
    for (const file of orphanedFiles) {
      // File is already confirmed to have no linked document (checked above)
      // Delete it
      try {
        // Delete physical file if it exists
        if (file.filePath && fs.existsSync(file.filePath)) {
          try {
            fs.unlinkSync(file.filePath);
            filesDeleted++;
          } catch (fileError) {
            console.error(`⚠️  Failed to delete orphaned file ${file.filePath}:`, fileError.message);
            filesFailed++;
          }
        }
        
        // Soft delete to preserve hash for duplicate detection
        file.deletedAt = new Date();
        await file.save();
        orphanedDeleted++;
        console.log(`   ✅ Soft deleted orphaned File record (hash preserved): ${file.id} (${file.fileName})`);
      } catch (error) {
        console.error(`❌ Error deleting orphaned file ${file.id}:`, error.message);
        filesFailed++;
      }
    }
    
    console.log(`   ✅ Deleted ${orphanedDeleted} orphaned File records`);
    
    for (const file of unallocatedFiles) {
      try {
        // Delete physical file if it exists
        if (file.filePath && fs.existsSync(file.filePath)) {
          try {
            fs.unlinkSync(file.filePath);
            filesDeleted++;
            console.log(`🗑️  Deleted unallocated file: ${file.filePath}`);
          } catch (fileError) {
            console.error(`⚠️  Failed to delete unallocated file ${file.filePath}:`, fileError.message);
            filesFailed++;
          }
        }
        
        // Hard delete from database
        await file.destroy({ force: true });
        unallocatedFilesDeleted++;
      } catch (error) {
        console.error(`❌ Error deleting unallocated file ${file.id}:`, error.message);
        filesFailed++;
      }
    }
    
    // Log the purge activity
    await logActivity({
      type: ActivityType.FILE_PURGE,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Purged all documents from system`,
      details: { 
        reason: deletionReason,
        invoicesDeleted,
        creditNotesDeleted,
        statementsDeleted,
        unallocatedFilesDeleted,
        filesDeleted,
        filesFailed,
        totalDocumentsDeleted: invoicesDeleted + creditNotesDeleted + statementsDeleted + unallocatedFilesDeleted
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    // NUKE actual folder contents (catch any orphan files not in database)
    let folderFilesDeleted = 0;
    const nukeFolderContents = (folderPath, recursive = true) => {
      if (!fs.existsSync(folderPath)) return 0;
      let count = 0;
      const items = fs.readdirSync(folderPath);
      for (const item of items) {
        const itemPath = path.join(folderPath, item);
        const stat = fs.statSync(itemPath);
        if (stat.isDirectory() && recursive) {
          count += nukeFolderContents(itemPath, true);
          // Remove empty directories
          try {
            if (fs.readdirSync(itemPath).length === 0) {
              fs.rmdirSync(itemPath);
            }
          } catch (e) { /* ignore */ }
        } else if (stat.isFile()) {
          try {
            fs.unlinkSync(itemPath);
            count++;
          } catch (e) {
            console.error(`   ⚠️  Failed to delete orphan file: ${itemPath}`);
          }
        }
      }
      return count;
    };
    
    // Clear /mnt/data/processed folders
    console.log('🗑️  Nuking processed folders...');
    folderFilesDeleted += nukeFolderContents(path.join(PROCESSED_BASE, 'invoices'));
    folderFilesDeleted += nukeFolderContents(path.join(PROCESSED_BASE, 'creditnotes'));
    folderFilesDeleted += nukeFolderContents(path.join(PROCESSED_BASE, 'statements'));
    
    // Clear /mnt/data/unprocessed folders
    console.log('🗑️  Nuking unprocessed folders...');
    folderFilesDeleted += nukeFolderContents(path.join(UNPROCESSED_BASE, 'failed'));
    folderFilesDeleted += nukeFolderContents(path.join(UNPROCESSED_BASE, 'duplicates'));
    
    // Clear legacy documents folder if exists
    const legacyDocsPath = path.join(STORAGE_BASE, 'documents');
    if (fs.existsSync(legacyDocsPath)) {
      console.log('🗑️  Nuking legacy documents folder...');
      folderFilesDeleted += nukeFolderContents(legacyDocsPath);
    }
    
    console.log(`\n📊 File Purge Summary:`);
    console.log(`   ✅ Invoices deleted: ${invoicesDeleted}`);
    console.log(`   ✅ Credit notes deleted: ${creditNotesDeleted}`);
    console.log(`   ✅ Statements deleted: ${statementsDeleted}`);
    console.log(`   ✅ Unallocated File records deleted: ${unallocatedFilesDeleted}`);
    console.log(`   ✅ Physical files deleted (from DB): ${filesDeleted}`);
    console.log(`   ✅ Orphan files nuked from folders: ${folderFilesDeleted}`);
    console.log(`   ⚠️  Files failed: ${filesFailed}`);
    console.log(`   👤 Purged by: ${req.user.email} (${deletedBy})`);
    console.log(`   📝 Reason: ${deletionReason}\n`);
    
    res.json({
      success: true,
      invoicesDeleted,
      creditNotesDeleted,
      statementsDeleted,
      unallocatedFilesDeleted,
      filesDeleted,
      folderFilesDeleted,
      filesFailed,
      purgedAt: deletedAt.toISOString()
    });
  } catch (error) {
    console.error('Error purging files:', error);
    res.status(500).json({ message: error.message });
  }
});

// Email Queue Stress Test - queues test notification emails to current user
router.post('/email-stress-test', auth, async (req, res) => {
  try {
    // Only global admins and administrators can run stress tests
    if (!['global_admin', 'administrator'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied. Only administrators can run email stress tests.' });
    }
    
    const { count = 10, includeAttachment = false, documentType = 'invoice' } = req.body;
    
    // Validate count - limit to 100 to conserve Mailtrap credits (500/month limit)
    const emailCount = Math.min(Math.max(parseInt(count) || 10, 1), 100);
    
    const settings = await Settings.getSettings();
    const { wrapEmailContent, emailButton, getEmailTheme } = require('../utils/emailTheme');
    const { emailQueue } = require('../config/queue');
    const { PROCESSED_BASE } = require('../config/storage');
    const { isEmailEnabled } = require('../utils/emailService');
    const { User } = require('../models');
    
    // Check if email is enabled
    if (!isEmailEnabled(settings)) {
      return res.status(400).json({ 
        message: 'Email is not enabled. Please configure an email provider first.' 
      });
    }
    
    // Fetch current user from database to get email (JWT only has userId and role)
    const currentUser = await User.findByPk(req.user.userId);
    if (!currentUser || !currentUser.email) {
      return res.status(400).json({ 
        message: 'Could not determine your email address. Please try logging in again.' 
      });
    }
    
    const theme = getEmailTheme(settings);
    const primaryColor = theme.primaryColor;
    const portalName = settings.portalName || settings.siteTitle || 'Makita Invoice Portal';
    const recipientEmail = currentUser.email;
    const recipientName = currentUser.name || currentUser.email;
    
    // Create a dummy PDF for attachment testing
    // This is a minimal valid PDF that renders a simple test page
    const createDummyPdf = (invoiceNumber) => {
      const content = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 150 >> stream
BT
/F1 24 Tf
100 700 Td
(TEST INVOICE) Tj
/F1 14 Tf
0 -40 Td
(Invoice: ${invoiceNumber}) Tj
0 -25 Td
(This is a test PDF for email stress testing.) Tj
ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000468 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
547
%%EOF`;
      return Buffer.from(content, 'utf-8');
    };
    
    // Also try to find a real sample PDF for variety
    let samplePdfPath = null;
    let samplePdfName = null;
    
    if (includeAttachment) {
      const invoicesDir = path.join(PROCESSED_BASE, 'invoices');
      
      const findPdf = (dir, depth = 0) => {
        if (depth > 5 || !fs.existsSync(dir)) return null;
        try {
          const items = fs.readdirSync(dir);
          for (const item of items) {
            const itemPath = path.join(dir, item);
            const stat = fs.statSync(itemPath);
            if (stat.isFile() && item.toLowerCase().endsWith('.pdf')) {
              return itemPath;
            } else if (stat.isDirectory()) {
              const found = findPdf(itemPath, depth + 1);
              if (found) return found;
            }
          }
        } catch (e) { /* ignore */ }
        return null;
      };
      
      samplePdfPath = findPdf(invoicesDir);
      if (samplePdfPath) {
        samplePdfName = path.basename(samplePdfPath);
        console.log(`[StressTest] Found sample PDF: ${samplePdfName}`);
      } else {
        console.log('[StressTest] No sample PDF found, will use generated dummy PDFs');
      }
    }
    
    // Queue the emails
    const queuedJobs = [];
    const documentTypeName = documentType === 'invoice' ? 'Invoice' : 'Credit Note';
    
    for (let i = 1; i <= emailCount; i++) {
      const testInvoiceNumber = `TEST-${Date.now()}-${i.toString().padStart(4, '0')}`;
      const testAmount = (Math.random() * 1000 + 100).toFixed(2);
      const testCompany = 'Test Company Ltd';
      
      // Build email content similar to real notification
      const emailContent = `
        <h2 style="color: ${primaryColor}; margin-bottom: 20px;">New ${documentTypeName} Available</h2>
        <p>Hello ${recipientName},</p>
        <p>A new ${documentTypeName.toLowerCase()} has been uploaded for <strong>${testCompany}</strong>:</p>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr style="background: #f8f9fa;">
            <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">${documentTypeName} Number</td>
            <td style="padding: 12px; border: 1px solid #e0e0e0;">${testInvoiceNumber}</td>
          </tr>
          <tr>
            <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">Amount</td>
            <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600; color: ${primaryColor};">GBP ${testAmount}</td>
          </tr>
          <tr style="background: #f8f9fa;">
            <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">Date</td>
            <td style="padding: 12px; border: 1px solid #e0e0e0;">${new Date().toLocaleDateString('en-GB')}</td>
          </tr>
          <tr>
            <td style="padding: 12px; border: 1px solid #e0e0e0; font-weight: 600;">Company</td>
            <td style="padding: 12px; border: 1px solid #e0e0e0;">${testCompany}</td>
          </tr>
        </table>
        
        ${emailButton('View Document', '#', settings)}
        
        <div style="margin-top: 30px; padding: 12px; background: #fff3cd; border: 1px solid #f59f00; border-radius: 4px;">
          <strong style="color: #856404;">Test Email ${i} of ${emailCount}</strong><br>
          <span style="color: #856404; font-size: 12px;">This is a stress test email. No action required.</span>
        </div>
      `;
      
      const html = wrapEmailContent(emailContent, settings);
      
      // Build attachments array
      // Send half with attachments, half without (alternating)
      const attachments = [];
      const shouldAttach = includeAttachment && (i % 2 === 1); // Odd numbered emails get attachments
      
      if (shouldAttach) {
        if (samplePdfPath && fs.existsSync(samplePdfPath)) {
          // Use real sample PDF - read as base64 to avoid Buffer serialization issues
          const pdfContent = fs.readFileSync(samplePdfPath);
          attachments.push({
            filename: `${testInvoiceNumber}.pdf`,
            content: pdfContent.toString('base64'),
            encoding: 'base64',
            contentType: 'application/pdf'
          });
        } else {
          // Use generated dummy PDF - encode as base64 for proper serialization
          attachments.push({
            filename: `${testInvoiceNumber}.pdf`,
            content: createDummyPdf(testInvoiceNumber).toString('base64'),
            encoding: 'base64',
            contentType: 'application/pdf'
          });
        }
      }
      
      // Queue the email
      // NOTE: Don't pass full settings object - it has serialization issues through Redis
      // Let the worker fetch fresh settings from database instead
      const job = await emailQueue.add('send-email', {
        to: recipientEmail,
        subject: `[TEST ${i}/${emailCount}] New ${documentTypeName} Available - ${testCompany}`,
        html,
        text: `Test Email ${i} of ${emailCount}\n\n${documentTypeName}: ${testInvoiceNumber}\nAmount: GBP ${testAmount}\nCompany: ${testCompany}\n\nThis is a stress test email.`,
        attachments,
        // settings omitted - worker will fetch from database
        metadata: {
          type: 'stress_test',
          emailNumber: i,
          totalEmails: emailCount,
          documentType,
          hasAttachment: attachments.length > 0
        }
      }, {
        priority: 0, // Normal priority
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      });
      
      queuedJobs.push({
        jobId: job.id,
        emailNumber: i,
        hasAttachment: attachments.length > 0
      });
    }
    
    // Calculate estimated delivery time based on Mailtrap rate limiting (10 emails per 10 seconds = 60/min)
    const rateLimitPerMinute = 60; // Mailtrap allows 10 per 10 seconds
    const estimatedSeconds = Math.ceil(emailCount / (rateLimitPerMinute / 60));
    const emailsWithAttachment = includeAttachment ? Math.floor(emailCount / 2) : 0;
    const emailsWithoutAttachment = emailCount - emailsWithAttachment;
    
    console.log(`[StressTest] Queued ${emailCount} test emails to ${recipientEmail}`);
    console.log(`[StressTest] With attachments: ${emailsWithAttachment}, Without: ${emailsWithoutAttachment}`);
    console.log(`[StressTest] Attachment source: ${samplePdfPath ? 'Real PDF' : 'Generated dummy PDF'}`);
    console.log(`[StressTest] Estimated delivery time: ~${estimatedSeconds} second(s)`);
    
    res.json({
      success: true,
      message: `Queued ${emailCount} test emails to ${recipientEmail}`,
      emailCount,
      recipientEmail,
      documentType,
      attachmentsEnabled: includeAttachment,
      emailsWithAttachment,
      emailsWithoutAttachment,
      attachmentSource: includeAttachment ? (samplePdfPath ? `Real PDF (${samplePdfName})` : 'Generated dummy PDF') : 'N/A',
      estimatedDeliverySeconds: estimatedSeconds,
      rateLimitInfo: '10 emails per 10 seconds (Mailtrap limit)',
      maxEmailsPerTest: 100,
      monthlyLimit: '500 emails/month on Mailtrap free tier'
    });
    
  } catch (error) {
    console.error('Error running email stress test:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * POST /api/settings/clear-import-history
 * Clears all file records from the files table, allowing previously imported files to be re-imported
 * Only accessible by Global Administrators
 */
router.post('/clear-import-history', auth, async (req, res) => {
  try {
    // Only global_admin can clear import history
    if (req.user.role !== 'global_admin') {
      return res.status(403).json({ 
        message: 'Access denied. Only Global Administrators can clear import history.' 
      });
    }
    
    const { reason } = req.body;
    
    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({ 
        message: 'A reason is required (minimum 5 characters) for accountability.' 
      });
    }
    
    const { File, sequelize } = require('../models');
    const { logActivity, ActivityType } = require('../services/activityLogger');
    
    // Get count before deletion
    const countBefore = await File.count();
    
    if (countBefore === 0) {
      return res.json({
        success: true,
        message: 'No file records to clear.',
        deletedCount: 0
      });
    }
    
    // Hard delete all file records (not soft delete)
    // This removes all file hashes so files can be re-imported
    await sequelize.query('DELETE FROM files');
    
    // Log the action
    await logActivity({
      type: ActivityType.SYSTEM_SETTINGS_UPDATED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Cleared file import history - ${countBefore} file record(s) deleted`,
      details: {
        deletedCount: countBefore,
        reason: reason.trim(),
        action: 'clear_import_history'
      },
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    console.log(`🗑️  Import history cleared by ${req.user.email}: ${countBefore} file records deleted. Reason: ${reason.trim()}`);
    
    res.json({
      success: true,
      message: `Successfully cleared ${countBefore} file record(s). Files can now be re-imported.`,
      deletedCount: countBefore
    });
    
  } catch (error) {
    console.error('Error clearing import history:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * GET /api/settings/import-history-count
 * Returns the count of file records in the files table
 */
router.get('/import-history-count', auth, async (req, res) => {
  try {
    if (!['global_admin', 'administrator'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    const { File } = require('../models');
    const count = await File.count();
    
    res.json({ count });
  } catch (error) {
    console.error('Error getting import history count:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Get email logs for terminal viewer
 * GET /api/settings/email-logs
 */
router.get('/email-logs', auth, globalAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const status = req.query.status || null;
    
    const { getEmailLogs, getEmailQueueStats } = require('../utils/emailQueue');
    const { EmailLog } = require('../models');
    const { getActivityLogs } = require('../services/activityLogger');
    
    // Get email logs
    const emailLogsResult = await getEmailLogs({
      page: 1,
      limit,
      status
    });
    
    // Get queue status
    const queueStatus = await getEmailQueueStats();
    
    // Get recent email-related activity logs (scheduled tasks, batch notifications)
    // Fetch email_sent and import_batch_notification separately and combine
    const emailSentLogs = await getActivityLogs({
      page: 1,
      limit: 25,
      type: 'email_sent'
    });
    
    const batchNotificationLogs = await getActivityLogs({
      page: 1,
      limit: 25,
      type: 'import_batch_notification'
    });
    
    const activityLogs = {
      logs: [...(emailSentLogs.logs || []), ...(batchNotificationLogs.logs || [])]
    };
    
    // Format email logs for terminal display
    const formattedLogs = emailLogsResult.logs.map(log => {
      const logData = log.toJSON ? log.toJSON() : log;
      const timestamp = new Date(logData.createdAt || logData.timestamp);
      
      // Determine status indicator
      let statusIndicator = '[QUEUED]';
      let color = 'yellow';
      
      if (logData.status === 'SENT') {
        statusIndicator = '[SENT]';
        color = 'green';
      } else if (logData.status === 'SENDING') {
        statusIndicator = '[SENDING]';
        color = 'yellow';
      } else if (logData.status === 'FAILED_PERMANENT') {
        statusIndicator = '[FAILED]';
        color = 'red';
      } else if (logData.status === 'DEFERRED') {
        statusIndicator = '[DEFERRED]';
        color = 'gray';
      }
      
      // Build log message
      let message = `${statusIndicator} -> ${logData.to}`;
      
      if (logData.recipientCount > 1) {
        message = `${statusIndicator} -> ${logData.recipientCount} recipients (BATCH)`;
      }
      
      message += ` | Subject: "${logData.subject}"`;
      
      if (logData.provider) {
        message += ` | Provider: ${logData.provider}`;
      }
      
      if (logData.messageId && logData.status === 'SENT') {
        message += ` | MessageID: ${logData.messageId}`;
      }
      
      if (logData.lastError && logData.status !== 'SENT') {
        message += ` | Error: ${logData.lastError.substring(0, 100)}`;
      }
      
      if (logData.attempts > 1) {
        message += ` | Attempts: ${logData.attempts}`;
      }
      
      return {
        id: logData.id,
        timestamp: timestamp.toISOString(),
        status: logData.status,
        message,
        color,
        to: logData.to,
        recipientCount: logData.recipientCount || 1,
        subject: logData.subject,
        provider: logData.provider,
        messageId: logData.messageId,
        error: logData.lastError,
        attempts: logData.attempts,
        isBatch: (logData.recipientCount || 1) > 1
      };
    });
    
    // Format activity logs for scheduled tasks and batch notifications
    const scheduledTaskLogs = (activityLogs.logs || []).filter(log => {
      const logData = log.toJSON ? log.toJSON() : log;
      return logData.type === 'import_batch_notification' || 
             (logData.type === 'email_sent' && logData.details?.isBatch);
    }).map(log => {
      const logData = log.toJSON ? log.toJSON() : log;
      const timestamp = new Date(logData.timestamp);
      const details = typeof logData.details === 'string' ? JSON.parse(logData.details) : (logData.details || {});
      
      let message = '[SCHEDULED]';
      
      if (logData.type === 'import_batch_notification') {
        message += ` Batch notification triggered | Emails queued: ${details.emailCount || 'N/A'}`;
      } else if (logData.type === 'email_sent' && details.isBatch) {
        message += ` Batch email sent | ${details.recipientCount || 1} recipients | Subject: "${details.subject || 'N/A'}"`;
      }
      
      return {
        id: `activity_${logData.id}`,
        timestamp: timestamp.toISOString(),
        status: 'SCHEDULED',
        message,
        color: 'blue',
        type: 'scheduled_task'
      };
    });
    
    // Combine and sort by timestamp (newest first)
    const allLogs = [...formattedLogs, ...scheduledTaskLogs].sort((a, b) => {
      return new Date(b.timestamp) - new Date(a.timestamp);
    }).slice(0, limit);
    
    res.json({
      logs: allLogs,
      queueStatus,
      count: allLogs.length
    });
  } catch (error) {
    console.error('Error getting email logs:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

