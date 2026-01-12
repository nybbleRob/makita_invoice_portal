/**
 * Fix supplier_files source check constraint to include 'bulk_import'
 * Run: node scripts/fix-supplier-files-source-constraint.js
 */

require('dotenv').config();
const { Sequelize } = require('sequelize');

async function fixSourceConstraint() {
  // Use individual DB parameters (not DATABASE_URL)
  const sequelize = new Sequelize(
    process.env.DB_NAME || 'makita_invoice_portal',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASSWORD || '',
    {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      dialect: 'postgres',
      logging: console.log
    }
  );

  try {
    console.log('🔧 Fixing supplier_files source constraint...');
    
    // Start transaction
    const transaction = await sequelize.transaction();
    
    try {
      // Drop the existing constraint
      console.log('➖ Dropping existing constraint...');
      await sequelize.query(`
        ALTER TABLE supplier_files 
        DROP CONSTRAINT IF EXISTS supplier_files_source_check;
      `, { transaction });
      
      // Add updated constraint with 'bulk_import' included
      console.log('➕ Adding updated constraint with bulk_import...');
      await sequelize.query(`
        ALTER TABLE supplier_files 
        ADD CONSTRAINT supplier_files_source_check 
        CHECK (source IN ('manual', 'ftp', 'email', 'api', 'bulk_import'));
      `, { transaction });
      
      await transaction.commit();
      console.log('✅ Constraint updated successfully!');
      
      // Verify the constraint
      const [results] = await sequelize.query(`
        SELECT conname, pg_get_constraintdef(oid) as definition
        FROM pg_constraint 
        WHERE conname = 'supplier_files_source_check';
      `);
      
      if (results.length > 0) {
        console.log('📋 Updated constraint:');
        console.log(`   ${results[0].conname}: ${results[0].definition}`);
      }
      
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    
    await sequelize.close();
    console.log('✅ Done!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fixSourceConstraint();
