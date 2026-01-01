/**
 * Activity Logger Service
 * Stores user activity logs in Redis with pagination support
 * Logs: logins, password resets, email transport, file imports, views, downloads, etc.
 */

const { redis } = require('../config/redis');
const winston = require('winston');

// Winston logger for file logging (optional, for server logs)
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/activity-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/activity-combined.log' })
  ]
});

// If not in production, also log to console
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Redis key prefixes
const ACTIVITY_LOG_KEY = 'activity:logs';
const ACTIVITY_LOG_INDEX = 'activity:index';
const ACTIVITY_LOG_COUNT = 'activity:count';
const MAX_LOGS = 100000; // Maximum logs to keep in Redis (adjust based on memory)

/**
 * Activity types
 */
const ActivityType = {
  LOGIN: 'login',
  LOGOUT: 'logout',
  LOGIN_FAILED: 'login_failed',
  PASSWORD_RESET_REQUEST: 'password_reset_request',
  PASSWORD_RESET: 'password_reset',
  PASSWORD_RESET_ADMIN: 'password_reset_admin',
  PASSWORD_CHANGE: 'password_change',
  TWO_FACTOR_REMOVED: 'two_factor_removed',
  EMAIL_SENT: 'email_sent',
  EMAIL_FAILED: 'email_failed',
  FILE_UPLOAD: 'file_upload',
  FILE_UPLOAD_SYSTEM: 'file_upload_system',
  FILE_IMPORT: 'file_import',
  FILE_IMPORT_FAILED: 'file_import_failed',
  INVOICE_VIEWED: 'invoice_viewed',
  INVOICE_DOWNLOADED: 'invoice_downloaded',
  INVOICE_DELETED: 'invoice_deleted',
  INVOICE_BULK_DELETE: 'invoice_bulk_delete',
  INVOICE_EDITED: 'invoice_edited',
  INVOICE_STATUS_CHANGED: 'invoice_status_changed',
  INVOICE_QUERIED: 'invoice_queried',
  CREDIT_NOTE_VIEWED: 'credit_note_viewed',
  CREDIT_NOTE_DOWNLOADED: 'credit_note_downloaded',
  CREDIT_NOTE_DELETED: 'credit_note_deleted',
  CREDIT_NOTE_BULK_DELETE: 'credit_note_bulk_delete',
  CREDIT_NOTE_EDITED: 'credit_note_edited',
  STATEMENT_VIEWED: 'statement_viewed',
  STATEMENT_DOWNLOADED: 'statement_downloaded',
  STATEMENT_DELETED: 'statement_deleted',
  STATEMENT_EDITED: 'statement_edited',
  TEMPLATE_CREATED: 'template_created',
  TEMPLATE_UPDATED: 'template_updated',
  TEMPLATE_DELETED: 'template_deleted',
  COMPANY_CREATED: 'company_created',
  COMPANY_UPDATED: 'company_updated',
  COMPANY_DELETED: 'company_deleted',
  COMPANY_ARCHIVED: 'company_archived',
  COMPANY_DEACTIVATED: 'company_deactivated',
  COMPANY_MOVED: 'company_moved',
  COMPANY_IMPORTED: 'company_imported',
  COMPANY_IMPORT_UNDONE: 'company_import_undone',
  UNALLOCATED_EDITED: 'unallocated_edited',
  UNALLOCATED_DELETED: 'unallocated_deleted',
  UNALLOCATED_BULK_DELETE: 'unallocated_bulk_delete',
  UNALLOCATED_ALLOCATED: 'unallocated_allocated',
  CREDIT_NOTE_BULK_DELETE: 'credit_note_bulk_delete',
  FILE_PURGE: 'file_purge',
  DOCUMENT_QUERIED: 'document_queried',
  DOCUMENT_QUERY_REPLIED: 'document_query_replied',
  DOCUMENT_QUERY_RESOLVED: 'document_query_resolved',
  DOCUMENT_DELETED: 'document_deleted',
  USER_CREATED: 'user_created',
  USER_UPDATED: 'user_updated',
  USER_DELETED: 'user_deleted',
  USER_REGISTRATION_SUBMITTED: 'user_registration_submitted',
  USER_REGISTRATION_APPROVED: 'user_registration_approved',
  USER_REGISTRATION_REJECTED: 'user_registration_rejected',
  SETTINGS_UPDATED: 'settings_updated',
  LOGS_CLEARED: 'logs_cleared',
  LOG_DELETED: 'log_deleted',
  LOGS_BULK_DELETED: 'logs_bulk_deleted',
  FILE_PURGE: 'file_purge',
  IMPORT_BATCH_COMPLETE: 'import_batch_complete',
  IMPORT_BATCH_NOTIFICATION: 'import_batch_notification'
};

