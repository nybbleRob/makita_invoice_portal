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

    // Invoices count - visible to all authenticated users
    // Scoped to user's accessible companies
    const invoiceCount = await Invoice.count({
      where: {
        ...companyFilter,
        deletedAt: null
      }
    });
    stats.invoices = {
      total: invoiceCount
    };

    // Credit Notes count - visible to all authenticated users
    // Scoped to user's accessible companies
    const creditNoteCount = await CreditNote.count({
      where: {
        ...companyFilter,
        deletedAt: null
      }
    });
    stats.creditNotes = {
      total: creditNoteCount
    };

    // Users count - only for those with USERS_VIEW permission (GA, Admin, Manager)
    if (hasPermission(userRole, 'USERS_VIEW')) {
      const manageableRoles = getManageableRoles(userRole);
      
      // Count users with roles the current user can manage
      const userCount = await User.count({
        where: {
          role: { [Op.in]: manageableRoles },
          deletedAt: null
        }
      });
      stats.users = {
        total: userCount
      };
    } else {
      stats.users = null;
    }

    // Companies count - only for staff roles (those with COMPANIES_VIEW permission)
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
      
      stats.companies = {
        total: companyCount
      };
    } else {
      stats.companies = null;
    }

    res.json(stats);
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ message: 'Failed to fetch dashboard statistics' });
  }
});

module.exports = router;

