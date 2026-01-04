const express = require('express');
const { File, Customer, Company, User, Invoice, CreditNote, Statement, sequelize } = require('../models');
const { Op } = require('sequelize');
const globalAdmin = require('../middleware/globalAdmin');
const auth = require('../middleware/auth');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const router = express.Router();

/**
 * Get all files with filtering and pagination
 */
router.get('/', globalAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      status,
      fileType,
      processingMethod,
      dateFrom,
      dateTo,
      search,
      customerId,
      assigned
    } = req.query;

    const where = {
      deletedAt: null // Only show non-deleted files by default
    };
    const include = [];

    // Status filter
    if (status && status !== 'all') {
      where.status = status;
    }

    // File type filter
    if (fileType && fileType !== 'all') {
      where.fileType = fileType;
    }

    // Processing method filter
    if (processingMethod && processingMethod !== 'all') {
      where.processingMethod = processingMethod;
    }

    // Date range filter
    if (dateFrom || dateTo) {
      where.uploadedAt = {};
      if (dateFrom) {
        where.uploadedAt[Op.gte] = new Date(dateFrom);
      }
      if (dateTo) {
        where.uploadedAt[Op.lte] = new Date(dateTo + 'T23:59:59.999Z');
      }
    }

    // Search filter (filename, invoice number, account number)
    if (search) {
      const searchConditions = [
        { fileName: { [Op.iLike]: `%${search}%` } }
      ];
      
      // Search in JSONB parsedData field
      searchConditions.push(
        sequelize.where(
          sequelize.cast(sequelize.col('File.parsedData'), 'text'),
          { [Op.iLike]: `%${search}%` }
        )
      );
      
      where[Op.or] = searchConditions;
    }

    // Customer filter
    if (customerId && customerId !== 'all') {
      where.customerId = customerId;
    }

    // Assigned filter (has customerId vs null)
    if (assigned === 'true') {
      where.customerId = { [Op.ne]: null };
    } else if (assigned === 'false') {
      where.customerId = null;
    }

    // Include associations
    include.push(
      {
        model: Customer,
        as: 'customer',
        attributes: ['id', 'name', 'accountNumber'],
        required: false
      },
      {
        model: User,
        as: 'uploadedBy',
        attributes: ['id', 'name', 'email'],
        required: false
      }
    );

    // Get total count for pagination (without include for performance)
    const total = await File.count({ where });

    // Get files with pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const files = await File.findAll({
      where,
      include,
      order: [['uploadedAt', 'DESC']],
      limit: parseInt(limit),
      offset: offset
    });

    res.json({
      files: files.map(file => file.toJSON()),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching files:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching files: ' + error.message
    });
  }
});

/**
 * Get single file with full details
 */
router.get('/:id', globalAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file ID format'
      });
    }

    const file = await File.findByPk(id, {
      include: [
        {
          model: Customer,
          as: 'customer',
          required: false
        },
        {
          model: User,
          as: 'uploadedBy',
          attributes: ['id', 'name', 'email'],
          required: false
        }
      ]
    });

    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    res.json(file.toJSON());
  } catch (error) {
    console.error('Error fetching file:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching file: ' + error.message
    });
  }
});

/**
 * Bulk delete files
 */
router.delete('/bulk', globalAdmin, async (req, res) => {
  try {
    const { fileIds } = req.body;

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'File IDs array is required'
      });
    }

    // Validate UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validIds = fileIds.filter(id => uuidRegex.test(id));

    if (validIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid file IDs provided'
      });
    }

    // Delete files (soft delete by setting deletedAt)
    const deletedCount = await File.update(
      { deletedAt: new Date() },
      {
        where: {
          id: { [Op.in]: validIds },
          deletedAt: null
        }
      }
    );

    res.json({
      success: true,
      message: `Successfully deleted ${deletedCount[0]} file(s)`,
      deletedCount: deletedCount[0]
    });
  } catch (error) {
    console.error('Error bulk deleting files:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting files: ' + error.message
    });
  }
});

/**
 * Delete single file
 */
router.delete('/:id', globalAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Validate UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file ID format'
      });
    }

    const file = await File.findByPk(id);

    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Soft delete
    await file.update({ deletedAt: new Date() });

    res.json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting file: ' + error.message
    });
  }
});

/**
 * Clear all logs (soft delete all files)
 */
