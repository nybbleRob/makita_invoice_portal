/**
 * Migration script to add mandatoryFields column to settings table
 * Run with: node backend/scripts/add-mandatory-fields-column.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { sequelize } = require('../config/database');

const runMigration = async () => {
  try {
    console.log('🔄 Adding mandatoryFields column to settings table...');
    
    // Check if column already exists
    const [results] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'settings' 
      AND column_name = 'mandatoryFields';
    `);
    
    if (results.length > 0) {
      console.log('✅ mandatoryFields column already exists');
      await sequelize.close();
      process.exit(0);
    }
    
    // Add the column
    await sequelize.query(`
      ALTER TABLE settings 
      ADD COLUMN "mandatoryFields" JSONB DEFAULT '{
        "pdf": ["document_type", "account_number", "invoice_number", "vat_amount", "customer_po", "amount", "date"],
        "excel": ["document_type", "account_no", "invoice_number", "vat_amount", "invoice_total"]
      }'::jsonb;
    `);
    
    console.log('✅ Successfully added mandatoryFields column');
    
    // Update existing settings with default values
    await sequelize.query(`
      UPDATE settings 
      SET "mandatoryFields" = '{
        "pdf": ["document_type", "account_number", "invoice_number", "vat_amount", "customer_po", "amount", "date"],
        "excel": ["document_type", "account_no", "invoice_number", "vat_amount", "invoice_total"]
      }'::jsonb
      WHERE "mandatoryFields" IS NULL;
    `);
    
    console.log('✅ Updated existing settings with default mandatoryFields');
    
    await sequelize.close();
    console.log('🎉 Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    await sequelize.close();
    process.exit(1);
  }
};

runMigration();

