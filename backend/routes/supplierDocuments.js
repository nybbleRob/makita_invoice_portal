const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { SupplierDocument, Supplier, SupplierTemplate, SupplierFile, Settings, User } = require('../models');
const { Op } = require('sequelize');
const auth = require('../middleware/auth');
const { requireStaff, requireManager } = require('../middleware/permissions');
const { logActivity, ActivityType } = require('../services/activityLogger');
const { ensureStorageDirs, getStorageDir } = require('../config/storage');
const { supplierDocumentQueue } = require('../config/queue');
const router = express.Router();

// Middleware to check if suppliers module is enabled
const checkSuppliersEnabled = async (req, res, next) => {
  try {
    const settings = await Settings.getSettings();
    if (settings.suppliersEnabled === false) {
      return res.status(403).json({ message: 'Suppliers feature is currently disabled' });
    }
    next();
  } catch (error) {
    console.error('Error checking suppliers enabled:', error);
    next();
  }
};

// Apply auth and suppliers enabled check
router.use(auth);
router.use(requireStaff);
router.use(checkSuppliersEnabled);

// Configure multer for file uploads
ensureStorageDirs();
const tempDir = getStorageDir('temp');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, tempDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname) || '.pdf';
      cb(null, `supplier-import-${uniqueSuffix}${ext}`);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB per file
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

// Get all supplier documents (with filters)
router.get('/', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      supplierId,
      documentType,
      status,
      documentStatus,
      startDate,
      endDate,
      search,
      sortBy = 'documentDate',
      sortOrder = 'DESC'
    } = req.query;
    
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    
    const whereConditions = {
      deletedAt: null
    };
    
    if (supplierId) {
      whereConditions.supplierId = supplierId;
    }
    
    if (documentType) {
      whereConditions.documentType = documentType;
    }
    
    if (status) {
      whereConditions.status = status;
    }
    
    if (documentStatus) {
      whereConditions.documentStatus = documentStatus;
    }
    
    if (startDate || endDate) {
      whereConditions.documentDate = {};
      if (startDate) whereConditions.documentDate[Op.gte] = startDate;
      if (endDate) whereConditions.documentDate[Op.lte] = endDate;
    }
    
    // Search functionality
    if (search) {
      const searchTerm = `%${search}%`;
      whereConditions[Op.or] = [
        { invoiceNumber: { [Op.iLike]: searchTerm } },
        { poNumber: { [Op.iLike]: searchTerm } },
        { notes: { [Op.iLike]: searchTerm } }
      ];
    }
    
    const total = await SupplierDocument.count({ where: whereConditions });
    
    const documents = await SupplierDocument.findAll({
      where: whereConditions,
      limit: limitNum,
      offset,
      order: [[sortBy, sortOrder.toUpperCase()]],
      include: [
        {
          model: Supplier,
          as: 'supplier',
          attributes: ['id', 'name', 'code'],
          required: true
        },
        {
          model: SupplierTemplate,
          as: 'template',
          required: false,
          attributes: ['id', 'name', 'templateType', 'fileType']
        }
      ]
    });
    
    res.json({
      documents,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching supplier documents:', error);
    res.status(500).json({ message: 'Error fetching supplier documents', error: error.message });
  }
});

// Get single supplier document
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const document = await SupplierDocument.findByPk(id, {
      include: [
        {
          model: Supplier,
          as: 'supplier',
          required: true,
          attributes: ['id', 'name', 'code', 'email', 'phone', 'address']
        },
        {
          model: SupplierTemplate,
          as: 'template',
          required: false,
          attributes: ['id', 'name', 'templateType', 'fileType']
        },
        {
          model: User,
          as: 'parsedByUser',
          required: false,
          attributes: ['id', 'firstName', 'lastName', 'email']
        },
        {
          model: User,
          as: 'viewedByUser',
          required: false,
          attributes: ['id', 'firstName', 'lastName', 'email']
        },
        {
          model: User,
          as: 'queriedByUser',
          required: false,
          attributes: ['id', 'firstName', 'lastName', 'email']
        }
      ]
    });
    
    if (!document) {
      return res.status(404).json({ message: 'Supplier document not found' });
    }
    
    // Mark as viewed if not already viewed (staff viewing)
    if (!document.viewedAt && req.user.role !== 'global_admin' && req.user.role !== 'administrator') {
      await document.markAsViewed(req.user.id);
    }
    
    res.json(document);
  } catch (error) {
    console.error('Error fetching supplier document:', error);
    res.status(500).json({ message: 'Error fetching supplier document', error: error.message });
  }
});

