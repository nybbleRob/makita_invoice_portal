/**
 * Migration script to add sendImportSummaryReport field to users table
 * This field allows Global Admins and Administrators to opt-in to receiving
 * import summary report emails after each batch import completes.
 */

const { sequelize } = require('../models');

async function addSendImportSummaryReportField() {
  try {
    console.log('Starting migration: Add sendImportSummaryReport field to users table...');
    
    // Check if column already exists
    const [results] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'sendImportSummaryReport'
    `);
    
    if (results.length > 0) {
      console.log('Column sendImportSummaryReport already exists. Skipping migration.');
      return;
    }
    
    // Add the column
    await sequelize.query(`
      ALTER TABLE users 
      ADD COLUMN "sendImportSummaryReport" BOOLEAN DEFAULT false;
    `);
    
    console.log('Added sendImportSummaryReport column to users table.');
    
    // Set default to true for existing global_admin users
    const [updateResult] = await sequelize.query(`
      UPDATE users 
      SET "sendImportSummaryReport" = true 
      WHERE role = 'global_admin' AND "isActive" = true;
    `);
    
    console.log(`Set sendImportSummaryReport=true for existing active global_admin users.`);
    
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
  addSendImportSummaryReportField()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { addSendImportSummaryReportField };

