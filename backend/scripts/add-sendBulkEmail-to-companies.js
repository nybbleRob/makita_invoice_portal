/**
 * Migration script to add sendBulkEmail field to companies table
 * This field allows companies to send one email to Primary Contact with CC to other notified users
 * instead of sending individual emails to each user.
 */

const { sequelize } = require('../models');

async function addSendBulkEmailField() {
  try {
    console.log('Starting migration: Add sendBulkEmail field to companies table...');
    
    // Check if column already exists
    const [results] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'companies' AND column_name = 'sendBulkEmail'
    `);
    
    if (results.length > 0) {
      console.log('Column sendBulkEmail already exists. Skipping migration.');
      return;
    }
    
    // Add the column
    await sequelize.query(`
      ALTER TABLE companies 
      ADD COLUMN "sendBulkEmail" BOOLEAN DEFAULT false;
    `);
    
    // Add comment
    await sequelize.query(`
      COMMENT ON COLUMN companies."sendBulkEmail" IS 
      'Send one email to Primary Contact with CC to other notified users, instead of individual emails to each user'
    `);
    
    console.log('Added sendBulkEmail column to companies table.');
    console.log('Migration completed successfully!');
    
  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Run if called directly
if (require.main === module) {
  addSendBulkEmailField()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { addSendBulkEmailField };
