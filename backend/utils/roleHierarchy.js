/**
 * Role hierarchy and permissions
 * Higher roles can manage lower roles
 * 
 * Hierarchy (highest to lowest):
 * 7 - Global Administrator: Full system access
 * 6 - Administrator: Almost full access, no Settings/Templates/Import
 * 5 - Manager: Operational access, can manage users below
 * 4 - Credit Senior: Senior credit team, can reallocate documents
 * 3 - Credit Controller: Standard credit team, view and download
 * 2 - External User: Customer access, own company documents only
 * 1 - Notification Contact: Email notifications only, no portal access
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

const ROLE_LABELS = {
  global_admin: 'Global Administrator',
  administrator: 'Administrator',
  manager: 'Manager',
  credit_senior: 'Credit Senior',
  credit_controller: 'Credit Controller',
  external_user: 'External User',
  notification_contact: 'Notification Contact'
};

// Roles that are considered "internal staff" (not external users)
const INTERNAL_ROLES = ['global_admin', 'administrator', 'manager', 'credit_senior', 'credit_controller'];

// Roles that can access the admin/staff portal
const PORTAL_ACCESS_ROLES = ['global_admin', 'administrator', 'manager', 'credit_senior', 'credit_controller', 'external_user'];

/**
 * Check if user can manage another user based on roles
 * Global admins can manage all roles including other global admins
 */
function canManageRole(userRole, targetRole) {
  // Global admins can manage all roles including other global admins
  if (userRole === 'global_admin') {
    return true;
  }
  return ROLE_HIERARCHY[userRole] > ROLE_HIERARCHY[targetRole];
}

/**
 * Get all roles a user can manage (create/edit)
 * Global admins can manage all roles including other global admins
 */
function getManageableRoles(userRole) {
  // Global admins can manage all roles including other global admins
  if (userRole === 'global_admin') {
    return Object.keys(ROLE_HIERARCHY);
  }
  
  const userLevel = ROLE_HIERARCHY[userRole];
  return Object.keys(ROLE_HIERARCHY).filter(
    role => ROLE_HIERARCHY[role] < userLevel
  );
}

/**
 * Check if user can add/manage users
 * Only GA, Administrator, and Manager can manage users
 */
function canAddUsers(userRole) {
  return ['global_admin', 'administrator', 'manager'].includes(userRole);
}

/**
 * Check if user can view users list
 * Only GA, Administrator, and Manager can view users
 */
function canViewUsers(userRole) {
  return ['global_admin', 'administrator', 'manager'].includes(userRole);
}

/**
 * Check if user can delete users
 * Only GA and Administrator can delete users
 */
function canDeleteUsers(userRole) {
  return ['global_admin', 'administrator'].includes(userRole);
}

/**
 * Check if role is internal staff
 */
function isInternalRole(role) {
  return INTERNAL_ROLES.includes(role);
}

/**
 * Check if role has portal access
 */
function hasPortalAccess(role) {
  return PORTAL_ACCESS_ROLES.includes(role);
}

/**
 * Get role label
 */
function getRoleLabel(role) {
  return ROLE_LABELS[role] || role;
}

/**
 * Get role level
 */
function getRoleLevel(role) {
  return ROLE_HIERARCHY[role] || 0;
}

module.exports = {
  ROLE_HIERARCHY,
  ROLE_LABELS,
  INTERNAL_ROLES,
  PORTAL_ACCESS_ROLES,
  canManageRole,
  getManageableRoles,
  canAddUsers,
  canViewUsers,
  canDeleteUsers,
  isInternalRole,
  hasPortalAccess,
  getRoleLabel,
  getRoleLevel
};
