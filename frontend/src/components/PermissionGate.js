import React from 'react';
import { usePermissions } from '../context/PermissionContext';

/**
 * PermissionGate Component
 * 
 * Conditionally renders children based on user permissions.
 * Use this to wrap any UI element that should be hidden from users
 * who don't have the required permission.
 * 
 * Usage:
 * <PermissionGate permission="INVOICES_DELETE">
 *   <button>Delete Invoice</button>
 * </PermissionGate>
 * 
 * Multiple permissions (requires any one):
 * <PermissionGate anyOf={['INVOICES_EDIT', 'INVOICES_DELETE']}>
 *   <button>Edit/Delete Invoice</button>
 * </PermissionGate>
 * 
 * Multiple permissions (requires all):
 * <PermissionGate allOf={['INVOICES_VIEW', 'INVOICES_EDIT']}>
 *   <button>View and Edit Invoice</button>
 * </PermissionGate>
 * 
 * Role-based (minimum role level):
 * <PermissionGate minRole="manager">
 *   <button>Manager Action</button>
 * </PermissionGate>
 * 
 * With fallback:
 * <PermissionGate permission="INVOICES_DELETE" fallback={<span>No access</span>}>
 *   <button>Delete Invoice</button>
 * </PermissionGate>
 */
const PermissionGate = ({ 
  children, 
  permission,      // Single permission
  anyOf,           // Array of permissions - user needs at least one
  allOf,           // Array of permissions - user needs all
  minRole,         // Minimum role level required
  fallback = null  // What to render if permission denied
}) => {
  const { hasPermission, hasAnyPermission, hasAllPermissions, isAtLeastRole } = usePermissions();

  let hasAccess = false;

  if (permission) {
    // Single permission check
    hasAccess = hasPermission(permission);
  } else if (anyOf && anyOf.length > 0) {
    // Any of the permissions
    hasAccess = hasAnyPermission(anyOf);
  } else if (allOf && allOf.length > 0) {
    // All of the permissions
    hasAccess = hasAllPermissions(allOf);
  } else if (minRole) {
    // Minimum role level
    hasAccess = isAtLeastRole(minRole);
  } else {
    // No permission specified, default to showing (developer should add permission)
    console.warn('PermissionGate: No permission specified, defaulting to show');
    hasAccess = true;
  }

  if (hasAccess) {
    return <>{children}</>;
  }

  return fallback;
};

/**
 * RequireAdmin Component
 * Shorthand for requiring admin or higher role
 */
export const RequireAdmin = ({ children, fallback = null }) => {
  const { isAdmin } = usePermissions();
  return isAdmin() ? <>{children}</> : fallback;
};

/**
 * RequireGlobalAdmin Component
 * Shorthand for requiring global admin role
 */
export const RequireGlobalAdmin = ({ children, fallback = null }) => {
  const { isGlobalAdmin } = usePermissions();
  return isGlobalAdmin() ? <>{children}</> : fallback;
};

/**
 * RequireManager Component
 * Shorthand for requiring manager or higher role
 */
export const RequireManager = ({ children, fallback = null }) => {
  const { isManager } = usePermissions();
  return isManager() ? <>{children}</> : fallback;
};

/**
 * RequireStaff Component
 * Shorthand for requiring any staff role (not external user)
 */
export const RequireStaff = ({ children, fallback = null }) => {
  const { isStaff } = usePermissions();
  return isStaff() ? <>{children}</> : fallback;
};

/**
 * Higher-Order Component version
 * 
 * Usage:
 * const ProtectedComponent = withPermission('INVOICES_DELETE')(MyComponent);
 */
export const withPermission = (permission) => (WrappedComponent) => {
  return function WithPermissionComponent(props) {
    return (
      <PermissionGate permission={permission}>
        <WrappedComponent {...props} />
      </PermissionGate>
    );
  };
};

export default PermissionGate;

