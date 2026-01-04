/**
 * Permission Middleware
 * 
 * Middleware functions to check user permissions on routes.
 * Uses the centralized permission definitions from utils/permissions.js
 */

const jwt = require('jsonwebtoken');
const { hasPermission, hasAnyPermission, isStaffRole } = require('../utils/permissions');

/**
 * Middleware to require a specific permission
 * @param {string} permission - Permission required (e.g., 'INVOICES_DELETE')
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    try {
      // Check if user is authenticated
      if (!req.user) {
        // Try to get user from token
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
          return res.status(401).json({ message: 'Authentication required' });
        }
        req.user = jwt.verify(token, process.env.JWT_SECRET);
      }

      const userRole = req.user.role;

      if (!hasPermission(userRole, permission)) {
        return res.status(403).json({ 
          message: 'Access denied. You do not have permission to perform this action.',
          requiredPermission: permission
        });
      }

      next();
    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Invalid or expired token' });
      }
      console.error('Permission middleware error:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  };
};

/**
 * Middleware to require any of multiple permissions
 * @param {string[]} permissions - Array of permissions (user needs at least one)
 */
const requireAnyPermission = (permissions) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) {
          return res.status(401).json({ message: 'Authentication required' });
        }
        req.user = jwt.verify(token, process.env.JWT_SECRET);
      }

      const userRole = req.user.role;

      if (!hasAnyPermission(userRole, permissions)) {
        return res.status(403).json({ 
          message: 'Access denied. You do not have permission to perform this action.',
          requiredPermissions: permissions
        });
      }

      next();
    } catch (error) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Invalid or expired token' });
      }
      console.error('Permission middleware error:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  };
};

/**
 * Middleware to require staff role (internal users only)
 */
const requireStaff = (req, res, next) => {
  try {
    if (!req.user) {
      const token = req.header('Authorization')?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
      }
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    }

    if (!isStaffRole(req.user.role)) {
      return res.status(403).json({ 
        message: 'Access denied. Staff access required.'
      });
    }

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    console.error('Permission middleware error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Middleware to require Global Admin only
 */
const requireGlobalAdmin = (req, res, next) => {
  try {
    if (!req.user) {
      const token = req.header('Authorization')?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
      }
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    }

    if (req.user.role !== 'global_admin') {
      return res.status(403).json({ 
        message: 'Access denied. Global Administrator privileges required.'
      });
    }

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    console.error('Permission middleware error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Middleware to require Admin or higher (GA + Admin)
 */
const requireAdmin = (req, res, next) => {
  try {
    if (!req.user) {
      const token = req.header('Authorization')?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
      }
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    }

    if (!['global_admin', 'administrator'].includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Access denied. Administrator privileges required.'
      });
    }

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    console.error('Permission middleware error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Middleware to require Manager or higher (GA + Admin + Manager)
 */
const requireManager = (req, res, next) => {
  try {
    if (!req.user) {
      const token = req.header('Authorization')?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
      }
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    }

    if (!['global_admin', 'administrator', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Access denied. Manager privileges required.'
      });
    }

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
    console.error('Permission middleware error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  requirePermission,
  requireAnyPermission,
  requireStaff,
  requireGlobalAdmin,
  requireAdmin,
  requireManager
};

