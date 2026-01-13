/**
 * Security Monitor Service
 * 
 * Tracks suspicious security patterns and sends alerts to administrators:
 * - Multiple failed logins from same IP
 * - Rapid login attempts across different accounts
 * - Account lockout events
 * - Brute force detection patterns
 */

const { logActivity, ActivityType, getActivityLogs } = require('./activityLogger');
const { Settings, User } = require('../models');
const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
const { getFrontendUrl } = require('../utils/urlConfig');

// In-memory tracking (could be moved to Redis for production)
const ipAttempts = new Map(); // { ip: { count: number, lastAttempt: Date, accounts: Set } }
const accountAttempts = new Map(); // { email: { count: number, lastAttempt: Date } }

// Cleanup old entries every 15 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = 15 * 60 * 1000; // 15 minutes
  
  for (const [ip, data] of ipAttempts.entries()) {
    if (now - data.lastAttempt > maxAge) {
      ipAttempts.delete(ip);
    }
  }
  
  for (const [email, data] of accountAttempts.entries()) {
    if (now - data.lastAttempt > maxAge) {
      accountAttempts.delete(email);
    }
  }
}, 15 * 60 * 1000);

/**
 * Track failed login attempt
 * @param {string} email - User email
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - User agent
 */
async function trackFailedLogin(email, ipAddress, userAgent) {
  const now = Date.now();
  
  // Track by IP
  if (ipAddress) {
    if (!ipAttempts.has(ipAddress)) {
      ipAttempts.set(ipAddress, { count: 0, lastAttempt: now, accounts: new Set() });
    }
    const ipData = ipAttempts.get(ipAddress);
    ipData.count++;
    ipData.lastAttempt = now;
    ipData.accounts.add(email);
  }
  
  // Track by account
  if (email) {
    if (!accountAttempts.has(email)) {
      accountAttempts.set(email, { count: 0, lastAttempt: now });
    }
    const accountData = accountAttempts.get(email);
    accountData.count++;
    accountData.lastAttempt = now;
  }
  
  // Check for suspicious patterns
  await checkSuspiciousPatterns(ipAddress, email);
}

/**
 * Check for suspicious security patterns
 * @param {string} ipAddress - IP address
 * @param {string} email - User email
 */
async function checkSuspiciousPatterns(ipAddress, email) {
  try {
    const settings = await Settings.getSettings();
    
    // Thresholds (configurable via settings in future)
    const IP_FAILED_THRESHOLD = 10; // 10 failed attempts from same IP
    const RAPID_ACCOUNTS_THRESHOLD = 5; // 5 different accounts from same IP in short time
    const ACCOUNT_FAILED_THRESHOLD = 5; // 5 failed attempts on same account
    
    // Check IP-based patterns
    if (ipAddress && ipAttempts.has(ipAddress)) {
      const ipData = ipAttempts.get(ipAddress);
      
      // Multiple failed attempts from same IP
      if (ipData.count >= IP_FAILED_THRESHOLD) {
        await logActivity({
          type: ActivityType.BRUTE_FORCE_DETECTED,
          userEmail: email || null,
          action: `Multiple failed login attempts from IP ${ipAddress}`,
          details: {
            ipAddress: ipAddress,
            failedAttempts: ipData.count,
            uniqueAccounts: Array.from(ipData.accounts),
            threshold: IP_FAILED_THRESHOLD
          },
          ipAddress: ipAddress,
          userAgent: null
        });
        
        // Send alert to admins if configured
        await sendSecurityAlert('ip_brute_force', {
          ipAddress: ipAddress,
          failedAttempts: ipData.count,
          uniqueAccounts: Array.from(ipData.accounts),
          threshold: IP_FAILED_THRESHOLD
        });
      }
      
      // Rapid attempts across different accounts (potential credential stuffing)
      if (ipData.accounts.size >= RAPID_ACCOUNTS_THRESHOLD) {
        await logActivity({
          type: ActivityType.BRUTE_FORCE_DETECTED,
          userEmail: null,
          action: `Rapid login attempts across multiple accounts from IP ${ipAddress}`,
          details: {
            ipAddress: ipAddress,
            uniqueAccounts: Array.from(ipData.accounts),
            threshold: RAPID_ACCOUNTS_THRESHOLD
          },
          ipAddress: ipAddress,
          userAgent: null
        });
        
        await sendSecurityAlert('credential_stuffing', {
          ipAddress: ipAddress,
          uniqueAccounts: Array.from(ipData.accounts),
          threshold: RAPID_ACCOUNTS_THRESHOLD
        });
      }
    }
    
    // Check account-based patterns
    if (email && accountAttempts.has(email)) {
      const accountData = accountAttempts.get(email);
      
      if (accountData.count >= ACCOUNT_FAILED_THRESHOLD) {
        await logActivity({
          type: ActivityType.BRUTE_FORCE_DETECTED,
          userEmail: email,
          action: `Multiple failed login attempts on account ${email}`,
          details: {
            email: email,
            failedAttempts: accountData.count,
            threshold: ACCOUNT_FAILED_THRESHOLD
          },
          ipAddress: ipAddress,
          userAgent: null
        });
      }
    }
  } catch (error) {
    console.error('Error checking suspicious patterns:', error);
  }
}

