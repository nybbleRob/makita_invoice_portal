const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { Invoice, Company, Sequelize, Settings, DocumentQuery, sequelize } = require('../models');
const { Op } = Sequelize;
const auth = require('../middleware/auth');
const { checkDocumentAccess, buildCompanyFilter } = require('../middleware/documentAccess');
const { getDescendantCompanyIds } = require('../utils/companyHierarchy');
const { invoiceImportQueue } = require('../config/queue');
const { ensureStorageDirs, getStorageDir } = require('../config/storage');
const { logActivity, ActivityType } = require('../services/activityLogger');
const { calculateDocumentRetentionDates } = require('../utils/documentRetention');
const { testConnection, listFiles, downloadFile } = require('../utils/ftp');
const router = express.Router();

// Storage configuration for invoice imports
ensureStorageDirs();
const tempImportsDir = getStorageDir('temp');

// Configure multer for invoice imports (max 500 files)
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

// Get all invoices (filtered by user's accessible companies)
router.get('/', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      companyId, 
      companyIds, // Support multiple company IDs (comma-separated or array)
      status, 
      startDate, 
      endDate,
      sortBy = 'issueDate',
      sortOrder = 'DESC',
      retentionFilter // 'expiring_soonest' or null
    } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    
    const whereConditions = buildCompanyFilter(req.accessibleCompanyIds);
    
    // Debug logging for Global Admins
    if (req.user.role === 'global_admin') {
      console.log(`🔍 [Invoices GET] Global Admin access - accessibleCompanyIds: ${req.accessibleCompanyIds === null ? 'null (all companies)' : JSON.stringify(req.accessibleCompanyIds)}, whereConditions: ${JSON.stringify(whereConditions)}`);
    }
    
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
    
    if (startDate || endDate) {
      whereConditions.issueDate = {};
      if (startDate) {
        whereConditions.issueDate[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        whereConditions.issueDate[Op.lte] = new Date(endDate);
      }
    }
    
    // Build search conditions
    const searchConditions = [];
    if (search) {
      const searchTerm = `%${search}%`;
      searchConditions.push(
        { invoiceNumber: { [Op.iLike]: searchTerm } },
        { notes: { [Op.iLike]: searchTerm } },
        // Search in metadata.parsedData fields (invoiceTo, deliveryAddress, customerPO, etc.)
        sequelize.where(
          sequelize.cast(sequelize.col('Invoice.metadata'), 'text'),
          { [Op.iLike]: searchTerm }
        )
      );
      
      // Add company search via subquery
      // Use Sequelize's escape method which returns a properly escaped string
      const escapedSearchTerm = sequelize.escape(searchTerm);
      const companySearchSubquery = sequelize.literal(`EXISTS (
        SELECT 1 FROM "companies" 
        WHERE "companies"."id" = "Invoice"."companyId"
        AND (
          "companies"."name" ILIKE ${escapedSearchTerm} OR
          CAST("companies"."referenceNo" AS TEXT) ILIKE ${escapedSearchTerm} OR
          "companies"."code" ILIKE ${escapedSearchTerm}
        )
      )`);
      searchConditions.push(companySearchSubquery);
    }
    
    // Document status filter (ready_new, viewed, downloaded, queried, review)
    const statusConditions = [];
    if (status) {
      if (status === 'ready_new') {
        // Ready (New) = documentStatus is 'ready' and not viewed
        statusConditions.push({
          documentStatus: 'ready',
          viewedAt: null
        });
      } else if (status === 'viewed') {
        // Viewed = documentStatus is 'viewed' OR (has viewedAt but not downloaded)
        statusConditions.push(
          { documentStatus: 'viewed' },
          sequelize.literal(`("Invoice"."viewedAt" IS NOT NULL AND "Invoice"."downloadedAt" IS NULL)`)
        );
      } else if (status === 'downloaded') {
        // Downloaded = documentStatus is 'downloaded' OR has downloadedAt
        statusConditions.push(
          { documentStatus: 'downloaded' },
          sequelize.literal(`"Invoice"."downloadedAt" IS NOT NULL`)
        );
      } else if (status === 'queried') {
        statusConditions.push({ documentStatus: 'queried' });
      } else if (status === 'review') {
        statusConditions.push({ documentStatus: 'review' });
      } else {
        // Fallback to invoice status for backward compatibility
        statusConditions.push({ status: status });
      }
    }
    
    // Combine conditions with AND logic
    const andConditions = [];
    if (searchConditions.length > 0) {
      andConditions.push({ [Op.or]: searchConditions });
    }
    if (statusConditions.length > 0) {
      if (statusConditions.length === 1) {
        andConditions.push(statusConditions[0]);
      } else {
        andConditions.push({ [Op.or]: statusConditions });
      }
    }
    
    if (andConditions.length > 0) {
      whereConditions[Op.and] = [
        ...(whereConditions[Op.and] || []),
        ...andConditions
      ];
    }
    
    // Build order clause
    let orderClause = [];
    const validSortFields = ['issueDate', 'createdAt', 'invoiceNumber', 'amount', 'status', 'retentionExpiryDate'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'issueDate';
    const sortDir = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    
    if (retentionFilter === 'expiring_soonest') {
      // Sort by retention expiry date (ascending - soonest first)
      orderClause = [
        [sequelize.literal('CASE WHEN "retentionExpiryDate" IS NULL THEN 1 ELSE 0 END'), 'ASC'],
        ['retentionExpiryDate', 'ASC'],
        ['issueDate', 'DESC']
      ];
    } else {
      orderClause = [[sortField, sortDir], ['createdAt', 'DESC']];
    }
    
    const { count, rows } = await Invoice.findAndCountAll({
      where: whereConditions,
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'referenceNo', 'type', 'parentId', 'code'],
        required: false, // LEFT JOIN - show invoices even if company is missing/deleted
        include: [{
          model: Company,
          as: 'parent',
          attributes: ['id', 'name', 'referenceNo', 'type', 'code'],
          required: false
        }]
      }],
      attributes: {
        include: ['viewedAt', 'downloadedAt', 'retentionExpiryDate', 'retentionStartDate']
      },
      limit: limitNum,
      offset: offset,
      order: orderClause,
      distinct: true // Important when using JOINs with search
    });
    
    // Fetch query information for all invoices
    const invoiceIds = rows.map(inv => inv.id);
    const queries = await DocumentQuery.findAll({
      where: {
        documentType: 'invoice',
        documentId: { [Op.in]: invoiceIds }
      },
      attributes: ['documentId', 'status', 'lastMessageBy', 'lastMessageAt', 'messages']
    });
    
    // Create a map of invoiceId -> query info
    const queryMap = new Map();
    queries.forEach(query => {
      queryMap.set(query.documentId, {
        hasQuery: true,
        status: query.status,
        lastMessageBy: query.lastMessageBy,
        lastMessageAt: query.lastMessageAt,
        messages: query.messages || []
      });
    });
    
    // Add query info to each invoice
    const invoicesWithQueryInfo = rows.map(invoice => {
      const invoiceData = invoice.toJSON();
      const queryInfo = queryMap.get(invoice.id);
      
      if (queryInfo) {
        invoiceData.queryInfo = {
          hasQuery: true,
          status: queryInfo.status,
          lastMessageBy: queryInfo.lastMessageBy,
          lastMessageAt: queryInfo.lastMessageAt,
          lastMessage: queryInfo.messages.length > 0 ? queryInfo.messages[queryInfo.messages.length - 1] : null
        };
      } else {
        invoiceData.queryInfo = {
          hasQuery: false,
          status: null,
          lastMessageBy: null,
          lastMessageAt: null,
          lastMessage: null
        };
      }
      
      return invoiceData;
    });
    
    res.json({
      data: invoicesWithQueryInfo,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        pages: Math.ceil(count / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ message: error.message });
  }
});

