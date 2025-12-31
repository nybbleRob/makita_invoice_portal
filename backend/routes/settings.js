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
          'page_no'
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
      
      // If emailProvider is not set, migrate smtp to emailProvider
      if (!settings.emailProvider || !settings.emailProvider.enabled) {
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
//   - STORAGE_BASE/documents/invoices/
//   - STORAGE_BASE/documents/credit_notes/
//   - STORAGE_BASE/documents/statements/
//
// PROTECTED (will NOT be deleted):
//   - Branding files (logos, favicons) in STORAGE_BASE root
//   - Templates in STORAGE_BASE/templates/
//   - Avatars in STORAGE_BASE/avatars/
//   - Test files in STORAGE_BASE/test/
//   - Temp files in STORAGE_BASE/temp/
//
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
    const { STORAGE_BASE } = require('../config/storage');
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
    
    // Helper function to delete file - ONLY deletes files in documents folders
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
        
        // SECURITY: Only delete files that are in the documents folder structure
        // This prevents accidental deletion of branding files, templates, etc.
        const normalizedPath = path.normalize(filePath);
        const documentsDir = path.join(STORAGE_BASE, 'documents');
        const normalizedDocumentsDir = path.normalize(documentsDir);
        
        // Check if file is within documents directory
        if (!normalizedPath.startsWith(normalizedDocumentsDir + path.sep) && 
            normalizedPath !== normalizedDocumentsDir) {
          console.warn(`⚠️  Skipping file outside documents folder: ${filePath}`);
          return false;
        }
        
        // Additional check: ensure it's in invoices, credit_notes, or statements subfolder
        const relativePath = path.relative(normalizedDocumentsDir, normalizedPath);
        const firstSegment = relativePath.split(path.sep)[0];
        if (!['invoices', 'credit_notes', 'statements'].includes(firstSegment)) {
          console.warn(`⚠️  Skipping file not in document type folder: ${filePath}`);
          return false;
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
    
    console.log(`\n📊 File Purge Summary:`);
    console.log(`   ✅ Invoices deleted: ${invoicesDeleted}`);
    console.log(`   ✅ Credit notes deleted: ${creditNotesDeleted}`);
    console.log(`   ✅ Statements deleted: ${statementsDeleted}`);
    console.log(`   ✅ Unallocated File records deleted: ${unallocatedFilesDeleted}`);
    console.log(`   ✅ Physical files deleted: ${filesDeleted}`);
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
      filesFailed,
      purgedAt: deletedAt.toISOString()
    });
  } catch (error) {
    console.error('Error purging files:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

