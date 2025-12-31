/**
 * User Import Routes
 * Handles bulk import of users from CSV/Excel files
 * Supports importing regular users and notification contacts
 */

const express = require('express');
const multer = require('multer');
const Papa = require('papaparse');
const XLSX = require('xlsx');
const { User, Company, UserCompany, sequelize } = require('../models');
const { Op } = require('sequelize');
const auth = require('../middleware/auth');
const globalAdmin = require('../middleware/globalAdmin');
const { logActivity, ActivityType } = require('../services/activityLogger');
const router = express.Router();

// Configure multer for file uploads
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
 * Parse and validate import file
 */
async function parseImportFile(file) {
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
    throw new Error('Unsupported file format');
  }

  if (rows.length === 0) {
    throw new Error('File contains no data rows');
  }

  return rows;
}

/**
 * Normalize column name for flexible mapping
 */
function normalizeColumnName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Get value from row with flexible column matching
 */
function getRowValue(row, possibleNames) {
  for (const name of possibleNames) {
    const normalized = normalizeColumnName(name);
    for (const key of Object.keys(row)) {
      if (normalizeColumnName(key) === normalized) {
        return row[key];
      }
    }
  }
  return null;
}

/**
 * Process a single row for preview
 */
async function processRowForPreview(row, rowNum, existingUsersMap, existingCompaniesMap) {
  const result = {
    rowNum,
    status: 'valid',
    errors: [],
    warnings: [],
    action: 'create',
    data: {},
    existingData: null
  };

  // Extract fields with flexible column matching
  const name = getRowValue(row, ['Name', 'Full Name', 'FullName', 'User Name', 'UserName']);
  const email = getRowValue(row, ['Email', 'Email Address', 'EmailAddress', 'E-mail']);
  const role = getRowValue(row, ['Role', 'User Role', 'UserRole', 'Type']);
  const allCompaniesStr = getRowValue(row, ['All Companies', 'AllCompanies', 'All Accounts', 'AllAccounts']);
  const companyCodes = getRowValue(row, ['Company Codes', 'CompanyCodes', 'Companies', 'Account Numbers', 'Accounts']);
  const sendInvoiceEmailStr = getRowValue(row, ['Send Invoice Email', 'SendInvoiceEmail', 'Invoice Email', 'Send Upload Email']);
  const sendInvoiceAttachmentStr = getRowValue(row, ['With Attachment', 'WithAttachment', 'Invoice Attachment', 'Send Attachment']);
  const sendStatementEmailStr = getRowValue(row, ['Send Statement Email', 'SendStatementEmail', 'Statement Email']);
  const sendStatementAttachmentStr = getRowValue(row, ['Statement Attachment', 'StatementAttachment']);
  const sendSummaryStr = getRowValue(row, ['Send Summary', 'SendSummary', 'Summary Email', 'Send Email As Summary']);

  // Validate required fields
  if (!name || !name.trim()) {
    result.errors.push('Name is required');
    result.status = 'error';
  }

  if (!email || !email.trim()) {
    result.errors.push('Email is required');
    result.status = 'error';
  } else {
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      result.errors.push('Invalid email format');
      result.status = 'error';
    }
  }

  // Normalize role
  let normalizedRole = 'notification_contact'; // Default for imports
  if (role) {
    const roleLower = role.toLowerCase().replace(/[^a-z_]/g, '');
    const roleMap = {
      'globaladmin': 'global_admin',
      'global_admin': 'global_admin',
      'administrator': 'administrator',
      'admin': 'administrator',
      'manager': 'manager',
      'staff': 'staff',
      'externaluser': 'external_user',
      'external_user': 'external_user',
      'external': 'external_user',
      'notificationcontact': 'notification_contact',
      'notification_contact': 'notification_contact',
      'notification': 'notification_contact',
      'contact': 'notification_contact'
    };
    normalizedRole = roleMap[roleLower] || 'notification_contact';
  }

  // Parse boolean fields
  const parseBoolean = (val) => {
    if (val === null || val === undefined || val === '') return false;
    const str = String(val).toLowerCase().trim();
    return str === 'true' || str === 'yes' || str === '1' || str === 'y';
  };

  const allCompanies = parseBoolean(allCompaniesStr);
  const sendInvoiceEmail = parseBoolean(sendInvoiceEmailStr);
  const sendInvoiceAttachment = parseBoolean(sendInvoiceAttachmentStr);
  const sendStatementEmail = parseBoolean(sendStatementEmailStr);
  const sendStatementAttachment = parseBoolean(sendStatementAttachmentStr);
  const sendEmailAsSummary = parseBoolean(sendSummaryStr);

  // Check if user already exists
  const emailLower = email ? email.toLowerCase().trim() : '';
  const existingUser = existingUsersMap.get(emailLower);
  
  if (existingUser) {
    result.action = 'update';
    result.existingData = {
      id: existingUser.id,
      name: existingUser.name,
      email: existingUser.email,
      role: existingUser.role
    };
    result.warnings.push('User already exists - will update');
    if (result.status !== 'error') {
      result.status = 'warning';
    }
  }

  // Parse company codes
  const companyIds = [];
  const companyWarnings = [];
  if (companyCodes && companyCodes.trim()) {
    const codes = companyCodes.split(',').map(c => c.trim()).filter(c => c);
    for (const code of codes) {
      const refNo = parseInt(code);
      if (!isNaN(refNo)) {
        const company = existingCompaniesMap.get(refNo);
        if (company) {
          companyIds.push({ id: company.id, name: company.name, code: refNo });
        } else {
          companyWarnings.push(`Company ${code} not found`);
        }
      } else {
        // Try to find by code string
        let found = false;
        for (const [, comp] of existingCompaniesMap) {
          if (comp.code && comp.code.toLowerCase() === code.toLowerCase()) {
            companyIds.push({ id: comp.id, name: comp.name, code: comp.referenceNo || comp.code });
            found = true;
            break;
          }
        }
        if (!found) {
          companyWarnings.push(`Company ${code} not found`);
        }
      }
    }
  }

  if (companyWarnings.length > 0) {
    result.warnings.push(...companyWarnings);
    if (result.status !== 'error') {
      result.status = 'warning';
    }
  }

  result.data = {
    name: name ? name.trim() : '',
    email: emailLower,
    role: normalizedRole,
    allCompanies,
    companies: companyIds,
    sendInvoiceEmail,
    sendInvoiceAttachment,
    sendStatementEmail,
    sendStatementAttachment,
    sendEmailAsSummary
  };

  return result;
}

