import React, { createContext, useContext, useMemo } from 'react';
import { useAuth } from './AuthContext';

/**
 * Permission Definitions
 * Must match backend/utils/permissions.js
 */

// All available roles
const ALL_ROLES = ['global_admin', 'administrator', 'manager', 'credit_senior', 'credit_controller', 'external_user', 'notification_contact'];

// Staff roles (internal users, not external customers)
const STAFF_ROLES = ['global_admin', 'administrator', 'manager', 'credit_senior', 'credit_controller'];

// All roles with portal access
const PORTAL_ROLES = ['global_admin', 'administrator', 'manager', 'credit_senior', 'credit_controller', 'external_user'];

/**
 * Permission Definitions
 * Format: PERMISSION_NAME: [roles that have this permission]
 */
const PERMISSIONS = {
  // SETTINGS & SYSTEM
  SETTINGS_VIEW: ['global_admin'],
  SETTINGS_EDIT: ['global_admin'],
  
  IMPORT_DATA_VIEW: ['global_admin'],
  IMPORT_DATA_MANAGE: ['global_admin'],
  
  TEMPLATES_VIEW: ['global_admin'],
  TEMPLATES_EDIT: ['global_admin'],
  
  FTP_CONFIGURE: ['global_admin'],
  
  // PROFILE
  PROFILE_VIEW_OWN: PORTAL_ROLES,
  PROFILE_EDIT_OWN: PORTAL_ROLES,
  
  // INVOICES
  INVOICES_VIEW: PORTAL_ROLES,
  INVOICES_IMPORT: ['global_admin', 'administrator'],
  INVOICES_EDIT: ['global_admin', 'administrator'],
  INVOICES_DELETE: ['global_admin', 'administrator'],
  INVOICES_DOWNLOAD: PORTAL_ROLES,
  
  // CREDIT NOTES
  CREDIT_NOTES_VIEW: PORTAL_ROLES,
  CREDIT_NOTES_IMPORT: ['global_admin', 'administrator'],
  CREDIT_NOTES_EDIT: ['global_admin', 'administrator'],
  CREDIT_NOTES_DELETE: ['global_admin', 'administrator'],
  CREDIT_NOTES_DOWNLOAD: PORTAL_ROLES,
  
  // STATEMENTS
  STATEMENTS_VIEW: ['global_admin'],
  STATEMENTS_IMPORT: ['global_admin'],
  STATEMENTS_EDIT: ['global_admin'],
  STATEMENTS_DELETE: ['global_admin'],
  STATEMENTS_DOWNLOAD: ['global_admin'],
  
  // UNALLOCATED DOCUMENTS
  UNALLOCATED_VIEW: ['global_admin', 'administrator', 'manager'],
  UNALLOCATED_EDIT: ['global_admin', 'administrator'],
  UNALLOCATED_DELETE: ['global_admin', 'administrator', 'manager'],
  UNALLOCATED_REALLOCATE: ['global_admin', 'administrator', 'manager', 'credit_senior'],
  UNALLOCATED_DOWNLOAD: ['global_admin', 'administrator', 'manager', 'credit_senior', 'credit_controller'],
  
  // FAILED DOCUMENTS
  FAILED_VIEW: ['global_admin', 'administrator', 'manager'],
  FAILED_DELETE: ['global_admin', 'administrator', 'manager'],
  FAILED_DOWNLOAD: ['global_admin', 'administrator', 'manager', 'credit_senior', 'credit_controller'],
  FAILED_REQUEUE: ['global_admin', 'administrator', 'manager', 'credit_senior'],
  
  // COMPANIES
  COMPANIES_VIEW: STAFF_ROLES,
  COMPANIES_CREATE: STAFF_ROLES,
  COMPANIES_EDIT: STAFF_ROLES,
  COMPANIES_DELETE: ['global_admin', 'administrator', 'manager'],
  COMPANIES_DEACTIVATE: ['global_admin', 'administrator', 'manager'],
  COMPANIES_VIEW_HIERARCHY: STAFF_ROLES,
  
  // USERS
  USERS_VIEW: ['global_admin', 'administrator', 'manager'],
  USERS_CREATE: ['global_admin', 'administrator', 'manager'],
  USERS_EDIT: ['global_admin', 'administrator', 'manager'],
  USERS_DELETE: ['global_admin', 'administrator'],
  USERS_DEACTIVATE: ['global_admin', 'administrator'],
  USERS_IMPORT: ['global_admin'],
  
  // ACTIVITY LOGS
  ACTIVITY_LOGS_VIEW: ['global_admin', 'administrator'],
  ACTIVITY_LOGS_DELETE: ['global_admin', 'administrator'],
  
  // DOCUMENT QUERIES
  QUERIES_VIEW: ['global_admin'],
  QUERIES_CREATE: ['global_admin'],
  QUERIES_RESPOND: ['global_admin'],
  QUERIES_RESOLVE: ['global_admin'],
  
  // REPORTS
  REPORTS_VIEW: ['global_admin'],
  
  // FILES
  FILES_VIEW: ['global_admin'],
  FILES_DELETE: ['global_admin'],
};

