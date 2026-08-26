/**
 * Frontend feature flags and visibility helpers.
 *
 * Statements visibility is no longer a compile-time constant. It follows
 * Statement Sandbox Mode (Settings.statementSandboxMode), so a global admin
 * can move between test and live from Settings -> Admin Tools without a
 * rebuild and without touching the server.
 *
 * The backend enforces the same rule independently on /api/statements, so
 * everything here is UX. Hiding a nav item is not access control: STATEMENTS_VIEW
 * includes external_user, which is why the July 2026 test statements stayed
 * reachable through the API even while the page was dark.
 */

/**
 * True while Statement Sandbox Mode is active. In sandbox:
 *   - Statements are a global-admin-only test area.
 *   - No statement email can be sent by any path.
 *   - ACR11P .TXT exports sit in the watched folder until an admin processes
 *     them from the sandbox, rather than being swept up on the scan tick.
 *
 * Fails safe: a missing or still-loading settings object reads as sandbox ON.
 */
export function isStatementSandboxMode(settings) {
  return !settings || settings.statementSandboxMode !== false;
}

/**
 * True when this role may see the Statements area.
 *
 * Global admins always can, since they are the ones running the sandbox.
 * Everyone else only once Sandbox Mode has been turned off, which is the
 * deliberate go-live action.
 *
 * While settings are still loading this returns false for non-admins, so pair
 * it with the settings `loading` flag before redirecting anyone. Otherwise a
 * customer following a /statements bookmark gets bounced to the dashboard in
 * the moment before settings arrive.
 */
export function canSeeStatements(role, settings) {
  if (role === 'global_admin') return true;
  return !isStatementSandboxMode(settings);
}
