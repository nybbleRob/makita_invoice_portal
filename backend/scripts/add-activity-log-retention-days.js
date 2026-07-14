/**
 * Migration script to add the activityLogRetentionDays column to the settings
 * table. This column controls how many days of activity logs the auto-purge
 * job retains — replacing the previous "wipe everything on a schedule"
 * behaviour with a rolling retention window.
 *
 * Safe to run repeatedly (uses IF NOT EXISTS + conditional backfill).
 */

const { sequelize } = require('../config/database');

async function addActivityLogRetentionDays() {
  const transaction = await sequelize.transaction();

  try {
    console.log('🔄 Adding activityLogRetentionDays column to settings table...');

    await sequelize.query(`
      ALTER TABLE settings
      ADD COLUMN IF NOT EXISTS "activityLogRetentionDays" INTEGER DEFAULT 14
        CHECK ("activityLogRetentionDays" IS NULL OR ("activityLogRetentionDays" >= 1 AND "activityLogRetentionDays" <= 3650));
    `, { transaction });

    // Backfill any pre-existing rows (Postgres won't set DEFAULT for existing
    // rows when the column is added — it only applies to future inserts).
    // We set 14 explicitly so the Settings UI reflects the new default.
    const [, meta] = await sequelize.query(`
      UPDATE settings
      SET "activityLogRetentionDays" = 14
      WHERE "activityLogRetentionDays" IS NULL;
    `, { transaction });

    await transaction.commit();
    console.log(`✅ activityLogRetentionDays column added; backfilled ${meta?.rowCount ?? 0} row(s) to 14.`);
    console.log('ℹ️  Auto-prune (when scheduled) now keeps the last 14 days of activity logs by default.');
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error adding activityLogRetentionDays:', error);
    throw error;
  }
}

if (require.main === module) {
  addActivityLogRetentionDays()
    .then(() => {
      console.log('✅ Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { addActivityLogRetentionDays };
