/**
 * Migration Script: Add queriesEnabled column to settings table
 * This allows enabling/disabling the queries feature system-wide
 */

const { sequelize } = require('../models');

async function addQueriesEnabledSetting() {
  try {
    console.log('🔄 Adding queriesEnabled column to settings table...');
    
    // Check if column already exists
    const [results] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'settings' 
      AND column_name = 'queriesEnabled'
    `);
    
    if (results.length > 0) {
      console.log('✅ Column already exists, skipping...');
      return;
    }
    
    // Add the column
    await sequelize.query(`
      ALTER TABLE settings 
      ADD COLUMN "queriesEnabled" BOOLEAN DEFAULT true
    `);
    
    // Add comment
    await sequelize.query(`
      COMMENT ON COLUMN settings."queriesEnabled" IS 'Enable/disable the document queries feature system-wide. When disabled, all query features are hidden.'
    `);
    
    console.log('✅ Successfully added queriesEnabled column!');
    console.log('   Default value: true (queries enabled by default)');
    
  } catch (error) {
    console.error('❌ Error adding column:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  sequelize.authenticate()
    .then(() => {
      console.log('📦 Database connection established');
      return addQueriesEnabledSetting();
    })
    .then(() => {
      console.log('✅ Migration complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { addQueriesEnabledSetting };