/**
 * Preview import endpoint
 */
router.post('/preview', globalAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const rows = await parseImportFile(req.file);

    // Get existing users by email
    const existingUsers = await User.findAll();
    const existingUsersMap = new Map();
    for (const user of existingUsers) {
      existingUsersMap.set(user.email.toLowerCase(), user);
    }

    // Get existing companies by referenceNo and code
    const existingCompanies = await Company.findAll();
    const existingCompaniesMap = new Map();
    for (const company of existingCompanies) {
      if (company.referenceNo) {
        existingCompaniesMap.set(company.referenceNo, company);
      }
    }

    // Process each row for preview
    const previewData = [];
    const summary = {
      total: rows.length,
      toCreate: 0,
      toUpdate: 0,
      errors: 0,
      warnings: 0
    };

    for (let i = 0; i < rows.length; i++) {
      const processed = await processRowForPreview(rows[i], i + 1, existingUsersMap, existingCompaniesMap);
      previewData.push(processed);

      if (processed.status === 'error') {
        summary.errors++;
      } else if (processed.status === 'warning') {
        summary.warnings++;
        if (processed.action === 'create') summary.toCreate++;
        else summary.toUpdate++;
      } else {
        if (processed.action === 'create') summary.toCreate++;
        else summary.toUpdate++;
      }
    }

    res.json({
      success: true,
      fileName: req.file.originalname,
      summary,
      preview: previewData
    });
  } catch (error) {
    console.error('Error previewing user import:', error);
    res.status(400).json({ message: error.message });
  }
});

