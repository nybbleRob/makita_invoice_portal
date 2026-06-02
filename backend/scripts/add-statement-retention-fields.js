/**
 * Migration script to add statement-specific retention override fields
 * Adds statementRetentionPeriod (INTEGER, null = inherit documentRetentionPeriod)
 * and statementRetentionDateTrigger (VARCHAR(20), null = inherit documentRetentionDateTrigger)
 * to the settings table.
 *
 * Existing Statement rows are not modified - the override only affects newly-created rows.
 */

const { sequelize } = require('../config/database');

async function addStatementRetentionFields() {
  const transaction = await sequelize.transaction();

  try {
    console.log('🔄 Adding statement retention override fields...');

    console.log('📝 Adding columns to settings table...');
    await sequelize.query(`
      ALTER TABLE settings
      ADD COLUMN IF NOT EXISTS "statementRetentionPeriod" INTEGER,
      ADD COLUMN IF NOT EXISTS "statementRetentionDateTrigger" VARCHAR(20)
        CHECK ("statementRetentionDateTrigger" IS NULL OR "statementRetentionDateTrigger" IN ('upload_date', 'invoice_date'));
    `, { transaction });

    await transaction.commit();
    console.log('✅ Statement retention override fields added successfully!');
    console.log('ℹ️  Both columns default to NULL, meaning statements inherit the shared documentRetention* policy until an override is set in Settings.');

  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error adding statement retention fields:', error);
    throw error;
  }
}

if (require.main === module) {
  addStatementRetentionFields()
    .then(() => {
      console.log('✅ Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { addStatementRetentionFields };
