/**
 * Role hierarchy and permissions
 * Higher roles can manage lower roles
 */

const ROLE_HIERARCHY = {
  global_admin: 6,
  administrator: 5,
  manager: 4,
  staff: 3,
  external_user: 2,
  notification_contact: 1
};

const ROLE_LABELS = {
  global_admin: 'Global Administrator',
  administrator: 'Administrator',
  manager: 'Manager',
  staff: 'Staff',
  external_user: 'External User',
  notification_contact: 'Notification Contact'
};

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
 * Get all roles a user can manage
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
 * Check if user can add users
 */
function canAddUsers(userRole) {
  return userRole !== 'external_user' && userRole !== 'notification_contact';
}

/**
 * Get role label
 */
function getRoleLabel(role) {
  return ROLE_LABELS[role] || role;
}

module.exports = {
  ROLE_HIERARCHY,
  ROLE_LABELS,
  canManageRole,
  getManageableRoles,
  canAddUsers,
  getRoleLabel
};