/**
 * Execute import endpoint
 */
router.post('/', globalAdmin, upload.single('file'), async (req, res) => {
  const transaction = await sequelize.transaction();
  
  try {
    if (!req.file) {
      await transaction.rollback();
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const rows = await parseImportFile(req.file);

    // Get existing users and companies
    const existingUsers = await User.findAll({ transaction });
    const existingUsersMap = new Map();
    for (const user of existingUsers) {
      existingUsersMap.set(user.email.toLowerCase(), user);
    }

    const existingCompanies = await Company.findAll({ transaction });
    const existingCompaniesMap = new Map();
    for (const company of existingCompanies) {
      if (company.referenceNo) {
        existingCompaniesMap.set(company.referenceNo, company);
      }
    }

    const results = {
      created: 0,
      updated: 0,
      errors: [],
      users: []
    };

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 1;
      
      try {
        const processed = await processRowForPreview(rows[i], rowNum, existingUsersMap, existingCompaniesMap);
        
        if (processed.status === 'error') {
          results.errors.push({
            row: rowNum,
            errors: processed.errors
          });
          continue;
        }

        const { data } = processed;
        let user;

        if (processed.action === 'create') {
          // Create new user
          user = await User.create({
            name: data.name,
            email: data.email,
            role: data.role,
            password: null, // No password for imports
            isActive: true,
            allCompanies: data.allCompanies,
            sendInvoiceEmail: data.sendInvoiceEmail,
            sendInvoiceAttachment: data.sendInvoiceAttachment,
            sendStatementEmail: data.sendStatementEmail,
            sendStatementAttachment: data.sendStatementAttachment,
            sendEmailAsSummary: data.sendEmailAsSummary,
            addedById: req.user.userId
          }, { transaction });

          results.created++;
        } else {
          // Update existing user
          user = existingUsersMap.get(data.email);
          await user.update({
            name: data.name,
            role: data.role,
            allCompanies: data.allCompanies,
            sendInvoiceEmail: data.sendInvoiceEmail,
            sendInvoiceAttachment: data.sendInvoiceAttachment,
            sendStatementEmail: data.sendStatementEmail,
            sendStatementAttachment: data.sendStatementAttachment,
            sendEmailAsSummary: data.sendEmailAsSummary
          }, { transaction });

          results.updated++;
        }

        // Assign companies if specified
        if (data.companies.length > 0) {
          // Remove existing company assignments
          await UserCompany.destroy({
            where: { userId: user.id },
            transaction
          });

          // Create new assignments
          for (const company of data.companies) {
            await UserCompany.create({
              userId: user.id,
              companyId: company.id
            }, { transaction });
          }
        }

        results.users.push({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          action: processed.action
        });

      } catch (error) {
        results.errors.push({
          row: rowNum,
          errors: [error.message]
        });
      }
    }

    await transaction.commit();

    // Log activity
    await logActivity({
      type: ActivityType.USER_CREATED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Imported ${results.created} new users, updated ${results.updated} users`,
      details: {
        fileName: req.file.originalname,
        created: results.created,
        updated: results.updated,
        errors: results.errors.length
      },
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: `Import completed. Created: ${results.created}, Updated: ${results.updated}, Errors: ${results.errors.length}`,
      results
    });

  } catch (error) {
    await transaction.rollback();
    console.error('Error importing users:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Download sample import template
 */
router.get('/template', auth, (req, res) => {
  const csvContent = `Name,Email,Role,All Companies,Company Codes,Send Invoice Email,With Attachment,Send Statement Email,Statement Attachment,Send Summary
John Doe,john@example.com,notification_contact,false,"1001,1002",true,false,true,false,false
Jane Smith,jane@example.com,external_user,true,,true,true,true,true,true
Bob Wilson,bob@example.com,staff,false,1003,true,false,false,false,false`;

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=user_import_template.csv');
  res.send(csvContent);
});

module.exports = router;

