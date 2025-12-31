/**
 * Migration: Add specific failure reasons to enum_files_failureReason
 * Adds: company_not_found, missing_account_number, missing_invoice_total, invalid_date_format, missing_invoice_number, missing_po_number, missing_vat_amount
 */

const { Sequelize } = require('sequelize');
require('dotenv').config();

async function runMigration() {
  const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      dialect: 'postgres',
      logging: false
    }
  );

  try {
    console.log('🔄 Starting migration: Add specific failure reasons...\n');

    // Check current enum values (PostgreSQL converts unquoted identifiers to lowercase)
    const enumValues = await sequelize.query(`
      SELECT 
        e.enumlabel as enum_value
      FROM pg_type t 
      JOIN pg_enum e ON t.oid = e.enumtypid  
      WHERE t.typname = 'enum_files_failurereason'
      ORDER BY e.enumsortorder;
    `, { type: Sequelize.QueryTypes.SELECT });

    console.log('📋 Current enum values:');
    enumValues.forEach(e => {
      console.log(`   - ${e.enum_value}`);
    });

    // New failure reasons to add
    const newReasons = [
      'company_not_found',
      'missing_account_number',
      'missing_invoice_total',
      'invalid_date_format',
      'missing_invoice_number',
      'missing_po_number',
      'missing_vat_amount'
    ];

    console.log('\n📝 Adding new failure reasons...');
    for (const reason of newReasons) {
      // Check if already exists
      const exists = enumValues.some(e => e.enum_value === reason);
      
      if (exists) {
        console.log(`   ℹ️  "${reason}" already exists`);
      } else {
        try {
          await sequelize.query(`
            ALTER TYPE enum_files_failurereason ADD VALUE IF NOT EXISTS '${reason}';
          `);
          console.log(`   ✅ Added "${reason}"`);
        } catch (error) {
          // IF NOT EXISTS might not work in all PostgreSQL versions, so catch and continue
          if (error.message.includes('already exists')) {
            console.log(`   ℹ️  "${reason}" already exists`);
          } else {
            throw error;
          }
        }
      }
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\n📋 Summary:');
    console.log('   - Added specific failure reasons for better tracking');
    console.log('   - Reasons: company_not_found, missing_account_number, missing_invoice_total,');
    console.log('             invalid_date_format, missing_invoice_number, missing_po_number,');
    console.log('             missing_vat_amount');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  runMigration();
}

module.exports = runMigration;