// Manual document upload (triggers processing)
router.post('/', upload.single('file'), async (req, res) => {
  try {
    const { supplierId, templateId } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ message: 'File is required' });
    }
    
    if (!supplierId) {
      return res.status(400).json({ message: 'Supplier ID is required' });
    }
    
    // Verify supplier exists
    const supplier = await Supplier.findByPk(supplierId);
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    
    // Calculate file hash
    const fileBuffer = fs.readFileSync(req.file.path);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    
    // Check for duplicate
    const existingDocument = await SupplierDocument.findOne({
      where: {
        fileHash,
        deletedAt: null
      }
    });
    
    if (existingDocument) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ 
        message: 'Duplicate document detected. This file has already been processed.',
        existingDocumentId: existingDocument.id
      });
    }
    
    // Create supplier file record
    const supplierFile = await SupplierFile.create({
      fileName: req.file.filename,
      originalName: req.file.originalname,
      filePath: req.file.path,
      fileHash,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      supplierId,
      templateId: templateId || null,
      source: 'manual',
      status: 'uploaded'
    });
    
    // Queue for processing
    if (supplierDocumentQueue) {
      await supplierDocumentQueue.add('supplier-document-import', {
        filePath: req.file.path,
        fileName: req.file.filename,
        originalName: req.file.originalname,
        supplierId,
        templateId: templateId || null,
        fileHash,
        supplierFileId: supplierFile.id,
        userId: req.user.id,
        source: 'manual',
        priority: 1 // Manual uploads get higher priority
      }, {
        jobId: `supplier-import-${Date.now()}-${fileHash.substring(0, 8)}`,
        priority: 1,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        removeOnComplete: true,
        removeOnFail: false
      });
      
      // Update file status
      supplierFile.status = 'processing';
      await supplierFile.save();
    }
    
    res.status(201).json({
      message: 'Document uploaded and queued for processing',
      supplierFileId: supplierFile.id,
      fileHash
    });
  } catch (error) {
    console.error('Error uploading supplier document:', error);
    res.status(500).json({ message: 'Error uploading supplier document', error: error.message });
  }
});

// Update supplier document (edit extracted fields)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      invoiceNumber,
      poNumber,
      documentDate,
      dueDate,
      amount,
      taxAmount,
      vatAmount,
      extractedFields,
      items,
      notes,
      status,
      documentStatus
    } = req.body;
    
    const document = await SupplierDocument.findByPk(id);
    if (!document) {
      return res.status(404).json({ message: 'Supplier document not found' });
    }
    
    // Update fields
    if (invoiceNumber !== undefined) document.invoiceNumber = invoiceNumber;
    if (poNumber !== undefined) document.poNumber = poNumber;
    if (documentDate !== undefined) document.documentDate = documentDate;
    if (dueDate !== undefined) document.dueDate = dueDate;
    if (amount !== undefined) document.amount = parseFloat(amount) || 0;
    if (taxAmount !== undefined) document.taxAmount = parseFloat(taxAmount) || 0;
    if (vatAmount !== undefined) document.vatAmount = parseFloat(vatAmount) || 0;
    if (extractedFields !== undefined) document.extractedFields = extractedFields;
    if (items !== undefined) document.items = items;
    if (notes !== undefined) document.notes = notes;
    if (status !== undefined) document.status = status;
    if (documentStatus !== undefined) document.documentStatus = documentStatus;
    
    await document.save();
    
    // Log activity
    await logActivity({
      type: ActivityType.SUPPLIER_DOCUMENT_UPDATED,
      userId: req.user.id,
      description: `Updated supplier document: ${document.invoiceNumber || document.id}`,
      metadata: {
        documentId: document.id,
        supplierId: document.supplierId
      }
    });
    
    res.json(document);
  } catch (error) {
    console.error('Error updating supplier document:', error);
    res.status(500).json({ message: 'Error updating supplier document', error: error.message });
  }
});

// Delete supplier document (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const document = await SupplierDocument.findByPk(id);
    if (!document) {
      return res.status(404).json({ message: 'Supplier document not found' });
    }
    
    // Soft delete
    document.deletedAt = new Date();
    await document.save();
    
    // Log activity
    await logActivity({
      type: ActivityType.SUPPLIER_DOCUMENT_DELETED,
      userId: req.user.id,
      description: `Deleted supplier document: ${document.invoiceNumber || document.id}`,
      metadata: {
        documentId: document.id,
        supplierId: document.supplierId
      }
    });
    
    res.json({ message: 'Supplier document deleted successfully' });
  } catch (error) {
    console.error('Error deleting supplier document:', error);
    res.status(500).json({ message: 'Error deleting supplier document', error: error.message });
  }
});

