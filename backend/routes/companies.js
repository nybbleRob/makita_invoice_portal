const express = require('express');
const multer = require('multer');
const Papa = require('papaparse');
const XLSX = require('xlsx');
const { Company, Sequelize, ImportTransaction, User, UserCompany, sequelize } = require('../models');
const { QueryTypes } = Sequelize;
const { Op } = Sequelize;
const auth = require('../middleware/auth');
const globalAdmin = require('../middleware/globalAdmin');
const { checkDocumentAccess, buildCompanyFilter } = require('../middleware/documentAccess');
const { requirePermission, requireManager, requireStaff } = require('../middleware/permissions');
const { updateNestedSetIndexes, queueNestedSetUpdate } = require('../utils/nestedSet');
const { redis } = require('../config/redis');
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
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/json',
      'application/vnd.ms-excel.sheet.macroEnabled.12'
    ];
    if (allowedMimes.includes(file.mimetype) || 
        file.originalname.endsWith('.csv') || 
        file.originalname.endsWith('.xls') || 
        file.originalname.endsWith('.xlsx') || 
        file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only CSV, XLS, XLSX, and JSON files are allowed.'));
    }
  }
});

// Get paginated companies for user assignment (with Redis caching)
router.get('/for-assignment', auth, async (req, res) => {
  try {
    const { page = 1, limit = 50, search = '' } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;
    
    // Create cache key
    const cacheKey = `companies:assignment:${pageNum}:${limitNum}:${search.toLowerCase().trim()}`;
    
    // Try to get from cache first
    if (redis) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          return res.json(JSON.parse(cached));
        }
      } catch (cacheError) {
        // If Redis fails, continue without cache
        console.warn('Redis cache read failed, continuing without cache:', cacheError.message);
      }
    }
    
    const whereConditions = {
      isActive: true
    };
    
    if (search) {
      const searchLower = search.toLowerCase().trim();
      const searchConditions = [
        { name: { [Op.iLike]: `%${searchLower}%` } },
        { code: { [Op.iLike]: `%${searchLower}%` } }
      ];
      
      // Try to parse as number for referenceNo search
      const searchNum = parseInt(search);
      if (!isNaN(searchNum)) {
        // Search by exact referenceNo match
        searchConditions.push({ referenceNo: searchNum });
        // Also search by referenceNo as text (in case it's stored as text in some cases)
        searchConditions.push(
          Sequelize.where(
            Sequelize.cast(Sequelize.col('referenceNo'), 'TEXT'),
            { [Op.iLike]: `%${searchLower}%` }
          )
        );
      } else {
        // If not a number, still try to search referenceNo as text
        searchConditions.push(
          Sequelize.where(
            Sequelize.cast(Sequelize.col('referenceNo'), 'TEXT'),
            { [Op.iLike]: `%${searchLower}%` }
          )
        );
      }
      
      whereConditions[Op.or] = searchConditions;
    }
    
    const { count, rows } = await Company.findAndCountAll({
      where: whereConditions,
      attributes: ['id', 'name', 'referenceNo', 'code', 'type', 'globalSystemEmail'],
      limit: limitNum,
      offset: offset,
      order: [['name', 'ASC']]
    });
    
    const response = {
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        pages: Math.ceil(count / limitNum)
      }
    };
    
    // Cache the result for 5 minutes
    if (redis) {
      try {
        await redis.setex(cacheKey, 300, JSON.stringify(response)); // 5 minutes TTL
      } catch (cacheError) {
        // If Redis fails, continue without cache
        console.warn('Redis cache write failed, continuing without cache:', cacheError.message);
      }
    }
    
    res.json(response);
  } catch (error) {
    console.error('Error fetching companies for assignment:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get paginated parent companies (for Branch/Subsidiary selection)
router.get('/parents', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const where = {
      [Op.and]: [
        {
          [Op.or]: [
            { type: 'CORP' },
            { type: 'SUB' }
          ]
        },
        { isActive: true }
      ]
    };
    
    if (search) {
      const searchConditions = [
        { name: { [Op.iLike]: `%${search}%` } },
        { code: { [Op.iLike]: `%${search}%` } }
      ];
      
      // Try to parse as number for referenceNo search
      const searchNum = parseInt(search);
      if (!isNaN(searchNum)) {
        searchConditions.push({ referenceNo: searchNum });
      }
      
      where[Op.and].push({
        [Op.or]: searchConditions
      });
    }
    
    const { count, rows } = await Company.findAndCountAll({
      where,
      attributes: ['id', 'name', 'referenceNo', 'code', 'type'],
      limit: parseInt(limit),
      offset: offset,
      order: [['name', 'ASC']]
    });
    
    res.json({
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        pages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching parent companies:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get companies in hierarchical structure for tree view filters
// Only returns companies the user has access to, structured as a tree
router.get('/hierarchy', auth, checkDocumentAccess, async (req, res) => {
  try {
    const { search } = req.query;
    
    // Build where clause based on user permissions
    const where = {};
    if (req.accessibleCompanyIds !== null) {
      if (req.accessibleCompanyIds.length === 0) {
        return res.json({ companies: [] });
      }
      where.id = { [Op.in]: req.accessibleCompanyIds };
    }
    
    // Add search filter if provided
    if (search) {
      const searchConditions = [
        { name: { [Op.iLike]: `%${search}%` } },
        { code: { [Op.iLike]: `%${search}%` } }
      ];
      const searchNum = parseInt(search);
      if (!isNaN(searchNum)) {
        searchConditions.push({ referenceNo: searchNum });
      }
      searchConditions.push(
        Sequelize.where(
          Sequelize.cast(Sequelize.col('Company.referenceNo'), 'TEXT'),
          { [Op.iLike]: `%${search}%` }
        )
      );
      where[Op.or] = searchConditions;
    }
    
    // Fetch all accessible companies
    const companies = await Company.findAll({
      where,
      attributes: ['id', 'name', 'referenceNo', 'code', 'type', 'parentId', 'isActive'],
      order: [['name', 'ASC']]
    });
    
    // Build hierarchical structure
    const companyMap = new Map();
    const rootCompanies = [];
    
    // First pass: create map of all companies
    companies.forEach(company => {
      companyMap.set(company.id, {
        id: company.id,
        name: company.name,
        referenceNo: company.referenceNo,
        code: company.code,
        type: company.type,
        parentId: company.parentId,
        isActive: company.isActive,
        children: []
      });
    });
    
    // Second pass: build tree structure
    companies.forEach(company => {
      const node = companyMap.get(company.id);
      if (company.parentId && companyMap.has(company.parentId)) {
        // Add to parent's children
        companyMap.get(company.parentId).children.push(node);
      } else {
        // No parent or parent not in accessible list - treat as root
        rootCompanies.push(node);
      }
    });
    
    // Sort children recursively
    const sortChildren = (node) => {
      if (node.children && node.children.length > 0) {
        node.children.sort((a, b) => a.name.localeCompare(b.name));
        node.children.forEach(sortChildren);
      }
    };
    rootCompanies.forEach(sortChildren);
    rootCompanies.sort((a, b) => a.name.localeCompare(b.name));
    
    res.json({ companies: rootCompanies });
  } catch (error) {
    console.error('Error fetching company hierarchy:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get all companies
router.get('/', auth, checkDocumentAccess, async (req, res) => {
  try {
    const { type, types, search, isActive, page, limit, companyIds } = req.query;
    
    // Support both paginated and non-paginated requests
    const usePagination = page !== undefined && limit !== undefined;
    const pageNum = usePagination ? parseInt(page) : 1;
    const limitNum = usePagination ? parseInt(limit) : 1000; // Default to 1000 if no pagination requested
    const offset = usePagination ? (pageNum - 1) * limitNum : 0;
    
    const where = {};
    
    // Apply company access filter for non-admin users
    // If accessibleCompanyIds is null, user can see all companies
    // If accessibleCompanyIds is an array, filter by those company IDs
    if (req.accessibleCompanyIds !== null) {
      if (req.accessibleCompanyIds.length === 0) {
        // User has no companies assigned - return empty result
        return res.json({
          data: [],
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: 0,
            pages: 0
          }
        });
      }
      where.id = { [Op.in]: req.accessibleCompanyIds };
    }
    
    // Filter by specific company IDs (from filter selection)
    // This takes precedence and narrows down the results
    if (companyIds) {
      const idsArray = companyIds.split(',').map(id => id.trim()).filter(id => id);
      if (idsArray.length > 0) {
        // If there's already an id filter from accessibleCompanyIds, intersect them
        if (where.id && where.id[Op.in]) {
          const accessible = new Set(where.id[Op.in]);
          const filtered = idsArray.filter(id => accessible.has(id));
          where.id = { [Op.in]: filtered.length > 0 ? filtered : ['00000000-0000-0000-0000-000000000000'] };
        } else {
          where.id = { [Op.in]: idsArray };
        }
      }
    }
    
    // Support multiple types filter (comma-separated)
    if (types) {
      const typesArray = types.split(',').map(t => t.trim().toUpperCase()).filter(t => ['CORP', 'SUB', 'BRANCH'].includes(t));
      if (typesArray.length > 0) {
        where.type = { [Op.in]: typesArray };
      }
    } else if (type && ['CORP', 'SUB', 'BRANCH'].includes(type)) {
      where.type = type;
    }
    
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }
    
    if (search) {
      const searchConditions = [
        { name: { [Op.iLike]: `%${search}%` } },
        { code: { [Op.iLike]: `%${search}%` } }
      ];
      
      // referenceNo is an INTEGER column, so we need to cast it to TEXT for ILIKE search
      // Try exact match first if it's a number
      const searchNum = parseInt(search);
      if (!isNaN(searchNum)) {
        searchConditions.push({ referenceNo: searchNum });
      }
      // Also search as text pattern
      searchConditions.push(
        Sequelize.where(
          Sequelize.cast(Sequelize.col('Company.referenceNo'), 'TEXT'),
          { [Op.iLike]: `%${search}%` }
        )
      );
      
      where[Op.or] = searchConditions;
    }
    
    const queryOptions = {
      where,
      include: [{
        model: Company,
        as: 'parent',
        attributes: ['id', 'name', 'referenceNo', 'type'],
        required: false
      }, {
        model: Company,
        as: 'children',
        attributes: ['id', 'name', 'referenceNo', 'type'],
        required: false
      }],
      order: [['name', 'ASC']]
    };
    
    if (usePagination) {
      // Use findAndCountAll for pagination
      const { count, rows } = await Company.findAndCountAll({
        ...queryOptions,
        limit: limitNum,
        offset: offset,
        distinct: true // Important when using includes
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
    } else {
      // Non-paginated response (for backward compatibility, but with limit)
      const companies = await Company.findAll({
        ...queryOptions,
        limit: limitNum
      });
      
      res.json(companies);
    }
  } catch (error) {
    console.error('Error fetching companies:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Export companies to CSV/XLS
 * GET /api/companies/export?format=csv|xls|xlsx
 * MUST be defined BEFORE /:id route to avoid "export" being treated as a UUID
 */
router.get('/export', auth, async (req, res) => {
  try {
    // Check if user is administrator (same as import)
    if (req.user.role !== 'global_admin' && req.user.role !== 'administrator') {
      return res.status(403).json({ 
        message: 'Access denied. Administrator privileges required.' 
      });
    }

    const format = (req.query.format || 'csv').toLowerCase();
    if (format !== 'csv' && format !== 'xls' && format !== 'xlsx') {
      return res.status(400).json({ message: 'Invalid format. Use csv, xls, or xlsx' });
    }

    // Get all companies with parent and primary contact
    const companiesResult = await Company.findAll({
      include: [
        {
          model: Company,
          as: 'parent',
          required: false,
          attributes: ['id', 'referenceNo']
        },
        {
          model: User,
          as: 'primaryContact',
          required: false,
          attributes: ['id', 'email']
        }
      ],
      order: [['name', 'ASC']]
    });
    
    // Sort companies by type (CORP first, then SUB, then BRANCH), then by name
    const typeOrder = { 'CORP': 1, 'SUB': 2, 'BRANCH': 3 };
    const companies = companiesResult.sort((a, b) => {
      const aTypeOrder = typeOrder[a.type] || 4;
      const bTypeOrder = typeOrder[b.type] || 4;
      if (aTypeOrder !== bTypeOrder) {
        return aTypeOrder - bTypeOrder;
      }
      return a.name.localeCompare(b.name);
    });

    // Get all users assigned to companies for contact_emails
    // Use raw query for efficiency
    const companyIds = companies.map(c => c.id);
    
    let userCompanyRows = [];
    if (companyIds.length > 0) {
      // Use IN clause with proper array handling for PostgreSQL
      const placeholders = companyIds.map((_, index) => `:companyId${index}`).join(', ');
      const replacements = {};
      companyIds.forEach((id, index) => {
        replacements[`companyId${index}`] = id;
      });
      
      userCompanyRows = await sequelize.query(`
        SELECT uc."companyId", u.email
        FROM user_companies uc
        INNER JOIN users u ON u.id = uc."userId"
        WHERE uc."companyId" IN (${placeholders})
          AND u."isActive" = true
        ORDER BY uc."companyId", u.email
      `, {
        replacements: replacements,
        type: QueryTypes.SELECT
      });
    }

    // Build a map of companyId -> array of user emails
    const companyUsersMap = new Map();
    userCompanyRows.forEach(row => {
      if (row.email) {
        if (!companyUsersMap.has(row.companyId)) {
          companyUsersMap.set(row.companyId, []);
        }
        companyUsersMap.get(row.companyId).push(row.email);
      }
    });

    // Format data for export
    const exportData = companies.map(company => {
      const assignedUsers = companyUsersMap.get(company.id) || [];
      const contactEmails = assignedUsers.join(', ');
      const primaryEmail = company.primaryContact?.email || company.globalSystemEmail || '';

      return {
        id: company.id || '',
        account_no: company.referenceNo || '',
        parent_account_no: company.parent?.referenceNo || '',
        company_name: company.name || '',
        type: company.type || '',
        active: company.isActive ? 'TRUE' : 'FALSE',
        edi: company.edi ? 'TRUE' : 'FALSE',
        contact_emails: contactEmails,
        primary_email: primaryEmail
      };
    });

    if (format === 'csv') {
      // Generate CSV using Papa.parse
      const csv = Papa.unparse(exportData, {
        header: true,
        columns: ['id', 'account_no', 'parent_account_no', 'company_name', 'type', 'active', 'edi', 'contact_emails', 'primary_email']
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="companies-export-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
    } else {
      // Generate XLS/XLSX using XLSX library
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Companies');
      
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: format === 'xls' ? 'xls' : 'xlsx' });
      
      res.setHeader('Content-Type', format === 'xls' ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="companies-export-${new Date().toISOString().split('T')[0]}.${format}"`);
      res.send(buffer);
    }

    // Log export activity (fire-and-forget)
    logActivity({
      type: ActivityType.COMPANY_EXPORTED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Exported ${companies.length} companies to ${format.toUpperCase()}`,
      details: {
        format: format,
        companyCount: companies.length
      },
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    }).catch(err => console.error('Error logging export activity:', err));
  } catch (error) {
    console.error('Error exporting companies:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get company by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const company = await Company.findByPk(req.params.id, {
      include: [{
        model: Company,
        as: 'parent',
        required: false
      }, {
        model: Company,
        as: 'children',
        required: false
      }, {
        model: User,
        as: 'primaryContact',
        required: false,
        attributes: ['id', 'name', 'email', 'role', 'isActive']
      }]
    });
    
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    
    res.json(company);
  } catch (error) {
    console.error('Error fetching company:', error);
    res.status(500).json({ message: error.message });
  }
});

// Create company
router.post('/', auth, async (req, res) => {
  try {
    const {
      name,
      type,
      referenceNo,
      code,
      parentId,
      email,
      phone,
      address,
      taxId,
      vatNumber,
      website,
      isActive,
      edi,
      globalSystemEmail,
      primaryContactId,
      sendInvoiceEmail,
      sendInvoiceAttachment,
      sendStatementEmail,
      sendStatementAttachment,
      sendEmailAsSummary,
      metadata
    } = req.body;
    
    // Validation
    if (!name) {
      return res.status(400).json({ message: 'Company name is required' });
    }
    
    if (!referenceNo) {
      return res.status(400).json({ message: 'Account Number / Company Number is required' });
    }
    
    // Validate comma-separated email addresses (if globalSystemEmail provided for backwards compatibility)
    if (globalSystemEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const emailList = globalSystemEmail.split(',').map(e => e.trim()).filter(e => e);
      for (const addr of emailList) {
        if (!emailRegex.test(addr)) {
          return res.status(400).json({ message: `Invalid email address: ${addr}` });
        }
      }
    }
    
    // Verify primaryContact exists if provided
    if (primaryContactId) {
      const primaryContact = await User.findByPk(primaryContactId);
      if (!primaryContact) {
        return res.status(400).json({ message: 'Primary contact user not found' });
      }
    }
    
    
    if (type && !['CORP', 'SUB', 'BRANCH'].includes(type)) {
      return res.status(400).json({ message: 'Type must be CORP, SUB, or BRANCH' });
    }
    
    // CORP companies cannot have a parent
    if (type === 'CORP' && parentId) {
      return res.status(400).json({ message: 'CORP companies cannot have a parent' });
    }
    
    // SUB and BRANCH companies must have a parent
    if ((type === 'SUB' || type === 'BRANCH') && !parentId) {
      return res.status(400).json({ message: 'SUB and BRANCH companies must have a parent' });
    }
    
    // Verify parent exists if provided
    if (parentId) {
      const parent = await Company.findByPk(parentId);
      if (!parent) {
        return res.status(400).json({ message: 'Parent company not found' });
      }
    }
    
    const companyData = {
      name,
      type: type || null,
      referenceNo: referenceNo || null,
      code: code || null,
      parentId: parentId || null,
      email: email || null,
      globalSystemEmail: globalSystemEmail || null,
      primaryContactId: primaryContactId || null,
      sendInvoiceEmail: sendInvoiceEmail !== undefined ? sendInvoiceEmail : false,
      sendInvoiceAttachment: sendInvoiceAttachment !== undefined ? sendInvoiceAttachment : false,
      sendStatementEmail: sendStatementEmail !== undefined ? sendStatementEmail : false,
      sendStatementAttachment: sendStatementAttachment !== undefined ? sendStatementAttachment : false,
      sendEmailAsSummary: sendEmailAsSummary !== undefined ? sendEmailAsSummary : false,
      phone: phone || null,
      address: address || {},
      taxId: taxId || null,
      vatNumber: vatNumber || null,
      website: website || null,
      isActive: isActive !== undefined ? isActive : true,
      edi: edi !== undefined ? edi : false,
      metadata: metadata || {},
      createdById: req.user.userId
    };
    
    const company = await Company.create(companyData);
    
    // Queue nested set update for background processing (non-blocking)
    queueNestedSetUpdate();
    
    // Reload with associations
    await company.reload({
      include: [{
        model: Company,
        as: 'parent',
        required: false
      }]
    });
    
    // Log company creation
    await logActivity({
      type: ActivityType.COMPANY_CREATED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Created company ${company.name}`,
      details: { 
        companyId: company.id,
        companyName: company.name,
        companyType: company.type,
        referenceNo: company.referenceNo,
        parentId: company.parentId
      },
      companyId: company.id,
      companyName: company.name,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.status(201).json(company);
  } catch (error) {
    console.error('Error creating company:', error);
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ message: 'Reference number or code already exists' });
    }
    res.status(500).json({ message: error.message });
  }
});

// Bulk update all companies - Global Admin only
// NOTE: This route MUST be before /:id routes to avoid being caught by the param
router.put('/bulk-update-all', auth, globalAdmin, async (req, res) => {
  try {
    const updateData = req.body;
    
    // Only allow specific fields to be updated
    const allowedFields = [
      'edi',
      'sendInvoiceEmail',
      'sendInvoiceAttachment',
      'sendStatementEmail',
      'sendStatementAttachment'
    ];
    
    // Filter to only allowed fields
    const filteredUpdate = {};
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        filteredUpdate[field] = updateData[field];
      }
    }
    
    if (Object.keys(filteredUpdate).length === 0) {
      return res.status(400).json({ 
        message: 'No valid fields to update' 
      });
    }
    
    // Update all companies
    const [updatedCount] = await Company.update(filteredUpdate, {
      where: {}
    });
    
    // Log activity
    await logActivity({
      type: ActivityType.SETTINGS_UPDATED,
      action: `Global company settings updated: ${Object.keys(filteredUpdate).join(', ')}`,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      details: {
        updatedFields: Object.keys(filteredUpdate),
        values: filteredUpdate,
        companiesAffected: updatedCount
      },
      ipAddress: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json({ 
      message: 'All companies updated successfully',
      updated: updatedCount
    });
  } catch (error) {
    console.error('Error bulk updating companies:', error);
    res.status(500).json({ message: error.message });
  }
});

// Update company
router.put('/:id', auth, async (req, res) => {
  try {
    const company = await Company.findByPk(req.params.id);
    
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    
    const {
      name,
      type,
      referenceNo,
      code,
      parentId,
      email,
      globalSystemEmail,
      primaryContactId,
      sendInvoiceEmail,
      sendInvoiceAttachment,
      sendStatementEmail,
      sendStatementAttachment,
      sendEmailAsSummary,
      phone,
      address,
      taxId,
      vatNumber,
      website,
      isActive,
      edi,
      metadata
    } = req.body;
    
    // Verify primaryContact exists if provided
    if (primaryContactId !== undefined && primaryContactId !== null) {
      const primaryContact = await User.findByPk(primaryContactId);
      if (!primaryContact) {
        return res.status(400).json({ message: 'Primary contact user not found' });
      }
    }
    
    
    // Validation
    if (type && !['CORP', 'SUB', 'BRANCH'].includes(type)) {
      return res.status(400).json({ message: 'Type must be CORP, SUB, or BRANCH' });
    }
    
    // CORP companies cannot have a parent
    if (type === 'CORP' && parentId) {
      return res.status(400).json({ message: 'CORP companies cannot have a parent' });
    }
    
    // Prevent circular references (company cannot be its own parent)
    if (parentId === company.id) {
      return res.status(400).json({ message: 'Company cannot be its own parent' });
    }
    
    // Verify parent exists if provided
    if (parentId) {
      const parent = await Company.findByPk(parentId);
      if (!parent) {
        return res.status(400).json({ message: 'Parent company not found' });
      }
      
      // Prevent setting a descendant as parent
      if (parent.left && parent.right && company.left && company.right) {
        if (company.left >= parent.left && company.right <= parent.right) {
          return res.status(400).json({ message: 'Cannot set a descendant as parent' });
        }
      }
    }
    
    // Update fields
    if (name !== undefined) company.name = name;
    if (type !== undefined) company.type = type;
    if (referenceNo !== undefined) company.referenceNo = referenceNo;
    if (code !== undefined) company.code = code;
    if (parentId !== undefined) company.parentId = parentId;
    if (email !== undefined) company.email = email;
    if (globalSystemEmail !== undefined) {
      // Validate comma-separated email addresses
      if (globalSystemEmail && globalSystemEmail.trim()) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const emailList = globalSystemEmail.split(',').map(email => email.trim()).filter(email => email);
        for (const email of emailList) {
          if (!emailRegex.test(email)) {
            return res.status(400).json({ message: `Invalid email address: ${email}` });
          }
        }
      }
      company.globalSystemEmail = globalSystemEmail;
    }
    if (primaryContactId !== undefined) company.primaryContactId = primaryContactId;
    if (sendInvoiceEmail !== undefined) company.sendInvoiceEmail = sendInvoiceEmail;
    if (sendInvoiceAttachment !== undefined) company.sendInvoiceAttachment = sendInvoiceAttachment;
    if (sendStatementEmail !== undefined) company.sendStatementEmail = sendStatementEmail;
    if (sendStatementAttachment !== undefined) company.sendStatementAttachment = sendStatementAttachment;
    if (sendEmailAsSummary !== undefined) company.sendEmailAsSummary = sendEmailAsSummary;
    if (phone !== undefined) company.phone = phone;
    if (address !== undefined) company.address = address;
    if (taxId !== undefined) company.taxId = taxId;
    if (vatNumber !== undefined) company.vatNumber = vatNumber;
    if (website !== undefined) company.website = website;
    if (isActive !== undefined) company.isActive = isActive;
    if (edi !== undefined) company.edi = edi;
    if (metadata !== undefined) company.metadata = metadata;
    
    const oldParentId = company.parentId;
    const oldIsActive = company.isActive;
    const wasMoved = company.changed('parentId');
    const wasDeactivated = oldIsActive && !company.isActive;
    
    await company.save();
    
    // Queue nested set update if parent changed (non-blocking)
    if (wasMoved) {
      queueNestedSetUpdate();
    }
    
    // Determine activity type and log
    let activityType = ActivityType.COMPANY_UPDATED;
    let action = `Updated company ${company.name}`;
    
    if (wasMoved) {
      activityType = ActivityType.COMPANY_MOVED;
      action = `Moved company ${company.name}${oldParentId ? ' to new parent' : ' (removed from parent)'}`;
    } else if (wasDeactivated) {
      activityType = ActivityType.COMPANY_DEACTIVATED;
      action = `Deactivated company ${company.name}`;
    } else if (!oldIsActive && company.isActive) {
      activityType = ActivityType.COMPANY_UPDATED;
      action = `Activated company ${company.name}`;
    }
    
    // Log company update/move/deactivation
    await logActivity({
      type: activityType,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: action,
      details: { 
        companyId: company.id,
        companyName: company.name,
        changes: {
          name: company.changed('name') ? req.body.name : undefined,
          type: company.changed('type') ? req.body.type : undefined,
          referenceNo: company.changed('referenceNo') ? req.body.referenceNo : undefined,
          parentId: wasMoved ? { from: oldParentId, to: company.parentId } : undefined,
          isActive: company.changed('isActive') ? { from: oldIsActive, to: company.isActive } : undefined
        }
      },
      companyId: company.id,
      companyName: company.name,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    // Reload with associations
    await company.reload({
      include: [{
        model: Company,
        as: 'parent',
        required: false
      }, {
        model: Company,
        as: 'children',
        required: false
      }]
    });
    
    res.json(company);
  } catch (error) {
    console.error('Error updating company:', error);
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ message: 'Reference number or code already exists' });
    }
    res.status(500).json({ message: error.message });
  }
});

// Purge all companies - Global Admin only
router.delete('/purge-all', auth, globalAdmin, async (req, res) => {
  try {
    const { reason } = req.body;
    
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ 
        message: 'A reason is required for purging all companies' 
      });
    }

    // Get count before deletion
    const totalCount = await Company.count();
    
    if (totalCount === 0) {
      return res.status(400).json({ 
        message: 'No companies to purge' 
      });
    }

    // Delete all companies (cascade will handle related records)
    await Company.destroy({ 
      where: {},
      force: true // Hard delete
    });

    // Clear nested set indexes (they'll be recalculated on next import)
    await sequelize.query('UPDATE companies SET "left" = NULL, "right" = NULL WHERE "left" IS NOT NULL OR "right" IS NOT NULL');

    // Log activity
    await logActivity({
      type: ActivityType.COMPANY_DELETED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Purged all ${totalCount} companies from system`,
      details: {
        totalDeleted: totalCount,
        reason: reason.trim()
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });

    res.json({
      message: `Successfully purged ${totalCount} companies from the system`,
      deleted: totalCount
    });
  } catch (error) {
    console.error('Error purging companies:', error);
    res.status(500).json({ message: error.message });
  }
});

// Delete company - GA + Admin + Manager only
router.delete('/:id', requirePermission('COMPANIES_DELETE'), async (req, res) => {
  try {
    const company = await Company.findByPk(req.params.id);
    
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    
    // Check if company has children
    const children = await Company.count({ where: { parentId: company.id } });
    if (children > 0) {
      return res.status(400).json({ 
        message: 'Cannot delete company with children. Please delete or reassign children first.' 
      });
    }
    
    // Store company info before deletion
    const deletedCompanyName = company.name;
    const deletedCompanyId = company.id;
    
    await company.destroy();
    
    // Queue nested set update after deletion (non-blocking)
    queueNestedSetUpdate();
    
    // Log company deletion
    await logActivity({
      type: ActivityType.COMPANY_DELETED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Deleted company ${deletedCompanyName}`,
      details: { 
        companyId: deletedCompanyId,
        companyName: deletedCompanyName,
        companyType: company.type,
        referenceNo: company.referenceNo
      },
      companyId: deletedCompanyId,
      companyName: deletedCompanyName,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json({ message: 'Company deleted successfully' });
  } catch (error) {
    console.error('Error deleting company:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get company hierarchy (all descendants)
router.get('/:id/hierarchy', auth, async (req, res) => {
  try {
    const company = await Company.findByPk(req.params.id);
    
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    
    // If company has nested set indexes, use them for efficient query
    if (company.left && company.right) {
      const descendants = await Company.findAll({
        where: {
          left: { [Op.gte]: company.left },
          right: { [Op.lte]: company.right },
          id: { [Op.ne]: company.id } // Exclude the company itself
        },
        order: [['left', 'ASC']]
      });
      
      return res.json(descendants);
    }
    
    // Fallback: recursive query if nested set not initialized
    const descendants = [];
    const getChildren = async (parentId) => {
      const children = await Company.findAll({ where: { parentId } });
      for (const child of children) {
        descendants.push(child);
        await getChildren(child.id);
      }
    };
    
    await getChildren(company.id);
    res.json(descendants);
  } catch (error) {
    console.error('Error fetching company hierarchy:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get all related companies (ancestors and descendants) in nested structure
router.get('/:id/relationships', auth, async (req, res) => {
  try {
    const company = await Company.findByPk(req.params.id, {
      include: [{
        model: Company,
        as: 'parent',
        required: false
      }]
    });
    
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    
    // Get all ancestors (parent chain)
    const ancestors = [];
    let currentParent = company.parent;
    while (currentParent) {
      const parentWithParent = await Company.findByPk(currentParent.id, {
        include: [{
          model: Company,
          as: 'parent',
          required: false
        }]
      });
      ancestors.unshift(parentWithParent); // Add to beginning to maintain order
      currentParent = parentWithParent.parent;
    }
    
    // Get all descendants (children recursively)
    const getChildrenRecursive = async (parentId, level = 0) => {
      const children = await Company.findAll({
        where: { parentId },
        order: [['name', 'ASC']]
      });
      
      const result = [];
      for (const child of children) {
        const childWithChildren = {
          id: child.id,
          name: child.name,
          type: child.type,
          referenceNo: child.referenceNo,
          code: child.code,
          isActive: child.isActive,
          level: level,
          children: await getChildrenRecursive(child.id, level + 1)
        };
        result.push(childWithChildren);
      }
      return result;
    };
    
    const descendants = await getChildrenRecursive(company.id);
    
    res.json({
      company: {
        id: company.id,
        name: company.name,
        type: company.type,
        referenceNo: company.referenceNo,
        code: company.code,
        email: company.email,
        phone: company.phone,
        address: company.address,
        taxId: company.taxId,
        vatNumber: company.vatNumber,
        website: company.website,
        isActive: company.isActive,
        edi: company.edi,
        globalSystemEmail: company.globalSystemEmail,
        primaryContactId: company.primaryContactId,
        sendInvoiceEmail: company.sendInvoiceEmail,
        sendInvoiceAttachment: company.sendInvoiceAttachment,
        sendStatementEmail: company.sendStatementEmail,
        sendStatementAttachment: company.sendStatementAttachment,
        sendEmailAsSummary: company.sendEmailAsSummary,
        metadata: company.metadata
      },
      ancestors: ancestors.map(a => ({
        id: a.id,
        name: a.name,
        type: a.type,
        referenceNo: a.referenceNo,
        code: a.code,
        isActive: a.isActive
      })),
      descendants: descendants,
      hasChildren: descendants.length > 0,
      hasParent: ancestors.length > 0
    });
  } catch (error) {
    console.error('Error fetching company relationships:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get all root companies (CORP companies without parents)
router.get('/roots/corps', auth, async (req, res) => {
  try {
    const corps = await Company.findAll({
      where: {
        [Op.or]: [
          { type: 'CORP' },
          { parentId: null }
        ]
      },
      order: [['name', 'ASC']]
    });
    
    res.json(corps);
  } catch (error) {
    console.error('Error fetching root companies:', error);
    res.status(500).json({ message: error.message });
  }
});

// Import companies from file (CSV, XLS, XLSX, JSON) - Admin only
// Helper function to parse and validate CSV data
async function parseAndValidateImportFile(file) {
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
  } else if (fileExtension === 'json') {
    const jsonText = file.buffer.toString('utf8');
    rows = JSON.parse(jsonText);
    if (!Array.isArray(rows)) {
      throw new Error('JSON file must contain an array of objects');
    }
  } else {
    throw new Error('Unsupported file format');
  }

  if (!rows || rows.length === 0) {
    throw new Error('File is empty or contains no data');
  }

  return rows;
}

// Helper function to process a single row and return preview data
async function processRowForPreview(row, rowNum, existingCompaniesMap, csvCompaniesMap = null, existingUsersMap = null, existingCompaniesByIdMap = null) {
  const result = {
    rowNum,
    status: 'valid', // 'valid', 'warning', 'error'
    errors: [],
    warnings: [],
    action: 'create', // 'create' or 'update'
    data: {},
    existingData: null,
    primaryEmail: null,
    userAction: null // 'create', 'existing', or null
  };

  try {
    // Map column names (support both new and old formats)
    const name = row['company_name'] || row['CNME'] || row['Name'] || row['name'] || row['Company Name'] || '';
    const type = (row['type'] || row['TYPE'] || row['Type'] || '').toUpperCase();
    const referenceNo = row['account_no'] || row['CUSTOMER'] || row['Reference No'] || row['referenceNo'] || row['reference_no'] || row['ReferenceNo'] || null;
    const parentRef = row['parent_account_no'] || row['PARENT'] || row['Parent'] || row['parent'] || row['Parent Reference'] || null;
    const primaryEmail = row['primary_email'] || row['Email Address'] || row['email'] || row['Email'] || row['globalSystemEmail'] || '';
    const statements = row['Statements'] || row['statements'] || '';
    const invoices = row['Invoices / Credit'] || row['Invoices / Credit'] || row['invoices'] || '';
    
    // EDI handling - support TRUE/FALSE strings and boolean
    let ediValue = row['edi'] || row['EDI'] || row['Enable EDI'] || false;
    const edi = ediValue === true || ediValue === 'TRUE' || ediValue === 'true' || ediValue === 'Y' || ediValue === 'Yes' || ediValue === '1' || ediValue === 1;
    
    // Active handling - support TRUE/FALSE strings and boolean
    let activeValue = row['active'];
    if (activeValue === undefined) activeValue = row['Active'];
    if (activeValue === undefined) activeValue = true;
    const isActive = activeValue === true || activeValue === 'TRUE' || activeValue === 'true' || activeValue === 'Y' || activeValue === 'Yes' || activeValue === '1' || activeValue === 1;

    // Validate required fields
    if (!name || !name.trim()) {
      result.status = 'error';
      result.errors.push('Company name is required');
      return result;
    }

    if (!type || !['CORP', 'SUB', 'BRANCH'].includes(type)) {
      result.status = 'error';
      result.errors.push('Type must be CORP, SUB, or BRANCH');
      return result;
    }

    // Determine if this is a top-level company (CORP)
    // Top-level if: empty parent_account_no OR parent_account_no equals account_no
    let parentId = null;
    let parentName = null;
    const isTopLevel = !parentRef || parentRef === '' || (referenceNo && parentRef.toString() === referenceNo.toString());
    
    if (isTopLevel) {
      // This is a top-level parent company
      if (type !== 'CORP') {
        result.warnings.push('No parent reference or self-referencing, treated as top-level CORP.');
      }
    } else if (type !== 'CORP') {
      const parentRefNum = parseInt(parentRef);
      if (!isNaN(parentRefNum)) {
        // First check if parent exists in database
        const parent = existingCompaniesMap.get(parentRefNum);
        if (parent) {
          parentId = parent.id;
          parentName = parent.name;
        } else if (csvCompaniesMap) {
          // Check if parent is in the CSV file (will be created/updated in this import)
          const csvParent = csvCompaniesMap.get(parentRefNum);
          if (csvParent) {
            parentName = csvParent.name;
            // Parent will be created in this import, so it's fine
          } else {
            result.warnings.push(`Parent company with account number ${parentRefNum} not found in existing companies or import file. Will need to be created first or import may fail.`);
          }
        } else {
          result.warnings.push(`Parent company with account number ${parentRefNum} not found in existing companies. Will need to be created first or import may fail.`);
        }
      } else {
        result.warnings.push(`Invalid parent account number: ${parentRef}`);
      }
    }

    // Check if company already exists
    const refNo = referenceNo ? parseInt(referenceNo) : null;
    let existingCompany = null;
    if (refNo) {
      existingCompany = existingCompaniesMap.get(refNo);
    }

    // Determine final type (force CORP for top-level)
    const finalType = isTopLevel ? 'CORP' : type;

    // Prepare company data
    const companyData = {
      name: name.trim(),
      type: finalType,
      referenceNo: refNo,
      edi: edi,
      isActive: isActive,
      parentId: parentId,
      // If EDI is enabled, disable all email notifications
      sendInvoiceEmail: edi ? false : undefined,
      sendInvoiceAttachment: edi ? false : undefined,
      sendStatementEmail: edi ? false : undefined,
      sendStatementAttachment: edi ? false : undefined,
      sendEmailAsSummary: edi ? false : undefined,
      metadata: {
        receivesStatements: statements === 'Y' || statements === 'y' || statements === 'Yes' || statements === '1',
        receivesInvoices: invoices === 'Y' || invoices === 'y' || invoices === 'Yes' || invoices === '1'
      }
    };

    result.data = companyData;
    result.parentName = parentName;
    result.parentRefNum = isTopLevel ? null : (parentRef ? parseInt(parentRef) : null);

    // Handle primary email - check if user exists or will be created
    if (primaryEmail && primaryEmail.trim()) {
      const emailLower = primaryEmail.trim().toLowerCase();
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(emailLower)) {
        result.primaryEmail = emailLower;
        // Check if user already exists
        if (existingUsersMap && existingUsersMap.has(emailLower)) {
          result.userAction = 'existing';
        } else {
          result.userAction = 'create';
        }
      } else {
        result.warnings.push(`Invalid email format: ${primaryEmail}`);
      }
    }

    if (existingCompany) {
      result.action = 'update';
      result.existingData = {
        name: existingCompany.name,
        type: existingCompany.type,
        referenceNo: existingCompany.referenceNo,
        globalSystemEmail: existingCompany.globalSystemEmail,
        edi: existingCompany.edi,
        isActive: existingCompany.isActive,
        parentId: existingCompany.parentId,
        parentName: existingCompany.parent?.name || null
      };
    } else {
      result.action = 'create';
    }

    if (result.warnings.length > 0) {
      result.status = 'warning';
    }

  } catch (error) {
    result.status = 'error';
    result.errors.push(error.message);
  }

  return result;
}

// Preview import endpoint - parses CSV and returns preview without importing
router.post('/import/preview', auth, upload.single('file'), async (req, res) => {
  // Check if user is administrator
  if (req.user.role !== 'global_admin' && req.user.role !== 'administrator') {
    return res.status(403).json({ 
      message: 'Access denied. Administrator privileges required.' 
    });
  }

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Parse file and get column names
    const file = req.file;
    const fileExtension = file.originalname.split('.').pop().toLowerCase();
    let columnNames = [];
    
    if (fileExtension === 'csv') {
      const csvText = file.buffer.toString('utf8');
      const result = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: false,
        transformHeader: (header) => header.trim()
      });
      columnNames = result.meta.fields || [];
    } else if (fileExtension === 'xls' || fileExtension === 'xlsx') {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      columnNames = [];
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        const cell = worksheet[cellAddress];
        if (cell && cell.v) {
          columnNames.push(cell.v.toString().trim());
        }
      }
    }
    
    const rows = await parseAndValidateImportFile(req.file);

    // Get all existing companies by referenceNo and ID for matching
    const existingCompanies = await Company.findAll({
      include: [{
        model: Company,
        as: 'parent',
        attributes: ['id', 'name'],
        required: false
      }]
    });

    const existingCompaniesMap = new Map(); // Map by referenceNo (for backwards compatibility)
    const existingCompaniesByIdMap = new Map(); // Map by ID
    existingCompanies.forEach(company => {
      if (company.referenceNo) {
        existingCompaniesMap.set(company.referenceNo, company);
      }
      existingCompaniesByIdMap.set(company.id, company);
    });

    // Get all existing users by email for primary contact matching
    const existingUsers = await User.findAll({
      attributes: ['id', 'email', 'name', 'role']
    });
    const existingUsersMap = new Map();
    existingUsers.forEach(user => {
      if (user.email) {
        existingUsersMap.set(user.email.toLowerCase(), user);
      }
    });

    // Sort rows by TYPE: CORP first, then SUB, then BRANCH
    // This ensures parent records exist before children
    const typeOrder = { 'CORP': 0, 'SUB': 1, 'BRANCH': 2 };
    const sortedRows = rows.map((row, index) => ({ row, originalIndex: index + 2 })).sort((a, b) => {
      const aType = (a.row['type'] || a.row['TYPE'] || a.row['Type'] || '').toUpperCase();
      const bType = (b.row['type'] || b.row['TYPE'] || b.row['Type'] || '').toUpperCase();
      
      const aRef = a.row['account_no'] || a.row['CUSTOMER'] || a.row['Reference No'] || a.row['referenceNo'] || '';
      const aParent = a.row['parent_account_no'] || a.row['PARENT'] || a.row['Parent'] || a.row['parent'] || '';
      
      const bRef = b.row['account_no'] || b.row['CUSTOMER'] || b.row['Reference No'] || b.row['referenceNo'] || '';
      const bParent = b.row['parent_account_no'] || b.row['PARENT'] || b.row['Parent'] || b.row['parent'] || '';
      
      // Check if company is a top-level parent (empty parent or self-referencing)
      const aIsTopLevel = !aParent || aParent === '' || (aRef && aParent.toString() === aRef.toString());
      const bIsTopLevel = !bParent || bParent === '' || (bRef && bParent.toString() === bRef.toString());
      
      // Top-level (CORP) companies come first
      if (aIsTopLevel && !bIsTopLevel) return -1;
      if (!aIsTopLevel && bIsTopLevel) return 1;
      
      // Then sort by type order
      const aOrder = typeOrder[aType] !== undefined ? typeOrder[aType] : 3;
      const bOrder = typeOrder[bType] !== undefined ? typeOrder[bType] : 3;
      
      return aOrder - bOrder;
    });

    // Build a map of companies from the CSV file (for parent lookup)
    const csvCompaniesMap = new Map();
    
    // First pass: build the map of companies that will be in the CSV
    for (let i = 0; i < sortedRows.length; i++) {
      const { row } = sortedRows[i];
      const referenceNo = row['account_no'] || row['CUSTOMER'] || row['Reference No'] || row['referenceNo'] || row['reference_no'] || row['ReferenceNo'] || null;
      const name = row['company_name'] || row['CNME'] || row['Name'] || row['name'] || row['Company Name'] || '';
      const type = (row['type'] || row['TYPE'] || row['Type'] || '').toUpperCase();
      
      if (referenceNo) {
        const refNo = parseInt(referenceNo);
        if (!isNaN(refNo) && name && name.trim()) {
          csvCompaniesMap.set(refNo, {
            name: name.trim(),
            referenceNo: refNo,
            type: type
          });
        }
      }
    }

    // Process each row for preview
    const previewData = [];
    const uniqueEmails = new Set();
    const summary = {
      total: rows.length,
      toCreate: 0,
      toUpdate: 0,
      errors: 0,
      warnings: 0,
      usersToCreate: 0,
      ediEnabled: 0
    };

    for (let i = 0; i < sortedRows.length; i++) {
      const { row, originalIndex: rowNum } = sortedRows[i];
      
      const processed = await processRowForPreview(row, rowNum, existingCompaniesMap, csvCompaniesMap, existingUsersMap, existingCompaniesByIdMap);
      previewData.push(processed);

      // Track unique emails to create
      if (processed.primaryEmail && processed.userAction === 'create') {
        uniqueEmails.add(processed.primaryEmail);
      }

      // Track EDI enabled count
      if (processed.data.edi) {
        summary.ediEnabled++;
      }

      if (processed.status === 'error') {
        summary.errors++;
      } else if (processed.status === 'warning') {
        summary.warnings++;
        if (processed.action === 'create') {
          summary.toCreate++;
        } else {
          summary.toUpdate++;
        }
      } else {
        if (processed.action === 'create') {
          summary.toCreate++;
        } else {
          summary.toUpdate++;
        }
      }
    }

    summary.usersToCreate = uniqueEmails.size;

    // Column mapping descriptions (support both old and new formats)
    const columnMappings = {
      'id': 'Database ID (UUID) - Primary matching key, falls back to account_no if not present',
      'account_no': 'Account Number - Unique identifier for the company (fallback matching key)',
      'parent_account_no': 'Parent Account Number - Empty for top-level CORP, otherwise references parent',
      'company_name': 'Company Name - Required',
      'type': 'Company Type - CORP (Corporate/Parent), SUB (Subsidiary), or BRANCH',
      'active': 'Active Status - TRUE or FALSE',
      'edi': 'EDI Enabled - TRUE or FALSE (if TRUE, email notifications are disabled)',
      'primary_email': 'Primary Email Contact - Creates notification contact user',
      // Legacy column names for backward compatibility
      'CUSTOMER': 'Account Number (legacy)',
      'PARENT': 'Parent Account Number (legacy)',
      'CNME': 'Company Name (legacy)',
      'TYPE': 'Company Type (legacy)'
    };

    res.json({
      preview: previewData,
      summary,
      totalRows: rows.length,
      columnNames: columnNames,
      columnMappings: columnMappings
    });

  } catch (error) {
    console.error('Error previewing import:', error);
    res.status(400).json({ message: error.message });
  }
});

router.post('/import', auth, upload.single('file'), async (req, res) => {
  // Check if user is administrator
  if (req.user.role !== 'global_admin' && req.user.role !== 'administrator') {
    return res.status(403).json({ 
      message: 'Access denied. Administrator privileges required.' 
    });
  }

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Parse file
    const rows = await parseAndValidateImportFile(req.file);

    // Get all existing companies by referenceNo for matching
    const existingCompanies = await Company.findAll({
      include: [{
        model: Company,
        as: 'parent',
        attributes: ['id', 'name'],
        required: false
      }]
    });

    const existingCompaniesMap = new Map();
    existingCompanies.forEach(company => {
      if (company.referenceNo) {
        existingCompaniesMap.set(company.referenceNo, company);
      }
    });

    // Get all existing users by email
    const existingUsers = await User.findAll({
      attributes: ['id', 'email', 'name', 'role']
    });
    const existingUsersMap = new Map();
    existingUsers.forEach(user => {
      if (user.email) {
        existingUsersMap.set(user.email.toLowerCase(), user);
      }
    });

    // Sort rows by TYPE: CORP first, then SUB, then BRANCH
    const typeOrder = { 'CORP': 0, 'SUB': 1, 'BRANCH': 2 };
    const sortedRows = rows.map((row, index) => ({ row, originalIndex: index + 2 })).sort((a, b) => {
      const aType = (a.row['type'] || a.row['TYPE'] || a.row['Type'] || '').toUpperCase();
      const bType = (b.row['type'] || b.row['TYPE'] || b.row['Type'] || '').toUpperCase();
      
      const aRef = a.row['account_no'] || a.row['CUSTOMER'] || a.row['Reference No'] || a.row['referenceNo'] || '';
      const aParent = a.row['parent_account_no'] || a.row['PARENT'] || a.row['Parent'] || a.row['parent'] || '';
      
      const bRef = b.row['account_no'] || b.row['CUSTOMER'] || b.row['Reference No'] || b.row['referenceNo'] || '';
      const bParent = b.row['parent_account_no'] || b.row['PARENT'] || b.row['Parent'] || b.row['parent'] || '';
      
      // Check if company is a top-level parent
      const aIsTopLevel = !aParent || aParent === '' || (aRef && aParent.toString() === aRef.toString());
      const bIsTopLevel = !bParent || bParent === '' || (bRef && bParent.toString() === bRef.toString());
      
      if (aIsTopLevel && !bIsTopLevel) return -1;
      if (!aIsTopLevel && bIsTopLevel) return 1;
      
      const aOrder = typeOrder[aType] !== undefined ? typeOrder[aType] : 3;
      const bOrder = typeOrder[bType] !== undefined ? typeOrder[bType] : 3;
      
      return aOrder - bOrder;
    });

    // Track import transaction for UNDO
    const createdCompanyIds = [];
    const updatedCompaniesData = [];
    const createdUserIds = [];

    // Validate and import companies
    const results = {
      created: 0,
      updated: 0,
      usersCreated: 0,
      errors: []
    };

    for (let i = 0; i < sortedRows.length; i++) {
      const { row, originalIndex: rowNum } = sortedRows[i];
      try {
        // Map column names (support both new and old formats)
        const name = row['company_name'] || row['CNME'] || row['Name'] || row['name'] || row['Company Name'] || '';
        const type = (row['type'] || row['TYPE'] || row['Type'] || '').toUpperCase();
        const referenceNo = row['account_no'] || row['CUSTOMER'] || row['Reference No'] || row['referenceNo'] || row['reference_no'] || row['ReferenceNo'] || null;
        const parentRef = row['parent_account_no'] || row['PARENT'] || row['Parent'] || row['parent'] || row['Parent Reference'] || null;
        const primaryEmail = row['primary_email'] || row['Email Address'] || row['email'] || row['Email'] || row['globalSystemEmail'] || '';
        const statements = row['Statements'] || row['statements'] || '';
        const invoices = row['Invoices / Credit'] || row['Invoices / Credit'] || row['invoices'] || '';
        
        // EDI handling
        let ediValue = row['edi'] || row['EDI'] || row['Enable EDI'] || false;
        const edi = ediValue === true || ediValue === 'TRUE' || ediValue === 'true' || ediValue === 'Y' || ediValue === 'Yes' || ediValue === '1' || ediValue === 1;
        
        // Active handling
        let activeValue = row['active'];
        if (activeValue === undefined) activeValue = row['Active'];
        if (activeValue === undefined) activeValue = true;
        const isActive = activeValue === true || activeValue === 'TRUE' || activeValue === 'true' || activeValue === 'Y' || activeValue === 'Yes' || activeValue === '1' || activeValue === 1;

        // Validate required fields
        if (!name || !name.trim()) {
          results.errors.push(`Row ${rowNum}: Company name is required`);
          continue;
        }

        if (!type || !['CORP', 'SUB', 'BRANCH'].includes(type)) {
          results.errors.push(`Row ${rowNum}: Type must be CORP, SUB, or BRANCH`);
          continue;
        }

        // Determine if this is a top-level company
        const isTopLevel = !parentRef || parentRef === '' || (referenceNo && parentRef.toString() === referenceNo.toString());
        
        // Handle parent company logic
        let parentId = null;
        let finalType = isTopLevel ? 'CORP' : type;
        
        if (!isTopLevel && type !== 'CORP') {
          const parentRefNum = parseInt(parentRef);
          if (!isNaN(parentRefNum)) {
            const parent = existingCompaniesMap.get(parentRefNum);
            if (parent) {
              parentId = parent.id;
            } else {
              // Try to find parent in database (might have been created earlier in this import)
              const parentCompany = await Company.findOne({
                where: { referenceNo: parentRefNum }
              });
              if (parentCompany) {
                parentId = parentCompany.id;
              } else {
                results.errors.push(`Row ${rowNum}: Parent company with account number ${parentRefNum} not found`);
                continue;
              }
            }
          } else {
            results.errors.push(`Row ${rowNum}: Invalid parent account number: ${parentRef}`);
            continue;
          }
        }

        // Prepare company data
        const companyData = {
          name: name.trim(),
          type: finalType,
          referenceNo: referenceNo ? parseInt(referenceNo) : null,
          edi: edi,
          isActive: isActive,
          parentId: parentId,
          createdById: req.user.userId
        };

        // If EDI is enabled, disable all email notifications
        if (edi) {
          companyData.sendInvoiceEmail = false;
          companyData.sendInvoiceAttachment = false;
          companyData.sendStatementEmail = false;
          companyData.sendStatementAttachment = false;
          companyData.sendEmailAsSummary = false;
        }

        // Merge metadata
        const metadata = {
          receivesStatements: statements === 'Y' || statements === 'y' || statements === 'Yes' || statements === '1',
          receivesInvoices: invoices === 'Y' || invoices === 'y' || invoices === 'Yes' || invoices === '1'
        };
        companyData.metadata = metadata;

        // Check if company exists - try ID first, then fall back to referenceNo
        let existingCompany = null;
        
        // Try to match by ID first (if present and valid UUID)
        if (companyId && typeof companyId === 'string' && companyId.trim()) {
          const idTrimmed = companyId.trim();
          // Basic UUID format validation (8-4-4-4-12 hex characters)
          const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (uuidRegex.test(idTrimmed)) {
            existingCompany = existingCompaniesByIdMap.get(idTrimmed);
            if (!existingCompany) {
              existingCompany = await Company.findByPk(idTrimmed);
            }
          }
        }
        
        // Fall back to referenceNo matching if ID not found or not present
        if (!existingCompany) {
          const refNo = referenceNo ? parseInt(referenceNo) : null;
          if (refNo) {
            existingCompany = existingCompaniesMap.get(refNo);
            if (!existingCompany) {
              existingCompany = await Company.findOne({
                where: { referenceNo: refNo }
              });
            }
          }
        }

        let company;
        if (existingCompany) {
          // Store previous data for UNDO
          const previousData = {
            name: existingCompany.name,
            type: existingCompany.type,
            referenceNo: existingCompany.referenceNo,
            globalSystemEmail: existingCompany.globalSystemEmail,
            edi: existingCompany.edi,
            isActive: existingCompany.isActive,
            parentId: existingCompany.parentId,
            primaryContactId: existingCompany.primaryContactId,
            sendInvoiceEmail: existingCompany.sendInvoiceEmail,
            sendStatementEmail: existingCompany.sendStatementEmail,
            metadata: existingCompany.metadata || {}
          };

          // Update existing company
          await existingCompany.update(companyData);
          company = existingCompany;
          updatedCompaniesData.push({
            companyId: existingCompany.id,
            previousData: previousData
          });
          results.updated++;
        } else {
          // Create new company
          company = await Company.create(companyData);
          createdCompanyIds.push(company.id);
          // Add to map for potential child companies
          if (company.referenceNo) {
            existingCompaniesMap.set(company.referenceNo, company);
          }
          results.created++;
        }

        // Handle primary email - create notification_contact user if needed
        if (primaryEmail && primaryEmail.trim()) {
          const emailLower = primaryEmail.trim().toLowerCase();
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          
          if (emailRegex.test(emailLower)) {
            let user = existingUsersMap.get(emailLower);
            
            if (!user) {
              // Create new notification_contact user
              try {
                user = await User.create({
                  name: emailLower.split('@')[0], // Use email prefix as name
                  email: emailLower,
                  role: 'notification_contact',
                  password: null, // No password needed
                  isActive: true,
                  addedById: req.user.userId,
                  // Don't enable notifications by default
                  sendInvoiceEmail: false,
                  sendInvoiceAttachment: false,
                  sendStatementEmail: false,
                  sendStatementAttachment: false,
                  sendEmailAsSummary: false,
                  allCompanies: false
                });
                existingUsersMap.set(emailLower, user);
                createdUserIds.push(user.id);
                results.usersCreated++;
              } catch (userError) {
                // User might already exist (race condition), try to find it
                user = await User.findOne({ where: { email: emailLower } });
                if (user) {
                  existingUsersMap.set(emailLower, user);
                } else {
                  results.errors.push(`Row ${rowNum}: Failed to create user for ${emailLower}: ${userError.message}`);
                }
              }
            }

            // Set as primary contact and create UserCompany association
            if (user) {
              await company.update({ primaryContactId: user.id });
              
              // Create UserCompany association if not exists
              const existingAssoc = await UserCompany.findOne({
                where: { userId: user.id, companyId: company.id }
              });
              if (!existingAssoc) {
                await UserCompany.create({
                  userId: user.id,
                  companyId: company.id
                });
              }
            }
          }
        }
      } catch (error) {
        results.errors.push(`Row ${rowNum}: ${error.message}`);
        console.error(`Error processing row ${rowNum}:`, error);
      }
    }

    // Queue nested set update after import (non-blocking)
    queueNestedSetUpdate();

    // Create import transaction record for UNDO capability
    let importTransaction = null;
    if (createdCompanyIds.length > 0 || updatedCompaniesData.length > 0 || createdUserIds.length > 0) {
      importTransaction = await ImportTransaction.create({
        userId: req.user.userId,
        type: 'company_import',
        createdCompanies: createdCompanyIds,
        updatedCompanies: updatedCompaniesData,
        importData: {
          fileName: req.file.originalname,
          totalRows: rows.length,
          timestamp: new Date().toISOString(),
          createdUserIds: createdUserIds // Track created users for potential undo
        },
        status: 'completed'
      });
    }

    // Log activity
    await logActivity({
      type: ActivityType.COMPANY_IMPORTED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Imported companies from CSV: ${results.created} created, ${results.updated} updated, ${results.usersCreated} users created`,
      details: {
        created: results.created,
        updated: results.updated,
        usersCreated: results.usersCreated,
        errors: results.errors.length,
        totalRows: rows.length,
        transactionId: importTransaction?.id
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });

    res.json({
      message: `Import completed. Created: ${results.created}, Updated: ${results.updated}, Users: ${results.usersCreated}`,
      created: results.created,
      updated: results.updated,
      usersCreated: results.usersCreated,
      errors: results.errors,
      totalRows: rows.length,
      transactionId: importTransaction?.id
    });
  } catch (error) {
    console.error('Error importing companies:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get last import transaction endpoint - returns the most recent import that can be undone
router.get('/import/last', auth, async (req, res) => {
  // Check if user is administrator
  if (req.user.role !== 'global_admin' && req.user.role !== 'administrator') {
    return res.status(403).json({ 
      message: 'Access denied. Administrator privileges required.' 
    });
  }

  try {
    // Find the most recent import transaction that hasn't been undone
    // Global admins can see all imports, regular admins can only see their own
    const whereClause = {
      type: 'company_import',
      status: 'completed'
    };

    if (req.user.role !== 'global_admin') {
      whereClause.userId = req.user.userId;
    }

    const lastImport = await ImportTransaction.findOne({
      where: whereClause,
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'name', 'email']
      }],
      order: [['createdAt', 'DESC']]
    });

    // Return 200 with null if no import found (instead of 404 to avoid console errors)
    if (!lastImport) {
      return res.status(200).json(null);
    }

    res.json({
      id: lastImport.id,
      createdAt: lastImport.createdAt,
      createdCompanies: lastImport.createdCompanies,
      updatedCompanies: lastImport.updatedCompanies,
      importData: lastImport.importData,
      user: lastImport.user ? {
        id: lastImport.user.id,
        name: lastImport.user.name,
        email: lastImport.user.email
      } : null
    });
  } catch (error) {
    console.error('Error fetching last import:', error);
    res.status(500).json({ message: error.message });
  }
});

// UNDO import endpoint - rollback an import transaction
router.post('/import/:transactionId/undo', auth, async (req, res) => {
  // Check if user is administrator
  if (req.user.role !== 'global_admin' && req.user.role !== 'administrator') {
    return res.status(403).json({ 
      message: 'Access denied. Administrator privileges required.' 
    });
  }

  try {
    const { transactionId } = req.params;

    // Find import transaction
    const importTransaction = await ImportTransaction.findByPk(transactionId, {
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'name', 'email']
      }]
    });

    if (!importTransaction) {
      return res.status(404).json({ message: 'Import transaction not found' });
    }

    // Check if already undone
    if (importTransaction.status === 'undone') {
      return res.status(400).json({ message: 'This import has already been undone' });
    }

    // Verify user has permission (only the user who created it or global admin can undo)
    if (importTransaction.userId !== req.user.userId && req.user.role !== 'global_admin') {
      return res.status(403).json({ 
        message: 'Access denied. You can only undo your own imports.' 
      });
    }

    const results = {
      deleted: 0,
      restored: 0,
      errors: []
    };

    // Delete created companies
    if (importTransaction.createdCompanies && importTransaction.createdCompanies.length > 0) {
      for (const companyId of importTransaction.createdCompanies) {
        try {
          const company = await Company.findByPk(companyId);
          if (company) {
            await company.destroy({ force: true }); // Hard delete
            results.deleted++;
          }
        } catch (error) {
          results.errors.push(`Failed to delete company ${companyId}: ${error.message}`);
          console.error(`Error deleting company ${companyId}:`, error);
        }
      }
    }

    // Restore updated companies
    if (importTransaction.updatedCompanies && importTransaction.updatedCompanies.length > 0) {
      for (const updateData of importTransaction.updatedCompanies) {
        try {
          const company = await Company.findByPk(updateData.companyId);
          if (company && updateData.previousData) {
            await company.update(updateData.previousData);
            results.restored++;
          } else if (!company) {
            results.errors.push(`Company ${updateData.companyId} not found for restoration`);
          }
        } catch (error) {
          results.errors.push(`Failed to restore company ${updateData.companyId}: ${error.message}`);
          console.error(`Error restoring company ${updateData.companyId}:`, error);
        }
      }
    }

    // Queue nested set update after undo (non-blocking)
    queueNestedSetUpdate();

    // Mark transaction as undone
    await importTransaction.update({ status: 'undone' });

    // Log activity
    await logActivity({
      type: ActivityType.COMPANY_IMPORT_UNDONE,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Undid company import: ${results.deleted} deleted, ${results.restored} restored`,
      details: {
        transactionId: importTransaction.id,
        deleted: results.deleted,
        restored: results.restored,
        errors: results.errors.length
      },
      companyId: null,
      companyName: null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });

    res.json({
      message: `Import undone. Deleted: ${results.deleted}, Restored: ${results.restored}`,
      deleted: results.deleted,
      restored: results.restored,
      errors: results.errors
    });
  } catch (error) {
    console.error('Error undoing import:', error);
    res.status(500).json({ message: error.message });
  }
});

// Quick-create a Notification Contact user for a company
// This is a convenience endpoint for adding email-only contacts from the company modal
router.post('/:id/notification-contact', auth, async (req, res) => {
  try {
    const { 
      name, 
      email, 
      setAsPrimary = true,
      sendInvoiceEmail = true,
      sendInvoiceAttachment = false,
      sendStatementEmail = true,
      sendStatementAttachment = false,
      sendEmailAsSummary = false
    } = req.body;
    
    // Validation - email is required, name is optional
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }
    
    // Check if company exists
    const company = await Company.findByPk(req.params.id);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    
    // Check if user with this email already exists
    const existingUser = await User.findOne({ 
      where: { email: email.toLowerCase().trim() } 
    });
    
    if (existingUser) {
      // If user exists, update their notification settings and set as primary contact
      await existingUser.update({
        sendInvoiceEmail,
        sendInvoiceAttachment,
        sendStatementEmail,
        sendStatementAttachment,
        sendEmailAsSummary
      });
      
      if (setAsPrimary) {
        company.primaryContactId = existingUser.id;
        // Also update company notification settings
        company.sendInvoiceEmail = sendInvoiceEmail;
        company.sendInvoiceAttachment = sendInvoiceAttachment;
        company.sendStatementEmail = sendStatementEmail;
        company.sendStatementAttachment = sendStatementAttachment;
        company.sendEmailAsSummary = sendEmailAsSummary;
        await company.save();
      }
      
      return res.status(200).json({
        message: 'User already exists. Updated and set as primary contact.',
        user: {
          id: existingUser.id,
          name: existingUser.name,
          email: existingUser.email,
          role: existingUser.role,
          sendInvoiceEmail,
          sendInvoiceAttachment,
          sendStatementEmail,
          sendStatementAttachment,
          sendEmailAsSummary,
          isNew: false
        },
        setPrimaryContact: setAsPrimary
      });
    }
    
    // Use email prefix as name if no name provided
    const userName = name?.trim() || email.split('@')[0];
    
    // Create new notification contact user
    const newUser = await User.create({
      name: userName,
      email: email.toLowerCase().trim(),
      role: 'notification_contact',
      password: null, // No password needed for notification contacts
      isActive: true,
      addedById: req.user.userId,
      sendInvoiceEmail,
      sendInvoiceAttachment,
      sendStatementEmail,
      sendStatementAttachment,
      sendEmailAsSummary,
      allCompanies: false
    });
    
    // If setAsPrimary, update company's primaryContactId and settings
    if (setAsPrimary) {
      company.primaryContactId = newUser.id;
      company.sendInvoiceEmail = sendInvoiceEmail;
      company.sendInvoiceAttachment = sendInvoiceAttachment;
      company.sendStatementEmail = sendStatementEmail;
      company.sendStatementAttachment = sendStatementAttachment;
      company.sendEmailAsSummary = sendEmailAsSummary;
      await company.save();
    }
    
    // Assign user to this company via UserCompany
    const { UserCompany } = require('../models');
    await UserCompany.create({
      userId: newUser.id,
      companyId: company.id
    });
    
    // Log activity
    await logActivity({
      type: ActivityType.USER_CREATED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Created notification contact ${newUser.name} (${newUser.email}) for company ${company.name}`,
      details: {
        newUserId: newUser.id,
        newUserEmail: newUser.email,
        newUserRole: 'notification_contact',
        companyId: company.id,
        companyName: company.name,
        setAsPrimary: setAsPrimary,
        notificationSettings: { sendInvoiceEmail, sendInvoiceAttachment, sendStatementEmail, sendStatementAttachment, sendEmailAsSummary }
      },
      companyId: company.id,
      companyName: company.name,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.status(201).json({
      message: 'Notification contact created successfully',
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        sendInvoiceEmail,
        sendInvoiceAttachment,
        sendStatementEmail,
        sendStatementAttachment,
        sendEmailAsSummary,
        isNew: true
      },
      setPrimaryContact: setAsPrimary
    });
  } catch (error) {
    console.error('Error creating notification contact:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Get assigned users for a company (with notification preferences)
 * Used for bulk email confirmation modal
 * GET /api/companies/:id/assigned-users
 */
router.get('/:id/assigned-users', auth, async (req, res) => {
  try {
    const company = await Company.findByPk(req.params.id, {
      include: [{
        model: User,
        as: 'primaryContact',
        required: false,
        attributes: ['id', 'name', 'email', 'role', 'isActive', 
          'sendInvoiceEmail', 'sendInvoiceAttachment', 
          'sendStatementEmail', 'sendStatementAttachment', 
          'sendEmailAsSummary']
      }]
    });
    
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    
    // Get all ancestor company IDs (parents up the hierarchy)
    // Users assigned to parent companies should also be included
    const ancestorIds = [company.id];
    if (company.parentId) {
      let currentParentId = company.parentId;
      const maxDepth = 10;
      let depth = 0;
      while (currentParentId && depth < maxDepth) {
        ancestorIds.push(currentParentId);
        const parentCompany = await Company.findByPk(currentParentId, { attributes: ['id', 'parentId'] });
        currentParentId = parentCompany?.parentId;
        depth++;
      }
    }
    
    // Get all users assigned to this company or any of its ancestors
    const assignedUsers = await User.findAll({
      include: [{
        model: Company,
        as: 'companies',
        where: { id: { [Op.in]: ancestorIds } },
        through: { attributes: [] }
      }],
      where: { isActive: true },
      attributes: ['id', 'name', 'email', 'role', 'isActive',
        'sendInvoiceEmail', 'sendInvoiceAttachment',
        'sendStatementEmail', 'sendStatementAttachment',
        'sendEmailAsSummary']
    });
    
    // Format response
    const primaryContactId = company.primaryContactId;
    const users = assignedUsers.map(user => {
      const userData = user.toJSON ? user.toJSON() : user;
      return {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        role: userData.role,
        isActive: userData.isActive,
        isPrimaryContact: userData.id === primaryContactId,
        sendInvoiceEmail: userData.sendInvoiceEmail || false,
        sendInvoiceAttachment: userData.sendInvoiceAttachment || false,
        sendStatementEmail: userData.sendStatementEmail || false,
        sendStatementAttachment: userData.sendStatementAttachment || false,
        sendEmailAsSummary: userData.sendEmailAsSummary || false
      };
    });
    
    res.json({
      company: {
        id: company.id,
        name: company.name,
        primaryContactId: company.primaryContactId,
        primaryContact: company.primaryContact ? {
          id: company.primaryContact.id,
          name: company.primaryContact.name,
          email: company.primaryContact.email
        } : null
      },
      users: users,
      totalUsers: users.length,
      usersWithInvoiceNotifications: users.filter(u => u.sendInvoiceEmail).length,
      usersWithStatementNotifications: users.filter(u => u.sendStatementEmail).length
    });
  } catch (error) {
    console.error('Error fetching assigned users:', error);
    res.status(500).json({ message: error.message });
  }
});

/**
 * Get assigned users count for a company
 * Used for displaying count in Companies table
 * GET /api/companies/:id/assigned-users-count
 */
router.get('/:id/assigned-users-count', auth, async (req, res) => {
  try {
    const company = await Company.findByPk(req.params.id);
    
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    
    // Get all ancestor company IDs
    const ancestorIds = [company.id];
    if (company.parentId) {
      let currentParentId = company.parentId;
      const maxDepth = 10;
      let depth = 0;
      while (currentParentId && depth < maxDepth) {
        ancestorIds.push(currentParentId);
        const parentCompany = await Company.findByPk(currentParentId, { attributes: ['id', 'parentId'] });
        if (!parentCompany) break;
        currentParentId = parentCompany.parentId;
        depth++;
      }
    }
    
    // Count users assigned to this company or any of its ancestors
    // Use raw query for better performance and reliability
    const [results] = await sequelize.query(`
      SELECT COUNT(DISTINCT uc."userId") as count
      FROM user_companies uc
      INNER JOIN users u ON u.id = uc."userId"
      WHERE uc."companyId" = ANY(:ancestorIds)
        AND u."isActive" = true
    `, {
      replacements: { ancestorIds: ancestorIds },
      type: sequelize.QueryTypes.SELECT
    });
    
    const count = results?.[0]?.count || 0;
    res.json({ count: parseInt(count) });
  } catch (error) {
    console.error('Error fetching assigned users count:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