/**
 * Track account lockout event
 * @param {Object} user - User instance
 * @param {string} ipAddress - IP address
 * @param {string} userAgent - User agent
 * @param {string} reason - Lockout reason
 */
async function trackAccountLockout(user, ipAddress, userAgent, reason) {
  try {
    // Log is already done in auth.js, but we can send alerts here
    await sendSecurityAlert('account_locked', {
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      reason: reason,
      lockedUntil: user.accountLockedUntil,
      ipAddress: ipAddress
    });
  } catch (error) {
    console.error('Error tracking account lockout:', error);
  }
}

/**
 * Send security alert email to administrators
 * @param {string} alertType - Type of alert
 * @param {Object} data - Alert data
 */
async function sendSecurityAlert(alertType, data) {
  try {
    const settings = await Settings.getSettings();
    
    // Get all global admins and administrators
    const admins = await User.findAll({
      where: {
        role: ['global_admin', 'administrator'],
        isActive: true
      },
      attributes: ['id', 'name', 'email']
    });
    
    if (admins.length === 0) {
      console.warn('No active administrators found to send security alerts to');
      return;
    }
    
    // Prepare alert message based on type
    let subject = '';
    let message = '';
    let details = {};
    
    switch (alertType) {
      case 'ip_brute_force':
        subject = 'Security Alert: Multiple Failed Login Attempts from IP';
        message = `Multiple failed login attempts detected from IP address ${data.ipAddress}.`;
        details = {
          ipAddress: data.ipAddress,
          failedAttempts: data.failedAttempts,
          uniqueAccounts: data.uniqueAccounts,
          threshold: data.threshold,
          timestamp: new Date().toISOString()
        };
        break;
        
      case 'credential_stuffing':
        subject = 'Security Alert: Credential Stuffing Attempt Detected';
        message = `Rapid login attempts across multiple accounts detected from IP address ${data.ipAddress}.`;
        details = {
          ipAddress: data.ipAddress,
          uniqueAccounts: data.uniqueAccounts,
          threshold: data.threshold,
          timestamp: new Date().toISOString()
        };
        break;
        
      case 'account_locked':
        subject = 'Security Alert: Account Locked';
        message = `Account for ${data.userName} (${data.userEmail}) has been locked.`;
        details = {
          userId: data.userId,
          userEmail: data.userEmail,
          userName: data.userName,
          reason: data.reason,
          lockedUntil: data.lockedUntil,
          ipAddress: data.ipAddress,
          timestamp: new Date().toISOString()
        };
        break;
        
      default:
        console.warn(`Unknown alert type: ${alertType}`);
        return;
    }
    
    // Send email to each admin
    const { isEmailEnabled } = require('../utils/emailService');
    if (isEmailEnabled(settings)) {
      const frontendUrl = getFrontendUrl();
      
      for (const admin of admins) {
        try {
          await sendTemplatedEmail(
            'security-alert',
            admin.email,
            {
              adminName: admin.name,
              alertType: alertType,
              subject: subject,
              message: message,
              details: details,
              portalUrl: frontendUrl,
              activityLogsUrl: `${frontendUrl}/activity`
            },
            settings,
            {
              ipAddress: null,
              userAgent: null,
              userId: admin.id
            }
          );
        } catch (emailError) {
          console.error(`Failed to send security alert to ${admin.email}:`, emailError);
        }
      }
    } else {
      console.warn('Email not enabled - security alerts will not be sent');
    }
  } catch (error) {
    console.error('Error sending security alert:', error);
  }
}

/**
 * Get security statistics
 * @returns {Object} Security stats
 */
async function getSecurityStats() {
  try {
    // Get recent security events from activity logs
    const recentLogs = await getActivityLogs({
      type: ActivityType.BRUTE_FORCE_DETECTED,
      limit: 100
    });
    
    const lockoutLogs = await getActivityLogs({
      type: ActivityType.ACCOUNT_LOCKED,
      limit: 100
    });
    
    return {
      recentBruteForceAttempts: recentLogs.logs.length,
      recentLockouts: lockoutLogs.logs.length,
      activeIPTracking: ipAttempts.size,
      activeAccountTracking: accountAttempts.size
    };
  } catch (error) {
    console.error('Error getting security stats:', error);
    return {
      recentBruteForceAttempts: 0,
      recentLockouts: 0,
      activeIPTracking: 0,
      activeAccountTracking: 0
    };
  }
}

module.exports = {
  trackFailedLogin,
  trackAccountLockout,
  checkSuspiciousPatterns,
  sendSecurityAlert,
  getSecurityStats
};
