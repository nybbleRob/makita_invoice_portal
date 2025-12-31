/**
 * Excel Template Management Routes
 * CRUD operations for Excel templates only
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Template, Settings } = require('../models');
const globalAdmin = require('../middleware/globalAdmin');
const { logActivity, ActivityType } = require('../services/activityLogger');
const router = express.Router();

// Storage configuration - must be initialized before multer
const { ensureStorageDirs, getStorageDir } = require('../config/storage');
ensureStorageDirs();
const templatesDir = getStorageDir('templates');

// Configure multer for Excel and PDF uploads
const upload = multer({
  dest: templatesDir,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv', // .csv
      'application/excel',
      'application/pdf' // PDF files
    ];
    const allowedExts = ['.xlsx', '.xls', '.csv', '.pdf'];
    
    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel, CSV, and PDF files (.xlsx, .xls, .csv, .pdf) are allowed!'), false);
    }
  }
});

/**
 * Get custom fields that should be shown in tables (public endpoint)
 * GET /api/templates/table-fields
 */
router.get('/table-fields', async (req, res) => {
  try {
    const { type } = req.query; // Optional filter by template type (invoice, credit_note)
    
    const where = { enabled: true };
    if (type) {
      where.templateType = type;
    }
    
    const templates = await Template.findAll({
      where,
      attributes: ['id', 'templateType', 'customFields'],
      order: [['isDefault', 'DESC'], ['priority', 'DESC']]
    });
    
    // Extract custom fields with showInTable: true
    const tableFields = new Map();
    
    templates.forEach(template => {
      if (template.customFields && typeof template.customFields === 'object') {
        Object.entries(template.customFields).forEach(([fieldName, config]) => {
          if (config.showInTable === true) {
            if (!tableFields.has(fieldName)) {
              tableFields.set(fieldName, {
                fieldName: fieldName,
                displayName: config.displayName || fieldName,
                dataType: config.dataType || 'text'
              });
            }
          }
        });
      }
    });
    
    res.json(Array.from(tableFields.values()));
  } catch (error) {
    console.error('Error fetching table custom fields:', error);
    res.status(500).json({ message: 'Error fetching table custom fields: ' + error.message });
  }
});

/**
 * Get all Excel templates
 * GET /api/templates
 */
router.get('/', globalAdmin, async (req, res) => {
  try {
    const { type, fileType } = req.query; // Optional filter by type and fileType
    
    const where = { enabled: true };
    if (fileType) {
      where.fileType = fileType; // Filter by fileType (excel, pdf)
    } else {
      // Default to excel for backward compatibility, but allow all types
      where.fileType = ['excel', 'pdf'];
    }
    if (type) {
      where.templateType = type;
    }
    
    const templates = await Template.findAll({
      where,
      order: [['isDefault', 'DESC'], ['priority', 'DESC'], ['name', 'ASC']]
    });
    
    res.json(templates);
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ message: 'Error fetching templates: ' + error.message });
  }
});

/**
 * Get stored Excel file for template
 * GET /api/templates/:id/excel
 */
router.get('/:id/excel', globalAdmin, async (req, res) => {
  try {
    const template = await Template.findByPk(req.params.id);
    
    if (!template) {
      return res.status(404).json({ message: 'Template not found' });
    }
    
    if (!template.sampleExcelPath) {
      return res.status(404).json({ message: 'No Excel file stored for this template' });
    }
    
    const excelPath = path.join(__dirname, '..', template.sampleExcelPath);
    
    if (!fs.existsSync(excelPath)) {
      return res.status(404).json({ message: 'Excel file not found on server' });
    }
    
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(excelPath);
    const sheetNames = workbook.SheetNames;
    const lastSheetName = sheetNames[sheetNames.length - 1];
    const worksheet = workbook.Sheets[lastSheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    
    res.json({
      success: true,
      data: jsonData,
      sheetName: lastSheetName,
      totalSheets: sheetNames.length
    });
  } catch (error) {
    console.error('Error serving template Excel:', error);
    res.status(500).json({ message: 'Error serving template Excel: ' + error.message });
  }
});

/**
 * Get stored PDF file for template (returns base64 data URL)
 * GET /api/templates/:id/pdf
 */
router.get('/:id/pdf', globalAdmin, async (req, res) => {
  try {
    const template = await Template.findByPk(req.params.id);
    
    if (!template) {
      return res.status(404).json({ message: 'Template not found' });
    }
    
    if (!template.samplePdfPath) {
      return res.status(404).json({ message: 'No PDF file stored for this template' });
    }
    
    const pdfPath = path.join(__dirname, '..', template.samplePdfPath);
    
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ message: 'PDF file not found on server' });
    }
    
    const pdfBuffer = fs.readFileSync(pdfPath);
    const base64Data = pdfBuffer.toString('base64');
    const dataUrl = `data:application/pdf;base64,${base64Data}`;
    
    res.json({
      success: true,
      pdfData: dataUrl
    });
  } catch (error) {
    console.error('Error serving template PDF:', error);
    res.status(500).json({ message: 'Error serving template PDF: ' + error.message });
  }
});

