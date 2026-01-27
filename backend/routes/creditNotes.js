const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { CreditNote, Company, Invoice, Sequelize, Settings, sequelize } = require('../models');
const { Op } = Sequelize;
const auth = require('../middleware/auth');
const { checkDocumentAccess, buildCompanyFilter } = require('../middleware/documentAccess');
const { requirePermission } = require('../middleware/permissions');
const { getDescendantCompanyIds } = require('../utils/companyHierarchy');
const { logActivity, ActivityType } = require('../services/activityLogger');
const { calculateDocumentRetentionDates } = require('../utils/documentRetention');
const { invoiceImportQueue } = require('../config/queue');
const { ensureStorageDirs, getStorageDir } = require('../config/storage');
const { testConnection, listFiles, downloadFile } = require('../utils/ftp');
const router = express.Router();

// Storage configuration for credit note imports
ensureStorageDirs();
const tempImportsDir = getStorageDir('temp');

// Configure multer for credit note imports (max 500 files)
const importStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempImportsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `import-${uniqueSuffix}${ext}`);
  }
});

const importUpload = multer({
  storage: importStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 500 // Max 500 files
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.pdf', '.xlsx', '.xls'];
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and Excel files (.pdf, .xlsx, .xls) are allowed!'), false);
    }
  }
});

// Apply auth and document access check to all routes
router.use(auth);
router.use(checkDocumentAccess);