/**
 * Log an activity
 * @param {Object} activity - Activity data
 * @param {string} activity.type - Activity type (from ActivityType enum)
 * @param {string} activity.userId - User ID who performed the action
 * @param {string} activity.userEmail - User email
 * @param {string} activity.userRole - User role
 * @param {string} activity.action - Action description
 * @param {Object} activity.details - Additional details (optional)
 * @param {string} activity.companyId - Company ID (if applicable)
 * @param {string} activity.companyName - Company name (if applicable)
 * @param {string} activity.ipAddress - IP address (optional)
 * @param {string} activity.userAgent - User agent (optional)
 */
async function logActivity(activity) {
  try {
    if (!redis) {
      // Fallback: log to Winston only if Redis is not available
      logger.info('Activity (Redis unavailable):', activity);
      return;
    }

    const logEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      type: activity.type,
      userId: activity.userId || null,
      userEmail: activity.userEmail || null,
      userRole: activity.userRole || null,
      action: activity.action,
      details: activity.details || {},
      companyId: activity.companyId || null,
      companyName: activity.companyName || null,
      ipAddress: activity.ipAddress || null,
      userAgent: activity.userAgent || null
    };

    // Store in Redis as sorted set (sorted by timestamp for easy pagination)
    const score = Date.now(); // Use timestamp as score for sorting
    const logKey = `${ACTIVITY_LOG_KEY}:${logEntry.id}`;
    
    // Store log entry as hash (convert object to flat key-value pairs)
    const hashData = {
      id: logEntry.id,
      timestamp: logEntry.timestamp,
      type: logEntry.type,
      userId: logEntry.userId || '',
      userEmail: logEntry.userEmail || '',
      userRole: logEntry.userRole || '',
      action: logEntry.action,
      details: JSON.stringify(logEntry.details),
      companyId: logEntry.companyId || '',
      companyName: logEntry.companyName || '',
      ipAddress: logEntry.ipAddress || '',
      userAgent: logEntry.userAgent || ''
    };
    await redis.hset(logKey, hashData);
    
    // Add to sorted set for pagination (score = timestamp)
    await redis.zadd(ACTIVITY_LOG_INDEX, score, logEntry.id);
    
    // Increment counter
    await redis.incr(ACTIVITY_LOG_COUNT);
    
    // Trim old logs if we exceed MAX_LOGS
    // CRITICAL: Never trim LOGS_CLEARED entries - they are permanent audit records
    const count = await redis.get(ACTIVITY_LOG_COUNT);
    if (parseInt(count) > MAX_LOGS) {
      // Remove oldest logs (keep only MAX_LOGS), but preserve LOGS_CLEARED entries
      const toRemove = parseInt(count) - MAX_LOGS;
      const oldestLogs = await redis.zrange(ACTIVITY_LOG_INDEX, 0, toRemove - 1);
      
      if (oldestLogs.length > 0) {
        // Filter out LOGS_CLEARED entries from the trim list
        const logsToTrim = [];
        const logsToPreserve = [];
        
        for (const logId of oldestLogs) {
          try {
            const logData = await redis.hgetall(`${ACTIVITY_LOG_KEY}:${logId}`);
            if (logData && logData.type === ActivityType.LOGS_CLEARED) {
              // Preserve this log entry - it's a clear log entry
              logsToPreserve.push(logId);
            } else {
              // This log can be trimmed
              logsToTrim.push(logId);
            }
          } catch (error) {
            // If we can't read the log, assume it's safe to trim
            logsToTrim.push(logId);
          }
        }
        
        if (logsToTrim.length > 0) {
          const pipeline = redis.pipeline();
          logsToTrim.forEach(logId => {
            pipeline.del(`${ACTIVITY_LOG_KEY}:${logId}`);
            pipeline.zrem(ACTIVITY_LOG_INDEX, logId);
          });
          await pipeline.exec();
        }
        
        // Update counter (accounting for preserved logs)
        const newCount = parseInt(count) - logsToTrim.length;
        await redis.set(ACTIVITY_LOG_COUNT, newCount.toString());
      }
    }
    
    // Also log to Winston for file backup
    logger.info('Activity logged:', logEntry);
    
    return logEntry;
  } catch (error) {
    console.error('Error logging activity:', error);
    // Fallback to Winston if Redis fails
    logger.error('Activity log error:', { error: error.message, activity });
  }
}