// Diagnostic endpoint to check invoice creation (Global Admin only)
router.get('/diagnostics', async (req, res) => {
  try {
    if (req.user.role !== 'global_admin') {
      return res.status(403).json({ message: 'Access denied. Global admin only.' });
    }

    const { Invoice, File, Company } = require('../models');
    const { Op } = Sequelize;

    // Get total invoice count (no filters)
    const totalInvoices = await Invoice.count();
    
    // Get invoices with accessible company filter
    const whereConditions = buildCompanyFilter(req.accessibleCompanyIds);
    const accessibleInvoices = await Invoice.count({
      where: whereConditions
    });
    
    // Get invoices without company filter (raw count)
    const allInvoicesRaw = await Invoice.count();
    
    // Check for invoices with missing companies
    const invoicesWithMissingCompanies = await Invoice.count({
      include: [{
        model: Company,
        as: 'company',
        required: false,
        where: { id: null } // This won't work, need different approach
      }]
    });
    
    // Better approach: Get all invoices and check which have companies
    const allInvoicesWithCompanies = await Invoice.findAll({
      limit: 100,
      include: [{
        model: Company,
        as: 'company',
        required: false
      }]
    });
    
    const invoicesWithoutCompany = allInvoicesWithCompanies.filter(inv => !inv.company).length;

    // Get recent invoices (last 10) - no filters to see all
    const recentInvoices = await Invoice.findAll({
      limit: 10,
      order: [['createdAt', 'DESC']],
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'referenceNo'],
        required: false // LEFT JOIN - show invoices even if company is missing
      }]
    });

    // Get files that should have created invoices
    // Note: File model doesn't have a direct Company association, so we fetch companies separately
    const matchedFiles = await File.findAll({
      where: {
        status: 'parsed',
        customerId: { [Op.ne]: null },
        parsedData: {
          [Op.not]: null
        }
      },
      limit: 10,
      order: [['createdAt', 'DESC']],
      attributes: ['id', 'fileName', 'customerId', 'status', 'parsedData', 'createdAt']
    });
    
    // Manually fetch companies for matched files
    const matchedFilesWithCompanies = await Promise.all(
      matchedFiles.map(async (file) => {
        let company = null;
        if (file.customerId) {
          company = await Company.findByPk(file.customerId, {
            attributes: ['id', 'name', 'referenceNo']
          });
        }
        return {
          id: file.id,
          fileName: file.fileName,
          customerId: file.customerId,
          companyName: company?.name || null,
          companyReferenceNo: company?.referenceNo || null,
          documentType: file.parsedData?.documentType,
          accountNumber: file.parsedData?.accountNumber,
          status: file.status
        };
      })
    );

    // Check for invoices by file name (to find invoices that might exist but aren't showing)
    const fileNameToCheck = req.query.fileName || null;
    let invoicesByFileName = [];
    if (fileNameToCheck) {
      invoicesByFileName = await Invoice.findAll({
        where: {
          [Op.or]: [
            { 'metadata.fileName': { [Op.iLike]: `%${fileNameToCheck}%` } },
            { fileUrl: { [Op.iLike]: `%${fileNameToCheck}%` } }
          ]
        },
        include: [{
          model: Company,
          as: 'company',
          attributes: ['id', 'name', 'referenceNo'],
          required: false
        }],
        limit: 10
      });
    }

    res.json({
      totalInvoices,
      allInvoicesRaw,
      accessibleInvoices,
      invoicesWithoutCompany,
      whereConditions,
      accessibleCompanyIds: req.accessibleCompanyIds,
      userRole: req.user.role,
      recentInvoices: recentInvoices.map(inv => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        companyId: inv.companyId,
        companyName: inv.company?.name || 'NO COMPANY',
        companyReferenceNo: inv.company?.referenceNo || 'N/A',
        createdAt: inv.createdAt,
        status: inv.status,
        documentStatus: inv.documentStatus
      })),
      matchedFiles: matchedFilesWithCompanies,
      invoicesByFileName: invoicesByFileName.map(inv => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        companyId: inv.companyId,
        companyName: inv.company?.name || 'NO COMPANY',
        companyReferenceNo: inv.company?.referenceNo || 'N/A',
        fileUrl: inv.fileUrl,
        metadata: inv.metadata
      }))
    });
  } catch (error) {
    console.error('Error in diagnostics:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get single invoice (marks as viewed if not already)
router.get('/:id', async (req, res) => {
  try {
    const invoice = await Invoice.findByPk(req.params.id, {
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'referenceNo', 'type', 'globalSystemEmail', 'parentId', 'code'],
        required: false, // LEFT JOIN - show invoice even if company is missing/deleted
        include: [{
          model: Company,
          as: 'parent',
          attributes: ['id', 'name', 'referenceNo', 'type', 'code'],
          required: false
        }]
      }]
    });
    
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    
    // Double-check access to this specific invoice's company
    if (req.accessibleCompanyIds !== null && 
        !req.accessibleCompanyIds.includes(invoice.companyId)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have access to this invoice.' 
      });
    }
    
    // Mark as viewed when fetching (if not already downloaded)
    // Only update status if setting allows all users OR user is external_user OR user is global_admin
    const settings = await Settings.getSettings();
    const canUpdateStatus = !settings.onlyExternalUsersChangeDocumentStatus || req.user.role === 'external_user' || req.user.role === 'global_admin';
    
    if (canUpdateStatus && invoice.documentStatus !== 'downloaded') {
      const wasFirstView = !invoice.viewedAt;
      const now = new Date();
      
      if (!invoice.viewedAt) {
        invoice.viewedAt = now;
      }
      
      invoice.documentStatus = 'viewed';
      
      // Store who viewed in metadata
      const metadata = invoice.metadata || {};
      if (!metadata.viewedBy) {
        metadata.viewedBy = req.user.userId;
        metadata.viewedByEmail = req.user.email;
        metadata.viewedByName = req.user.name || req.user.email;
      }
      invoice.metadata = metadata;
      
      await invoice.save();
      
      if (wasFirstView) {
        console.log(`👁️  Invoice ${invoice.invoiceNumber} marked as viewed by ${req.user.email}`);
      }
    }
    
    res.json(invoice);
  } catch (error) {
    console.error('Error fetching invoice:', error);
    res.status(500).json({ message: error.message });
  }
});