// Get all credit notes (filtered by user's accessible companies)
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, search = '', creditNoteNumbers, companyId, companyIds, invoiceId, status, startDate, endDate } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    
    const whereConditions = buildCompanyFilter(req.accessibleCompanyIds);
    
    // Company filter - support both single and multiple IDs
    // IMPORTANT: Expand parent company IDs to include all descendants (branches)
    if (companyIds) {
      // Handle comma-separated string or array
      const ids = Array.isArray(companyIds) ? companyIds : companyIds.split(',').map(id => id.trim()).filter(id => id);
      if (ids.length > 0) {
        // Expand each company ID to include its descendants (for parent companies)
        const expandedIds = new Set();
        for (const id of ids) {
          expandedIds.add(id);
          const descendants = await getDescendantCompanyIds(id, false);
          descendants.forEach(d => expandedIds.add(d));
        }
        whereConditions.companyId = { [Op.in]: Array.from(expandedIds) };
      }
    } else if (companyId) {
      // Single company ID - also expand to include descendants
      const expandedIds = new Set([companyId]);
      const descendants = await getDescendantCompanyIds(companyId, false);
      descendants.forEach(d => expandedIds.add(d));
      whereConditions.companyId = { [Op.in]: Array.from(expandedIds) };
    }
    
    if (invoiceId) {
      whereConditions.invoiceId = invoiceId;
    }
    
    if (status) {
      whereConditions.status = status;
    }
    
    if (startDate || endDate) {
      whereConditions.issueDate = {};
      if (startDate) {
        whereConditions.issueDate[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        whereConditions.issueDate[Op.lte] = new Date(endDate);
      }
    }
    
    // Handle comma-separated credit note numbers (exact match) - takes priority over regular search
    if (creditNoteNumbers) {
      const numbers = creditNoteNumbers.split(',').map(n => n.trim()).filter(n => n);
      console.log('🔍 [CreditNotes] Searching for credit note numbers:', numbers);
      if (numbers.length > 0) {
        // Use case-insensitive matching - search for any of the credit note numbers
        whereConditions[Op.or] = numbers.map(num => ({
          creditNoteNumber: { [Op.iLike]: num }
        }));
      }
    }
    // Otherwise use regular search (partial match)
    else if (search) {
      const searchTerm = `%${search}%`;
      const searchConditions = [
        { creditNoteNumber: { [Op.iLike]: searchTerm } },
        { notes: { [Op.iLike]: searchTerm } },
        // Search in metadata fields (invoiceTo, deliveryAddress, customerPO, etc.)
        sequelize.where(
          sequelize.cast(sequelize.col('CreditNote.metadata'), 'text'),
          { [Op.iLike]: searchTerm }
        )
      ];
      
      // Add company search via subquery
      const escapedSearchTerm = sequelize.escape(searchTerm);
      const companySearchSubquery = sequelize.literal(`EXISTS (
        SELECT 1 FROM "companies" 
        WHERE "companies"."id" = "CreditNote"."companyId"
        AND (
          "companies"."name" ILIKE ${escapedSearchTerm} OR
          CAST("companies"."referenceNo" AS TEXT) ILIKE ${escapedSearchTerm} OR
          "companies"."code" ILIKE ${escapedSearchTerm}
        )
      )`);
      searchConditions.push(companySearchSubquery);
      
      whereConditions[Op.or] = searchConditions;
    }
    
    const { count, rows } = await CreditNote.findAndCountAll({
      where: whereConditions,
      include: [
        {
          model: Company,
          as: 'company',
          attributes: ['id', 'name', 'referenceNo', 'type'],
          required: false // LEFT JOIN - show credit notes even if company is missing/deleted
        },
        {
          model: Invoice,
          as: 'invoice',
          attributes: ['id', 'invoiceNumber'],
          required: false
        }
      ],
      limit: limitNum,
      offset: offset,
      order: [['issueDate', 'DESC'], ['createdAt', 'DESC']]
    });
    
    res.json({
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        pages: Math.ceil(count / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching credit notes:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get single credit note
router.get('/:id', async (req, res) => {
  try {
    const creditNote = await CreditNote.findByPk(req.params.id, {
      include: [
        {
          model: Company,
          as: 'company',
          attributes: ['id', 'name', 'referenceNo', 'type', 'globalSystemEmail']
        },
        {
          model: Invoice,
          as: 'invoice',
          attributes: ['id', 'invoiceNumber'],
          required: false
        }
      ]
    });
    
    if (!creditNote) {
      return res.status(404).json({ message: 'Credit note not found' });
    }
    
    // Double-check access to this specific credit note's company
    if (req.accessibleCompanyIds !== null && 
        !req.accessibleCompanyIds.includes(creditNote.companyId)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have access to this credit note.' 
      });
    }
    
    // Only update status if setting allows all users OR user is external_user
    // When setting is enabled, ONLY external users can change status (no exceptions)
    const settings = await Settings.getSettings();
    const canUpdateStatus = !settings.onlyExternalUsersChangeDocumentStatus || req.user.role === 'external_user';
    
    // Skip auto-mark-as-viewed for admins/GA (they can manually set status)
    const isAdmin = req.user.role === 'global_admin' || req.user.role === 'administrator';
    const shouldAutoMarkAsViewed = canUpdateStatus && !isAdmin && creditNote.documentStatus !== 'downloaded';
    
    // Mark as viewed when fetching (if not already downloaded)
    if (shouldAutoMarkAsViewed) {
      const wasFirstView = !creditNote.viewedAt;
      const now = new Date();
      
      if (!creditNote.viewedAt) {
        creditNote.viewedAt = now;
      }
      
      creditNote.documentStatus = 'viewed';
      
      // Store who viewed in metadata
      const metadata = creditNote.metadata || {};
      if (!metadata.viewedBy) {
        metadata.viewedBy = req.user.userId;
        metadata.viewedByEmail = req.user.email;
        metadata.viewedByName = req.user.name || req.user.email;
      }
      creditNote.metadata = metadata;
      
      await creditNote.save();
      
      if (wasFirstView) {
        console.log(`👁️  Credit Note ${creditNote.creditNoteNumber} marked as viewed by ${req.user.email}`);
      }
    }
    
    // Log credit note view (if first view)
    await logActivity({
      type: ActivityType.CREDIT_NOTE_VIEWED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Viewed credit note ${creditNote.creditNoteNumber || creditNote.id}`,
      details: { 
        creditNoteId: creditNote.id,
        creditNoteNumber: creditNote.creditNoteNumber,
        companyId: creditNote.companyId
      },
      companyId: creditNote.companyId,
      companyName: creditNote.company?.name || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json(creditNote);
  } catch (error) {
    console.error('Error fetching credit note:', error);
    res.status(500).json({ message: error.message });
  }
});

// Create credit note - GA + Admin only
router.post('/', requirePermission('CREDIT_NOTES_EDIT'), async (req, res) => {
  try {
    const {
      creditNoteNumber,
      companyId,
      invoiceId,
      issueDate,
      amount,
      taxAmount,
      status,
      reason,
      items,
      notes,
      fileUrl,
      metadata
    } = req.body;
    
    // Validate required fields
    if (!creditNoteNumber || !companyId || !issueDate || amount === undefined) {
      return res.status(400).json({ 
        message: 'creditNoteNumber, companyId, issueDate, and amount are required' 
      });
    }
    
    // Check if credit note number already exists
    const existingCreditNote = await CreditNote.findOne({
      where: { creditNoteNumber }
    });
    
    if (existingCreditNote) {
      return res.status(400).json({ message: 'Credit note number already exists' });
    }
    
    // Verify company exists
    const company = await Company.findByPk(companyId);
    if (!company) {
      return res.status(400).json({ message: 'Company not found' });
    }
    
    // Verify invoice exists if provided
    if (invoiceId) {
      const invoice = await Invoice.findByPk(invoiceId);
      if (!invoice) {
        return res.status(400).json({ message: 'Invoice not found' });
      }
    }
    
    // Get settings for retention calculation
    const settings = await Settings.getSettings();
    
    // Prepare document data for retention calculation
    const documentDataForRetention = {
      issueDate: new Date(issueDate),
      createdAt: new Date(),
      documentStatus: 'ready'
    };
    
    // Calculate retention dates
    const retentionDates = calculateDocumentRetentionDates(documentDataForRetention, settings);
    
    const creditNote = await CreditNote.create({
      creditNoteNumber,
      companyId,
      invoiceId,
      issueDate,
      amount,
      taxAmount: taxAmount || 0,
      status: status || 'draft',
      reason,
      items: items || [],
      notes,
      fileUrl,
      metadata: metadata || {},
      createdById: req.user.userId,
      retentionStartDate: retentionDates.retentionStartDate,
      retentionExpiryDate: retentionDates.retentionExpiryDate
    });
    
    // Reload with associations
    await creditNote.reload({
      include: [
        {
          model: Company,
          as: 'company',
          attributes: ['id', 'name', 'referenceNo', 'type']
        },
        {
          model: Invoice,
          as: 'invoice',
          attributes: ['id', 'invoiceNumber'],
          required: false
        }
      ]
    });
    
    res.status(201).json(creditNote);
  } catch (error) {
    console.error('Error creating credit note:', error);
    res.status(400).json({ message: error.message });
  }
});

// Update credit note - GA + Admin only
router.put('/:id', requirePermission('CREDIT_NOTES_EDIT'), async (req, res) => {
  try {
    const creditNote = await CreditNote.findByPk(req.params.id);
    
    if (!creditNote) {
      return res.status(404).json({ message: 'Credit note not found' });
    }
    
    // Check access to this credit note's company
    if (req.accessibleCompanyIds !== null && 
        !req.accessibleCompanyIds.includes(creditNote.companyId)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have access to this credit note.' 
      });
    }
    
    const {
      creditNoteNumber,
      companyId,
      invoiceId,
      issueDate,
      amount,
      taxAmount,
      status,
      reason,
      items,
      notes,
      fileUrl,
      metadata
    } = req.body;
    
    // Check if credit note number is being changed and if it already exists
    if (creditNoteNumber && creditNoteNumber !== creditNote.creditNoteNumber) {
      const existingCreditNote = await CreditNote.findOne({
        where: { creditNoteNumber }
      });
      
      if (existingCreditNote) {
        return res.status(400).json({ message: 'Credit note number already exists' });
      }
    }
    
    // Update fields
    if (creditNoteNumber !== undefined) creditNote.creditNoteNumber = creditNoteNumber;
    if (companyId !== undefined) creditNote.companyId = companyId;
    if (invoiceId !== undefined) creditNote.invoiceId = invoiceId;
    if (issueDate !== undefined) creditNote.issueDate = issueDate;
    if (amount !== undefined) creditNote.amount = amount;
    if (taxAmount !== undefined) creditNote.taxAmount = taxAmount;
    if (status !== undefined) creditNote.status = status;
    if (reason !== undefined) creditNote.reason = reason;
    if (items !== undefined) creditNote.items = items;
    if (notes !== undefined) creditNote.notes = notes;
    if (fileUrl !== undefined) creditNote.fileUrl = fileUrl;
    if (metadata !== undefined) creditNote.metadata = metadata;
    
    await creditNote.save();
    
    // Reload with associations
    await creditNote.reload({
      include: [
        {
          model: Company,
          as: 'company',
          attributes: ['id', 'name', 'referenceNo', 'type']
        },
        {
          model: Invoice,
          as: 'invoice',
          attributes: ['id', 'invoiceNumber'],
          required: false
        }
      ]
    });
    
    res.json(creditNote);
  } catch (error) {
    console.error('Error updating credit note:', error);
    res.status(400).json({ message: error.message });
  }
});

// Delete credit note - GA + Admin only
router.delete('/:id', requirePermission('CREDIT_NOTES_DELETE'), async (req, res) => {
  try {
    const creditNote = await CreditNote.findByPk(req.params.id);
    
    if (!creditNote) {
      return res.status(404).json({ message: 'Credit note not found' });
    }
    
    // Check access to this credit note's company
    if (req.accessibleCompanyIds !== null && 
        !req.accessibleCompanyIds.includes(creditNote.companyId)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have access to this credit note.' 
      });
    }
    
    await creditNote.destroy();
    
    res.json({ message: 'Credit note deleted successfully' });
  } catch (error) {
    console.error('Error deleting credit note:', error);
    res.status(500).json({ message: error.message });
  }
});

// Mark credit note as viewed
router.post('/:id/view', async (req, res) => {
  try {
    const creditNote = await CreditNote.findByPk(req.params.id);
    
    if (!creditNote) {
      return res.status(404).json({ message: 'Credit note not found' });
    }
    
    // Check access to this credit note's company
    if (req.accessibleCompanyIds !== null && 
        !req.accessibleCompanyIds.includes(creditNote.companyId)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have access to this credit note.' 
      });
    }
    
    // Only update status if setting allows all users OR user is external_user
    const settings = await Settings.getSettings();
    const onlyExternal = settings.onlyExternalUsersChangeDocumentStatus;
    const userRole = req.user.role;
    const canUpdateStatus = !onlyExternal || userRole === 'external_user';
    
    console.log(`📊 CN Document Status Check - onlyExternalUsersChangeDocumentStatus: ${onlyExternal}, userRole: ${userRole}, canUpdateStatus: ${canUpdateStatus}`);
    
    // Always update status when viewed (unless already downloaded)
    const wasFirstView = !creditNote.viewedAt;
    const now = new Date();
    
    if (canUpdateStatus) {
      if (!creditNote.viewedAt) {
        creditNote.viewedAt = now;
      }
      
      // Update documentStatus to 'viewed' if not already 'downloaded'
      if (creditNote.documentStatus !== 'downloaded') {
        creditNote.documentStatus = 'viewed';
      }
      
      // Store who viewed in metadata
      const metadata = creditNote.metadata || {};
      if (!metadata.viewedBy) {
        metadata.viewedBy = req.user.userId;
        metadata.viewedByEmail = req.user.email;
        metadata.viewedByName = req.user.name || req.user.email;
      }
      creditNote.metadata = metadata;
      
      await creditNote.save();
    }
    
    // Always log credit note view
    await logActivity({
      type: ActivityType.CREDIT_NOTE_VIEWED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Viewed credit note ${creditNote.creditNoteNumber || creditNote.id}${wasFirstView ? '' : ' (subsequent view)'}`,
      details: { 
        creditNoteId: creditNote.id, 
        creditNoteNumber: creditNote.creditNoteNumber,
        documentStatus: creditNote.documentStatus,
        isFirstView: wasFirstView
      },
      companyId: creditNote.companyId,
      companyName: creditNote.company?.name || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json({ message: 'Credit note marked as viewed', viewedAt: creditNote.viewedAt });
  } catch (error) {
    console.error('Error marking credit note as viewed:', error);
    res.status(500).json({ message: error.message });
  }
});

// Download single credit note document
router.get('/:id/download', async (req, res) => {
  try {
    const creditNote = await CreditNote.findByPk(req.params.id, {
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name']
      }]
    });
    
    if (!creditNote) {
      return res.status(404).json({ message: 'Credit note not found' });
    }
    
    // Check access to this credit note's company
    if (req.accessibleCompanyIds !== null && 
        !req.accessibleCompanyIds.includes(creditNote.companyId)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have access to this credit note.' 
      });
    }
    
    if (!creditNote.fileUrl) {
      return res.status(404).json({ message: 'No document file available for this credit note' });
    }
    
    const filePath = path.isAbsolute(creditNote.fileUrl) 
      ? creditNote.fileUrl 
      : path.join(__dirname, '..', creditNote.fileUrl);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Document file not found on server' });
    }
    
    // Only update status if setting allows all users OR user is external_user
    // When setting is enabled, ONLY external users can change status (no exceptions)
    const settings = await Settings.getSettings();
    const canUpdateStatus = !settings.onlyExternalUsersChangeDocumentStatus || req.user.role === 'external_user';
    
    const wasFirstDownload = !creditNote.downloadedAt;
    const now = new Date();
    
    if (canUpdateStatus) {
      if (!creditNote.downloadedAt) {
        creditNote.downloadedAt = now;
      }
      
      // Always set status to 'downloaded' when downloaded
      creditNote.documentStatus = 'downloaded';
      
      // Mark as viewed if not already
      if (!creditNote.viewedAt) {
        creditNote.viewedAt = now;
      }
      
      // Store who downloaded in metadata
      const metadata = creditNote.metadata || {};
      if (!metadata.downloadedBy) {
        metadata.downloadedBy = req.user.userId;
        metadata.downloadedByEmail = req.user.email;
        metadata.downloadedByName = req.user.name || req.user.email;
      }
      creditNote.metadata = metadata;
      
      await creditNote.save();
    }
    
    // Always log download
    await logActivity({
      type: ActivityType.CREDIT_NOTE_DOWNLOADED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Downloaded credit note ${creditNote.creditNoteNumber || creditNote.id}${wasFirstDownload ? '' : ' (subsequent download)'}`,
      details: { 
        creditNoteId: creditNote.id, 
        creditNoteNumber: creditNote.creditNoteNumber,
        documentStatus: creditNote.documentStatus,
        isFirstDownload: wasFirstDownload
      },
      companyId: creditNote.companyId,
      companyName: creditNote.company?.name || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    // Get filename from credit note number or use default
    const filename = creditNote.creditNoteNumber 
      ? `credit-note-${creditNote.creditNoteNumber}.pdf`
      : `credit-note-${creditNote.id}.pdf`;
    
    // Serve PDF with download content-disposition
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error downloading credit note PDF:', error);
    res.status(500).json({ message: error.message });
  }
});

// View credit note PDF inline (for preview)
router.get('/:id/view-pdf', async (req, res) => {
  try {
    const creditNote = await CreditNote.findByPk(req.params.id, {
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name']
      }]
    });
    
    if (!creditNote) {
      return res.status(404).json({ message: 'Credit note not found' });
    }
    
    // Check access to this credit note's company
    if (req.accessibleCompanyIds !== null && 
        !req.accessibleCompanyIds.includes(creditNote.companyId)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have access to this credit note.' 
      });
    }
    
    if (!creditNote.fileUrl) {
      return res.status(404).json({ message: 'No document file available for this credit note' });
    }
    
    // Handle both absolute and relative paths
    let filePath;
    if (path.isAbsolute(creditNote.fileUrl)) {
      filePath = creditNote.fileUrl;
    } else {
      filePath = path.join(__dirname, '..', creditNote.fileUrl);
      if (!fs.existsSync(filePath)) {
        filePath = creditNote.fileUrl;
      }
    }
    
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath} (original: ${creditNote.fileUrl})`);
      return res.status(404).json({ message: 'Document file not found on server' });
    }
    
    // Only update status if setting allows all users OR user is external_user
    // When setting is enabled, ONLY external users can change status (no exceptions)
    const settings = await Settings.getSettings();
    const canUpdateStatus = !settings.onlyExternalUsersChangeDocumentStatus || req.user.role === 'external_user';
    
    // Mark as viewed if not already
    const wasViewed = !!creditNote.viewedAt;
    if (canUpdateStatus && !creditNote.viewedAt) {
      creditNote.viewedAt = new Date();
      // Update documentStatus to 'viewed' if it's currently 'ready' or 'review'
      if (creditNote.documentStatus === 'ready' || creditNote.documentStatus === 'review') {
        creditNote.documentStatus = 'viewed';
      }
      await creditNote.save();
    }
    
    // Log view (log ALL views, not just the first one)
    await logActivity({
      type: ActivityType.CREDIT_NOTE_VIEWED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Viewed credit note PDF ${creditNote.creditNoteNumber || creditNote.id}${wasViewed ? ' (subsequent view)' : ''}`,
      details: { 
        creditNoteId: creditNote.id, 
        creditNoteNumber: creditNote.creditNoteNumber,
        documentStatus: creditNote.documentStatus,
        isFirstView: !wasViewed,
        viewMethod: 'pdf_preview'
      },
      companyId: creditNote.companyId,
      companyName: creditNote.company?.name || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    // Serve PDF with inline content-disposition (view only, no download)
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error viewing credit note PDF:', error);
    res.status(500).json({ message: error.message });
  }
});

// Bulk delete credit notes - GA + Admin only
router.post('/bulk-delete', requirePermission('CREDIT_NOTES_DELETE'), async (req, res) => {
  try {
    const { creditNoteIds, reason } = req.body;
    
    if (!Array.isArray(creditNoteIds) || creditNoteIds.length === 0) {
      return res.status(400).json({ message: 'No credit note IDs provided' });
    }
    
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ 
        message: 'Deletion reason is required for accountability.' 
      });
    }
    
    if (creditNoteIds.length > 100) {
      return res.status(400).json({ message: 'Maximum 100 credit notes can be deleted at once' });
    }
    
    const creditNotes = await CreditNote.findAll({
      where: {
        id: { [Op.in]: creditNoteIds },
        ...buildCompanyFilter(req.accessibleCompanyIds)
      },
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name']
      }]
    });
    
    if (creditNotes.length === 0) {
      return res.status(404).json({ message: 'No accessible credit notes found' });
    }
    
    const deletionReason = reason.trim();
    const deletedBy = req.user.userId;
    const deletedAt = new Date();
    const deletedCreditNotes = [];
    const failedCreditNotes = [];
    
    // Process each credit note
    for (const creditNote of creditNotes) {
      try {
        // Track deletion (soft delete with tracking)
        creditNote.deletedBy = deletedBy;
        creditNote.deletedReason = deletionReason;
        creditNote.deletedAt = deletedAt;
        await creditNote.save();
        
        // Delete the physical file if it exists
        if (creditNote.fileUrl) {
          const filePath = path.isAbsolute(creditNote.fileUrl) 
            ? creditNote.fileUrl 
            : path.join(__dirname, '..', creditNote.fileUrl);
          
          if (fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
              console.log(`🗑️  Deleted credit note file: ${filePath}`);
            } catch (fileError) {
              console.error(`⚠️  Failed to delete credit note file: ${fileError.message}`);
              // Continue even if file deletion fails
            }
          }
        }
        
        // Hard delete from database
        await creditNote.destroy({ force: true });
        
        // Log individual credit note deletion
        console.log(`🗑️  Credit Note ${creditNote.creditNoteNumber} (ID: ${creditNote.id}) deleted by ${req.user.email} (${deletedBy}). Reason: ${deletionReason}`);
        
        // Log each deletion
        await logActivity({
          type: ActivityType.CREDIT_NOTE_DELETED,
          userId: req.user.userId,
          userEmail: req.user.email,
          userRole: req.user.role,
          action: `Bulk deleted credit note ${creditNote.creditNoteNumber || creditNote.id}`,
          details: { 
            creditNoteId: creditNote.id, 
            creditNoteNumber: creditNote.creditNoteNumber,
            reason: deletionReason,
            bulkDelete: true,
            totalDeleted: deletedCreditNotes.length + 1
          },
          companyId: creditNote.companyId,
          companyName: creditNote.company?.name || null,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent')
        });
        
        deletedCreditNotes.push({
          id: creditNote.id,
          creditNoteNumber: creditNote.creditNoteNumber
        });
      } catch (error) {
        console.error(`Error deleting credit note ${creditNote.id}:`, error);
        failedCreditNotes.push({
          id: creditNote.id,
          creditNoteNumber: creditNote.creditNoteNumber,
          error: error.message
        });
      }
    }
    
    // Log bulk deletion summary
    await logActivity({
      type: ActivityType.CREDIT_NOTE_BULK_DELETE,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Bulk deleted ${deletedCreditNotes.length} credit note(s)`,
      details: { 
        totalRequested: creditNoteIds.length,
        totalDeleted: deletedCreditNotes.length,
        totalFailed: failedCreditNotes.length,
        reason: deletionReason,
        deletedCreditNotes: deletedCreditNotes.map(cn => cn.creditNoteNumber),
        failedCreditNotes: failedCreditNotes.map(cn => ({ id: cn.id, creditNoteNumber: cn.creditNoteNumber, error: cn.error }))
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json({
      success: true,
      deleted: deletedCreditNotes.length,
      failed: failedCreditNotes.length,
      deletedCreditNotes: deletedCreditNotes,
      failedCreditNotes: failedCreditNotes
    });
  } catch (error) {
    console.error('Error bulk deleting credit notes:', error);
    res.status(500).json({ message: error.message });
  }
});

// Import credit notes - bulk upload (max 500 files) - GA + Admin only
router.post('/import', requirePermission('CREDIT_NOTES_IMPORT'), importUpload.array('files', 500), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded. Please select at least one file.',
        error: 'No files provided'
      });
    }
    
    // Validate file types - only PDF for invoices/credit notes
    const invalidFiles = req.files.filter(file => {
      const ext = path.extname(file.originalname).toLowerCase();
      return ext !== '.pdf';
    });
    
    if (invalidFiles.length > 0) {
      // Delete invalid files
      invalidFiles.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
      return res.status(400).json({
        success: false,
        message: `Only PDF files are allowed for credit note imports. ${invalidFiles.length} invalid file(s) rejected.`,
        error: 'Invalid file type'
      });
    }
    
    // Limit to 500 files
    if (req.files.length > 500) {
      // Delete uploaded files
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
      return res.status(400).json({
        success: false,
        message: 'Maximum 500 files allowed for import.',
        error: 'Too many files'
      });
    }
    
    const importId = uuidv4();
    const userId = req.user.userId;
    
    // Log file upload
    await logActivity({
      type: ActivityType.FILE_UPLOAD,
      userId: userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Uploaded ${req.files.length} file(s) for credit note import`,
      details: { 
        importId: importId,
        fileCount: req.files.length,
        fileNames: req.files.map(f => f.originalname),
        uploadMethod: 'manual',
        documentType: 'credit_note'
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    // Create import session store (similar to bulkTestStore)
    const importStore = require('../utils/importStore');
    await importStore.createImport(importId, req.files.length, req.files.map(f => f.path), userId);
    
    // Add each file to the invoice import queue (same queue, will determine type from template)
    // Use absolute path to ensure file is found even if working directory changes
    for (const file of req.files) {
      const absolutePath = path.resolve(file.path);
      
      // Verify file exists before adding to queue
      if (!fs.existsSync(absolutePath)) {
        console.error(`⚠️  File not found after upload: ${absolutePath}`);
        continue; // Skip this file
      }
      
      // Add a small delay to ensure file is fully written to disk
      // This helps prevent race conditions where the queue processes before multer finishes
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Double-check file still exists before adding to queue
      if (!fs.existsSync(absolutePath)) {
        console.error(`⚠️  File disappeared before adding to queue: ${absolutePath}`);
        continue; // Skip this file
      }
      
      await invoiceImportQueue.add('invoice-import', {
        filePath: absolutePath, // Use absolute path
        fileName: path.basename(file.path),
        originalName: file.originalname,
        importId: importId,
        userId: userId,
        source: 'manual-upload', // Mark as manual upload
        documentType: 'credit_note' // Specify this is for credit notes
      }, {
        priority: 1, // High priority - process before scheduled FTP imports
        attempts: 3, // Retry up to 3 times if job fails
        backoff: {
          type: 'exponential',
          delay: 2000 // Start with 2 second delay
        },
        removeOnComplete: true, // Remove completed jobs
        removeOnFail: false // Keep failed jobs for debugging
      });
      
      console.log(`📤 Added file to credit note import queue: ${file.originalname} -> ${absolutePath}`);
    }
    
    res.json({
      success: true,
      importId: importId,
      totalFiles: req.files.length,
      message: `Import started. Processing ${req.files.length} file(s)...`
    });
  } catch (error) {
    console.error('Error starting credit note import:', error);
    
    // Clean up uploaded files on error
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          try {
            fs.unlinkSync(file.path);
          } catch (cleanupError) {
            // Ignore cleanup errors
          }
        }
      });
    }
    
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to start import',
      error: error.message
    });
  }
});

// Get import status
router.get('/import/:importId', async (req, res) => {
  try {
    const { importId } = req.params;
    const importStore = require('../utils/importStore');
    const importSession = await importStore.getImport(importId);
    
    if (!importSession) {
      return res.status(404).json({
        success: false,
        message: 'Import session not found'
      });
    }
    
    res.json({
      success: true,
      import: {
        importId: importSession.importId,
        totalFiles: importSession.totalFiles,
        processedFiles: importSession.processedFiles || 0,
        downloadedFiles: importSession.downloadedFiles || 0,
        currentFile: importSession.currentFile || null,
        status: importSession.status,
        cancelled: importSession.cancelled || false,
        createdAt: importSession.createdAt,
        completedAt: importSession.completedAt
      }
    });
  } catch (error) {
    console.error('Error fetching import status:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Get import results
router.get('/import/:importId/results', async (req, res) => {
  try {
    const { importId } = req.params;
    const importStore = require('../utils/importStore');
    const importSession = await importStore.getImport(importId);
    
    if (!importSession) {
      return res.status(404).json({
        success: false,
        message: 'Import session not found'
      });
    }
    
    // Calculate summary statistics
    const successful = importSession.results.filter(r => r.success).length;
    const failed = importSession.results.filter(r => !r.success).length;
    const matched = importSession.results.filter(r => r.companyId).length;
    const unallocated = importSession.results.filter(r => r.success && !r.companyId).length;
    const totalProcessingTime = importSession.results.reduce((sum, r) => sum + (r.processingTime || 0), 0);
    const avgProcessingTime = importSession.results.length > 0 ? totalProcessingTime / importSession.results.length : 0;
    
    res.json({
      success: true,
      import: {
        importId: importSession.importId,
        totalFiles: importSession.totalFiles,
        processedFiles: importSession.processedFiles,
        status: importSession.status,
        createdAt: importSession.createdAt,
        completedAt: importSession.completedAt,
        summary: {
          successful,
          failed,
          matched,
          unallocated,
          avgProcessingTime: Math.round(avgProcessingTime)
        },
        results: importSession.results
      }
    });
  } catch (error) {
    console.error('Error fetching import results:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// Bulk download credit notes
router.post('/bulk-download', async (req, res) => {
  try {
    const { creditNoteIds } = req.body;
    
    if (!Array.isArray(creditNoteIds) || creditNoteIds.length === 0) {
      return res.status(400).json({ message: 'No credit note IDs provided' });
    }
    
    if (creditNoteIds.length > 100) {
      return res.status(400).json({ message: 'Maximum 100 credit notes can be downloaded at once' });
    }
    
    const creditNotes = await CreditNote.findAll({
      where: {
        id: { [Op.in]: creditNoteIds },
        ...buildCompanyFilter(req.accessibleCompanyIds)
      },
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name']
      }]
    });
    
    if (creditNotes.length === 0) {
      return res.status(404).json({ message: 'No accessible credit notes found' });
    }
    
    // Filter credit notes that have files
    const creditNotesWithFiles = creditNotes.filter(cn => cn.fileUrl && fs.existsSync(
      path.isAbsolute(cn.fileUrl) ? cn.fileUrl : path.join(__dirname, '..', cn.fileUrl)
    ));
    
    if (creditNotesWithFiles.length === 0) {
      return res.status(404).json({ message: 'No documents available for download' });
    }
    
    // Only update status if setting allows all users OR user is external_user
    // When setting is enabled, ONLY external users can change status (no exceptions)
    const settings = await Settings.getSettings();
    const canUpdateStatus = !settings.onlyExternalUsersChangeDocumentStatus || req.user.role === 'external_user';
    
    // Update download timestamps and log activity
    const now = new Date();
    for (const creditNote of creditNotesWithFiles) {
      const wasFirstDownload = !creditNote.downloadedAt;
      
      if (canUpdateStatus) {
        if (!creditNote.downloadedAt) {
          creditNote.downloadedAt = now;
        }
        
        // Always set status to 'downloaded' when downloaded
        creditNote.documentStatus = 'downloaded';
        
        if (!creditNote.viewedAt) {
          creditNote.viewedAt = now;
        }
        
        // Store who downloaded in metadata
        const metadata = creditNote.metadata || {};
        if (!metadata.downloadedBy) {
          metadata.downloadedBy = req.user.userId;
          metadata.downloadedByEmail = req.user.email;
          metadata.downloadedByName = req.user.name || req.user.email;
        }
        creditNote.metadata = metadata;
        
        await creditNote.save();
      }
      
      // Log each download (log ALL downloads, not just the first one)
      await logActivity({
        type: ActivityType.CREDIT_NOTE_DOWNLOADED,
        userId: req.user.userId,
        userEmail: req.user.email,
        userRole: req.user.role,
        action: `Bulk downloaded credit note ${creditNote.creditNoteNumber || creditNote.id}${wasFirstDownload ? '' : ' (subsequent download)'}`,
        details: { 
          creditNoteId: creditNote.id, 
          creditNoteNumber: creditNote.creditNoteNumber,
          documentStatus: creditNote.documentStatus,
          isFirstDownload: wasFirstDownload,
          bulkDownload: true,
          totalCreditNotes: creditNotesWithFiles.length
        },
        companyId: creditNote.companyId,
        companyName: creditNote.company?.name || null,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent')
      });
    }
    
    // If only one file, download directly
    if (creditNotesWithFiles.length === 1) {
      const creditNote = creditNotesWithFiles[0];
      const filePath = path.isAbsolute(creditNote.fileUrl) 
        ? creditNote.fileUrl 
        : path.join(__dirname, '..', creditNote.fileUrl);
      const fileName = path.basename(filePath);
      return res.download(filePath, fileName);
    }
    
    // Multiple files - create zip
    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    res.attachment(`credit-notes-${Date.now()}.zip`);
    archive.pipe(res);
    
    for (const creditNote of creditNotesWithFiles) {
      const filePath = path.isAbsolute(creditNote.fileUrl) 
        ? creditNote.fileUrl 
        : path.join(__dirname, '..', creditNote.fileUrl);
      const fileName = `${creditNote.creditNoteNumber}_${path.basename(filePath)}`;
      archive.file(filePath, { name: fileName });
    }
    
    archive.finalize();
  } catch (error) {
    console.error('Error bulk downloading credit notes:', error);
    res.status(500).json({ message: error.message });
  }
});

// Test FTP/SFTP connection and list PDF files - GA only
router.post('/sftp/test-connection', requirePermission('FTP_CONFIGURE'), async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    
    if (!settings.ftp || !settings.ftp.enabled) {
      return res.status(400).json({ 
        success: false,
        message: 'FTP/SFTP is not enabled. Please enable and configure FTP/SFTP settings first.' 
      });
    }

    // Support both FTP and SFTP based on settings
    const connectionType = settings.ftp.type || 'ftp';
    const connectionTypeUpper = connectionType.toUpperCase();

    // Log the FTP config being used (without password) for debugging
    console.log(`🔍 ${connectionTypeUpper} Test Connection - Using settings:`, {
      host: settings.ftp.host,
      port: settings.ftp.port,
      username: settings.ftp.username,
      type: connectionType,
      directory: settings.ftp.directory,
      passwordSet: !!settings.ftp.password
    });

    // Test connection
    const connectionTest = await testConnection(settings.ftp);
    if (!connectionTest.success) {
      return res.status(400).json({
        success: false,
        message: connectionTest.message,
        error: connectionTest.error
      });
    }

    // List only PDF files (Excel is only for statements)
    const allFiles = await listFiles(settings.ftp);
    const pdfFiles = allFiles.filter(file => {
      const name = file.name.toLowerCase();
      return name.endsWith('.pdf');
    });

    // Log FTP/SFTP connection test
    await logActivity({
      type: ActivityType.FILE_UPLOAD_SYSTEM,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Tested ${connectionTypeUpper} connection for credit notes - found ${pdfFiles.length} PDF file(s)`,
      details: { 
        connectionTest: true,
        connectionType: connectionType,
        fileCount: pdfFiles.length,
        totalFiles: allFiles.length,
        documentType: 'credit_note'
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: `Connection established. Found ${pdfFiles.length} PDF file(s).`,
      fileCount: pdfFiles.length,
      files: pdfFiles.map(file => ({
        name: file.name,
        size: file.size,
        modified: file.modifyTime || file.date
      }))
    });
  } catch (error) {
    console.error('Error testing SFTP connection:', error);
    res.status(500).json({
      success: false,
      message: 'Error testing SFTP connection: ' + error.message
    });
  }
});

