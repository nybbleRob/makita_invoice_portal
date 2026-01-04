/**
 * Migration Script: Add testModeDefaultCompanyId column to settings table
 * This column stores the company ID to use for unallocated documents in test mode
 */

const { sequelize } = require('../models');

async function addTestModeDefaultCompanyId() {
  try {
    console.log('🔄 Adding testModeDefaultCompanyId column to settings table...');
    
    // Check if column already exists
    const [results] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'settings' 
      AND column_name = 'testModeDefaultCompanyId'
    `);
    
    if (results.length > 0) {
      console.log('ℹ️  Column testModeDefaultCompanyId already exists, skipping...');
      return;
    }
    
    // Add the column
    await sequelize.query(`
      ALTER TABLE settings 
      ADD COLUMN "testModeDefaultCompanyId" UUID DEFAULT NULL
    `);
    
    // Add comment
    await sequelize.query(`
      COMMENT ON COLUMN settings."testModeDefaultCompanyId" IS 'Company ID to use for unallocated documents in test mode - allows testing email notifications for documents without a company'
    `);
    
    console.log('✅ Successfully added testModeDefaultCompanyId column!');
    
  } catch (error) {
    console.error('❌ Error adding testModeDefaultCompanyId column:', error.message);
  } finally {
    await sequelize.close();
  }
}

addTestModeDefaultCompanyId();