// Create invoice (only for admins/managers/staff)
router.post('/', async (req, res) => {
  try {
    // Only admins, managers, and staff can create invoices
    if (req.user.role === 'external_user') {
      return res.status(403).json({ 
        message: 'Access denied. External users cannot create invoices.' 
      });
    }
    
    const {
      invoiceNumber,
      companyId,
      issueDate,
      dueDate,
      amount,
      taxAmount,
      status,
      items,
      notes,
      fileUrl,
      metadata
    } = req.body;
    
    // Validate required fields
    if (!invoiceNumber || !companyId || !issueDate || amount === undefined) {
      return res.status(400).json({ 
        message: 'invoiceNumber, companyId, issueDate, and amount are required' 
      });
    }
    
    // Check if invoice number already exists
    const existingInvoice = await Invoice.findOne({
      where: { invoiceNumber }
    });
    
    if (existingInvoice) {
      return res.status(400).json({ message: 'Invoice number already exists' });
    }
    
    // Verify company exists
    const company = await Company.findByPk(companyId);
    if (!company) {
      return res.status(400).json({ message: 'Company not found' });
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
    
    const invoice = await Invoice.create({
      invoiceNumber,
      companyId,
      issueDate,
      dueDate,
      amount,
      taxAmount: taxAmount || 0,
      status: status || 'draft',
      items: items || [],
      notes,
      fileUrl,
      metadata: metadata || {},
      createdById: req.user.userId,
      retentionStartDate: retentionDates.retentionStartDate,
      retentionExpiryDate: retentionDates.retentionExpiryDate
    });
    
    // Reload with company
    await invoice.reload({
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'referenceNo', 'type']
      }]
    });
    
    res.status(201).json(invoice);
  } catch (error) {
    console.error('Error creating invoice:', error);
    res.status(400).json({ message: error.message });
  }
});

