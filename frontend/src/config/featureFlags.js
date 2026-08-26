/**
 * Frontend feature flags. These gate whole product areas out of the
 * customer-facing UI (nav + routes) without touching the backend, DB schema,
 * or worker code, so changing exposure is a one-line edit and a rebuild.
 *
 * These are compile-time constants intentionally, with no runtime toggle from
 * Settings, because the areas they gate are pre-production and we don't want
 * a stray admin click to expose them.
 */

/**
 * Who can see the customer-facing Statements area (list, view, edit, uploads).
 *
 *   'off'          - nobody, including global_admin. Bookmarked URLs redirect.
 *   'global_admin' - global_admin only. Everyone else is redirected, and the
 *                    nav item is hidden for them.
 *   'all'          - every portal role, subject to the usual company scoping.
 *
 * Currently 'global_admin' for the ACR11P FTP pilot: a real monthly export is
 * dropped in the watched folder and a global admin verifies the generated
 * statements in the UI before any customer sees the area. This is deliberately
 * NOT 'all' because the July 2026 incident was exactly that - test statements
 * generated against live CORP companies were visible to those customers.
 *
 * The backend enforces the same restriction independently via the
 * STATEMENTS_VISIBILITY env var (default 'global_admin'), because hiding the
 * nav item alone leaves /api/statements reachable by any portal role. Keep the
 * two in sync when changing this.
 *
 * The Statement Generator Sandbox in Settings -> Admin Tools is unaffected by
 * this setting; it is always global_admin only and always forces silent=true.
 */
export const STATEMENTS_VISIBILITY = 'global_admin';

/**
 * True when the given role may see the Statements area under the current
 * visibility mode. Pass the role from useAuth()'s user object; a missing role
 * (still loading, logged out) resolves to false.
 */
export function canSeeStatements(role) {
  if (STATEMENTS_VISIBILITY === 'all') return true;
  if (STATEMENTS_VISIBILITY === 'global_admin') return role === 'global_admin';
  return false;
}
