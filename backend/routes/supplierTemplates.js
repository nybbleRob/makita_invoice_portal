const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { SupplierTemplateSupplier: SupplierTemplate, Supplier, Settings } = require('../models');
const { Op } = require('sequelize');
const auth = require('../middleware/auth');
const globalAdmin = require('../middleware/globalAdmin');
const { logActivity, ActivityType } = require('../services/activityLogger');
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
router.use(checkSuppliersEnabled);

// Configure multer for file uploads
const { ensureStorageDirs, getStorageDir } = require('../config/storage');
ensureStorageDirs();
const templatesDir = getStorageDir('templates');

const upload = multer({
  dest: templatesDir,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.xlsx', '.xls', '.csv', '.pdf'];
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel, CSV, and PDF files (.xlsx, .xls, .csv, .pdf) are allowed!'), false);
    }
  }
});

// Get all supplier templates (filterable by supplier, type)
router.get('/', globalAdmin, async (req, res) => {
  try {
    const { supplierId, templateType, fileType } = req.query;
    
    const whereConditions = {
      deletedAt: null
    };
    
    if (supplierId) {
      whereConditions.supplierId = supplierId;
    }
    
    if (templateType) {
      whereConditions.templateType = templateType;
    }
    
    if (fileType) {
      whereConditions.fileType = fileType;
    }
    
    const templates = await SupplierTemplate.findAll({
      where: whereConditions,
      include: [
        {
          model: Supplier,
          as: 'supplier',
          attributes: ['id', 'name', 'code'],
          required: false
        }
      ],
      order: [['supplierId', 'ASC'], ['templateType', 'ASC'], ['isDefault', 'DESC'], ['priority', 'DESC']]
    });
    
    res.json(templates);
  } catch (error) {
    console.error('Error fetching supplier templates:', error);
    res.status(500).json({ message: 'Error fetching supplier templates', error: error.message });
  }
});

// Get single supplier template
router.get('/:id', globalAdmin, async (req, res) => {
  try {
    const template = await SupplierTemplate.findByPk(req.params.id, {
      include: [
        {
          model: Supplier,
          as: 'supplier',
          attributes: ['id', 'name', 'code'],
          required: false
        }
      ]
    });
    
    if (!template) {
      return res.status(404).json({ message: 'Supplier template not found' });
    }
    
    res.json(template);
  } catch (error) {
    console.error('Error fetching supplier template:', error);
    res.status(500).json({ message: 'Error fetching supplier template', error: error.message });
  }
});