// Import invoices - bulk upload (max 500 files)
router.post('/import', importUpload.array('files', 500), async (req, res) => {
  try {
    // Only admins, managers, and staff can import invoices
    if (req.user.role === 'external_user') {
      return res.status(403).json({ 
        message: 'Access denied. External users cannot import invoices.' 
      });
    }
    
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
        message: `Only PDF files are allowed for invoice/credit note imports. ${invalidFiles.length} invalid file(s) rejected.`,
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
    
    // Register batch for notification tracking
    try {
      const { registerBatch } = require('../services/batchNotificationService');
      registerBatch(importId, req.files.length, {
        userId: userId,
        userEmail: req.user.email,
        source: 'manual-upload'
      });
    } catch (batchError) {
      console.warn('Failed to register batch:', batchError.message);
    }
    
    // Log file upload
    await logActivity({
      type: ActivityType.FILE_UPLOAD,
      userId: userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Uploaded ${req.files.length} file(s) for import`,
      details: { 
        importId: importId,
        fileCount: req.files.length,
        fileNames: req.files.map(f => f.originalname),
        uploadMethod: 'manual'
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    // OPTIMIZATION: Batch duplicate detection - calculate all hashes upfront and do single DB query
    // This is O(new_files) instead of O(new_files * existing_files)
    console.log(`🔍 Calculating hashes for ${req.files.length} file(s) for batch duplicate detection...`);
    const crypto = require('crypto');
    const { File } = require('../models');
    const fileHashMap = new Map(); // Map<filePath, { hash, fileName, originalName }>
    const fileHashes = [];
    
    for (const file of req.files) {
      const absolutePath = path.resolve(file.path);
      
      // Verify file exists
      if (!fs.existsSync(absolutePath)) {
        console.error(`⚠️  File not found after upload: ${absolutePath}`);
        continue; // Skip this file
      }
      
      try {
        // Calculate hash
        const fileBuffer = fs.readFileSync(absolutePath);
        const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
        
        fileHashMap.set(absolutePath, {
          hash: fileHash,
          fileName: path.basename(file.path),
          originalName: file.originalname
        });
        fileHashes.push(fileHash);
      } catch (hashError) {
        console.error(`⚠️  Error calculating hash for ${absolutePath}:`, hashError.message);
        continue; // Skip this file
      }
    }
    
    // Single batch query to check for duplicates (O(1) with indexed lookup)
    console.log(`🔍 Checking ${fileHashes.length} hash(es) against database...`);
    const settings = await Settings.findOne();
    const retentionDays = settings?.fileRetentionDays || null;
    const retentionDate = retentionDays ? new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000)) : null;
    
    // Check for duplicates - include deleted files if within retention period
    const duplicateWhere = {
      fileHash: { [Op.in]: fileHashes }
    };
    
    // If retention period is set, check deleted files too (to keep hash records)
    if (retentionDate) {
      duplicateWhere[Op.or] = [
        { deletedAt: null }, // Non-deleted files
        { deletedAt: { [Op.gte]: retentionDate } } // Deleted files within retention period
      ];
    } else {
      // No retention period - check all files (including deleted) to keep hash records forever
      // This allows us to track hashes even after deletion
    }
    
    const existingFiles = await File.findAll({
      where: duplicateWhere,
      attributes: ['id', 'fileHash', 'fileName', 'status', 'deletedAt', 'filePath'],
      order: [['createdAt', 'DESC']]
    });
    
    // Create a Map for O(1) lookup: hash -> existing file
    const existingHashesMap = new Map();
    for (const existingFile of existingFiles) {
      if (!existingHashesMap.has(existingFile.fileHash)) {
        existingHashesMap.set(existingFile.fileHash, existingFile);
      }
    }
    
    console.log(`✅ Found ${existingHashesMap.size} existing file(s) with matching hash(es)`);
    
    // Create import session store (similar to bulkTestStore)
    const importStore = require('../utils/importStore');
    await importStore.createImport(importId, req.files.length, req.files.map(f => f.path), userId);
    
    // Add each file to the invoice import queue with pre-calculated duplicate info
    for (const file of req.files) {
      const absolutePath = path.resolve(file.path);
      const fileInfo = fileHashMap.get(absolutePath);
      
      if (!fileInfo) {
        console.error(`⚠️  File info not found for: ${absolutePath}`);
        continue; // Skip this file
      }
      
      // Verify file still exists before adding to queue
      if (!fs.existsSync(absolutePath)) {
        console.error(`⚠️  File disappeared before adding to queue: ${absolutePath}`);
        continue; // Skip this file
      }
      
      // Check if this file is a duplicate (from batch check)
      const existingFile = existingHashesMap.get(fileInfo.hash);
      const isDuplicate = !!existingFile;
      const duplicateFileId = existingFile?.id || null;
      
      await invoiceImportQueue.add('invoice-import', {
        filePath: absolutePath, // Use absolute path
        fileName: fileInfo.fileName,
        originalName: fileInfo.originalName,
        importId: importId,
        userId: userId,
        source: 'manual-upload', // Mark as manual upload
        // Pre-calculated duplicate info to avoid re-checking in job
        fileHash: fileInfo.hash,
        isDuplicate: isDuplicate,
        duplicateFileId: duplicateFileId
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
      
      if (isDuplicate) {
        console.log(`📤 Added file to import queue (DUPLICATE): ${fileInfo.originalName} -> ${absolutePath} (matches ${duplicateFileId})`);
      } else {
        console.log(`📤 Added file to import queue: ${fileInfo.originalName} -> ${absolutePath}`);
      }
    }
    
    res.json({
      success: true,
      importId: importId,
      totalFiles: req.files.length,
      message: `Import started. Processing ${req.files.length} file(s)...`
    });
  } catch (error) {
    console.error('Error starting invoice import:', error);
    
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

// Update invoice (only for admins/managers/staff)
router.put('/:id', async (req, res) => {
  try {
    // Only admins, managers, and staff can update invoices
    if (req.user.role === 'external_user') {
      return res.status(403).json({ 
        message: 'Access denied. External users cannot update invoices.' 
      });
    }
    
    const invoice = await Invoice.findByPk(req.params.id);
    
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    
    // Check access to this invoice's company
    if (req.accessibleCompanyIds !== null && 
        !req.accessibleCompanyIds.includes(invoice.companyId)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have access to this invoice.' 
      });
    }
    
    const {
      invoiceNumber,
      companyId,
      issueDate,
      dueDate,
      amount,
      taxAmount,
      status,
      documentStatus,
      items,
      notes,
      fileUrl,
      metadata,
      editReason
    } = req.body;
    
    // Check if invoice number is being changed and if it already exists
    if (invoiceNumber && invoiceNumber !== invoice.invoiceNumber) {
      const existingInvoice = await Invoice.findOne({
        where: { invoiceNumber }
      });
      
      if (existingInvoice) {
        return res.status(400).json({ message: 'Invoice number already exists' });
      }
    }
    
    // Track changes for edit history
    const changes = {};
    const oldValues = {};
    
    // Update fields and track changes
    if (invoiceNumber !== undefined && invoiceNumber !== invoice.invoiceNumber) {
      oldValues.invoiceNumber = invoice.invoiceNumber;
      invoice.invoiceNumber = invoiceNumber;
      changes.invoiceNumber = { from: oldValues.invoiceNumber, to: invoiceNumber };
    }
    if (companyId !== undefined && companyId !== invoice.companyId) {
      oldValues.companyId = invoice.companyId;
      invoice.companyId = companyId;
      changes.companyId = { from: oldValues.companyId, to: companyId };
    }
    if (issueDate !== undefined) {
      const newDate = new Date(issueDate);
      const oldDate = invoice.issueDate ? new Date(invoice.issueDate) : null;
      if (!oldDate || newDate.getTime() !== oldDate.getTime()) {
        oldValues.issueDate = invoice.issueDate;
        invoice.issueDate = issueDate;
        changes.issueDate = { from: oldValues.issueDate, to: issueDate };
      }
    }
    if (dueDate !== undefined) {
      const newDate = dueDate ? new Date(dueDate) : null;
      const oldDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
      if ((!newDate && oldDate) || (newDate && !oldDate) || (newDate && oldDate && newDate.getTime() !== oldDate.getTime())) {
        oldValues.dueDate = invoice.dueDate;
        invoice.dueDate = dueDate;
        changes.dueDate = { from: oldValues.dueDate, to: dueDate };
      }
    }
    if (amount !== undefined && parseFloat(amount) !== parseFloat(invoice.amount || 0)) {
      oldValues.amount = invoice.amount;
      invoice.amount = amount;
      changes.amount = { from: oldValues.amount, to: amount };
    }
    if (taxAmount !== undefined && parseFloat(taxAmount) !== parseFloat(invoice.taxAmount || 0)) {
      oldValues.taxAmount = invoice.taxAmount;
      invoice.taxAmount = taxAmount;
      changes.taxAmount = { from: oldValues.taxAmount, to: taxAmount };
    }
    if (status !== undefined && status !== invoice.status) {
      oldValues.status = invoice.status;
      invoice.status = status;
      changes.status = { from: oldValues.status, to: status };
    }
    if (documentStatus !== undefined && documentStatus !== invoice.documentStatus) {
      // Check if user can change document status (Global Admins can always change it)
      const settings = await Settings.getSettings();
      const canChangeStatus = req.user.role === 'global_admin' || 
                             !settings.onlyExternalUsersChangeDocumentStatus || 
                             req.user.role === 'external_user';
      
      if (!canChangeStatus) {
        return res.status(403).json({ 
          message: 'Access denied. Only external users can change document status when this restriction is enabled.' 
        });
      }
      
      oldValues.documentStatus = invoice.documentStatus;
      invoice.documentStatus = documentStatus;
      changes.documentStatus = { from: oldValues.documentStatus, to: documentStatus };
    }
    if (items !== undefined) {
      invoice.items = items;
      changes.items = { updated: true };
    }
    if (notes !== undefined && notes !== (invoice.notes || '')) {
      oldValues.notes = invoice.notes;
      invoice.notes = notes;
      changes.notes = { from: oldValues.notes, to: notes };
    }
    if (fileUrl !== undefined) {
      invoice.fileUrl = fileUrl;
    }
    if (metadata !== undefined) {
      invoice.metadata = metadata;
    }
    
    // If there are changes, require edit reason and log them
    if (Object.keys(changes).length > 0) {
      if (!editReason || editReason.trim().length === 0) {
        return res.status(400).json({ 
          message: 'Edit reason is required when making changes to an invoice.' 
        });
      }
      
      // Update edit tracking fields
      invoice.editedBy = req.user.id;
      invoice.editReason = editReason.trim();
      
      // Add to edit history
      const editHistory = invoice.editHistory || [];
      editHistory.push({
        timestamp: new Date().toISOString(),
        editedBy: req.user.id,
        editedByName: req.user.name || req.user.email || 'Unknown',
        reason: editReason.trim(),
        changes: changes
      });
      invoice.editHistory = editHistory;
      
      // Log activity
      const { logActivity } = require('../services/activityLogger');
      await logActivity({
        type: 'invoice_edited',
        userId: req.user.id,
        userEmail: req.user.email || 'Unknown',
        userName: req.user.name || req.user.email || 'Unknown',
        userRole: req.user.role,
        action: 'Edited invoice',
        details: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          changes: changes,
          reason: editReason.trim()
        },
        companyId: invoice.companyId
      });
    }
    
    await invoice.save();
    
    // Reload with company
    await invoice.reload({
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'referenceNo', 'type']
      }]
    });
    
    res.json(invoice);
  } catch (error) {
    console.error('Error updating invoice:', error);
    res.status(400).json({ message: error.message });
  }
});

// Delete invoice (only for global_admin and administrator)
router.delete('/:id', async (req, res) => {
  try {
    // Only global_admin and administrator can delete invoices
    if (!['global_admin', 'administrator'].includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Access denied. Only Global Administrators and Administrators can delete invoices.' 
      });
    }
    
    const { reason } = req.body;
    
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ 
        message: 'Deletion reason is required for accountability.' 
      });
    }
    
    const invoice = await Invoice.findByPk(req.params.id);
    
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    
    // Check access to this invoice's company
    if (req.accessibleCompanyIds !== null && 
        !req.accessibleCompanyIds.includes(invoice.companyId)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have access to this invoice.' 
      });
    }
    
    // Track deletion (soft delete with tracking)
    invoice.deletedBy = req.user.userId;
    invoice.deletedReason = reason.trim();
    invoice.deletedAt = new Date();
    await invoice.save();
    
    // Delete the physical file if it exists
    if (invoice.fileUrl) {
      const filePath = path.isAbsolute(invoice.fileUrl) 
        ? invoice.fileUrl 
        : path.join(__dirname, '..', invoice.fileUrl);
      
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          console.log(`🗑️  Deleted invoice file: ${filePath}`);
        } catch (fileError) {
          console.error(`⚠️  Failed to delete invoice file: ${fileError.message}`);
          // Continue even if file deletion fails
        }
      }
    }
    
    // Hard delete from database
    await invoice.destroy({ force: true });
    
    // Log deletion
    await logActivity({
      type: ActivityType.INVOICE_DELETED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Deleted invoice ${invoice.invoiceNumber || invoice.id}`,
      details: { 
        invoiceId: invoice.id, 
        invoiceNumber: invoice.invoiceNumber,
        reason: reason.trim()
      },
      companyId: invoice.companyId,
      companyName: invoice.company?.name || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    console.log(`🗑️  Invoice ${invoice.invoiceNumber} deleted by ${req.user.email} (${req.user.userId}). Reason: ${reason}`);
    
    res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    console.error('Error deleting invoice:', error);
    res.status(500).json({ message: error.message });
  }
});

// Mark invoice as viewed
router.post('/:id/view', async (req, res) => {
  try {
    const invoice = await Invoice.findByPk(req.params.id, {
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'referenceNo'],
        required: false
      }]
    });
    
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    
    // Check access to this invoice's company
    if (req.accessibleCompanyIds !== null && 
        !req.accessibleCompanyIds.includes(invoice.companyId)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have access to this invoice.' 
      });
    }
    
    // Only update status if setting allows all users OR user is external_user OR user is global_admin
    const settings = await Settings.getSettings();
    const canUpdateStatus = !settings.onlyExternalUsersChangeDocumentStatus || req.user.role === 'external_user' || req.user.role === 'global_admin';
    
    // Track if this is the first view (needed for logging)
    const wasFirstView = !invoice.viewedAt;
    
    if (canUpdateStatus) {
      // Always update status when viewed (unless already downloaded)
      const now = new Date();
      
      if (!invoice.viewedAt) {
        invoice.viewedAt = now;
      }
      
      // Update documentStatus to 'viewed' if not already 'downloaded'
      if (invoice.documentStatus !== 'downloaded') {
        invoice.documentStatus = 'viewed';
      }
      
      // Store who viewed in metadata
      const metadata = invoice.metadata || {};
      if (!metadata.viewedBy) {
        metadata.viewedBy = req.user.userId;
        metadata.viewedByEmail = req.user.email;
        metadata.viewedByName = req.user.name || req.user.email;
      }
      invoice.metadata = metadata;
      
      await invoice.save();
    }
    
    // Always log invoice view
    await logActivity({
      type: ActivityType.INVOICE_VIEWED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Viewed invoice ${invoice.invoiceNumber || invoice.id}${wasFirstView ? '' : ' (subsequent view)'}`,
      details: { 
        invoiceId: invoice.id, 
        invoiceNumber: invoice.invoiceNumber,
        documentStatus: invoice.documentStatus,
        isFirstView: wasFirstView
      },
      companyId: invoice.companyId,
      companyName: invoice.company?.name || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json({ message: 'Invoice marked as viewed', viewedAt: invoice.viewedAt });
  } catch (error) {
    console.error('Error marking invoice as viewed:', error);
    res.status(500).json({ message: error.message });
  }
});

// View invoice PDF (view only, no download)
router.get('/:id/view-pdf', async (req, res) => {
  try {
    const invoice = await Invoice.findByPk(req.params.id, {
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name']
      }]
    });
    
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    
    // Check access to this invoice's company
    if (req.accessibleCompanyIds !== null && 
        !req.accessibleCompanyIds.includes(invoice.companyId)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have access to this invoice.' 
      });
    }
    
    if (!invoice.fileUrl) {
      return res.status(404).json({ message: 'No document file available for this invoice' });
    }
    
    // Handle both absolute and relative paths
    let filePath;
    if (path.isAbsolute(invoice.fileUrl)) {
      filePath = invoice.fileUrl;
    } else {
      filePath = path.join(__dirname, '..', invoice.fileUrl);
      if (!fs.existsSync(filePath)) {
        filePath = invoice.fileUrl;
      }
    }
    
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath} (original: ${invoice.fileUrl})`);
      return res.status(404).json({ message: 'Document file not found on server' });
    }
    
    // Only update status if setting allows all users OR user is external_user OR user is global_admin
    const settings = await Settings.getSettings();
    const canUpdateStatus = !settings.onlyExternalUsersChangeDocumentStatus || req.user.role === 'external_user' || req.user.role === 'global_admin';
    
    // Mark as viewed if not already
    const wasViewed = !!invoice.viewedAt;
    if (canUpdateStatus && !invoice.viewedAt) {
      invoice.viewedAt = new Date();
      // Update documentStatus to 'viewed' if it's currently 'ready' or 'review'
      if (invoice.documentStatus === 'ready' || invoice.documentStatus === 'review') {
        invoice.documentStatus = 'viewed';
      }
      await invoice.save();
    }
    
    // Log view (log ALL views, not just the first one)
    await logActivity({
      type: ActivityType.INVOICE_VIEWED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Viewed invoice PDF ${invoice.invoiceNumber || invoice.id}${wasViewed ? ' (subsequent view)' : ''}`,
      details: { 
        invoiceId: invoice.id, 
        invoiceNumber: invoice.invoiceNumber,
        documentStatus: invoice.documentStatus,
        isFirstView: !wasViewed,
        viewMethod: 'pdf_preview'
      },
      companyId: invoice.companyId,
      companyName: invoice.company?.name || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    // Serve PDF with inline content-disposition (view only, no download)
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error viewing invoice PDF:', error);
    res.status(500).json({ message: error.message });
  }
});

// Download single invoice document
router.get('/:id/download', async (req, res) => {
  try {
    const invoice = await Invoice.findByPk(req.params.id, {
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name']
      }]
    });
    
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    
    // Check access to this invoice's company
    if (req.accessibleCompanyIds !== null && 
        !req.accessibleCompanyIds.includes(invoice.companyId)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have access to this invoice.' 
      });
    }
    
    if (!invoice.fileUrl) {
      return res.status(404).json({ message: 'No document file available for this invoice' });
    }
    
    const filePath = path.isAbsolute(invoice.fileUrl) 
      ? invoice.fileUrl 
      : path.join(__dirname, '..', invoice.fileUrl);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Document file not found on server' });
    }
    
    // Always update status when downloaded
    // Only update status if setting allows all users OR user is external_user OR user is global_admin
    const settings = await Settings.getSettings();
    const canUpdateStatus = !settings.onlyExternalUsersChangeDocumentStatus || req.user.role === 'external_user' || req.user.role === 'global_admin';
    
    const wasFirstDownload = !invoice.downloadedAt;
    const now = new Date();
    
    if (canUpdateStatus) {
      if (!invoice.downloadedAt) {
        invoice.downloadedAt = now;
      }
      
      // Always set status to 'downloaded' when downloaded
      invoice.documentStatus = 'downloaded';
      
      // Mark as viewed if not already
      if (!invoice.viewedAt) {
        invoice.viewedAt = now;
      }
      
      // Store who downloaded in metadata
      const metadata = invoice.metadata || {};
      if (!metadata.downloadedBy) {
        metadata.downloadedBy = req.user.userId;
        metadata.downloadedByEmail = req.user.email;
        metadata.downloadedByName = req.user.name || req.user.email;
      }
      invoice.metadata = metadata;
      
      await invoice.save();
    }
    
    // Always log download
    await logActivity({
      type: ActivityType.INVOICE_DOWNLOADED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Downloaded invoice ${invoice.invoiceNumber || invoice.id}${wasFirstDownload ? '' : ' (subsequent download)'}`,
      details: { 
        invoiceId: invoice.id, 
        invoiceNumber: invoice.invoiceNumber,
        documentStatus: invoice.documentStatus,
        isFirstDownload: wasFirstDownload
      },
      companyId: invoice.companyId,
      companyName: invoice.company?.name || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    const fileName = path.basename(filePath);
    res.download(filePath, fileName, (err) => {
      if (err) {
        console.error('Error downloading file:', err);
        if (!res.headersSent) {
          res.status(500).json({ message: 'Error downloading file' });
        }
      }
    });
  } catch (error) {
    console.error('Error downloading invoice:', error);
    res.status(500).json({ message: error.message });
  }
});

