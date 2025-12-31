const jwt = require('jsonwebtoken');
const { canManageRole, canAddUsers } = require('../utils/roleHierarchy');

/**
 * Middleware to check if user can manage users
 */
const canManageUsers = (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (!canAddUsers(decoded.role)) {
      return res.status(403).json({ 
        message: 'Access denied. You do not have permission to manage users.' 
      });
    }
    
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

/**
 * Middleware to check if user can manage a specific role
 */
const canManageRoleMiddleware = (targetRole) => {
  return (req, res, next) => {
    try {
      const token = req.header('Authorization')?.replace('Bearer ', '');
      
      if (!token) {
        return res.status(401).json({ message: 'No token, authorization denied' });
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      if (!canManageRole(decoded.role, targetRole)) {
        return res.status(403).json({ 
          message: `Access denied. You cannot manage ${targetRole} users.` 
        });
      }
      
      req.user = decoded;
      next();
    } catch (error) {
      res.status(401).json({ message: 'Token is not valid' });
    }
  };
};

module.exports = {
  canManageUsers,
  canManageRoleMiddleware
};