router.delete('/logs/clear', globalAdmin, async (req, res) => {
  try {
    const { confirm } = req.body;

    if (confirm !== 'DELETE_ALL_LOGS') {
      return res.status(400).json({
        success: false,
        message: 'Confirmation required. Send { confirm: "DELETE_ALL_LOGS" }'
      });
    }

    const deletedCount = await File.update(
      { deletedAt: new Date() },
      {
        where: {
          deletedAt: null
        }
      }
    );

    res.json({
      success: true,
      message: `Successfully cleared ${deletedCount[0]} log entries`,
      deletedCount: deletedCount[0]
    });
  } catch (error) {
    console.error('Error clearing logs:', error);
    res.status(500).json({
      success: false,
      message: 'Error clearing logs: ' + error.message
    });
  }
});

/**
 * Get statistics for parsing log
 */
router.get('/stats/summary', globalAdmin, async (req, res) => {
  try {
    const [stats] = await sequelize.query(`
      SELECT 
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'parsed')::int as parsed,
        COUNT(*) FILTER (WHERE status = 'failed')::int as failed,
        COUNT(*) FILTER (WHERE status = 'processing')::int as processing,
        COUNT(*) FILTER (WHERE status = 'pending')::int as pending,
        COUNT(*) FILTER (WHERE status = 'duplicate')::int as duplicate,
        COUNT(*) FILTER (WHERE "processingMethod" = 'vision')::int as vision,
        COUNT(*) FILTER (WHERE "processingMethod" = 'documentai')::int as documentai,
        COUNT(*) FILTER (WHERE "customerId" IS NOT NULL)::int as assigned
      FROM files
      WHERE "deletedAt" IS NULL
    `);

    res.json({
      success: true,
      stats: stats[0] || {}
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching stats: ' + error.message
    });
  }
});

/**
 * Test Import - Create a file with mock parsed data to test import logic
 * This bypasses FTP and parsing, allowing you to test the matching and document creation logic
 * 
 * Example request body:
 * {
 *   "fileName": "test-invoice-123.pdf",
 *   "fileType": "invoice",
 *   "accountNumber": "12345",  // Will try to match to company
 *   "invoiceNumber": "INV-001",
 *   "amount": 1500.00,
 *   "date": "2025-12-09"
 * }
 */
