/**
 * Migration Script: Add onlyExternalUsersChangeDocumentStatus column to settings table
 * This column controls whether only external users (customers) can change document status
 */

const { sequelize } = require('../models');

async function addOnlyExternalUsersChangeDocumentStatus() {
  try {
    console.log('🔄 Adding onlyExternalUsersChangeDocumentStatus column to settings table...');
    
    // Check if column already exists
    const [results] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'settings' 
      AND column_name = 'onlyExternalUsersChangeDocumentStatus'
    `);
    
    if (results.length > 0) {
      console.log('✅ Column already exists, skipping...');
      return;
    }
    
    // Add the column
    await sequelize.query(`
      ALTER TABLE settings 
      ADD COLUMN "onlyExternalUsersChangeDocumentStatus" BOOLEAN DEFAULT false
    `);
    
    // Add comment
    await sequelize.query(`
      COMMENT ON COLUMN settings."onlyExternalUsersChangeDocumentStatus" IS 'If true, only external users (customers) can change document status (viewed/downloaded). If false, all users can change status (for testing).'
    `);
    
    console.log('✅ Successfully added onlyExternalUsersChangeDocumentStatus column!');
    console.log('   Default value: false (all users can change document status - testing mode)');
    
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
      return addOnlyExternalUsersChangeDocumentStatus();
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

module.exports = { addOnlyExternalUsersChangeDocumentStatus };