// Import files from FTP/SFTP - GA only
router.post('/sftp/import', requirePermission('FTP_CONFIGURE'), async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    
    if (!settings.ftp || !settings.ftp.enabled) {
      return res.status(400).json({ 
        success: false,
        message: 'FTP/SFTP is not enabled or configured.' 
      });
    }

    // Support both FTP and SFTP based on settings
    const connectionType = settings.ftp.type || 'ftp';
    const connectionTypeUpper = connectionType.toUpperCase();

    // Only PDF for invoices/credit notes - Excel is only for statements
    const fileTypeFilter = 'pdf';

    // Log the FTP config being used (without password) for debugging
    console.log(`🔍 ${connectionTypeUpper} Import (Credit Notes) - Using settings:`, {
      host: settings.ftp.host,
      port: settings.ftp.port,
      username: settings.ftp.username,
      type: connectionType,
      directory: settings.ftp.directory,
      passwordSet: !!settings.ftp.password,
      fileTypeFilter: fileTypeFilter
    });

    // Test connection first
    const connectionTest = await testConnection(settings.ftp);
    if (!connectionTest.success) {
      return res.status(400).json({
        success: false,
        message: `${connectionTypeUpper} connection failed: ${connectionTest.message}`
      });
    }

    // List PDF/Excel files
    const allFiles = await listFiles(settings.ftp);
    
    // Filter only PDF files (Excel is only for statements)
    const pdfFiles = allFiles.filter(file => {
      const name = file.name.toLowerCase();
      return name.endsWith('.pdf');
    });

    if (pdfFiles.length === 0) {
      return res.status(400).json({
        success: false,
        message: `No PDF files found on ${connectionTypeUpper} server.`
      });
    }

    const importId = uuidv4();
    const userId = req.user.userId;

    // Create import session store
    const importStore = require('../utils/importStore');
    importStore.createImport(importId, pdfFiles.length, [], userId);

    // STEP 1: Download ALL files first (batch download)
    console.log(`📥 Starting batch download of ${pdfFiles.length} credit note file(s) from ${connectionTypeUpper}...`);
    const downloadedFiles = [];
    const fileQueueData = [];
    
    // Update import store with total files
    importStore.updateImport(importId, {
      totalFiles: pdfFiles.length,
      downloadedFiles: 0,
      status: 'downloading'
    });
    
    // Send response immediately so frontend knows import started
    // Downloads will continue in background
    res.json({
      success: true,
      importId: importId,
      totalFiles: pdfFiles.length,
      downloadedFiles: 0,
      message: `Import started. Downloading ${pdfFiles.length} file(s) from ${connectionTypeUpper}...`
    });
    
    // Continue downloads in background (non-blocking)
    // Use setImmediate to ensure response is sent first
    setImmediate(async () => {
      try {
        for (let i = 0; i < pdfFiles.length; i++) {
          // Check for cancellation FIRST THING in each iteration
          if (importStore.isCancelled(importId)) {
            console.log(`🛑 Import ${importId} was cancelled. Stopping downloads immediately.`);
            // Clean up any files that were downloaded
            for (const fileData of fileQueueData) {
              try {
                if (fs.existsSync(fileData.filePath)) {
                  fs.unlinkSync(fileData.filePath);
                }
              } catch (cleanupError) {
                // Ignore cleanup errors
              }
            }
            return; // Exit immediately
          }
          
          const file = pdfFiles[i];
          const fileIndex = i + 1;
          
          // Update progress BEFORE starting download (shows which file we're about to download)
          // Use explicit count to ensure accuracy
          const currentDownloadedCount = downloadedFiles.length;
          importStore.updateImport(importId, {
            downloadedFiles: currentDownloadedCount,
            currentFile: file.name,
            status: 'downloading'
          });
          console.log(`📊 Progress before download: ${currentDownloadedCount}/${pdfFiles.length} - Starting: ${file.name}`);
          
          try {
            // Download file to temp directory
            // IMPORTANT: We use a temporary unique filename (sftp-{timestamp}-{random}-{index}.pdf)
            // to avoid collisions during parallel downloads, but we ALWAYS preserve the original
            // filename in the 'originalName' field. The final file will be saved with the original
            // filename after processing completes.
            const timestamp = Date.now();
            const random = Math.round(Math.random() * 1E9);
            const tempFileName = `sftp-${timestamp}-${random}-${fileIndex}${path.extname(file.name)}`;
            const tempFilePath = path.join(tempImportsDir, tempFileName);
            
            console.log(`📥 [${fileIndex}/${pdfFiles.length}] Downloading ${file.name} (will be saved as ${tempFileName} temporarily, then restored to original name)`);
            
            // Check cancellation again right before download (in case it was cancelled during progress update)
            if (importStore.isCancelled(importId)) {
              console.log(`🛑 Import ${importId} was cancelled before download. Stopping.`);
              break;
            }
            
            // Download from FTP/SFTP
            let downloadResult;
            try {
              downloadResult = await downloadFile(settings.ftp, file.name, tempFilePath);
              
              // Check cancellation immediately after download completes
              if (importStore.isCancelled(importId)) {
                console.log(`🛑 Import ${importId} was cancelled after download. Stopping.`);
                // Clean up the downloaded file
                try {
                  if (fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                  }
                } catch (cleanupError) {
                  // Ignore cleanup errors
                }
                break;
              }
            } catch (downloadError) {
              console.error(`⚠️  Download failed for ${file.name}:`, downloadError.message);
              // Check cancellation even on error
              if (importStore.isCancelled(importId)) {
                console.log(`🛑 Import ${importId} was cancelled. Stopping downloads.`);
                break;
              }
              continue; // Skip this file and continue with others
            }
            
            if (!downloadResult || !downloadResult.success) {
              console.error(`⚠️  Download failed for ${file.name}: File was not downloaded successfully`);
              // Check cancellation
              if (importStore.isCancelled(importId)) {
                console.log(`🛑 Import ${importId} was cancelled. Stopping downloads.`);
                break;
              }
              continue; // Skip this file and continue with others
            }
            
            // Verify file exists and has content
            let fileReady = false;
            let retries = 10;
            while (retries > 0 && !fileReady) {
              // Check for cancellation during wait
              if (importStore.isCancelled(importId)) {
                console.log(`🛑 Import ${importId} was cancelled during file verification. Stopping.`);
                // Clean up the partially downloaded file
                try {
                  if (fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                  }
                } catch (cleanupError) {
                  // Ignore cleanup errors
                }
                break;
              }
              
              if (fs.existsSync(tempFilePath)) {
                const stats = fs.statSync(tempFilePath);
                if (stats.size > 0) {
                  fileReady = true;
                } else {
                  retries--;
                  if (retries > 0) {
                    await new Promise(resolve => setTimeout(resolve, 200)); // Wait 200ms
                  }
                }
              } else {
                retries--;
                if (retries > 0) {
                  await new Promise(resolve => setTimeout(resolve, 200)); // Wait 200ms
                }
              }
            }
            
            // Check cancellation again after verification
            if (importStore.isCancelled(importId)) {
              console.log(`🛑 Import ${importId} was cancelled. Stopping downloads.`);
              // Clean up the file if it exists
              try {
                if (fs.existsSync(tempFilePath)) {
                  fs.unlinkSync(tempFilePath);
                }
              } catch (cleanupError) {
                // Ignore cleanup errors
              }
              break; // Exit the loop immediately
            }
            
            if (!fileReady) {
              console.error(`⚠️  File ${file.name} was not fully downloaded or is empty`);
              // Check cancellation even on error
              if (importStore.isCancelled(importId)) {
                console.log(`🛑 Import ${importId} was cancelled. Stopping downloads.`);
                break;
              }
              continue; // Skip this file and continue with others
            }
            
            // Get absolute path and verify it exists
            const absolutePath = path.resolve(tempFilePath);
            console.log(`🔍 [${fileIndex}/${pdfFiles.length}] Verifying downloaded file:`);
            console.log(`   Original path: ${tempFilePath}`);
            console.log(`   Absolute path: ${absolutePath}`);
            console.log(`   File exists: ${fs.existsSync(absolutePath)}`);
            
            if (!fs.existsSync(absolutePath)) {
              console.error(`⚠️  File path verification failed: ${absolutePath}`);
              // Try to find the file with just the filename in temp directory
              const tempDir = getStorageDir('temp');
              const altPath = path.join(tempDir, tempFileName);
              if (fs.existsSync(altPath)) {
                console.log(`✅ Found file at alternative path: ${altPath}`);
                fileQueueData.push({
                  filePath: path.resolve(altPath),
                  fileName: tempFileName,
                  originalName: file.name
                });
                downloadedFiles.push(file.name);
                const altCount = downloadedFiles.length;
                console.log(`✅ Downloaded ${connectionTypeUpper} file: ${file.name} -> ${path.resolve(altPath)} (${fs.statSync(altPath).size} bytes) [${altCount}/${pdfFiles.length}]`);
                
                // Update progress for alternative path case
                importStore.updateImport(importId, {
                  downloadedFiles: altCount,
                  currentFile: null,
                  status: altCount < pdfFiles.length ? 'downloading' : 'queuing'
                });
                console.log(`📊 Progress updated (alt path): ${altCount}/${pdfFiles.length} files downloaded`);
                
                // Check cancellation
                if (importStore.isCancelled(importId)) {
                  console.log(`🛑 Import ${importId} was cancelled. Stopping downloads.`);
                  break;
                }
                
                await new Promise(resolve => setTimeout(resolve, 100));
                continue;
              }
              continue; // Skip this file and continue with others
            }
            
            // Store file info for queuing (we'll queue all at once after downloads complete)
            fileQueueData.push({
              filePath: absolutePath,
              fileName: tempFileName,
              originalName: file.name
            });
            
            downloadedFiles.push(file.name);
            const currentCount = downloadedFiles.length;
            
            // Track file path for cleanup on cancellation
            const importSession = importStore.getImport(importId);
            if (importSession) {
              if (!importSession.filePaths) {
                importSession.filePaths = [];
              }
              importSession.filePaths.push(absolutePath);
            }
            console.log(`✅ Downloaded ${connectionTypeUpper} file: ${file.name} -> ${absolutePath} (${fs.statSync(absolutePath).size} bytes) [${currentCount}/${pdfFiles.length}]`);
            
            // Update progress after successful download (AFTER adding to array)
            // Use explicit count to ensure accuracy
            importStore.updateImport(importId, {
              downloadedFiles: currentCount,
              currentFile: null, // Clear current file after download completes
              status: currentCount < pdfFiles.length ? 'downloading' : 'queuing'
            });
            
            // Log progress update for debugging
            console.log(`📊 Progress updated: ${currentCount}/${pdfFiles.length} files downloaded`);
            
            // Small delay to allow frontend to poll and see the update
            await new Promise(resolve => setTimeout(resolve, 100));
            } catch (fileError) {
              console.error(`⚠️  Error downloading ${connectionTypeUpper} file ${file.name}:`, fileError.message);
              // Check cancellation on error
              if (importStore.isCancelled(importId)) {
                console.log(`🛑 Import ${importId} was cancelled. Stopping downloads.`);
                break;
              }
              // Continue with other files
            }
          }
          
          // Update import store - all downloads complete (or cancelled)
          if (importStore.isCancelled(importId)) {
            console.log(`🛑 Import ${importId} was cancelled. Cleaning up downloaded files.`);
            // Clean up downloaded files
            for (const fileData of fileQueueData) {
              try {
                if (fs.existsSync(fileData.filePath)) {
                  fs.unlinkSync(fileData.filePath);
                  console.log(`🗑️  Cleaned up cancelled file: ${fileData.filePath}`);
                }
              } catch (cleanupError) {
                console.error(`⚠️  Error cleaning up file ${fileData.filePath}:`, cleanupError.message);
              }
            }
            importStore.updateImport(importId, {
              status: 'cancelled',
              downloadedFiles: downloadedFiles.length
            });
            return; // Exit background process
          }
          
          importStore.updateImport(importId, {
            downloadedFiles: downloadedFiles.length,
            currentFile: null,
            status: 'queuing'
          });
          
          console.log(`📊 Download complete: ${downloadedFiles.length}/${pdfFiles.length} files downloaded successfully`);
        
          // STEP 2: Queue ALL downloaded files for processing (only after all downloads complete)
          if (!importStore.isCancelled(importId)) {
            console.log(`📤 Queuing ${fileQueueData.length} downloaded file(s) for processing...`);
            for (const fileData of fileQueueData) {
              // Check for cancellation before queuing each file
              if (importStore.isCancelled(importId)) {
                console.log(`🛑 Import ${importId} was cancelled. Stopping queue operations.`);
                // Clean up remaining files
                const currentIndex = fileQueueData.indexOf(fileData);
                for (let i = currentIndex; i < fileQueueData.length; i++) {
                  const remainingFile = fileQueueData[i];
                  try {
                    if (fs.existsSync(remainingFile.filePath)) {
                      fs.unlinkSync(remainingFile.filePath);
                      console.log(`🗑️  Cleaned up cancelled file: ${remainingFile.filePath}`);
                    }
                  } catch (cleanupError) {
                    console.error(`⚠️  Error cleaning up file ${remainingFile.filePath}:`, cleanupError.message);
                  }
                }
                break;
              }
              
              try {
                // Double-check file still exists before queuing
                if (!fs.existsSync(fileData.filePath)) {
                  console.error(`⚠️  File no longer exists before queuing: ${fileData.filePath}`);
                  continue;
                }
                
                // Add to import queue (same queue as invoices - it will determine document type from template)
                await invoiceImportQueue.add('invoice-import', {
                  filePath: fileData.filePath,
                  fileName: fileData.fileName,
                  originalName: fileData.originalName,
                  importId: importId,
                  userId: userId,
                  source: connectionType,
                  documentType: 'credit_note' // Specify this is for credit notes
                }, {
                  attempts: 3,
                  backoff: {
                    type: 'exponential',
                    delay: 2000
                  },
                  removeOnComplete: true,
                  removeOnFail: false
                });

                console.log(`📤 Queued ${connectionTypeUpper} file for processing: ${fileData.originalName}`);
              } catch (queueError) {
                console.error(`⚠️  Error queuing file ${fileData.originalName}:`, queueError.message);
              }
            }
            
            if (!importStore.isCancelled(importId)) {
              console.log(`✅ Batch download complete: ${downloadedFiles.length}/${pdfFiles.length} file(s) downloaded and queued`);

              // Log FTP/SFTP import
              await logActivity({
                type: ActivityType.FILE_UPLOAD_SYSTEM,
                userId: userId,
                userEmail: req.user.email,
                userRole: req.user.role,
                action: `Imported ${downloadedFiles.length} credit note file(s) from ${connectionTypeUpper}`,
                details: { 
                  importId: importId,
                  fileCount: downloadedFiles.length,
                  totalFiles: pdfFiles.length,
                  files: downloadedFiles,
                  uploadMethod: connectionType,
                  documentType: 'credit_note'
                },
                companyId: null,
                companyName: null,
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('user-agent')
              });
            }
          }
        } catch (backgroundError) {
          console.error(`❌ Error in background download process:`, backgroundError);
          importStore.updateImport(importId, {
            status: 'failed',
            errors: [...(importStore.getImport(importId)?.errors || []), backgroundError.message]
          });
        }
      });
    } catch (error) {
      console.error(`Error importing from ${connectionTypeUpper}:`, error);
      res.status(500).json({
        success: false,
        message: error.message || `Failed to import from ${connectionTypeUpper}`,
        error: error.message
      });
    }
  });

