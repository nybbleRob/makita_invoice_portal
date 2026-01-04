/**
 * Dashboard Statistics Routes
 * Returns permission-filtered statistics for the dashboard
 */

const express = require('express');
const { Invoice, CreditNote, User, Company, UserCompany, Sequelize } = require('../models');
const { Op } = Sequelize;
const auth = require('../middleware/auth');
const { checkDocumentAccess, buildCompanyFilter } = require('../middleware/documentAccess');
const { hasPermission } = require('../utils/permissions');
const { getManageableRoles } = require('../utils/roleHierarchy');
const router = express.Router();

// Apply auth and document access check
router.use(auth);
router.use(checkDocumentAccess);

/**
 * GET /api/stats/dashboard
 * Returns dashboard statistics filtered by user's permissions and company access
 */
router.get('/dashboard', async (req, res) => {
  try {
    const userRole = req.user.role;
    const stats = {};

    // Build company filter for document access
    const companyFilter = buildCompanyFilter(req.accessibleCompanyIds);
    
    console.log(`📊 Dashboard Stats - User: ${req.user.email || 'unknown'}, Role: ${userRole}, AccessibleCompanyIds: ${JSON.stringify(req.accessibleCompanyIds)}`);
    console.log(`📊 Dashboard Stats - Company Filter: ${JSON.stringify(companyFilter)}`);

    // Invoices count - visible to all authenticated users
    // Scoped to user's accessible companies
    try {
      const invoiceCount = await Invoice.count({
        where: {
          ...companyFilter,
          deletedAt: null
        }
      });
      console.log(`📊 Dashboard Stats - Invoice count: ${invoiceCount}`);
      stats.invoices = { total: invoiceCount };
    } catch (invErr) {
      console.error('📊 Dashboard Stats - Invoice count error:', invErr.message);
      stats.invoices = { total: 0 };
    }

    // Credit Notes count - visible to all authenticated users
    // Scoped to user's accessible companies
    try {
      const creditNoteCount = await CreditNote.count({
        where: {
          ...companyFilter,
          deletedAt: null
        }
      });
      console.log(`📊 Dashboard Stats - Credit Note count: ${creditNoteCount}`);
      stats.creditNotes = { total: creditNoteCount };
    } catch (cnErr) {
      console.error('📊 Dashboard Stats - Credit Note count error:', cnErr.message);
      stats.creditNotes = { total: 0 };
    }

    // Users count - only for those with USERS_VIEW permission (GA, Admin, Manager)
    try {
      if (hasPermission(userRole, 'USERS_VIEW')) {
        const manageableRoles = getManageableRoles(userRole);
        console.log(`📊 Dashboard Stats - Manageable roles for ${userRole}:`, manageableRoles);
        
        // Count users with roles the current user can manage
        const userCount = await User.count({
          where: {
            role: { [Op.in]: manageableRoles },
            deletedAt: null
          }
        });
        console.log(`📊 Dashboard Stats - User count: ${userCount}`);
        stats.users = { total: userCount };
      } else {
        stats.users = null;
      }
    } catch (userErr) {
      console.error('📊 Dashboard Stats - User count error:', userErr.message);
      stats.users = null;
    }

    // Companies count - only for staff roles (those with COMPANIES_VIEW permission)
    try {
      if (hasPermission(userRole, 'COMPANIES_VIEW')) {
        let companyCount;
        
        // If user has full access (accessibleCompanyIds is null), count all
        if (req.accessibleCompanyIds === null) {
          companyCount = await Company.count({
            where: { deletedAt: null }
          });
        } else {
          // Otherwise count only accessible companies
          companyCount = req.accessibleCompanyIds.length;
        }
        console.log(`📊 Dashboard Stats - Company count: ${companyCount}`);
        stats.companies = { total: companyCount };
      } else {
        stats.companies = null;
      }
    } catch (compErr) {
      console.error('📊 Dashboard Stats - Company count error:', compErr.message);
      stats.companies = null;
    }

    console.log(`📊 Dashboard Stats - Final stats:`, JSON.stringify(stats));
    res.json(stats);
  } catch (error) {
    console.error('📊 Dashboard Stats - FATAL ERROR:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard statistics' });
  }
});

module.exports = router;