router.post('/test-import', auth, globalAdmin, async (req, res) => {
  try {
    const {
      fileName = `test-invoice-${Date.now()}.pdf`,
      fileType = 'invoice', // 'invoice', 'credit_note', 'statement'
      parsedData = {},
      accountNumber = null, // Will try to match to company
      invoiceNumber = null,
      amount = null,
      date = null,
      companyId = null // Optional: directly assign to a company
    } = req.body;

    // Build parsed data from provided fields or use provided parsedData
    const mockParsedData = {
      invoiceNumber: invoiceNumber || parsedData.invoiceNumber || `INV-${Date.now()}`,
      accountNumber: accountNumber || parsedData.accountNumber || null,
      amount: amount !== null ? parseFloat(amount) : (parsedData.amount || 100.00),
      date: date ? new Date(date).toISOString() : (parsedData.date || new Date().toISOString()),
      documentType: fileType,
      ...parsedData // Allow overriding with full parsedData object
    };

    // Create a dummy file path (file doesn't need to exist for testing)
    const { ensureStorageDirs, getStorageDir, getFilePath } = require('../config/storage');
    ensureStorageDirs();
    const dummyFilePath = getFilePath('invoices', fileName);

    // Create a dummy file (empty file for testing)
    if (!fs.existsSync(dummyFilePath)) {
      fs.writeFileSync(dummyFilePath, Buffer.from('TEST FILE - Created for import testing'));
    }

    const fileStats = fs.statSync(dummyFilePath);
    const fileHash = crypto.createHash('sha256').update(fs.readFileSync(dummyFilePath)).digest('hex');

    // Try to match company by account number if provided
    let matchedCompanyId = companyId;
    if (!matchedCompanyId && mockParsedData.accountNumber) {
      const company = await Company.findOne({
        where: {
          referenceNo: mockParsedData.accountNumber.toString()
        }
      });
      
      if (company) {
        matchedCompanyId = company.id;
        console.log(`✅ Matched company: ${company.name} (${company.referenceNo})`);
      } else {
        console.log(`⚠️  No company found with account number: ${mockParsedData.accountNumber}`);
      }
    }

    // Determine status based on whether company was matched
    let status = 'parsed';
    let failureReason = null;
    
    if (!matchedCompanyId && mockParsedData.accountNumber) {
      status = 'unallocated';
      failureReason = 'unallocated';
    } else if (!matchedCompanyId && !mockParsedData.accountNumber) {
      status = 'unallocated';
      failureReason = 'unallocated';
    }

    // Create file record (File model uses customerId, but we'll store Company ID there)
    const file = await File.create({
      fileName,
      fileHash,
      filePath: dummyFilePath,
      fileSize: fileStats.size,
      fileType: fileType,
      status: status,
      failureReason: failureReason,
      parsedData: mockParsedData,
      processingMethod: 'manual', // Using 'manual' since 'test' is not in the enum
      customerId: matchedCompanyId, // File model uses customerId field (legacy, but works with Company)
      uploadedById: req.user.userId,
      metadata: {
        isTestImport: true,
        testData: {
          accountNumber: mockParsedData.accountNumber,
          invoiceNumber: mockParsedData.invoiceNumber,
          amount: mockParsedData.amount,
          date: mockParsedData.date
        }
      }
    });

    // If company was matched, try to create the appropriate document
    let document = null;
    if (matchedCompanyId && status === 'parsed') {
      try {
        const issueDate = new Date(mockParsedData.date);
        
        if (fileType === 'invoice') {
          document = await Invoice.create({
            companyId: matchedCompanyId,
            invoiceNumber: mockParsedData.invoiceNumber,
            issueDate: issueDate,
            amount: mockParsedData.amount || 0,
            status: 'draft', // Valid status: 'draft', 'sent', 'paid', 'overdue', 'cancelled'
            metadata: {
              source: 'test_import',
              fileId: file.id,
              parsedData: mockParsedData
            }
          });
        } else if (fileType === 'credit_note') {
          document = await CreditNote.create({
            companyId: matchedCompanyId,
            creditNoteNumber: mockParsedData.invoiceNumber || mockParsedData.creditNumber || `CN-${Date.now()}`,
            issueDate: issueDate,
            amount: mockParsedData.amount || 0,
            status: 'draft', // Valid status: 'draft', 'sent', 'applied', 'cancelled'
            metadata: {
              source: 'test_import',
              fileId: file.id,
              parsedData: mockParsedData
            }
          });
        } else if (fileType === 'statement') {
          // Statement requires periodStart, periodEnd, openingBalance, closingBalance, etc.
          const periodStart = issueDate;
          const periodEnd = new Date(issueDate);
          periodEnd.setMonth(periodEnd.getMonth() + 1); // Default to 1 month period
          
          document = await Statement.create({
            companyId: matchedCompanyId,
            statementNumber: mockParsedData.invoiceNumber || mockParsedData.statementNumber || `STMT-${Date.now()}`,
            periodStart: periodStart,
            periodEnd: periodEnd,
            openingBalance: 0,
            closingBalance: mockParsedData.amount || 0,
            totalDebits: mockParsedData.amount || 0,
            totalCredits: 0,
            status: 'draft', // Valid status: 'draft', 'sent', 'acknowledged', 'disputed'
            metadata: {
              source: 'test_import',
              fileId: file.id,
              parsedData: mockParsedData
            }
          });
        }
        
        if (document) {
          console.log(`✅ Created ${fileType}: ${document.id}`);
        }
      } catch (docError) {
        console.error(`⚠️  Failed to create ${fileType} document:`, docError.message);
        console.error(`   Error details:`, docError.errors || docError);
        // Don't fail the import if document creation fails
      }
    }

    res.json({
      success: true,
      message: `Test import completed: ${status === 'parsed' ? 'Successfully matched and processed' : 'Unallocated - no matching company found'}`,
      file: {
        id: file.id,
        fileName: file.fileName,
        status: file.status,
        failureReason: file.failureReason
      },
      company: matchedCompanyId ? {
        id: matchedCompanyId,
        matched: true
      } : {
        matched: false,
        reason: mockParsedData.accountNumber ? `No company found with account number: ${mockParsedData.accountNumber}` : 'No account number provided'
      },
      document: document ? {
        id: document.id,
        type: fileType
      } : null,
      parsedData: mockParsedData
    });
  } catch (error) {
    console.error('Test import error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating test import: ' + error.message
    });
  }
});

module.exports = router;

