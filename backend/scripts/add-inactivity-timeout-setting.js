/**
 * Migration Script: Add inactivityTimeoutMinutes column to settings table
 * Session inactivity timeout in minutes; null = disabled. Allowed: 15, 30, 45, 60, 120.
 */

const { sequelize } = require('../models');

async function addInactivityTimeoutSetting() {
  try {
    console.log('Adding inactivityTimeoutMinutes column to settings table...');

    const [results] = await sequelize.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'settings'
      AND column_name = 'inactivityTimeoutMinutes'
    `);

    if (results.length > 0) {
      console.log('Column already exists, skipping.');
      return;
    }

    await sequelize.query(`
      ALTER TABLE settings
      ADD COLUMN "inactivityTimeoutMinutes" INTEGER DEFAULT NULL
    `);

    await sequelize.query(`
      COMMENT ON COLUMN settings."inactivityTimeoutMinutes" IS 'Session inactivity timeout in minutes; null = disabled. When set, user is logged out after this many minutes of no activity.'
    `);

    console.log('Successfully added inactivityTimeoutMinutes column. Default: null (disabled)');
  } catch (error) {
    console.error('Error adding column:', error);
    throw error;
  }
}

if (require.main === module) {
  sequelize.authenticate()
    .then(() => {
      console.log('Database connection established');
      return addInactivityTimeoutSetting();
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

module.exports = { addInactivityTimeoutSetting };