// Bulk download invoices
router.post('/bulk-download', async (req, res) => {
  try {
    const { invoiceIds } = req.body;
    
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({ message: 'No invoice IDs provided' });
    }
    
    if (invoiceIds.length > 100) {
      return res.status(400).json({ message: 'Maximum 100 invoices can be downloaded at once' });
    }
    
    const invoices = await Invoice.findAll({
      where: {
        id: { [Op.in]: invoiceIds },
        ...buildCompanyFilter(req.accessibleCompanyIds)
      },
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name'],
        required: false // LEFT JOIN - show invoices even if company is missing
      }]
    });
    
    if (invoices.length === 0) {
      return res.status(404).json({ message: 'No accessible invoices found' });
    }
    
    // Filter invoices that have files
    const invoicesWithFiles = invoices.filter(inv => inv.fileUrl && fs.existsSync(
      path.isAbsolute(inv.fileUrl) ? inv.fileUrl : path.join(__dirname, '..', inv.fileUrl)
    ));
    
    if (invoicesWithFiles.length === 0) {
      return res.status(404).json({ message: 'No documents available for download' });
    }
    
    // Only update status if setting allows all users OR user is external_user OR user is global_admin
    const settings = await Settings.getSettings();
    const canUpdateStatus = !settings.onlyExternalUsersChangeDocumentStatus || req.user.role === 'external_user' || req.user.role === 'global_admin';
    
    // Update download timestamps and log activity
    const now = new Date();
    for (const invoice of invoicesWithFiles) {
      const wasFirstDownload = !invoice.downloadedAt;
      
      if (canUpdateStatus) {
        if (!invoice.downloadedAt) {
          invoice.downloadedAt = now;
        }
        
        // Always set status to 'downloaded' when downloaded
        invoice.documentStatus = 'downloaded';
        
        if (!invoice.viewedAt) {
          invoice.viewedAt = now;
        }
        
        // Store who downloaded in metadata
        const metadata = invoice.metadata || {};
        if (!metadata.downloadedBy) {
          metadata.downloadedBy = req.user.userId;
          metadata.downloadedByEmail = req.user.email;
          metadata.downloadedByName = req.user.name || req.user.email;
        }
        invoice.metadata = metadata;
        
        await invoice.save();
      }
      
      // Log each download (log ALL downloads, not just the first one)
      await logActivity({
        type: ActivityType.INVOICE_DOWNLOADED,
        userId: req.user.userId,
        userEmail: req.user.email,
        userRole: req.user.role,
        action: `Bulk downloaded invoice ${invoice.invoiceNumber || invoice.id}${wasFirstDownload ? '' : ' (subsequent download)'}`,
        details: { 
          invoiceId: invoice.id, 
          invoiceNumber: invoice.invoiceNumber,
          documentStatus: invoice.documentStatus,
          isFirstDownload: wasFirstDownload,
          bulkDownload: true,
          totalInvoices: invoicesWithFiles.length
        },
        companyId: invoice.companyId,
        companyName: invoice.company?.name || null,
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent')
      });
    }
    
    // If only one file, download directly
    if (invoicesWithFiles.length === 1) {
      const invoice = invoicesWithFiles[0];
      const filePath = path.isAbsolute(invoice.fileUrl) 
        ? invoice.fileUrl 
        : path.join(__dirname, '..', invoice.fileUrl);
      const fileName = path.basename(filePath);
      return res.download(filePath, fileName);
    }
    
    // Multiple files - create zip
    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    res.attachment(`invoices-${Date.now()}.zip`);
    archive.pipe(res);
    
    for (const invoice of invoicesWithFiles) {
      const filePath = path.isAbsolute(invoice.fileUrl) 
        ? invoice.fileUrl 
        : path.join(__dirname, '..', invoice.fileUrl);
      const fileName = `${invoice.invoiceNumber}_${path.basename(filePath)}`;
      archive.file(filePath, { name: fileName });
    }
    
    archive.finalize();
  } catch (error) {
    console.error('Error in bulk download:', error);
    res.status(500).json({ message: error.message });
  }
});

