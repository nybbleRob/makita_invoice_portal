const express = require('express');
const { Supplier, SupplierTemplateSupplier: SupplierTemplate, SupplierDocument, Settings, User, Sequelize } = require('../models');
const { Op } = Sequelize;
const auth = require('../middleware/auth');
const globalAdmin = require('../middleware/globalAdmin');
const { requireStaff, requireManager } = require('../middleware/permissions');
const { logActivity, ActivityType } = require('../services/activityLogger');
const router = express.Router();

// Middleware to check if suppliers module is enabled
const checkSuppliersEnabled = async (req, res, next) => {
  try {
    const settings = await Settings.getSettings();
    // Default to true if not set (backwards compatibility)
    if (settings.suppliersEnabled === false) {
      return res.status(403).json({ message: 'Suppliers feature is currently disabled' });
    }
    next();
  } catch (error) {
    console.error('Error checking suppliers enabled:', error);
    // If settings can't be loaded, allow access (fail open for backwards compatibility)
    next();
  }
};

// Apply auth, permission check, and suppliers enabled check to all routes
router.use(auth);
router.use(requireStaff); // Staff or higher can view suppliers
router.use(checkSuppliersEnabled);

// Get all suppliers with pagination, search, and filters
router.get('/', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      search = '', 
      isActive,
      sortBy = 'name',
      sortOrder = 'ASC'
    } = req.query;
    
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    
    const whereConditions = {
      deletedAt: null
    };
    
    // Filter by active status
    if (isActive !== undefined) {
      whereConditions.isActive = isActive === 'true' || isActive === true;
    }
    
    // Search functionality
    if (search) {
      const searchLower = search.toLowerCase().trim();
      const searchConditions = [
        { name: { [Op.iLike]: `%${searchLower}%` } },
        { code: { [Op.iLike]: `%${searchLower}%` } },
        { email: { [Op.iLike]: `%${searchLower}%` } }
      ];
      whereConditions[Op.or] = searchConditions;
    }
    
    // Get total count
    const total = await Supplier.count({ where: whereConditions });
    
    // Get suppliers with template and document counts
    const suppliers = await Supplier.findAll({
      where: whereConditions,
      limit: limitNum,
      offset,
      order: [[sortBy, sortOrder.toUpperCase()]],
      include: [
        {
          model: User,
          as: 'createdBy',
          attributes: ['id', 'name', 'email']
        }
      ]
    });
    
    // Get template and document counts for each supplier
    const suppliersWithCounts = await Promise.all(
      suppliers.map(async (supplier) => {
        const templateCount = await SupplierTemplate.count({
          where: {
            supplierId: supplier.id,
            deletedAt: null
          }
        });
        
        const documentCount = await SupplierDocument.count({
          where: {
            supplierId: supplier.id,
            deletedAt: null
          }
        });
        
        return {
          ...supplier.toJSON(),
          templateCount,
          documentCount
        };
      })
    );
    
    res.json({
      suppliers: suppliersWithCounts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Error fetching suppliers', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get single supplier with templates and recent documents
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const supplier = await Supplier.findByPk(id, {
      include: [
        {
          model: User,
          as: 'createdBy',
          attributes: ['id', 'name', 'email']
        },
        {
          model: SupplierTemplate,
          as: 'templates',
          where: { deletedAt: null },
          required: false,
          order: [['templateType', 'ASC'], ['priority', 'DESC']]
        },
        {
          model: SupplierDocument,
          as: 'documents',
          where: { deletedAt: null },
          required: false,
          limit: 10,
          order: [['documentDate', 'DESC']],
          include: [
            {
              model: SupplierTemplate,
              as: 'template',
              required: false,
              attributes: ['id', 'name', 'templateType', 'fileType']
            }
          ]
        }
      ]
    });
    
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    
    // Get counts
    const templateCount = await SupplierTemplate.count({
      where: { supplierId: id, deletedAt: null }
    });
    
    const documentCount = await SupplierDocument.count({
      where: { supplierId: id, deletedAt: null }
    });
    
    res.json({
      ...supplier.toJSON(),
      templateCount,
      documentCount
    });
  } catch (error) {
    console.error('Error fetching supplier:', error);
    res.status(500).json({ message: 'Error fetching supplier', error: error.message });
  }
});

// Create new supplier (Global Admin only)
router.post('/', globalAdmin, async (req, res) => {
  try {
    const { name, code, email, phone, address, taxId, vatNumber, website, notes, isActive = true, metadata = {} } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Supplier name is required' });
    }
    
    // Sanitize inputs - convert empty strings to null
    const sanitizedCode = code && code.trim() ? code.trim() : null;
    const sanitizedEmail = email && email.trim() ? email.trim() : null;
    const sanitizedPhone = phone && phone.trim() ? phone.trim() : null;
    const sanitizedWebsite = website && website.trim() ? website.trim() : null;
    
    // Check if code is already taken (if provided)
    if (sanitizedCode) {
      const existingSupplier = await Supplier.findByCode(sanitizedCode);
      if (existingSupplier) {
        return res.status(400).json({ message: 'Supplier with this code already exists' });
      }
    }
    
    const supplier = await Supplier.create({
      name: name.trim(),
      code: sanitizedCode,
      email: sanitizedEmail,
      phone: sanitizedPhone,
      address: address || {},
      taxId: taxId && taxId.trim() ? taxId.trim() : null,
      vatNumber: vatNumber && vatNumber.trim() ? vatNumber.trim() : null,
      website: sanitizedWebsite,
      notes: notes && notes.trim() ? notes.trim() : null,
      isActive,
      metadata: metadata || {},
      createdById: req.user.id
    });
    
    // Log activity
    await logActivity({
      type: ActivityType.SUPPLIER_CREATED,
      userId: req.user.id,
      description: `Created supplier: ${supplier.name}`,
      metadata: {
        supplierId: supplier.id,
        supplierName: supplier.name
      }
    });
    
    res.status(201).json(supplier);
  } catch (error) {
    console.error('Error creating supplier:', error);
    res.status(500).json({ message: 'Error creating supplier', error: error.message });
  }
});

