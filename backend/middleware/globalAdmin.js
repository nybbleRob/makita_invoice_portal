const jwt = require('jsonwebtoken');

// Middleware to check if user is Global Admin
const globalAdmin = (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user is global admin
    if (decoded.role !== 'global_admin') {
      return res.status(403).json({ 
        message: 'Access denied. Global Admin privileges required.' 
      });
    }
    
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

module.exports = globalAdmin;