// Cancel an import session
router.post('/import/:importId/cancel', async (req, res) => {
  try {
    const { importId } = req.params;
    const importStore = require('../utils/importStore');
    
    const importSession = importStore.getImport(importId);
    if (!importSession) {
      return res.status(404).json({
        success: false,
        message: 'Import session not found'
      });
    }
    
    // Cancel the import
    importStore.cancelImport(importId);
    
    // Remove all queued jobs for this import from BullMQ queue
    try {
      const jobs = await invoiceImportQueue.getJobs(['waiting', 'delayed', 'active', 'wait']);
      let removedCount = 0;
      for (const job of jobs) {
        if (job.data.importId === importId) {
          await job.remove();
          removedCount++;
          console.log(`🗑️  Removed queued job ${job.id} for cancelled import ${importId}`);
        }
      }
      console.log(`🗑️  Removed ${removedCount} queued job(s) for cancelled import ${importId}`);
    } catch (queueError) {
      console.error(`⚠️  Error removing jobs from queue:`, queueError.message);
    }
    
    // Clean up any downloaded files
    const filePaths = importSession.filePaths || [];
    for (const filePath of filePaths) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`🗑️  Cleaned up cancelled file: ${filePath}`);
        }
      } catch (cleanupError) {
        console.error(`⚠️  Error cleaning up file ${filePath}:`, cleanupError.message);
      }
    }
    
    // Clean up any remaining temp files that might not be in filePaths
    // (fallback for files that were downloaded but not yet tracked)
    const tempDir = getStorageDir('temp');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      const trackedPaths = new Set((importSession.filePaths || []).map(p => path.resolve(p)));
      
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        const absolutePath = path.resolve(filePath);
        
        // Delete if:
        // 1. It's already tracked in filePaths, OR
        // 2. It starts with 'sftp-' and was created recently (within last 5 minutes)
        //    to avoid deleting files from other concurrent imports
        const isTracked = trackedPaths.has(absolutePath);
        const isRecentSftpFile = file.startsWith('sftp-');
        
        if (isTracked) {
          // Already handled above, but double-check
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(`🗑️  Cleaned up cancelled temp file (tracked): ${filePath}`);
            }
          } catch (cleanupError) {
            console.error(`⚠️  Error cleaning up tracked temp file ${file}:`, cleanupError.message);
          }
        } else if (isRecentSftpFile) {
          // Fallback: delete recent sftp files (likely from this import)
          try {
            if (fs.existsSync(filePath)) {
              const stats = fs.statSync(filePath);
              const fileAge = Date.now() - stats.mtime.getTime();
              // Only delete files less than 5 minutes old to avoid deleting files from other imports
              if (fileAge < 5 * 60 * 1000) {
                fs.unlinkSync(filePath);
                console.log(`🗑️  Cleaned up cancelled temp file (fallback): ${filePath}`);
              }
            }
          } catch (cleanupError) {
            console.error(`⚠️  Error cleaning up temp file ${file}:`, cleanupError.message);
          }
        }
      }
    }
    
    // Get user identifier - try email first, then userId, then id, fallback to 'unknown'
    const userIdentifier = req.user?.email || req.user?.userId || req.user?.id || 'unknown';
    console.log(`🛑 Import ${importId} cancelled by user ${userIdentifier}`);
    
    res.json({
      success: true,
      message: 'Import cancelled successfully'
    });
  } catch (error) {
    console.error('Error cancelling import:', error);
    res.status(500).json({
      success: false,
      message: `Error cancelling import: ${error.message}`
    });
  }
});

module.exports = router;

