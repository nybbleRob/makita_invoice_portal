/**
 * Account Lockout Utility
 * 
 * Handles account lockout logic including:
 * - Checking if account is locked
 * - Incrementing failed login attempts
 * - Resetting failed attempts on successful login
 * - Locking accounts manually or automatically
 * - Unlocking accounts
 * - Getting lockout duration from settings
 */

const { User, Settings } = require('../models');

/**
 * Check if an account is currently locked
 * @param {Object} user - User instance
 * @returns {Object} - { isLocked: boolean, lockedUntil: Date|null, reason: string|null }
 */
async function checkAccountLockout(user) {
  if (!user.accountLockedUntil) {
    return {
      isLocked: false,
      lockedUntil: null,
      reason: null
    };
  }
  
  const now = new Date();
  const lockedUntil = new Date(user.accountLockedUntil);
  
  // If lockout has expired, clear it
  if (now >= lockedUntil) {
    // Auto-unlock expired accounts
    user.accountLockedUntil = null;
    user.failedLoginAttempts = 0;
    user.lockReason = null;
    await user.save();
    
    return {
      isLocked: false,
      lockedUntil: null,
      reason: null
    };
  }
  
  return {
    isLocked: true,
    lockedUntil: lockedUntil,
    reason: user.lockReason || 'brute_force'
  };
}

/**
 * Increment failed login attempts and lock account if threshold reached
 * @param {Object} user - User instance
 * @param {string} ipAddress - IP address of the failed attempt
 * @param {string} userAgent - User agent of the failed attempt
 * @returns {Object} - { wasLocked: boolean, attemptsRemaining: number, lockedUntil: Date|null }
 */
async function incrementFailedAttempts(user, ipAddress = null, userAgent = null) {
  // Get lockout settings
  const settings = await Settings.getSettings();
  const lockoutEnabled = settings.accountLockoutEnabled !== false; // Default to true
  const maxAttempts = settings.maxFailedLoginAttempts || 5;
  const lockoutDurationMinutes = settings.lockoutDurationMinutes || 30;
  
  // If lockout is disabled, don't track attempts
  if (!lockoutEnabled) {
    return {
      wasLocked: false,
      attemptsRemaining: Infinity,
      lockedUntil: null
    };
  }
  
  // Increment failed attempts
  user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
  user.lastFailedLoginAt = new Date();
  
  const attemptsRemaining = Math.max(0, maxAttempts - user.failedLoginAttempts);
  
  // Check if threshold reached
  if (user.failedLoginAttempts >= maxAttempts) {
    // Lock the account
    const lockedUntil = new Date();
    lockedUntil.setMinutes(lockedUntil.getMinutes() + lockoutDurationMinutes);
    
    user.accountLockedUntil = lockedUntil;
    user.lockReason = 'brute_force';
    user.lockedBy = null; // Auto-locked, not by admin
    
    await user.save();
    
    return {
      wasLocked: true,
      attemptsRemaining: 0,
      lockedUntil: lockedUntil
    };
  }
  
  // Save incremented attempts
  await user.save();
  
  return {
    wasLocked: false,
    attemptsRemaining: attemptsRemaining,
    lockedUntil: null
  };
}

/**
 * Reset failed login attempts on successful login
 * @param {Object} user - User instance
 */
async function resetFailedAttempts(user) {
  if (user.failedLoginAttempts > 0 || user.accountLockedUntil) {
    user.failedLoginAttempts = 0;
    user.accountLockedUntil = null;
    user.lastFailedLoginAt = null;
    user.lockReason = null;
    user.lockedBy = null;
    await user.save();
  }
}

/**
 * Manually lock an account
 * @param {Object} user - User instance
 * @param {number} durationMinutes - Lockout duration in minutes (null = indefinite)
 * @param {string} reason - Reason for lockout
 * @param {string} lockedByUserId - Admin user ID who is locking the account
 * @returns {Object} - { lockedUntil: Date|null }
 */
async function lockAccount(user, durationMinutes = null, reason = 'manual', lockedByUserId = null) {
  let lockedUntil = null;
  
  if (durationMinutes !== null && durationMinutes > 0) {
    lockedUntil = new Date();
    lockedUntil.setMinutes(lockedUntil.getMinutes() + durationMinutes);
  }
  // If durationMinutes is null, lock indefinitely (lockedUntil remains null)
  
  user.accountLockedUntil = lockedUntil;
  user.lockReason = reason;
  user.lockedBy = lockedByUserId;
  user.failedLoginAttempts = 0; // Reset failed attempts when manually locked
  
  await user.save();
  
  return {
    lockedUntil: lockedUntil
  };
}

/**
 * Unlock an account
 * @param {Object} user - User instance
 * @param {string} unlockedByUserId - Admin user ID who is unlocking the account
 */
async function unlockAccount(user, unlockedByUserId = null) {
  user.accountLockedUntil = null;
  user.failedLoginAttempts = 0;
  user.lastFailedLoginAt = null;
  user.lockReason = null;
  user.lockedBy = null;
  
  await user.save();
}

/**
 * Get lockout duration from settings
 * @returns {number} - Lockout duration in minutes
 */
async function getLockoutDuration() {
  const settings = await Settings.getSettings();
  return settings.lockoutDurationMinutes || 30;
}

/**
 * Get lockout configuration from settings
 * @returns {Object} - { enabled: boolean, maxAttempts: number, durationMinutes: number }
 */
async function getLockoutConfig() {
  const settings = await Settings.getSettings();
  return {
    enabled: settings.accountLockoutEnabled !== false, // Default to true
    maxAttempts: settings.maxFailedLoginAttempts || 5,
    durationMinutes: settings.lockoutDurationMinutes || 30
  };
}

module.exports = {
  checkAccountLockout,
  incrementFailedAttempts,
  resetFailedAttempts,
  lockAccount,
  unlockAccount,
  getLockoutDuration,
  getLockoutConfig
};