// Create new supplier template
router.post('/', globalAdmin, upload.single('sampleFile'), async (req, res) => {
  try {
    const { 
      supplierId, 
      name, 
      templateType, 
      fileType, 
      excelCells, 
      coordinates,
      patterns, 
      transformations,
      customFields,
      mandatoryFields,
      priority = 0,
      isDefault = false,
      enabled = true
    } = req.body;
    
    if (!supplierId || !name || !templateType || !fileType) {
      return res.status(400).json({ 
        message: 'Supplier ID, name, template type, and file type are required' 
      });
    }
    
    if (!['invoice', 'credit_note', 'statement'].includes(templateType)) {
      return res.status(400).json({ 
        message: 'Template type must be: invoice, credit_note, or statement' 
      });
    }
    
    if (!['pdf', 'excel'].includes(fileType)) {
      return res.status(400).json({ 
        message: 'File type must be: pdf or excel' 
      });
    }
    
    // Verify supplier exists
    const supplier = await Supplier.findByPk(supplierId);
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    
    // Generate code from name (lowercase, spaces to underscores)
    const code = name.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    
    // Check if template with same supplier/code/type/fileType already exists
    const existingTemplate = await SupplierTemplate.findOne({
      where: {
        supplierId,
        code,
        templateType,
        fileType,
        deletedAt: null
      }
    });
    
    if (existingTemplate) {
      return res.status(400).json({ 
        message: 'A template with this name already exists for this supplier, type, and file type' 
      });
    }
    
    // Parse JSON fields
    let excelCellsObj = {};
    let coordinatesObj = {};
    let patternsObj = {};
    let transformationsObj = {};
    let customFieldsArr = [];
    let mandatoryFieldsArr = [];
    
    if (excelCells && fileType === 'excel') {
      try {
        excelCellsObj = typeof excelCells === 'string' ? JSON.parse(excelCells) : excelCells;
      } catch (e) {
        return res.status(400).json({ message: 'Invalid excelCells JSON: ' + e.message });
      }
    }
    
    if (coordinates && fileType === 'pdf') {
      try {
        coordinatesObj = typeof coordinates === 'string' ? JSON.parse(coordinates) : coordinates;
      } catch (e) {
        return res.status(400).json({ message: 'Invalid coordinates JSON: ' + e.message });
      }
    }
    
    if (patterns) {
      try {
        patternsObj = typeof patterns === 'string' ? JSON.parse(patterns) : patterns;
      } catch (e) {
        console.warn('Error parsing patterns:', e);
      }
    }
    
    if (transformations) {
      try {
        transformationsObj = typeof transformations === 'string' ? JSON.parse(transformations) : transformations;
      } catch (e) {
        console.warn('Error parsing transformations:', e);
      }
    }
    
    if (customFields) {
      try {
        customFieldsArr = Array.isArray(customFields) ? customFields : JSON.parse(customFields);
      } catch (e) {
        console.warn('Error parsing customFields:', e);
      }
    }
    
    if (mandatoryFields) {
      try {
        mandatoryFieldsArr = Array.isArray(mandatoryFields) ? mandatoryFields : JSON.parse(mandatoryFields);
      } catch (e) {
        console.warn('Error parsing mandatoryFields:', e);
      }
    }
    
    // Handle sample file
    let sampleFileUrl = null;
    if (req.file) {
      const fileName = `supplier-template-${Date.now()}-${req.file.originalname}`;
      const finalPath = path.join(templatesDir, fileName);
      fs.renameSync(req.file.path, finalPath);
      sampleFileUrl = path.relative(path.join(__dirname, '..'), finalPath);
    }
    
    // Handle isDefault - unset other defaults for same supplier/type/fileType
    if (isDefault === true || isDefault === 'true') {
      await SupplierTemplate.update(
        { isDefault: false },
        {
          where: {
            supplierId,
            templateType,
            fileType,
            deletedAt: null
          }
        }
      );
    }
    
    // Create template
    const template = await SupplierTemplate.create({
      supplierId,
      name: name.trim(),
      code,
      templateType,
      fileType,
      isDefault: isDefault === true || isDefault === 'true',
      enabled: enabled === true || enabled !== 'false',
      priority: parseInt(priority) || 0,
      coordinates: coordinatesObj,
      patterns: patternsObj,
      transformations: transformationsObj,
      customFields: customFieldsArr,
      mandatoryFields: mandatoryFieldsArr,
      sampleFileUrl
    });
    
    // Log activity
    await logActivity({
      type: ActivityType.SUPPLIER_TEMPLATE_CREATED,
      userId: req.user.id,
      description: `Created supplier template: ${name} for ${supplier.name}`,
      metadata: {
        templateId: template.id,
        supplierId: supplier.id,
        templateName: name
      }
    });
    
    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating supplier template:', error);
    res.status(500).json({ message: 'Error creating supplier template', error: error.message });
  }
});

