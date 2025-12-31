const { User, Company } = require('../models');
const { Op } = require('sequelize').Sequelize;
const { getAccessibleCompanyIds, getDescendantCompanyIds } = require('../utils/companyHierarchy');

/**
 * Middleware to check if user has access to view documents (invoices, credit notes, statements)
 * Access is granted if:
 * 1. User is global_admin or administrator
 * 2. User has allCompanies = true
 * 3. User is assigned to companies and document belongs to one of those companies
 * 
 * IMPORTANT: Documents are assigned to companies using account number/company number (referenceNo)
 * during import/parsing. The invoice.companyId links to the company, and users are assigned to companies.
 * Users can ONLY view documents from companies they are assigned to (unless allCompanies = true).
 */
const checkDocumentAccess = async (req, res, next) => {
  try {
    const user = req.user;
    
    // Global admins and administrators can access all documents
    if (user.role === 'global_admin' || user.role === 'administrator') {
      // Still enrich req.user with email and name for logging
      const userRecord = await User.findByPk(user.userId, {
        attributes: ['email', 'name']
      });
      if (userRecord) {
        req.user.email = userRecord.email;
        req.user.name = userRecord.name;
      }
      req.accessibleCompanyIds = null; // null means all companies
      return next();
    }
    
    // Load user with companies to check allCompanies flag and assignments
    const userWithCompanies = await User.findByPk(user.userId, {
      include: [{
        model: Company,
        as: 'companies',
        attributes: ['id', 'type', 'parentId'],
        through: { attributes: [] }
      }]
    });
    
    if (!userWithCompanies) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Enrich req.user with email and name for logging and other purposes
    req.user.email = userWithCompanies.email;
    req.user.name = userWithCompanies.name;
    
    // If user has allCompanies enabled, they can access all documents
    if (userWithCompanies.allCompanies) {
      req.accessibleCompanyIds = null; // null means all companies
      return next();
    }
    
    // For ALL users, check if they have access to the requested company
    // This is handled by the accessibleCompanyIds list which includes hierarchy
    // No need for separate check here as buildCompanyFilter will handle it
    
    // Build list of accessible company IDs based on hierarchy rules:
    // - If company has children: user sees own company + all descendants
    // - If company has no children (branch): user sees only own company
    let accessibleCompanyIds = [];
    
    if (userWithCompanies.companies.length > 0) {
      // Get all assigned company IDs
      const assignedCompanyIds = userWithCompanies.companies.map(c => c.id);
      
      // Get accessible company IDs using hierarchy rules
      accessibleCompanyIds = await getAccessibleCompanyIds(assignedCompanyIds);
    }
    
    // Store accessible company IDs in request for filtering
    if (accessibleCompanyIds.length > 0) {
      req.accessibleCompanyIds = accessibleCompanyIds;
    } else {
      // User has no companies assigned and allCompanies is false - they see nothing
      req.accessibleCompanyIds = [];
    }
    
    next();
  } catch (error) {
    console.error('Error checking document access:', error);
    res.status(500).json({ message: 'Error checking document access', error: error.message });
  }
};

/**
 * Helper function to build company filter for queries
 * Returns Sequelize where condition based on user's accessible companies
 * 
 * IMPORTANT: Documents are assigned to companies using account number/company number (referenceNo)
 * during import/parsing. The invoice.companyId links to the company.
 * Users can ONLY view documents from companies they are assigned to.
 */
const buildCompanyFilter = (accessibleCompanyIds) => {
  if (accessibleCompanyIds === null) {
    // User can access all companies (global_admin, administrator, or allCompanies = true)
    return {};
  }
  
  if (accessibleCompanyIds.length === 0) {
    // User has no companies assigned - return impossible condition so they see nothing
    return {
      companyId: {
        [Op.in]: [] // Empty array means no matches
      }
    };
  }
  
  // User can only access specific companies
  return {
    companyId: {
      [Op.in]: accessibleCompanyIds
    }
  };
};

module.exports = {
  checkDocumentAccess,
  buildCompanyFilter
};

