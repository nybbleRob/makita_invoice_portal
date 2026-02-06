/**
 * Migration Script: Add activityLogPurgeSchedule column to settings table
 * Used for Activity Log auto-purge: off, daily, weekly, monthly, quarterly (runs at midnight)
 */

const { sequelize } = require('../models');

async function addActivityLogPurgeSchedule() {
  try {
    console.log('Adding activityLogPurgeSchedule column to settings table...');

    const [results] = await sequelize.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'settings'
      AND column_name = 'activityLogPurgeSchedule'
    `);

    if (results.length > 0) {
      console.log('Column already exists, skipping.');
      return;
    }

    await sequelize.query(`
      ALTER TABLE settings
      ADD COLUMN "activityLogPurgeSchedule" VARCHAR(20) DEFAULT 'off'
    `);

    await sequelize.query(`
      COMMENT ON COLUMN settings."activityLogPurgeSchedule" IS 'Activity log auto-purge schedule: off, daily, weekly, monthly, quarterly (runs at midnight)'
    `);

    console.log('Successfully added activityLogPurgeSchedule column. Default: off');
  } catch (error) {
    console.error('Error adding column:', error);
    throw error;
  }
}

if (require.main === module) {
  sequelize.authenticate()
    .then(() => {
      console.log('Database connection established');
      return addActivityLogPurgeSchedule();
    })
    .then(() => {
      console.log('Migration complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { addActivityLogPurgeSchedule };
