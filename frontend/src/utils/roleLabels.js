/**
 * Get human-readable label for role
 */
export const getRoleLabel = (role) => {
  const labels = {
    global_admin: 'Global Administrator',
    administrator: 'Administrator',
    manager: 'Manager',
    staff: 'Staff',
    external_user: 'External User',
    notification_contact: 'Notification Contact'
  };
  return labels[role] || role;
};

/**
 * Get badge colour class for role
 */
export const getRoleBadgeClass = (role) => {
  const classes = {
    global_admin: 'bg-purple-lt',
    administrator: 'bg-blue-lt',
    manager: 'bg-green-lt',
    staff: 'bg-yellow-lt',
    external_user: 'bg-secondary-lt',
    notification_contact: 'bg-cyan-lt'
  };
  return classes[role] || 'bg-secondary-lt';
};

