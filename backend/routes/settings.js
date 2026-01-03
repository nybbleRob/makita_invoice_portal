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
      settings.onlyExternalUsersChangeDocumentStatus = req.body.onlyExternalUsersChangeDocumentStatus === true || req.body.onlyExternalUsersChangeDocumentStatus === 'true';
    }
    
    // Update queries enabled setting
    if (req.body.queriesEnabled !== undefined) {
      settings.queriesEnabled = req.body.queriesEnabled === true || req.body.queriesEnabled === 'true';
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
    const { wrapEmailContent } = require('../utils/emailTheme');
    const { emailQueue } = require('../config/queue');
    const { PROCESSED_BASE } = require('../config/storage');
    const { isEmailEnabled } = require('../utils/emailService');
    
    // Check if email is enabled
    if (!isEmailEnabled(settings)) {
      return res.status(400).json({ 
        message: 'Email is not enabled. Please configure an email provider first.' 
      });
    }
    
    const primaryColor = settings.primaryColor || '#066fd1';
    const portalName = settings.portalName || settings.siteTitle || 'Makita Invoice Portal';
    const recipientEmail = req.user.email;
    const recipientName = req.user.name || req.user.email;
    
    // Find a sample PDF for attachments if requested
    let samplePdfPath = null;
    let samplePdfName = null;
    
    if (includeAttachment) {
      // Look for any PDF in processed invoices folder
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
        console.log('[StressTest] No sample PDF found, emails will be sent without attachments');
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
        
        <p style="margin-top: 24px;">
          <a href="#" style="display: inline-block; padding: 12px 24px; background-color: ${primaryColor}; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">
            View Document
          </a>
        </p>
        
        <div style="margin-top: 30px; padding: 12px; background: #fff3cd; border: 1px solid #f59f00; border-radius: 4px;">
          <strong style="color: #856404;">Test Email ${i} of ${emailCount}</strong><br>
          <span style="color: #856404; font-size: 12px;">This is a stress test email. No action required.</span>
        </div>
      `;
      
      const html = wrapEmailContent(emailContent, settings);
      
      // Build attachments array
      const attachments = [];
      if (samplePdfPath && fs.existsSync(samplePdfPath)) {
        attachments.push({
          filename: `${testInvoiceNumber}.pdf`,
          path: samplePdfPath,
          contentType: 'application/pdf'
        });
      }
      
      // Queue the email
      const job = await emailQueue.add('send-email', {
        to: recipientEmail,
        subject: `[TEST ${i}/${emailCount}] New ${documentTypeName} Available - ${testCompany}`,
        html,
        text: `Test Email ${i} of ${emailCount}\n\n${documentTypeName}: ${testInvoiceNumber}\nAmount: GBP ${testAmount}\nCompany: ${testCompany}\n\nThis is a stress test email.`,
        attachments,
        settings,
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
    
    console.log(`[StressTest] Queued ${emailCount} test emails to ${recipientEmail}`);
    console.log(`[StressTest] Attachments: ${includeAttachment ? (samplePdfPath ? 'Yes' : 'No sample PDF found') : 'Disabled'}`);
    console.log(`[StressTest] Estimated delivery time: ~${estimatedSeconds} second(s)`);
    
    res.json({
      success: true,
      message: `Queued ${emailCount} test emails to ${recipientEmail}`,
      emailCount,
      recipientEmail,
      documentType,
      hasAttachments: includeAttachment && !!samplePdfPath,
      samplePdfUsed: samplePdfName,
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

module.exports = router;

