/**
 * Activity Logs Routes
 * View and manage activity logs
 */

const express = require('express');
const { getActivityLogs, clearActivityLogs, purgeAllActivityLogs, deleteActivityLog, getActivityStats, ActivityType } = require('../services/activityLogger');
const auth = require('../middleware/auth');
const router = express.Router();

// All routes require authentication
router.use(auth);

// Get activity logs with filters and pagination
router.get('/', async (req, res) => {
  try {
    // Only Global Admin and Administrators can view logs
    if (!['global_admin', 'administrator'].includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Access denied. Only Global Administrators and Administrators can view activity logs.' 
      });
    }

    const {
      page = 1,
      limit = 50,
      userId,
      companyId,
      role,
      type,
      startDate,
      endDate,
      search
    } = req.query;

    const result = await getActivityLogs({
      page: parseInt(page),
      limit: parseInt(limit),
      userId,
      companyId,
      role,
      type,
      startDate,
      endDate,
      search
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get activity statistics
router.get('/stats', async (req, res) => {
  try {
    // Only Global Admin and Administrators can view stats
    if (!['global_admin', 'administrator'].includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Access denied. Only Global Administrators and Administrators can view activity statistics.' 
      });
    }

    const stats = await getActivityStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching activity stats:', error);
    res.status(500).json({ message: error.message });
  }
});

// Clear all activity logs
router.delete('/', async (req, res) => {
  try {
    // Only Global Admin and Administrators can clear logs
    if (!['global_admin', 'administrator'].includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Access denied. Only Global Administrators and Administrators can clear activity logs.' 
      });
    }

    const { reason } = req.body;
    
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ 
        message: 'Reason is required for clearing logs (auditing requirement).' 
      });
    }

    const result = await clearActivityLogs(
      req.user.userId, 
      req.user.email, 
      reason,
      req.user.role,
      req.ip || req.connection.remoteAddress,
      req.get('user-agent')
    );
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('Error clearing activity logs:', error);
    res.status(500).json({ message: error.message });
  }
});

// Purge ALL activity logs including protected ones (Global Admin only)
router.delete('/purge-all', async (req, res) => {
  try {
    // Only Global Admin can purge all logs
    if (req.user.role !== 'global_admin') {
      return res.status(403).json({ 
        message: 'Access denied. Only Global Administrators can purge all activity logs.' 
      });
    }

    const { reason, confirmPurge } = req.body;
    
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ 
        message: 'Reason is required for purging logs (auditing requirement).' 
      });
    }

    if (confirmPurge !== 'PURGE ALL LOGS') {
      return res.status(400).json({ 
        message: 'Please type "PURGE ALL LOGS" to confirm this action.' 
      });
    }

    const result = await purgeAllActivityLogs(
      req.user.userId, 
      req.user.email, 
      reason,
      req.user.role,
      req.ip || req.connection.remoteAddress,
      req.get('user-agent')
    );
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error('Error purging activity logs:', error);
    res.status(500).json({ message: error.message });
  }
});

// Delete a single activity log
router.delete('/:logId', async (req, res) => {
  try {
    // Only Global Admin can delete logs (for security and auditing)
    if (req.user.role !== 'global_admin') {
      return res.status(403).json({ 
        message: 'Access denied. Only Global Administrators can delete activity logs.' 
      });
    }

    const { reason } = req.body;
    const { logId } = req.params;
    
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ 
        message: 'Reason is required for deleting logs (auditing requirement).' 
      });
    }

    const result = await deleteActivityLog(
      logId,
      req.user.userId, 
      req.user.email, 
      reason,
      req.user.role,
      req.ip || req.connection.remoteAddress,
      req.get('user-agent')
    );
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error deleting activity log:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get available activity types
router.get('/types', async (req, res) => {
  try {
    res.json({
      types: Object.values(ActivityType)
    });
  } catch (error) {
    console.error('Error fetching activity types:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