// Removed set-default route - only one template per fileType is allowed, so no need for "default" selection

/**
 * Get single template
 * GET /api/templates/:id
 */
router.get('/:id', globalAdmin, async (req, res) => {
  try {
    const template = await Template.findByPk(req.params.id);
    
    if (!template) {
      return res.status(404).json({ message: 'Template not found' });
    }
    
    res.json(template);
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ message: 'Error fetching template: ' + error.message });
  }
});

/**
 * Create template (Excel or PDF)
 * POST /api/templates
 * Note: Only one template per fileType is allowed. If one exists, it will be updated instead.
 */
router.post('/', globalAdmin, upload.single('sampleExcel'), async (req, res) => {
  try {
    const { name, templateType, fileType, excelCells, patterns, transformations, priority } = req.body;
    
    const actualFileType = fileType || 'excel'; // Default to excel for backward compatibility
    
    console.log(`📝 Creating/Updating ${actualFileType} template:`, { 
      name, 
      templateType, 
      fileType: actualFileType,
      hasExcelCells: !!excelCells,
      hasFile: !!req.file
    });
    
    if (!name || !templateType) {
      return res.status(400).json({ message: 'Name and template type are required' });
    }
    
    if (!['invoice', 'credit_note', 'statement'].includes(templateType)) {
      return res.status(400).json({ message: 'Template type must be: invoice, credit_note, or statement' });
    }
    
    if (!['excel', 'pdf'].includes(actualFileType)) {
      return res.status(400).json({ message: 'File type must be: excel or pdf' });
    }
    
    // Check if template name already exists (enforce uniqueness)
    const existingTemplateByName = await Template.findOne({
      where: {
        name: name.trim(),
        enabled: true
      }
    });
    
    if (existingTemplateByName) {
      return res.status(400).json({ 
        message: `Template with name "${name}" already exists. Template names must be unique.` 
      });
    }
    
    // Handle isDefault - only one default per templateType
    const isDefault = req.body.isDefault === 'true' || req.body.isDefault === true;
    if (isDefault) {
      // Unset other defaults of the same templateType
      await Template.update(
        { isDefault: false },
        {
          where: {
            templateType: templateType,
            enabled: true
          }
        }
      );
    }
    
    // Parse JSON fields
    let excelCellsObj = {};
    let patternsObj = {};
    let transformationsObj = {};
    let customFieldsObj = {};
    
    if (excelCells && actualFileType === 'excel') {
      try {
        excelCellsObj = typeof excelCells === 'string' ? JSON.parse(excelCells) : excelCells;
        console.log('📊 Parsed excelCells keys:', Object.keys(excelCellsObj));
      } catch (e) {
        console.error('Error parsing excelCells:', e);
        return res.status(400).json({ message: 'Invalid excelCells JSON: ' + e.message });
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

    // Parse and validate customFields
    if (req.body.customFields) {
      try {
        customFieldsObj = typeof req.body.customFields === 'string' ? JSON.parse(req.body.customFields) : req.body.customFields;
        
        // Validate custom fields
        const { validateCustomFieldName } = require('../utils/fieldDiscovery');
        for (const [fieldName, fieldConfig] of Object.entries(customFieldsObj)) {
          const validation = validateCustomFieldName(fieldName);
          if (!validation.valid) {
            return res.status(400).json({ message: `Invalid custom field name "${fieldName}": ${validation.error}` });
          }
          
          if (!fieldConfig || typeof fieldConfig !== 'object') {
            return res.status(400).json({ message: `Invalid custom field config for "${fieldName}": must be an object` });
          }
          
          if (!fieldConfig.displayName || typeof fieldConfig.displayName !== 'string') {
            return res.status(400).json({ message: `Custom field "${fieldName}" must have a displayName` });
          }
          
          // Validate dataType
          const validDataTypes = ['text', 'number', 'date', 'currency'];
          if (fieldConfig.dataType && !validDataTypes.includes(fieldConfig.dataType)) {
            return res.status(400).json({ message: `Custom field "${fieldName}" has invalid dataType. Must be one of: ${validDataTypes.join(', ')}` });
          }
        }
      } catch (e) {
        console.error('Error parsing customFields:', e);
        return res.status(400).json({ message: 'Invalid customFields JSON: ' + e.message });
      }
    }
    
    // Generate code from template name (lowercase, underscores)
    // Example: "Invoice Template 2025" -> "invoice_template_2025"
    const templateCode = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    
    console.log('📝 Template code generated:', templateCode);
    
    // Validate based on file type
    if (actualFileType === 'excel') {
      console.log('📊 Excel cells received:', Object.keys(excelCellsObj));
      console.log('📊 Excel cells data:', JSON.stringify(excelCellsObj, null, 2));
      
      // Get mandatory fields from Settings (or use defaults)
      const settings = await Settings.getSettings();
      const mandatoryFields = settings.mandatoryFields?.excel || [
        'account_no',
        'invoice_number',
        'document_type',
        'invoice_total',
        'vat_amount'
      ];
      
      // Required fields that must be present for Excel templates
      const requiredFields = mandatoryFields;
      
      // Validate all required fields are present with template code prefix
      const missingFields = [];
      const cellReferences = new Map(); // Track cell references for uniqueness (stores fieldId)
      
      for (const fieldName of requiredFields) {
        const fieldId = `${templateCode}_${fieldName}`;
        const cell = excelCellsObj[fieldId];
        
        console.log(`🔍 Checking field: ${fieldId}, found:`, !!cell);
        
        if (!cell || !cell.column || !cell.row) {
          missingFields.push(fieldName);
          continue;
        }
        
        // Check for duplicate cell references
        const cellKey = `${cell.column}${cell.row}`;
        if (cellReferences.has(cellKey)) {
          return res.status(400).json({
            message: `Duplicate cell reference: ${cellKey} is used by both "${fieldName}" and "${cellReferences.get(cellKey)}". Each field must use a unique cell.`
          });
        }
        // Store fieldId (not fieldName) for consistency with second loop
        cellReferences.set(cellKey, fieldId);
      }
      
      if (missingFields.length > 0) {
        console.error('❌ Missing fields:', missingFields);
        console.error('Expected template code:', templateCode);
        console.error('Available keys:', Object.keys(excelCellsObj));
        return res.status(400).json({
          message: `Missing required fields: ${missingFields.join(', ')}. All fields must be mapped with template code prefix: ${templateCode}_fieldname`,
          missingFields,
          templateCode,
          availableKeys: Object.keys(excelCellsObj)
        });
      }
      
      // Validate no duplicate cell references across all fields
      for (const [fieldId, cell] of Object.entries(excelCellsObj)) {
        if (cell.column && cell.row) {
          const cellKey = `${cell.column}${cell.row}`;
          // Check if this cell is already used by a different field
          if (cellReferences.has(cellKey) && cellReferences.get(cellKey) !== fieldId) {
            return res.status(400).json({
              message: `Duplicate cell reference: ${cellKey} is used by multiple fields. Each field must use a unique cell.`
            });
          }
          // Only add if not already in map (to avoid overwriting)
          if (!cellReferences.has(cellKey)) {
            cellReferences.set(cellKey, fieldId);
          }
        }
      }
    } else if (actualFileType === 'pdf') {
      // Validate PDF template has coordinates
      const { coordinates } = req.body;
      let coordinatesObj = {};
      
      if (coordinates) {
        try {
          coordinatesObj = typeof coordinates === 'string' ? JSON.parse(coordinates) : coordinates;
          console.log('📊 PDF coordinates received:', Object.keys(coordinatesObj).length, 'regions');
        } catch (e) {
          console.error('Error parsing coordinates:', e);
          return res.status(400).json({ message: 'Invalid coordinates JSON: ' + e.message });
        }
      }
      
      // Validate at least one region is defined
      if (!coordinatesObj || Object.keys(coordinatesObj).length === 0) {
        return res.status(400).json({
          message: 'PDF templates require at least one region in coordinates. Please define regions for field extraction.'
        });
      }
      
      // Validate each region has normalized coordinates and uses template code prefix
      for (const [fieldId, coords] of Object.entries(coordinatesObj)) {
        // Ensure field ID uses template code prefix
        if (!fieldId.startsWith(`${templateCode}_`)) {
          return res.status(400).json({
            message: `Field ID "${fieldId}" must use template code prefix "${templateCode}_". Expected: "${templateCode}_${fieldId.replace(/^[^_]+_/, '')}"`
          });
        }
        
        if (!coords.normalized || 
            coords.normalized.left === undefined ||
            coords.normalized.top === undefined ||
            coords.normalized.right === undefined ||
            coords.normalized.bottom === undefined) {
          return res.status(400).json({
            message: `Region for field "${fieldId}" is missing normalized coordinates. All regions must have normalized (0-1) coordinates.`
          });
        }
      }
      
      // Store coordinates for later use (will be added to templateData)
      req.body.parsedCoordinates = coordinatesObj;
      
      // Validate mandatory fields for PDF templates using standard field names
      const { getMandatoryFields } = require('../utils/standardFields');
      const mandatoryFields = getMandatoryFields(templateType);
      
      console.log('🔍 Validating mandatory fields for PDF template:');
      console.log('  Template code:', templateCode);
      console.log('  Coordinates keys:', Object.keys(coordinatesObj));
      console.log('  Mandatory fields:', mandatoryFields.map(f => f.standardName));
      
      if (mandatoryFields.length > 0) {
        const missingFields = [];
        
        for (const field of mandatoryFields) {
          const standardName = field.standardName; // e.g., 'documentType', 'accountNumber'
          
          // Check multiple possible field ID formats:
          // 1. Template code prefix + standard name: `${templateCode}_documentType`
          // 2. Template code prefix + snake_case: `${templateCode}_document_type`
          // 3. Just standard name: `documentType`
          // 4. Just snake_case: `document_type`
          const snakeCase = standardName.replace(/([A-Z])/g, '_$1').toLowerCase();
          
          const possibleFieldIds = [
            `${templateCode}_${standardName}`,
            `${templateCode}_${snakeCase}`,
            standardName,
            snakeCase
          ];
          
          console.log(`  Checking field "${field.displayName}" (${standardName}):`);
          console.log('    Possible IDs:', possibleFieldIds);
          
          let hasField = false;
          let foundFieldId = null;
          for (const fieldId of possibleFieldIds) {
            if (coordinatesObj[fieldId]) {
              console.log(`    Found ${fieldId}:`, {
                hasNormalized: !!coordinatesObj[fieldId].normalized,
                hasLeft: coordinatesObj[fieldId].normalized?.left !== undefined
              });
              if (coordinatesObj[fieldId].normalized &&
                  coordinatesObj[fieldId].normalized.left !== undefined) {
                hasField = true;
                foundFieldId = fieldId;
                break;
              }
            }
          }
          
          if (!hasField) {
            console.log(`    ❌ Missing: ${field.displayName}`);
            missingFields.push(field.displayName);
          } else {
            console.log(`    ✅ Found: ${field.displayName} (as ${foundFieldId})`);
          }
        }
        
        if (missingFields.length > 0) {
          console.log('❌ Missing mandatory fields:', missingFields);
          return res.status(400).json({
            message: `Missing mandatory fields: ${missingFields.join(', ')}. Please define all mandatory fields before saving.`,
            missingFields: missingFields
          });
        } else {
          console.log('✅ All mandatory fields are defined');
        }
      }
    }
    
    // Prepare data for template creation
    const prefixedExcelCells = actualFileType === 'excel' ? excelCellsObj : {};
    
    // Handle file upload (Excel for Excel templates, PDF for PDF templates)
    let sampleExcelPath = null;
    let samplePdfPath = null;
    if (req.file) {
      if (actualFileType === 'excel') {
        sampleExcelPath = `/uploads/templates/${req.file.filename}`;
      } else if (actualFileType === 'pdf') {
        samplePdfPath = `/uploads/templates/${req.file.filename}`;
      }
    }
    
    // Parse coordinates for PDF templates
    let coordinatesObj = {};
    if (actualFileType === 'pdf' && req.body.coordinates) {
      try {
        coordinatesObj = typeof req.body.coordinates === 'string' 
          ? JSON.parse(req.body.coordinates) 
          : req.body.coordinates;
      } catch (e) {
        console.error('Error parsing coordinates:', e);
        return res.status(400).json({ message: 'Invalid coordinates JSON: ' + e.message });
      }
    }
    
    // Create template
    const templateData = {
      name,
      code: templateCode,
      fileType: actualFileType,
      templateType,
      excelCells: prefixedExcelCells,
      patterns: patternsObj,
      transformations: transformationsObj,
      customFields: customFieldsObj,
      isDefault: isDefault || false,
      priority: priority ? parseInt(priority) : 0,
      enabled: true
    };
    
    // Add coordinates for PDF templates (already validated and parsed above)
    if (actualFileType === 'pdf' && req.body.parsedCoordinates) {
      templateData.coordinates = req.body.parsedCoordinates;
    }
    
    if (sampleExcelPath) {
      templateData.sampleExcelPath = sampleExcelPath;
    }
    if (samplePdfPath) {
      templateData.samplePdfPath = samplePdfPath;
    }
    
    // Create new template
    const template = await Template.create(templateData);
    console.log(`✅ ${actualFileType} template created successfully:`, template.id);
    
    // Log template creation
    await logActivity({
      type: ActivityType.TEMPLATE_CREATED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Created ${actualFileType} template ${template.name}`,
      details: { 
        templateId: template.id,
        templateName: template.name,
        templateType: template.templateType,
        fileType: actualFileType,
        isDefault: template.isDefault || false
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ message: 'Error creating template: ' + error.message });
  }
});

/**
 * Update template (Excel or PDF)
 * PUT /api/templates/:id
 */
router.put('/:id', globalAdmin, upload.single('samplePdf'), async (req, res) => {
  try {
    const template = await Template.findByPk(req.params.id);
    
    if (!template) {
      return res.status(404).json({ message: 'Template not found' });
    }
    
    const actualFileType = template.fileType || 'excel';
    
    console.log(`📝 Updating ${actualFileType} template:`, {
      id: template.id,
      hasExcelCells: !!req.body.excelCells,
      hasCoordinates: !!req.body.coordinates
    });
    
    const { name, templateType, fileType, excelCells, coordinates, patterns, transformations, priority } = req.body;
    const currentTemplateType = templateType || template.templateType;
    
    // Get template code - NEVER change it for existing templates
    // This ensures field IDs with template code prefix remain valid
    let templateCode = template.code;
    
    // Only generate template code if it doesn't exist (shouldn't happen for existing templates)
    if (!templateCode) {
      return res.status(400).json({ message: 'Template code is missing. This template may be corrupted.' });
    }
    
    // Prevent template name changes - enforce uniqueness
    if (name && name.trim() !== template.name) {
      // Check if new name already exists
      const existingTemplateWithName = await Template.findOne({
        where: {
          name: name.trim(),
          id: { [require('sequelize').Op.ne]: template.id },
          enabled: true
        }
      });
      
      if (existingTemplateWithName) {
        return res.status(400).json({ 
          message: `Template with name "${name}" already exists. Template names must be unique and cannot be changed.` 
        });
      }
      
      // Don't allow name changes - this would break template code and field mappings
      return res.status(400).json({ 
        message: 'Template name cannot be changed. Template names are permanent to ensure uniqueness and data integrity.' 
      });
    }
    
    // Handle Excel templates
    if (actualFileType === 'excel') {
      // Parse Excel cells
      let excelCellsObj = template.excelCells || {};
      if (excelCells) {
        try {
          excelCellsObj = typeof excelCells === 'string' ? JSON.parse(excelCells) : excelCells;
          console.log('📊 Parsed excelCells keys:', Object.keys(excelCellsObj));
        } catch (e) {
          console.error('Error parsing excelCells:', e);
          return res.status(400).json({ message: 'Invalid excelCells JSON: ' + e.message });
        }
      }
      
      // All fields should already have template code prefix from frontend
      const prefixedExcelCells = excelCellsObj;
      
      // Required fields that must be present for Excel templates
      const requiredFields = [
        'account_no',
        'invoice_number',
        'document_type',
        'invoice_total',
        'vat_amount'
      ];
      
      // Validate all required fields are present
      const missingFields = [];
      const cellReferences = new Map(); // Track cell references for uniqueness (stores fieldId)
      
      for (const fieldName of requiredFields) {
        const fieldId = `${templateCode}_${fieldName}`;
        const cell = prefixedExcelCells[fieldId];
        
        if (!cell || !cell.column || !cell.row) {
          missingFields.push(fieldName);
          continue;
        }
        
        // Check for duplicate cell references
        const cellKey = `${cell.column}${cell.row}`;
        if (cellReferences.has(cellKey)) {
          return res.status(400).json({
            message: `Duplicate cell reference: ${cellKey} is used by both "${fieldName}" and "${cellReferences.get(cellKey)}". Each field must use a unique cell.`
          });
        }
        // Store fieldId (not fieldName) for consistency with second loop
        cellReferences.set(cellKey, fieldId);
      }
      
      if (missingFields.length > 0) {
        return res.status(400).json({
          message: `Missing required fields: ${missingFields.join(', ')}. All fields must be mapped with template code prefix: ${templateCode}_fieldname`,
          missingFields,
          templateCode
        });
      }
      
      // Validate no duplicate cell references across all fields
      for (const [fieldId, cell] of Object.entries(prefixedExcelCells)) {
        if (cell.column && cell.row) {
          const cellKey = `${cell.column}${cell.row}`;
          // Check if this cell is already used by a different field
          if (cellReferences.has(cellKey) && cellReferences.get(cellKey) !== fieldId) {
            return res.status(400).json({
              message: `Duplicate cell reference: ${cellKey} is used by multiple fields. Each field must use a unique cell.`
            });
          }
          // Only add if not already in map (to avoid overwriting)
          if (!cellReferences.has(cellKey)) {
            cellReferences.set(cellKey, fieldId);
          }
        }
      }
      
      template.excelCells = prefixedExcelCells;
    } else if (actualFileType === 'pdf') {
      // Handle PDF template coordinates
      if (coordinates) {
        try {
          const coordsObj = typeof coordinates === 'string' ? JSON.parse(coordinates) : coordinates;
          template.coordinates = coordsObj;
          console.log('📊 Updated PDF coordinates:', Object.keys(coordsObj).length, 'regions');
        } catch (e) {
          console.error('Error parsing coordinates:', e);
          return res.status(400).json({ message: 'Invalid coordinates JSON: ' + e.message });
        }
      }
    }
    
    if (patterns) {
      try {
        template.patterns = typeof patterns === 'string' ? JSON.parse(patterns) : patterns;
      } catch (e) {
        console.warn('Error parsing patterns:', e);
      }
    }
    
    if (transformations) {
      try {
        template.transformations = typeof transformations === 'string' ? JSON.parse(transformations) : transformations;
      } catch (e) {
        console.warn('Error parsing transformations:', e);
      }
    }

    // Handle customFields update
    if (req.body.customFields !== undefined) {
      try {
        const customFieldsObj = typeof req.body.customFields === 'string' 
          ? JSON.parse(req.body.customFields) 
          : req.body.customFields;
        
        // Validate custom fields
        const { validateCustomFieldName } = require('../utils/fieldDiscovery');
        for (const [fieldName, fieldConfig] of Object.entries(customFieldsObj)) {
          const validation = validateCustomFieldName(fieldName);
          if (!validation.valid) {
            return res.status(400).json({ message: `Invalid custom field name "${fieldName}": ${validation.error}` });
          }
          
          if (!fieldConfig || typeof fieldConfig !== 'object') {
            return res.status(400).json({ message: `Invalid custom field config for "${fieldName}": must be an object` });
          }
          
          if (!fieldConfig.displayName || typeof fieldConfig.displayName !== 'string') {
            return res.status(400).json({ message: `Custom field "${fieldName}" must have a displayName` });
          }
          
          // Validate dataType
          const validDataTypes = ['text', 'number', 'date', 'currency'];
          if (fieldConfig.dataType && !validDataTypes.includes(fieldConfig.dataType)) {
            return res.status(400).json({ message: `Custom field "${fieldName}" has invalid dataType. Must be one of: ${validDataTypes.join(', ')}` });
          }
        }
        
        template.customFields = customFieldsObj;
      } catch (e) {
        console.error('Error parsing customFields:', e);
        return res.status(400).json({ message: 'Invalid customFields JSON: ' + e.message });
      }
    }
    
    // Don't allow changing name (already validated above)
    // if (name) template.name = name;
    if (templateType) template.templateType = templateType;
    // Don't allow changing fileType for existing templates (would break data)
    // if (fileType) template.fileType = fileType;
    if (priority !== undefined) template.priority = parseInt(priority);
    
    // Handle isDefault - only one default per templateType
    const isDefault = req.body.isDefault === 'true' || req.body.isDefault === true;
    if (isDefault !== template.isDefault) {
      if (isDefault) {
        // Unset other defaults of the same templateType
        await Template.update(
          { isDefault: false },
          {
            where: {
              templateType: template.templateType || currentTemplateType,
              id: { [require('sequelize').Op.ne]: template.id },
              enabled: true
            }
          }
        );
      }
      template.isDefault = isDefault;
    }
    
    // Handle file upload (Excel or PDF)
    if (req.file) {
      if (actualFileType === 'excel') {
        // Delete old Excel file if exists
        if (template.sampleExcelPath) {
          const oldPath = path.join(__dirname, '..', template.sampleExcelPath);
          if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
          }
        }
        template.sampleExcelPath = `/uploads/templates/${req.file.filename}`;
      } else if (actualFileType === 'pdf') {
        // Delete old PDF file if exists
        if (template.samplePdfPath) {
          const oldPath = path.join(__dirname, '..', template.samplePdfPath);
          if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
          }
        }
        template.samplePdfPath = `/uploads/templates/${req.file.filename}`;
      }
    }
    
    await template.save();
    
    console.log(`✅ ${actualFileType} template updated successfully:`, template.id);
    
    // Log template update
    await logActivity({
      type: ActivityType.TEMPLATE_UPDATED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Updated ${actualFileType} template ${template.name}`,
      details: { 
        templateId: template.id,
        templateName: template.name,
        templateType: template.templateType,
        fileType: actualFileType,
        isDefault: template.isDefault || false
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json(template);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ message: 'Error updating template: ' + error.message });
  }
});

/**
 * Extract text from a specific region in a PDF
 * POST /api/templates/extract-region-text
 */
router.post('/extract-region-text', globalAdmin, upload.single('pdf'), async (req, res) => {
  try {
    // Accept normalized coordinates (0-1 system) - bulletproof approach!
    const { left, top, right, bottom, page, templateId } = req.body;
    
    if (left === undefined || top === undefined || right === undefined || bottom === undefined) {
      return res.status(400).json({ message: 'Normalized coordinates (left, top, right, bottom) are required' });
    }
    
    // Validate normalized coordinates are in 0-1 range
    const normalizedCoords = {
      left: Math.max(0, Math.min(1, parseFloat(left))),
      top: Math.max(0, Math.min(1, parseFloat(top))),
      right: Math.max(0, Math.min(1, parseFloat(right))),
      bottom: Math.max(0, Math.min(1, parseFloat(bottom)))
    };
    
    if (normalizedCoords.left >= normalizedCoords.right || normalizedCoords.top >= normalizedCoords.bottom) {
      return res.status(400).json({ message: 'Invalid normalized coordinates: left < right and top < bottom required' });
    }
    
    let pdfBuffer;
    
    if (req.file) {
      pdfBuffer = fs.readFileSync(req.file.path);
    } else if (templateId) {
      const template = await Template.findByPk(templateId);
      if (!template || !template.samplePdfPath) {
        return res.status(404).json({ message: 'Template or PDF not found' });
      }
      const pdfPath = path.join(__dirname, '..', template.samplePdfPath);
      if (!fs.existsSync(pdfPath)) {
        return res.status(404).json({ message: 'PDF file not found' });
      }
      pdfBuffer = fs.readFileSync(pdfPath);
    } else {
      return res.status(400).json({ message: 'Either PDF file or templateId is required' });
    }
    
    const { extractTextFromNormalizedRegion } = require('../utils/pdfCoordinates');
    const pageNum = parseInt(page) || 1;
    
    const extractedText = await extractTextFromNormalizedRegion(pdfBuffer, {
      left: normalizedCoords.left,
      top: normalizedCoords.top,
      right: normalizedCoords.right,
      bottom: normalizedCoords.bottom,
      page: pageNum
    });
    
    // Clean up uploaded file if it was temporary
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.json({
      success: true,
      text: extractedText,
      itemCount: extractedText ? extractedText.split(/\s+/).filter(w => w.length > 0).length : 0
    });
  } catch (error) {
    console.error('Error extracting region text:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ 
      success: false,
      message: 'Error extracting text from region: ' + error.message 
    });
  }
});

/**
 * Delete template
 * DELETE /api/templates/:id
 */
router.delete('/:id', globalAdmin, async (req, res) => {
  try {
    const template = await Template.findByPk(req.params.id);
    
    if (!template) {
      return res.status(404).json({ message: 'Template not found' });
    }
    
    // Delete Excel file if exists
    if (template.sampleExcelPath) {
      const excelPath = path.join(__dirname, '..', template.sampleExcelPath);
      if (fs.existsSync(excelPath)) {
        fs.unlinkSync(excelPath);
      }
    }
    
    // Store template info before deletion
    const deletedTemplateName = template.name;
    const deletedTemplateId = template.id;
    const deletedFileType = template.fileType || 'excel';
    
    await template.destroy();
    
    // Log template deletion
    await logActivity({
      type: ActivityType.TEMPLATE_DELETED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Deleted ${deletedFileType} template ${deletedTemplateName}`,
      details: { 
        templateId: deletedTemplateId,
        templateName: deletedTemplateName,
        templateType: template.templateType,
        fileType: deletedFileType
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ message: 'Error deleting template: ' + error.message });
  }
});

/**
 * Get default template for a specific file type and template type
 * GET /api/templates/default/:fileType/:templateType?
 */
router.get('/default/:fileType/:templateType?', globalAdmin, async (req, res) => {
  try {
    const { fileType, templateType } = req.params;
    
    if (!['pdf', 'excel'].includes(fileType)) {
      return res.status(400).json({ message: 'File type must be "pdf" or "excel"' });
    }
    
    const template = await Template.findDefaultTemplate(fileType, templateType || null);
    
    if (!template) {
      return res.status(404).json({ 
        message: `No default ${fileType} template found${templateType ? ` for ${templateType}` : ''}` 
      });
    }
    
    res.json({
      success: true,
      template: {
        id: template.id,
        name: template.name,
        code: template.code,
        templateType: template.templateType,
        fileType: template.fileType,
        isDefault: template.isDefault,
        priority: template.priority
      }
    });
  } catch (error) {
    console.error('Error fetching default template:', error);
    res.status(500).json({ message: 'Error fetching default template: ' + error.message });
  }
});

module.exports = router;
