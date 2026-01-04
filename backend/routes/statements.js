const express = require('express');
const { Statement, Company, Sequelize, Settings } = require('../models');
const { calculateDocumentRetentionDates } = require('../utils/documentRetention');
const { Op } = Sequelize;
const auth = require('../middleware/auth');
const { checkDocumentAccess, buildCompanyFilter } = require('../middleware/documentAccess');
const { getDescendantCompanyIds } = require('../utils/companyHierarchy');
const { logActivity, ActivityType } = require('../services/activityLogger');
const { requirePermission } = require('../middleware/permissions');
const router = express.Router();

// Apply auth and document access check to all routes
// Statements are GA only for now
router.use(auth);
router.use(requirePermission('STATEMENTS_VIEW'));
router.use(checkDocumentAccess);

// Get all statements (filtered by user's accessible companies)
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, search = '', companyId, companyIds, status, startDate, endDate } = req.query;
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
    
    if (status) {
      whereConditions.status = status;
    }
    
    if (startDate || endDate) {
      whereConditions[Op.and] = [];
      if (startDate) {
        whereConditions[Op.and].push({
          periodEnd: { [Op.gte]: new Date(startDate) }
        });
      }
      if (endDate) {
        whereConditions[Op.and].push({
          periodStart: { [Op.lte]: new Date(endDate) }
        });
      }
    }
    
    if (search) {
      whereConditions[Op.or] = [
        { statementNumber: { [Op.iLike]: `%${search}%` } },
        { notes: { [Op.iLike]: `%${search}%` } }
      ];
    }
    
    const { count, rows } = await Statement.findAndCountAll({
      where: whereConditions,
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'referenceNo', 'type']
      }],
      limit: limitNum,
      offset: offset,
      order: [['periodEnd', 'DESC'], ['createdAt', 'DESC']]
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
    console.error('Error fetching statements:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get single statement
router.get('/:id', async (req, res) => {
  try {
    const statement = await Statement.findByPk(req.params.id, {
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'referenceNo', 'type', 'globalSystemEmail']
      }]
    });
    
    if (!statement) {
      return res.status(404).json({ message: 'Statement not found' });
    }
    
    // Double-check access to this specific statement's company
    if (req.accessibleCompanyIds !== null && 
        !req.accessibleCompanyIds.includes(statement.companyId)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have access to this statement.' 
      });
    }
    
    // Only update status if setting allows all users OR user is external_user
    const settings = await Settings.getSettings();
    const canUpdateStatus = !settings.onlyExternalUsersChangeDocumentStatus || req.user.role === 'external_user' || req.user.role === 'global_admin';
    
    // Mark as viewed if not already
    if (canUpdateStatus && !statement.viewedAt) {
      statement.viewedAt = new Date();
      if (statement.documentStatus === 'ready' || statement.documentStatus === 'review') {
        statement.documentStatus = 'viewed';
      }
      await statement.save();
    }
    
    // Log statement view
    await logActivity({
      type: ActivityType.STATEMENT_VIEWED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Viewed statement ${statement.statementNumber || statement.id}`,
      details: { 
        statementId: statement.id,
        statementNumber: statement.statementNumber,
        companyId: statement.companyId
      },
      companyId: statement.companyId,
      companyName: statement.company?.name || null,
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent')
    });
    
    res.json(statement);
  } catch (error) {
    console.error('Error fetching statement:', error);
    res.status(500).json({ message: error.message });
  }
});

// Create statement (only for admins/managers/staff)
router.post('/', async (req, res) => {
  try {
    // Only admins, managers, and staff can create statements
    if (req.user.role === 'external_user') {
      return res.status(403).json({ 
        message: 'Access denied. External users cannot create statements.' 
      });
    }
    
    const {
      statementNumber,
      companyId,
      periodStart,
      periodEnd,
      openingBalance,
      closingBalance,
      totalDebits,
      totalCredits,
      transactions,
      status,
      notes,
      fileUrl,
      metadata
    } = req.body;
    
    // Validate required fields
    if (!statementNumber || !companyId || !periodStart || !periodEnd) {
      return res.status(400).json({ 
        message: 'statementNumber, companyId, periodStart, and periodEnd are required' 
      });
    }
    
    // Check if statement number already exists
    const existingStatement = await Statement.findOne({
      where: { statementNumber }
    });
    
    if (existingStatement) {
      return res.status(400).json({ message: 'Statement number already exists' });
    }
    
    // Verify company exists
    const company = await Company.findByPk(companyId);
    if (!company) {
      return res.status(400).json({ message: 'Company not found' });
    }
    
    // Get settings for retention calculation
    const settings = await Settings.getSettings();
    
    // Prepare document data for retention calculation
    // For statements, use periodEnd as the invoice date equivalent
    const documentDataForRetention = {
      periodEnd: new Date(periodEnd),
      createdAt: new Date(),
      documentStatus: 'ready'
    };
    
    // Calculate retention dates
    const retentionDates = calculateDocumentRetentionDates(documentDataForRetention, settings);
    
    const statement = await Statement.create({
      statementNumber,
      companyId,
      periodStart,
      periodEnd,
      openingBalance: openingBalance || 0,
      closingBalance: closingBalance || 0,
      totalDebits: totalDebits || 0,
      totalCredits: totalCredits || 0,
      transactions: transactions || [],
      status: status || 'draft',
      notes,
      fileUrl,
      metadata: metadata || {},
      createdById: req.user.userId,
      retentionStartDate: retentionDates.retentionStartDate,
      retentionExpiryDate: retentionDates.retentionExpiryDate
    });
    
    // Reload with company
    await statement.reload({
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'referenceNo', 'type']
      }]
    });
    
    res.status(201).json(statement);
  } catch (error) {
    console.error('Error creating statement:', error);
    res.status(400).json({ message: error.message });
  }
});

// Update statement (only for admins/managers/staff)
router.put('/:id', async (req, res) => {
  try {
    // Only admins, managers, and staff can update statements
    if (req.user.role === 'external_user') {
      return res.status(403).json({ 
        message: 'Access denied. External users cannot update statements.' 
      });
    }
    
    const statement = await Statement.findByPk(req.params.id);
    
    if (!statement) {
      return res.status(404).json({ message: 'Statement not found' });
    }
    
    // Check access to this statement's company
    if (req.accessibleCompanyIds !== null && 
        !req.accessibleCompanyIds.includes(statement.companyId)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have access to this statement.' 
      });
    }
    
    const {
      statementNumber,
      companyId,
      periodStart,
      periodEnd,
      openingBalance,
      closingBalance,
      totalDebits,
      totalCredits,
      transactions,
      status,
      notes,
      fileUrl,
      metadata
    } = req.body;
    
    // Check if statement number is being changed and if it already exists
    if (statementNumber && statementNumber !== statement.statementNumber) {
      const existingStatement = await Statement.findOne({
        where: { statementNumber }
      });
      
      if (existingStatement) {
        return res.status(400).json({ message: 'Statement number already exists' });
      }
    }
    
    // Update fields
    if (statementNumber !== undefined) statement.statementNumber = statementNumber;
    if (companyId !== undefined) statement.companyId = companyId;
    if (periodStart !== undefined) statement.periodStart = periodStart;
    if (periodEnd !== undefined) statement.periodEnd = periodEnd;
    if (openingBalance !== undefined) statement.openingBalance = openingBalance;
    if (closingBalance !== undefined) statement.closingBalance = closingBalance;
    if (totalDebits !== undefined) statement.totalDebits = totalDebits;
    if (totalCredits !== undefined) statement.totalCredits = totalCredits;
    if (transactions !== undefined) statement.transactions = transactions;
    if (status !== undefined) statement.status = status;
    if (notes !== undefined) statement.notes = notes;
    if (fileUrl !== undefined) statement.fileUrl = fileUrl;
    if (metadata !== undefined) statement.metadata = metadata;
    
    await statement.save();
    
    // Reload with company
    await statement.reload({
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'referenceNo', 'type']
      }]
    });
    
    res.json(statement);
  } catch (error) {
    console.error('Error updating statement:', error);
    res.status(400).json({ message: error.message });
  }
});

// Delete statement (only for admins/managers/staff)
router.delete('/:id', async (req, res) => {
  try {
    // Only admins, managers, and staff can delete statements
    if (req.user.role === 'external_user') {
      return res.status(403).json({ 
        message: 'Access denied. External users cannot delete statements.' 
      });
    }
    
    const statement = await Statement.findByPk(req.params.id);
    
    if (!statement) {
      return res.status(404).json({ message: 'Statement not found' });
    }
    
    // Check access to this statement's company
    if (req.accessibleCompanyIds !== null && 
        !req.accessibleCompanyIds.includes(statement.companyId)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have access to this statement.' 
      });
    }
    
    await statement.destroy();
    
    res.json({ message: 'Statement deleted successfully' });
  } catch (error) {
    console.error('Error deleting statement:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