// Bulk delete invoices (only for global_admin and administrator)
router.post('/bulk-delete', async (req, res) => {
  try {
    // Only global_admin and administrator can delete invoices
    if (!['global_admin', 'administrator'].includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Access denied. Only Global Administrators and Administrators can delete invoices.' 
      });
    }
    
    const { invoiceIds, reason } = req.body;
    
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({ message: 'No invoice IDs provided' });
    }
    
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ 
        message: 'Deletion reason is required for accountability.' 
      });
    }
    
    if (invoiceIds.length > 100) {
      return res.status(400).json({ message: 'Maximum 100 invoices can be deleted at once' });
    }
    
    const invoices = await Invoice.findAll({
      where: {
        id: { [Op.in]: invoiceIds },
        ...buildCompanyFilter(req.accessibleCompanyIds)
      },
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name']
      }]
    });
    
    if (invoices.length === 0) {
      return res.status(404).json({ message: 'No accessible invoices found' });
    }
    
    const deletionReason = reason.trim();
    const deletedBy = req.user.userId;
    const deletedAt = new Date();
    const deletedInvoices = [];
    const failedInvoices = [];
    
    // Process each invoice
    for (const invoice of invoices) {
      try {
        // Track deletion (soft delete with tracking)
        invoice.deletedBy = deletedBy;
        invoice.deletedReason = deletionReason;
        invoice.deletedAt = deletedAt;
        await invoice.save();
        
        // Delete the physical file if it exists
        if (invoice.fileUrl) {
          const filePath = path.isAbsolute(invoice.fileUrl) 
            ? invoice.fileUrl 
            : path.join(__dirname, '..', invoice.fileUrl);
          
          if (fs.existsSync(filePath)) {
            try {
              fs.unlinkSync(filePath);
              console.log(`🗑️  Deleted invoice file: ${filePath}`);
            } catch (fileError) {
              console.error(`⚠️  Failed to delete invoice file: ${fileError.message}`);
              // Continue even if file deletion fails
            }
          }
        }
        
        // Hard delete from database
        await invoice.destroy({ force: true });
        
        // Log individual invoice deletion
        console.log(`🗑️  Invoice ${invoice.invoiceNumber} (ID: ${invoice.id}) deleted by ${req.user.email} (${deletedBy}). Reason: ${deletionReason}`);
        
        // Log each deletion
        await logActivity({
          type: ActivityType.INVOICE_DELETED,
          userId: req.user.userId,
          userEmail: req.user.email,
          userRole: req.user.role,
          action: `Bulk deleted invoice ${invoice.invoiceNumber || invoice.id}`,
          details: { 
            invoiceId: invoice.id, 
            invoiceNumber: invoice.invoiceNumber,
            reason: deletionReason,
            bulkDelete: true,
            totalDeleted: deletedInvoices.length + 1
          },
          companyId: invoice.companyId,
          companyName: invoice.company?.name || null,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent')
        });
        
        deletedInvoices.push({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          companyName: invoice.company?.name || 'Unknown'
        });
      } catch (error) {
        console.error(`❌ Error deleting invoice ${invoice.id}:`, error.message);
        failedInvoices.push({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          error: error.message
        });
      }
    }
    
    // Summary log
    console.log(`\n📊 Bulk Deletion Summary:`);
    console.log(`   ✅ Successfully deleted: ${deletedInvoices.length} invoice(s)`);
    console.log(`   ❌ Failed: ${failedInvoices.length} invoice(s)`);
    console.log(`   👤 Deleted by: ${req.user.email} (${deletedBy})`);
    console.log(`   📝 Reason: ${deletionReason}\n`);
    
    res.json({
      message: `Successfully deleted ${deletedInvoices.length} of ${invoices.length} invoice(s)`,
      deleted: deletedInvoices.length,
      failed: failedInvoices.length,
      deletedInvoices: deletedInvoices,
      failedInvoices: failedInvoices
    });
  } catch (error) {
    console.error('Error in bulk delete:', error);
    res.status(500).json({ message: error.message });
  }
});

