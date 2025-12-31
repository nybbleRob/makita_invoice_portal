/**
 * Activity Log Middleware
 * Automatically logs user activities
 */

const { logActivity, ActivityType } = require('../services/activityLogger');

/**
 * Middleware to log activity
 * Usage: router.post('/endpoint', activityLog('action_description'), handler)
 */
function activityLog(action, type = null) {
  return async (req, res, next) => {
    // Log after response is sent to avoid blocking
    res.on('finish', async () => {
      try {
        const user = req.user || {};
        const ipAddress = req.ip || req.connection.remoteAddress || null;
        const userAgent = req.get('user-agent') || null;

        // Only log successful requests (2xx status codes)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          await logActivity({
            type: type || ActivityType.USER_ACTION,
            userId: user.userId || null,
            userEmail: user.email || null,
            userRole: user.role || null,
            action: action,
            details: {
              method: req.method,
              path: req.path,
              statusCode: res.statusCode
            },
            ipAddress,
            userAgent
          });
        }
      } catch (error) {
        // Don't block the request if logging fails
        console.error('Error in activity log middleware:', error);
      }
    });

    next();
  };
}

/**
 * Helper function to extract company info from request
 */
function getCompanyInfo(req) {
  const companyId = req.params.companyId || req.body.companyId || req.query.companyId || null;
  const companyName = req.body.companyName || req.query.companyName || null;
  return { companyId, companyName };
}

module.exports = {
  activityLog,
  getCompanyInfo
};