// Update supplier template
router.put('/:id', globalAdmin, upload.single('sampleFile'), async (req, res) => {
  try {
    const { id } = req.params;
    const template = await SupplierTemplate.findByPk(id);
    
    if (!template) {
      return res.status(404).json({ message: 'Supplier template not found' });
    }
    
    const {
      name,
      excelCells,
      coordinates,
      patterns,
      transformations,
      customFields,
      mandatoryFields,
      priority,
      isDefault,
      enabled
    } = req.body;
    
    // Update fields
    if (name !== undefined) {
      const code = name.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      template.name = name.trim();
      template.code = code;
    }
    
    if (excelCells && template.fileType === 'excel') {
      try {
        const excelCellsObj = typeof excelCells === 'string' ? JSON.parse(excelCells) : excelCells;
        template.coordinates = excelCellsObj;
      } catch (e) {
        return res.status(400).json({ message: 'Invalid excelCells JSON: ' + e.message });
      }
    }
    
    if (coordinates && template.fileType === 'pdf') {
      try {
        const coordinatesObj = typeof coordinates === 'string' ? JSON.parse(coordinates) : coordinates;
        template.coordinates = coordinatesObj;
      } catch (e) {
        return res.status(400).json({ message: 'Invalid coordinates JSON: ' + e.message });
      }
    }
    
    if (patterns !== undefined) {
      try {
        template.patterns = typeof patterns === 'string' ? JSON.parse(patterns) : patterns;
      } catch (e) {
        console.warn('Error parsing patterns:', e);
      }
    }
    
    if (transformations !== undefined) {
      try {
        template.transformations = typeof transformations === 'string' ? JSON.parse(transformations) : transformations;
      } catch (e) {
        console.warn('Error parsing transformations:', e);
      }
    }
    
    if (customFields !== undefined) {
      try {
        template.customFields = Array.isArray(customFields) ? customFields : JSON.parse(customFields);
      } catch (e) {
        console.warn('Error parsing customFields:', e);
      }
    }
    
    if (mandatoryFields !== undefined) {
      try {
        template.mandatoryFields = Array.isArray(mandatoryFields) ? mandatoryFields : JSON.parse(mandatoryFields);
      } catch (e) {
        console.warn('Error parsing mandatoryFields:', e);
      }
    }
    
    if (priority !== undefined) {
      template.priority = parseInt(priority) || 0;
    }
    
    if (enabled !== undefined) {
      template.enabled = enabled === true || enabled === 'true';
    }
    
    // Handle isDefault
    if (isDefault !== undefined) {
      const shouldBeDefault = isDefault === true || isDefault === 'true';
      if (shouldBeDefault && !template.isDefault) {
        await template.setAsDefault();
      } else if (!shouldBeDefault) {
        template.isDefault = false;
      }
    }
    
    // Handle sample file upload
    if (req.file) {
      // Delete old file if exists
      if (template.sampleFileUrl) {
        const oldPath = path.join(__dirname, '..', template.sampleFileUrl);
        if (fs.existsSync(oldPath)) {
          try {
            fs.unlinkSync(oldPath);
          } catch (e) {
            console.warn('Error deleting old sample file:', e);
          }
        }
      }
      
      const fileName = `supplier-template-${Date.now()}-${req.file.originalname}`;
      const finalPath = path.join(templatesDir, fileName);
      fs.renameSync(req.file.path, finalPath);
      template.sampleFileUrl = path.relative(path.join(__dirname, '..'), finalPath);
    }
    
    await template.save();
    
    // Log activity
    await logActivity({
      type: ActivityType.SUPPLIER_TEMPLATE_UPDATED,
      userId: req.user.id,
      description: `Updated supplier template: ${template.name}`,
      metadata: {
        templateId: template.id,
        supplierId: template.supplierId
      }
    });
    
    res.json(template);
  } catch (error) {
    console.error('Error updating supplier template:', error);
    res.status(500).json({ message: 'Error updating supplier template', error: error.message });
  }
});

// Delete supplier template
router.delete('/:id', globalAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const template = await SupplierTemplate.findByPk(id);
    
    if (!template) {
      return res.status(404).json({ message: 'Supplier template not found' });
    }
    
    // Check if template is in use
    const { SupplierDocument } = require('../models');
    const documentCount = await SupplierDocument.count({
      where: { templateId: id, deletedAt: null }
    });
    
    if (documentCount > 0) {
      return res.status(400).json({ 
        message: `Cannot delete template with ${documentCount} associated document(s). Please delete or reassign documents first.` 
      });
    }
    
    // Delete sample file if exists
    if (template.sampleFileUrl) {
      const filePath = path.join(__dirname, '..', template.sampleFileUrl);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.warn('Error deleting sample file:', e);
        }
      }
    }
    
    // Soft delete
    template.deletedAt = new Date();
    await template.save();
    
    // Log activity
    await logActivity({
      type: ActivityType.SUPPLIER_TEMPLATE_DELETED,
      userId: req.user.id,
      description: `Deleted supplier template: ${template.name}`,
      metadata: {
        templateId: template.id,
        supplierId: template.supplierId
      }
    });
    
    res.json({ message: 'Supplier template deleted successfully' });
  } catch (error) {
    console.error('Error deleting supplier template:', error);
    res.status(500).json({ message: 'Error deleting supplier template', error: error.message });
  }
});

// Set template as default
router.post('/:id/set-default', globalAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const template = await SupplierTemplate.findByPk(id);
    
    if (!template) {
      return res.status(404).json({ message: 'Supplier template not found' });
    }
    
    await template.setAsDefault();
    
    // Log activity
    await logActivity({
      type: ActivityType.SUPPLIER_TEMPLATE_UPDATED,
      userId: req.user.id,
      description: `Set supplier template as default: ${template.name}`,
      metadata: {
        templateId: template.id,
        supplierId: template.supplierId
      }
    });
    
    res.json(template);
  } catch (error) {
    console.error('Error setting default template:', error);
    res.status(500).json({ message: 'Error setting default template', error: error.message });
  }
});

module.exports = router;
