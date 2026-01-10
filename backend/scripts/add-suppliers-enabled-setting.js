/**
 * Migration Script: Add suppliersEnabled column to settings table
 * This allows enabling/disabling the suppliers feature system-wide
 */

const { sequelize } = require('../models');

async function addSuppliersEnabledSetting() {
  try {
    console.log('🔄 Adding suppliersEnabled column to settings table...');
    
    // Check if column already exists
    const [results] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'settings' 
      AND column_name = 'suppliersEnabled'
    `);
    
    if (results.length > 0) {
      console.log('✅ Column already exists, skipping...');
      return;
    }
    
    // Add the column
    await sequelize.query(`
      ALTER TABLE settings 
      ADD COLUMN "suppliersEnabled" BOOLEAN DEFAULT true
    `);
    
    // Add comment
    await sequelize.query(`
      COMMENT ON COLUMN settings."suppliersEnabled" IS 'Enable/disable the suppliers feature system-wide. When disabled, all supplier features are hidden.'
    `);
    
    console.log('✅ Successfully added suppliersEnabled column!');
    console.log('   Default value: true (suppliers enabled by default)');
    
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
      return addSuppliersEnabledSetting();
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

module.exports = { addSuppliersEnabledSetting };
