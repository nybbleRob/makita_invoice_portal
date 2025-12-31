/**
 * Migration script to add document retention fields
 * Adds fields to settings, invoices, credit_notes, and statements tables
 */

const { sequelize } = require('../config/database');

async function addDocumentRetentionFields() {
  const transaction = await sequelize.transaction();
  
  try {
    console.log('🔄 Adding document retention fields...');
    
    // Add fields to settings table
    console.log('📝 Adding fields to settings table...');
    await sequelize.query(`
      ALTER TABLE settings 
      ADD COLUMN IF NOT EXISTS "documentRetentionPeriod" INTEGER,
      ADD COLUMN IF NOT EXISTS "documentRetentionDateTrigger" VARCHAR(20) DEFAULT 'upload_date' CHECK ("documentRetentionDateTrigger" IN ('upload_date', 'invoice_date'));
    `, { transaction });
    
    // Add fields to invoices table
    console.log('📝 Adding fields to invoices table...');
    await sequelize.query(`
      ALTER TABLE invoices 
      ADD COLUMN IF NOT EXISTS "retentionStartDate" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "retentionExpiryDate" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "retentionDeletedAt" TIMESTAMP;
    `, { transaction });
    
    // Add index for retention expiry date queries
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS "invoices_retentionExpiryDate_idx" ON invoices ("retentionExpiryDate");
    `, { transaction });
    
    // Add fields to credit_notes table
    console.log('📝 Adding fields to credit_notes table...');
    await sequelize.query(`
      ALTER TABLE credit_notes 
      ADD COLUMN IF NOT EXISTS "retentionStartDate" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "retentionExpiryDate" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "retentionDeletedAt" TIMESTAMP;
    `, { transaction });
    
    // Add index for retention expiry date queries
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS "credit_notes_retentionExpiryDate_idx" ON credit_notes ("retentionExpiryDate");
    `, { transaction });
    
    // Add fields to statements table
    console.log('📝 Adding fields to statements table...');
    await sequelize.query(`
      ALTER TABLE statements 
      ADD COLUMN IF NOT EXISTS "retentionStartDate" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "retentionExpiryDate" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "retentionDeletedAt" TIMESTAMP;
    `, { transaction });
    
    // Add index for retention expiry date queries
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS "statements_retentionExpiryDate_idx" ON statements ("retentionExpiryDate");
    `, { transaction });
    
    await transaction.commit();
    console.log('✅ Document retention fields added successfully!');
    
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error adding document retention fields:', error);
    throw error;
  }
}

// Run migration if called directly
if (require.main === module) {
  addDocumentRetentionFields()
    .then(() => {
      console.log('✅ Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { addDocumentRetentionFields };