/**
 * Get activity logs with pagination and filters
 * @param {Object} options - Query options
 * @param {number} options.page - Page number (default: 1)
 * @param {number} options.limit - Items per page (default: 50)
 * @param {string} options.userId - Filter by user ID
 * @param {string} options.companyId - Filter by company ID
 * @param {string} options.role - Filter by user role
 * @param {string} options.type - Filter by activity type
 * @param {string} options.startDate - Start date (ISO string)
 * @param {string} options.endDate - End date (ISO string)
 * @param {string} options.search - Search in action/email
 */
async function getActivityLogs(options = {}) {
  try {
    if (!redis) {
      return {
        logs: [],
        pagination: { page: 1, limit: 50, total: 0, pages: 0 }
      };
    }

    const {
      page = 1,
      limit = 50,
      userId = null,
      companyId = null,
      role = null,
      type = null,
      startDate = null,
      endDate = null,
      search = null
    } = options;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // Get all log IDs from sorted set (newest first)
    let logIds = await redis.zrevrange(ACTIVITY_LOG_INDEX, 0, -1);
    
    console.log(`[ActivityLogs] Found ${logIds.length} total log entries in Redis`);

    // Apply filters
    if (userId || companyId || role || type || startDate || endDate || search) {
      console.log(`[ActivityLogs] Applying filters:`, { userId, companyId, role, type, startDate, endDate, search });
      const filteredIds = [];
      
      // Fetch log entries to filter (we'll optimize this later if needed)
      for (const logId of logIds) {
        const logData = await redis.hgetall(`${ACTIVITY_LOG_KEY}:${logId}`);
        if (!logData || Object.keys(logData).length === 0) continue;
        
        // Parse the log entry
        const log = {
          id: logData.id,
          timestamp: logData.timestamp,
          type: logData.type,
          userId: logData.userId || null,
          userEmail: logData.userEmail || null,
          userRole: logData.userRole || null,
          action: logData.action,
          details: logData.details ? JSON.parse(logData.details) : {},
          companyId: logData.companyId || null,
          companyName: logData.companyName || null,
          ipAddress: logData.ipAddress || null,
          userAgent: logData.userAgent || null
        };
        
        // Apply filters
        if (userId && log.userId !== userId) continue;
        if (companyId && log.companyId !== companyId) continue;
        if (role && log.userRole !== role) continue;
        if (type && log.type !== type) continue;
        
        if (startDate || endDate) {
          const logDate = new Date(log.timestamp);
          
          // For startDate: compare from start of day (00:00:00)
          if (startDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            if (logDate < start) continue;
          }
          
          // For endDate: compare to end of day (23:59:59.999)
          if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            if (logDate > end) continue;
          }
        }
        
        if (search) {
          const searchLower = search.toLowerCase();
          const matches = 
            (log.action && log.action.toLowerCase().includes(searchLower)) ||
            (log.userEmail && log.userEmail.toLowerCase().includes(searchLower)) ||
            (log.companyName && log.companyName.toLowerCase().includes(searchLower));
          if (!matches) continue;
        }
        
        filteredIds.push(logId);
      }
      
      logIds = filteredIds;
      console.log(`[ActivityLogs] After filtering: ${logIds.length} log entries match criteria`);
    } else {
      console.log(`[ActivityLogs] No filters applied, returning all ${logIds.length} log entries`);
    }

    const total = logIds.length;
    const pages = Math.ceil(total / limitNum);
    
    // Get paginated log IDs
    const paginatedIds = logIds.slice(offset, offset + limitNum);
    
    // Fetch log entries
    const logs = [];
    for (const logId of paginatedIds) {
      const logData = await redis.hgetall(`${ACTIVITY_LOG_KEY}:${logId}`);
      if (!logData || Object.keys(logData).length === 0) continue;
      
      logs.push({
        id: logData.id,
        timestamp: logData.timestamp,
        type: logData.type,
        userId: logData.userId || null,
        userEmail: logData.userEmail || null,
        userRole: logData.userRole || null,
        action: logData.action,
        details: logData.details ? JSON.parse(logData.details) : {},
        companyId: logData.companyId || null,
        companyName: logData.companyName || null,
        ipAddress: logData.ipAddress || null,
        userAgent: logData.userAgent || null
      });
    }

    return {
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages
      }
    };
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    logger.error('Error fetching activity logs:', error);
    return {
      logs: [],
      pagination: { page: 1, limit: 50, total: 0, pages: 0 }
    };
  }
}

