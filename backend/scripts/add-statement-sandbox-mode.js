/**
 * Migration: add Settings.statementSandboxMode
 *
 * Defaults to TRUE (sandbox on) so applying this migration never turns
 * Statements live or enables customer emails as a side effect. Going live is
 * always a deliberate action from Settings -> Admin Tools.
 *
 * Idempotent: safe to re-run.
 */

const { sequelize } = require('../config/database');

async function addStatementSandboxMode() {
  const transaction = await sequelize.transaction();

  try {
    console.log('🔄 Adding statementSandboxMode to settings...');

    await sequelize.query(`
      ALTER TABLE settings
      ADD COLUMN IF NOT EXISTS "statementSandboxMode" BOOLEAN NOT NULL DEFAULT true;
    `, { transaction });

    // Existing rows created before the column existed take the default, but be
    // explicit so a partially-applied migration can't leave a NULL behind.
    await sequelize.query(`
      UPDATE settings SET "statementSandboxMode" = true WHERE "statementSandboxMode" IS NULL;
    `, { transaction });

    await transaction.commit();

    console.log('✅ statementSandboxMode added (default: true).');
    console.log('ℹ️  Sandbox is ON: Statements are visible to global admins only,');
    console.log('   no statement emails can be sent, and the scheduled scanner');
    console.log('   leaves ACR11P .TXT exports for manual processing.');
    console.log('   Turn it off from Settings -> Admin Tools when you are ready to go live.');
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
}

if (require.main === module) {
  addStatementSandboxMode()
    .then(() => { console.log('✅ Migration completed'); process.exit(0); })
    .catch(() => process.exit(1));
}

module.exports = addStatementSandboxMode;