// Update supplier (Global Admin only)
router.put('/:id', globalAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, email, phone, address, taxId, vatNumber, website, notes, isActive, metadata } = req.body;
    
    const supplier = await Supplier.findByPk(id);
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    
    // Sanitize inputs - convert empty strings to null
    const sanitizedCode = code && code.trim() ? code.trim() : null;
    
    // Check if code is already taken by another supplier (if changing code)
    if (sanitizedCode && sanitizedCode !== supplier.code) {
      const existingSupplier = await Supplier.findByCode(sanitizedCode);
      if (existingSupplier && existingSupplier.id !== id) {
        return res.status(400).json({ message: 'Supplier with this code already exists' });
      }
    }
    
    // Update fields - sanitize all inputs
    if (name !== undefined) supplier.name = name.trim();
    if (code !== undefined) supplier.code = sanitizedCode;
    if (email !== undefined) supplier.email = email && email.trim() ? email.trim() : null;
    if (phone !== undefined) supplier.phone = phone && phone.trim() ? phone.trim() : null;
    if (address !== undefined) supplier.address = address || {};
    if (taxId !== undefined) supplier.taxId = taxId && taxId.trim() ? taxId.trim() : null;
    if (vatNumber !== undefined) supplier.vatNumber = vatNumber && vatNumber.trim() ? vatNumber.trim() : null;
    if (website !== undefined) supplier.website = website && website.trim() ? website.trim() : null;
    if (notes !== undefined) supplier.notes = notes && notes.trim() ? notes.trim() : null;
    if (isActive !== undefined) supplier.isActive = isActive;
    if (metadata !== undefined) supplier.metadata = metadata || {};
    
    await supplier.save();
    
    // Log activity
    await logActivity({
      type: ActivityType.SUPPLIER_UPDATED,
      userId: req.user.id,
      description: `Updated supplier: ${supplier.name}`,
      metadata: {
        supplierId: supplier.id,
        supplierName: supplier.name
      }
    });
    
    res.json(supplier);
  } catch (error) {
    console.error('Error updating supplier:', error);
    res.status(500).json({ message: 'Error updating supplier', error: error.message });
  }
});

// Delete supplier (soft delete, Global Admin only)
router.delete('/:id', globalAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const supplier = await Supplier.findByPk(id);
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    
    // Check if supplier has documents
    const documentCount = await SupplierDocument.count({
      where: { supplierId: id, deletedAt: null }
    });
    
    if (documentCount > 0) {
      return res.status(400).json({ 
        message: `Cannot delete supplier with ${documentCount} existing document(s). Please delete or archive documents first.` 
      });
    }
    
    // Soft delete
    supplier.deletedAt = new Date();
    await supplier.save();
    
    // Log activity
    await logActivity({
      type: ActivityType.SUPPLIER_DELETED,
      userId: req.user.id,
      description: `Deleted supplier: ${supplier.name}`,
      metadata: {
        supplierId: supplier.id,
        supplierName: supplier.name
      }
    });
    
    res.json({ message: 'Supplier deleted successfully' });
  } catch (error) {
    console.error('Error deleting supplier:', error);
    res.status(500).json({ message: 'Error deleting supplier', error: error.message });
  }
});

// Get all templates for a supplier
router.get('/:id/templates', async (req, res) => {
  try {
    const { id } = req.params;
    
    const supplier = await Supplier.findByPk(id);
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    
    const templates = await SupplierTemplate.findAll({
      where: {
        supplierId: id,
        deletedAt: null
      },
      order: [['templateType', 'ASC'], ['isDefault', 'DESC'], ['priority', 'DESC']]
    });
    
    res.json(templates);
  } catch (error) {
    console.error('Error fetching supplier templates:', error);
    res.status(500).json({ message: 'Error fetching supplier templates', error: error.message });
  }
});

// Get all documents for a supplier
router.get('/:id/documents', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      page = 1, 
      limit = 50, 
      documentType,
      status,
      startDate,
      endDate
    } = req.query;
    
    const supplier = await Supplier.findByPk(id);
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }
    
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    
    const whereConditions = {
      supplierId: id,
      deletedAt: null
    };
    
    if (documentType) {
      whereConditions.documentType = documentType;
    }
    
    if (status) {
      whereConditions.status = status;
    }
    
    if (startDate || endDate) {
      whereConditions.documentDate = {};
      if (startDate) whereConditions.documentDate[Op.gte] = startDate;
      if (endDate) whereConditions.documentDate[Op.lte] = endDate;
    }
    
    const total = await SupplierDocument.count({ where: whereConditions });
    
    const documents = await SupplierDocument.findAll({
      where: whereConditions,
      limit: limitNum,
      offset,
      order: [['documentDate', 'DESC']],
      include: [
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

module.exports = router;
