/**
 * Migration: Change processingMethod from ENUM to STRING
 * 
 * This allows storing longer processing method names like:
 * - local_coordinates_makita_invoice_template
 * - excel_template_template_name
 * - local_basic
 * 
 * Run: node backend/scripts/update-processing-method-to-string.js
 */

require('dotenv').config();
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME || 'invoice_portal',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || 'postgres',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: console.log
  }
);

async function migrate() {
  try {
    console.log('🔄 Starting migration: Update processingMethod to STRING...');
    
    await sequelize.authenticate();
    console.log('✅ Connected to database');
    
    // Drop the enum type and recreate as VARCHAR
    // Note: This will fail if there are existing values that don't match the enum
    // So we need to handle this carefully
    
    console.log('📝 Step 1: Altering processingMethod column to VARCHAR...');
    
    // First, check if the enum exists and what values it has
    const enumCheck = await sequelize.query(`
      SELECT 
        t.typname as enum_name,
        e.enumlabel as enum_value
      FROM pg_type t 
      JOIN pg_enum e ON t.oid = e.enumtypid  
      WHERE t.typname = 'enum_files_processingMethod'
      ORDER BY e.enumsortorder;
    `, { type: Sequelize.QueryTypes.SELECT });
    
    if (enumCheck.length > 0) {
      console.log(`   Found enum with values: ${enumCheck.map(e => e.enum_value).join(', ')}`);
      
      // Alter the column to TEXT first (to avoid enum constraint issues)
      await sequelize.query(`
        ALTER TABLE files 
        ALTER COLUMN "processingMethod" TYPE TEXT 
        USING "processingMethod"::TEXT;
      `);
      
      console.log('   ✅ Changed column type to TEXT');
      
      // Drop the enum type (optional, but cleans up)
      await sequelize.query(`
        DROP TYPE IF EXISTS enum_files_processingMethod;
      `);
      
      console.log('   ✅ Dropped old enum type');
    } else {
      console.log('   ℹ️  Enum type not found, column may already be TEXT/VARCHAR');
      
      // Try to alter anyway (in case it's still ENUM but not registered)
      try {
        await sequelize.query(`
          ALTER TABLE files 
          ALTER COLUMN "processingMethod" TYPE TEXT 
          USING "processingMethod"::TEXT;
        `);
        console.log('   ✅ Changed column type to TEXT');
      } catch (error) {
        if (error.message.includes('does not exist') || error.message.includes('already')) {
          console.log('   ℹ️  Column is already TEXT/VARCHAR or does not exist');
        } else {
          throw error;
        }
      }
    }
    
    console.log('✅ Migration completed successfully!');
    console.log('');
    console.log('📋 Summary:');
    console.log('   - processingMethod column is now TEXT (can store any string)');
    console.log('   - Old enum values (vision, documentai, manual) are still valid');
    console.log('   - New values like "local_coordinates_template_name" are now allowed');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Run migration
migrate();