// Test FTP/SFTP connection and list PDF files
router.post('/sftp/test-connection', async (req, res) => {
  try {
    // Only admins, managers, and staff can test FTP/SFTP
    if (req.user.role === 'external_user') {
      return res.status(403).json({ 
        message: 'Access denied. External users cannot test FTP/SFTP connections.' 
      });
    }

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
      action: `Tested ${connectionTypeUpper} connection - found ${pdfFiles.length} PDF file(s)`,
      details: { 
        connectionTest: true,
        connectionType: connectionType,
        fileCount: pdfFiles.length,
        totalFiles: allFiles.length
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

// Import files from FTP/SFTP
router.post('/sftp/import', async (req, res) => {
  try {
    // Only admins, managers, and staff can import from FTP/SFTP
    if (req.user.role === 'external_user') {
      return res.status(403).json({ 
        message: 'Access denied. External users cannot import from FTP/SFTP.' 
      });
    }

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
    console.log(`🔍 ${connectionTypeUpper} Import - Using settings:`, {
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
    console.log(`📥 Starting batch download of ${pdfFiles.length} file(s) from ${connectionTypeUpper}...`);
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
            
            // Add to import queue (BullMQ format: name, data, options)
            await invoiceImportQueue.add('invoice-import', {
              filePath: fileData.filePath,
              fileName: fileData.fileName,
              originalName: fileData.originalName,
              importId: importId,
              userId: userId,
              source: connectionType
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
            action: `Imported ${downloadedFiles.length} file(s) from ${connectionTypeUpper}`,
            details: { 
              importId: importId,
              fileCount: downloadedFiles.length,
              totalFiles: pdfFiles.length,
              files: downloadedFiles,
              uploadMethod: connectionType
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