/**
 * Clear all activity logs (only for Global Admin and Administrators)
 */
async function clearActivityLogs(userId, userEmail, reason, userRole, ipAddress, userAgent) {
  try {
    if (!redis) {
      return { success: false, message: 'Redis not available' };
    }

    if (!reason || reason.trim().length === 0) {
      return { success: false, message: 'Reason is required for clearing logs (auditing requirement)' };
    }

    // Get all log IDs
    const logIds = await redis.zrange(ACTIVITY_LOG_INDEX, 0, -1);
    
    if (logIds.length === 0) {
      return { success: true, message: 'No logs to clear', count: 0 };
    }

    // CRITICAL: Filter out LOGS_CLEARED entries - these must NEVER be deleted
    // They are permanent audit records of who cleared logs and when
    const logsToDelete = [];
    const logsToPreserve = [];
    
    for (const logId of logIds) {
      try {
        const logData = await redis.hgetall(`${ACTIVITY_LOG_KEY}:${logId}`);
        if (logData && logData.type === ActivityType.LOGS_CLEARED) {
          // Preserve this log entry - it's a clear log entry
          logsToPreserve.push(logId);
        } else {
          // This log can be deleted
          logsToDelete.push(logId);
        }
      } catch (error) {
        // If we can't read the log, assume it's safe to delete (or it doesn't exist)
        console.warn(`Warning: Could not read log ${logId} to check type:`, error.message);
        logsToDelete.push(logId);
      }
    }

    if (logsToDelete.length === 0) {
      return { success: true, message: 'No logs to clear (only clear log entries exist)', count: 0 };
    }

    // Delete only non-LOGS_CLEARED entries
    const pipeline = redis.pipeline();
    logsToDelete.forEach(logId => {
      pipeline.del(`${ACTIVITY_LOG_KEY}:${logId}`);
    });
    
    // Rebuild the index to only include preserved LOGS_CLEARED entries
    // First, delete the old index
    pipeline.del(ACTIVITY_LOG_INDEX);
    
    // Then rebuild it with preserved entries (with their original scores)
    if (logsToPreserve.length > 0) {
      for (const logId of logsToPreserve) {
        try {
          const logData = await redis.hgetall(`${ACTIVITY_LOG_KEY}:${logId}`);
          if (logData && logData.timestamp) {
            // Use the original timestamp as the score
            const score = parseInt(logData.timestamp) || Date.now();
            pipeline.zadd(ACTIVITY_LOG_INDEX, score, logId);
          }
        } catch (error) {
          console.warn(`Warning: Could not preserve log ${logId}:`, error.message);
        }
      }
    }
    
    // Update count to reflect only preserved logs
    pipeline.set(ACTIVITY_LOG_COUNT, logsToPreserve.length.toString());
    
    await pipeline.exec();

    // Log the clearing action (this log entry cannot be deleted - it's protected)
    await logActivity({
      type: ActivityType.LOGS_CLEARED,
      userId: userId,
      userEmail: userEmail,
      userRole: userRole,
      action: `Cleared ${logsToDelete.length} activity logs (${logsToPreserve.length} clear log entries preserved)`,
      details: { 
        count: logsToDelete.length,
        preservedCount: logsToPreserve.length,
        reason: reason.trim(),
        isClearLog: true, // Flag to prevent deletion
        clearedBy: userId,
        clearedAt: new Date().toISOString()
      },
      companyId: null,
      companyName: null,
      ipAddress: ipAddress,
      userAgent: userAgent
    });

    logger.info(`Activity logs cleared by ${userEmail} (${userId}): ${logsToDelete.length} logs deleted, ${logsToPreserve.length} clear log entries preserved. Reason: ${reason}`);

    return { 
      success: true, 
      message: `Cleared ${logsToDelete.length} logs (${logsToPreserve.length} clear log entries preserved)`, 
      count: logsToDelete.length,
      preservedCount: logsToPreserve.length
    };
  } catch (error) {
    console.error('Error clearing activity logs:', error);
    logger.error('Error clearing activity logs:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Purge ALL activity logs including protected ones (DANGEROUS - only for Global Admin)
 * This completely wipes all logs with NO record preserved
 */
async function purgeAllActivityLogs(userId, userEmail, reason, userRole, ipAddress, userAgent) {
  try {
    if (!redis) {
      return { success: false, message: 'Redis not available' };
    }

    // Only Global Admin can purge all logs
    if (userRole !== 'global_admin') {
      return { success: false, message: 'Only Global Administrators can purge all logs' };
    }

    if (!reason || reason.trim().length === 0) {
      return { success: false, message: 'Reason is required for purging logs (auditing requirement)' };
    }

    // Get all log IDs
    const logIds = await redis.zrange(ACTIVITY_LOG_INDEX, 0, -1);
    
    if (logIds.length === 0) {
      return { success: true, message: 'No logs to purge', count: 0 };
    }

    const totalCount = logIds.length;

    // Delete ALL log entries (including protected ones)
    const pipeline = redis.pipeline();
    logIds.forEach(logId => {
      pipeline.del(`${ACTIVITY_LOG_KEY}:${logId}`);
    });
    
    // Delete the index
    pipeline.del(ACTIVITY_LOG_INDEX);
    
    // Reset count to 0
    pipeline.set(ACTIVITY_LOG_COUNT, '0');
    
    await pipeline.exec();

    // Log to file system only (not to Redis since we just purged it)
    logger.warn(`ALL ACTIVITY LOGS PURGED by ${userEmail} (${userId}): ${totalCount} logs permanently deleted including protected entries. Reason: ${reason}. IP: ${ipAddress}`);

    return { 
      success: true, 
      message: `Purged ALL ${totalCount} logs (including protected entries)`, 
      count: totalCount
    };
  } catch (error) {
    console.error('Error purging activity logs:', error);
    logger.error('Error purging activity logs:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Delete a single activity log
 * @param {string} logId - Log ID to delete
 * @param {string} userId - User ID who is deleting
 * @param {string} userEmail - User email
 * @param {string} reason - Reason for deletion (required for auditing)
 * @param {string} userRole - User role
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - User agent
 */
async function deleteActivityLog(logId, userId, userEmail, reason, userRole, ipAddress, userAgent) {
  try {
    if (!redis) {
      return { success: false, message: 'Redis not available' };
    }

    if (!reason || reason.trim().length === 0) {
      return { success: false, message: 'Reason is required for deleting logs (auditing requirement)' };
    }

    // Get the log entry first to check if it's a clear log
    const logData = await redis.hgetall(`${ACTIVITY_LOG_KEY}:${logId}`);
    if (!logData || Object.keys(logData).length === 0) {
      return { success: false, message: 'Log entry not found' };
    }

    // Parse details to check if it's a clear log
    let details = {};
    try {
      details = logData.details ? JSON.parse(logData.details) : {};
    } catch (e) {
      // Ignore parse errors
    }

    // CRITICAL: Clear log entries CANNOT be deleted by anyone (including Global Admin)
    // This is a security/audit requirement - we must maintain a permanent record of who cleared logs
    if (details.isClearLog || logData.type === ActivityType.LOGS_CLEARED) {
      return { 
        success: false, 
        message: 'Log clearing entries cannot be deleted. This is a permanent audit record that must be preserved for security and compliance purposes.' 
      };
    }

    // Delete the log entry
    await redis.del(`${ACTIVITY_LOG_KEY}:${logId}`);
    await redis.zrem(ACTIVITY_LOG_INDEX, logId);
    
    // Decrement counter
    const count = await redis.get(ACTIVITY_LOG_COUNT);
    if (count && parseInt(count) > 0) {
      await redis.decr(ACTIVITY_LOG_COUNT);
    }

    // Log the deletion (for auditing) - mark as clear log so it can't be deleted except by Global Admin
    await logActivity({
      type: ActivityType.LOGS_CLEARED,
      userId: userId,
      userEmail: userEmail,
      userRole: userRole,
      action: `Deleted activity log ${logId}`,
      details: { 
        deletedLogId: logId,
        deletedLogAction: logData.action || 'Unknown',
        reason: reason.trim(),
        deletedBy: userId,
        deletedAt: new Date().toISOString(),
        isClearLog: true // Flag to prevent deletion except by Global Admin
      },
      companyId: logData.companyId || null,
      companyName: logData.companyName || null,
      ipAddress: ipAddress,
      userAgent: userAgent
    });

    return { success: true, message: 'Activity log deleted successfully' };
  } catch (error) {
    console.error('Error deleting activity log:', error);
    logger.error('Error deleting activity log:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Get activity log statistics
 */
async function getActivityStats() {
  try {
    if (!redis) {
      return {
        total: 0,
        byType: {},
        byRole: {},
        recentActivity: []
      };
    }

    const count = await redis.get(ACTIVITY_LOG_COUNT) || 0;
    const logIds = await redis.zrevrange(ACTIVITY_LOG_INDEX, 0, 99); // Last 100 logs for stats
    
    const byType = {};
    const byRole = {};
    
    for (const logId of logIds) {
      const logData = await redis.hgetall(`${ACTIVITY_LOG_KEY}:${logId}`);
      if (!logData || Object.keys(logData).length === 0) continue;
      
      const type = logData.type || 'unknown';
      const role = logData.userRole || 'unknown';
      
      byType[type] = (byType[type] || 0) + 1;
      byRole[role] = (byRole[role] || 0) + 1;
    }

    return {
      total: parseInt(count) || 0,
      byType,
      byRole
    };
  } catch (error) {
    console.error('Error getting activity stats:', error);
    return {
      total: 0,
      byType: {},
      byRole: {}
    };
  }
}

module.exports = {
  logActivity,
  getActivityLogs,
  clearActivityLogs,
  purgeAllActivityLogs,
  deleteActivityLog,
  getActivityStats,
  ActivityType,
  logger
};

