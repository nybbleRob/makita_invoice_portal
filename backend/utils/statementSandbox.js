/**
 * Statement Sandbox Mode.
 *
 * One switch (Settings.statementSandboxMode) that decides whether the
 * Statements product area is a private test harness or a live customer
 * feature. Every consumer reads it through here so they cannot drift apart.
 *
 * SANDBOX ON (default, and the value a fresh install gets):
 *   - Statements page + /api/statements are global_admin only.
 *   - No statement notification can be sent by ANY path: the FTP production
 *     import, the admin sandbox route, or anything added later.
 *   - The scheduled folder scanner leaves ACR11P .TXT exports where they are.
 *     They are processed only when a global admin picks one in the sandbox
 *     and clicks Process, through the same code path production uses.
 *
 * SANDBOX OFF:
 *   - Statements are visible to every portal role, company-scoped as usual.
 *   - Notifications fire normally, still subject to the per-user and
 *     per-company sendStatementEmail / attachment preferences.
 *   - The scheduled scanner picks up .TXT exports on its normal tick.
 *
 * Failure mode is deliberately the safe one: if the setting cannot be read
 * (DB down, column missing before the migration runs), we report sandbox ON.
 * The cost is statements not going out; the cost of the opposite default is
 * emailing customers by accident, which is what happened in July 2026.
 */

const { Settings } = require('../models');

/**
 * @returns {Promise<boolean>} true when sandbox mode is active.
 */
async function isStatementSandboxMode() {
  try {
    const settings = await Settings.getSettings();
    // Anything other than an explicit false means sandbox. An unmigrated
    // database returns undefined here and correctly stays locked down.
    return settings?.statementSandboxMode !== false;
  } catch (err) {
    console.warn(
      `⚠️  Could not read statementSandboxMode (${err.message}); assuming sandbox ON ` +
      `(statements stay admin-only and no customer emails will be sent).`
    );
    return true;
  }
}

module.exports = { isStatementSandboxMode };
