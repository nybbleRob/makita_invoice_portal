/**
 * Migration: Add recipientCount column to email_logs table
 * This column tracks the number of recipients for batch emails
 */

const { sequelize } = require('../models');

async function addRecipientCountColumn() {
  try {
    console.log('Adding recipientCount column to email_logs table...');
    
    // Check if column already exists
    const [results] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'email_logs' 
      AND column_name = 'recipientCount'
    `);
    
    if (results.length > 0) {
      console.log('✓ Column recipientCount already exists in email_logs table');
      return;
    }
    
    // Add the column
    await sequelize.query(`
      ALTER TABLE email_logs 
      ADD COLUMN "recipientCount" INTEGER DEFAULT 1,
      ADD CONSTRAINT "email_logs_recipientCount_check" 
        CHECK ("recipientCount" >= 1)
    `);
    
    // Update existing rows to have recipientCount = 1
    await sequelize.query(`
      UPDATE email_logs 
      SET "recipientCount" = 1 
      WHERE "recipientCount" IS NULL
    `);
    
    // Add comment
    await sequelize.query(`
      COMMENT ON COLUMN email_logs."recipientCount" IS 
      'Number of recipients (1 for single, >1 for batch emails)'
    `);
    
    console.log('✓ Successfully added recipientCount column to email_logs table');
  } catch (error) {
    console.error('✗ Error adding recipientCount column:', error.message);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Run migration if called directly
if (require.main === module) {
  addRecipientCountColumn()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = addRecipientCountColumn;