/**
 * Role hierarchy levels for comparison
 */
const ROLE_HIERARCHY = {
  global_admin: 7,
  administrator: 6,
  manager: 5,
  credit_senior: 4,
  credit_controller: 3,
  external_user: 2,
  notification_contact: 1
};

/**
 * Role display labels
 */
const ROLE_LABELS = {
  global_admin: 'Global Administrator',
  administrator: 'Administrator',
  manager: 'Manager',
  credit_senior: 'Credit Senior',
  credit_controller: 'Credit Controller',
  external_user: 'External User',
  notification_contact: 'Notification Contact'
};

const PermissionContext = createContext(null);

export const PermissionProvider = ({ children }) => {
  const { user } = useAuth();
  const userRole = user?.role || 'notification_contact';

  const value = useMemo(() => {
    /**
     * Check if current user has a specific permission
     * @param {string} permission - Permission to check
     * @returns {boolean}
     */
    const hasPermission = (permission) => {
      const allowedRoles = PERMISSIONS[permission];
      if (!allowedRoles) {
        console.warn(`Unknown permission: ${permission}`);
        return false;
      }
      return allowedRoles.includes(userRole);
    };

    /**
     * Check if current user has any of the specified permissions
     * @param {string[]} permissions - Array of permissions to check
     * @returns {boolean}
     */
    const hasAnyPermission = (permissions) => {
      return permissions.some(permission => hasPermission(permission));
    };

    /**
     * Check if current user has all of the specified permissions
     * @param {string[]} permissions - Array of permissions to check
     * @returns {boolean}
     */
    const hasAllPermissions = (permissions) => {
      return permissions.every(permission => hasPermission(permission));
    };

    /**
     * Check if current user's role is at or above the specified minimum level
     * @param {string} minRole - Minimum role required
     * @returns {boolean}
     */
    const isAtLeastRole = (minRole) => {
      const userLevel = ROLE_HIERARCHY[userRole] || 0;
      const minLevel = ROLE_HIERARCHY[minRole] || 0;
      return userLevel >= minLevel;
    };

    /**
     * Check if current user is internal staff
     * @returns {boolean}
     */
    const isStaff = () => {
      return STAFF_ROLES.includes(userRole);
    };

    /**
     * Check if current user is Global Admin
     * @returns {boolean}
     */
    const isGlobalAdmin = () => {
      return userRole === 'global_admin';
    };

    /**
     * Check if current user is Administrator or higher
     * @returns {boolean}
     */
    const isAdmin = () => {
      return ['global_admin', 'administrator'].includes(userRole);
    };

    /**
     * Check if current user is Manager or higher
     * @returns {boolean}
     */
    const isManager = () => {
      return ['global_admin', 'administrator', 'manager'].includes(userRole);
    };

    /**
     * Check if current user can manage another user based on role
     * @param {string} targetRole - Role of the user to manage
     * @returns {boolean}
     */
    const canManageRole = (targetRole) => {
      if (userRole === 'global_admin') {
        return true;
      }
      const userLevel = ROLE_HIERARCHY[userRole] || 0;
      const targetLevel = ROLE_HIERARCHY[targetRole] || 0;
      return userLevel > targetLevel;
    };

    /**
     * Get all roles the current user can manage
     * @returns {string[]}
     */
    const getManageableRoles = () => {
      if (userRole === 'global_admin') {
        return Object.keys(ROLE_HIERARCHY);
      }
      const userLevel = ROLE_HIERARCHY[userRole] || 0;
      return Object.keys(ROLE_HIERARCHY).filter(
        role => ROLE_HIERARCHY[role] < userLevel
      );
    };

    /**
     * Get display label for a role
     * @param {string} role
     * @returns {string}
     */
    const getRoleLabel = (role) => {
      return ROLE_LABELS[role] || role;
    };

    return {
      userRole,
      hasPermission,
      hasAnyPermission,
      hasAllPermissions,
      isAtLeastRole,
      isStaff,
      isGlobalAdmin,
      isAdmin,
      isManager,
      canManageRole,
      getManageableRoles,
      getRoleLabel,
      PERMISSIONS,
      ROLE_HIERARCHY,
      ROLE_LABELS,
      STAFF_ROLES,
      PORTAL_ROLES,
      ALL_ROLES
    };
  }, [userRole]);

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
};

/**
 * Hook to access permission context
 * @returns {PermissionContextValue}
 */
export const usePermissions = () => {
  const context = useContext(PermissionContext);
  if (!context) {
    throw new Error('usePermissions must be used within a PermissionProvider');
  }
  return context;
};

export default PermissionContext;

