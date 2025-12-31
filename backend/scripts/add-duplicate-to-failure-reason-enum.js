/**
 * Migration: Add 'duplicate' to failureReason ENUM
 * 
 * This allows storing 'duplicate' as a failure reason for files
 * 
 * Run: node backend/scripts/add-duplicate-to-failure-reason-enum.js
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
    console.log('🔄 Starting migration: Add "duplicate" to failureReason ENUM...');
    
    await sequelize.authenticate();
    console.log('✅ Connected to database');
    
    // Check if 'duplicate' already exists in the enum
    const enumCheck = await sequelize.query(`
      SELECT 
        t.typname as enum_name,
        e.enumlabel as enum_value
      FROM pg_type t 
      JOIN pg_enum e ON t.oid = e.enumtypid  
      WHERE t.typname = 'enum_files_failureReason'
      AND e.enumlabel = 'duplicate';
    `, { type: Sequelize.QueryTypes.SELECT });
    
    if (enumCheck.length > 0) {
      console.log('   ℹ️  "duplicate" already exists in failureReason enum');
    } else {
      console.log('📝 Adding "duplicate" to failureReason enum...');
      
      // Add 'duplicate' to the enum
      await sequelize.query(`
        ALTER TYPE enum_files_failureReason ADD VALUE IF NOT EXISTS 'duplicate';
      `);
      
      console.log('   ✅ Added "duplicate" to failureReason enum');
    }
    
    console.log('✅ Migration completed successfully!');
    console.log('');
    console.log('📋 Summary:');
    console.log('   - failureReason enum now includes: unallocated, parsing_error, validation_error, duplicate, other');
    
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