// Download document file
router.get('/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    
    const document = await SupplierDocument.findByPk(id);
    if (!document) {
      return res.status(404).json({ message: 'Supplier document not found' });
    }
    
    if (!document.fileUrl || !fs.existsSync(document.fileUrl)) {
      return res.status(404).json({ message: 'Document file not found' });
    }
    
    const fileName = document.originalName || path.basename(document.fileUrl);
    res.download(document.fileUrl, fileName, (err) => {
      if (err) {
        console.error('Error downloading file:', err);
        if (!res.headersSent) {
          res.status(500).json({ message: 'Error downloading file' });
        }
      }
    });
  } catch (error) {
    console.error('Error downloading supplier document:', error);
    res.status(500).json({ message: 'Error downloading supplier document', error: error.message });
  }
});

// Re-parse document with different template
router.post('/:id/reparse', async (req, res) => {
  try {
    const { id } = req.params;
    const { templateId } = req.body;
    
    const document = await SupplierDocument.findByPk(id);
    if (!document) {
      return res.status(404).json({ message: 'Supplier document not found' });
    }
    
    if (!templateId) {
      return res.status(400).json({ message: 'Template ID is required' });
    }
    
    const template = await SupplierTemplate.findByPk(templateId);
    if (!template) {
      return res.status(404).json({ message: 'Supplier template not found' });
    }
    
    if (!document.fileUrl || !fs.existsSync(document.fileUrl)) {
      return res.status(404).json({ message: 'Document file not found' });
    }
    
    // Queue for re-parsing
    if (supplierDocumentQueue) {
      await supplierDocumentQueue.add('supplier-document-import', {
        filePath: document.fileUrl,
        fileName: path.basename(document.fileUrl),
        originalName: document.originalName,
        supplierId: document.supplierId,
        templateId,
        fileHash: document.fileHash,
        documentId: document.id, // Indicates this is a re-parse
        userId: req.user.id,
        source: 'reparse',
        priority: 1
      }, {
        jobId: `supplier-reparse-${Date.now()}-${document.id}`,
        priority: 1,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      });
      
      res.json({ message: 'Document queued for re-parsing' });
    } else {
      res.status(500).json({ message: 'Queue system not available' });
    }
  } catch (error) {
    console.error('Error queuing re-parse:', error);
    res.status(500).json({ message: 'Error queuing re-parse', error: error.message });
  }
});

// Add query/comment to document
router.post('/:id/query', async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    
    if (!message || !message.trim()) {
      return res.status(400).json({ message: 'Query message is required' });
    }
    
    const document = await SupplierDocument.findByPk(id);
    if (!document) {
      return res.status(404).json({ message: 'Supplier document not found' });
    }
    
    // Mark as queried
    await document.markAsQueried(req.user.id);
    
    // Store query in metadata (or use DocumentQuery if queries module is enabled)
    if (!document.metadata) {
      document.metadata = {};
    }
    if (!document.metadata.queries) {
      document.metadata.queries = [];
    }
    
    document.metadata.queries.push({
      userId: req.user.id,
      userName: `${req.user.firstName} ${req.user.lastName}`,
      message: message.trim(),
      createdAt: new Date().toISOString()
    });
    
    await document.save();
    
    // Log activity
    await logActivity({
      type: ActivityType.SUPPLIER_DOCUMENT_QUERIED,
      userId: req.user.id,
      description: `Added query to supplier document: ${document.invoiceNumber || document.id}`,
      metadata: {
        documentId: document.id,
        supplierId: document.supplierId,
        query: message.trim()
      }
    });
    
    res.json(document);
  } catch (error) {
    console.error('Error adding query:', error);
    res.status(500).json({ message: 'Error adding query', error: error.message });
  }
});

// Get queries for document
router.get('/:id/queries', async (req, res) => {
  try {
    const { id } = req.params;
    
    const document = await SupplierDocument.findByPk(id);
    if (!document) {
      return res.status(404).json({ message: 'Supplier document not found' });
    }
    
    const queries = document.metadata?.queries || [];
    res.json(queries);
  } catch (error) {
    console.error('Error fetching queries:', error);
    res.status(500).json({ message: 'Error fetching queries', error: error.message });
  }
});

module.exports = router;
