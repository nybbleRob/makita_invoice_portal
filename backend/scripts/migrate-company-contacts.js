/**
 * Migration script to add company contact and notification columns
 */
const { sequelize } = require('../models');

async function migrate() {
  try {
    console.log('Starting migration...');
    
    // Add columns to companies table
    console.log('Adding columns to companies table...');
    await sequelize.query(`
      ALTER TABLE companies 
      ADD COLUMN IF NOT EXISTS "primaryContactId" UUID REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS "sendInvoiceEmail" BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS "sendInvoiceAttachment" BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS "sendStatementEmail" BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS "sendStatementAttachment" BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS "sendEmailAsSummary" BOOLEAN DEFAULT false;
    `);
    
    // Add index on primaryContactId
    console.log('Creating index on primaryContactId...');
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS companies_primary_contact_idx ON companies("primaryContactId");
    `);
    
    // Add notification_contact to users role enum if not exists
    console.log('Updating users role enum...');
    try {
      await sequelize.query(`
        ALTER TYPE enum_users_role ADD VALUE IF NOT EXISTS 'notification_contact';
      `);
    } catch (enumError) {
      // Enum value might already exist
      console.log('Role enum update skipped (may already exist):', enumError.message);
    }
    
    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Migration error:', err.message);
    console.error(err);
    process.exit(1);
  }
}

migrate();

