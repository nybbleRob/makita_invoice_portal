/**
 * Check and fix failureReason constraint
 * 
 * Run: node backend/scripts/check-failure-reason-constraint.js
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

async function checkConstraint() {
  try {
    console.log('🔍 Checking failureReason constraint...');
    
    await sequelize.authenticate();
    console.log('✅ Connected to database');
    
    // Check for CHECK constraints on failureReason
    const constraints = await sequelize.query(`
      SELECT 
        conname as constraint_name,
        pg_get_constraintdef(oid) as constraint_definition
      FROM pg_constraint
      WHERE conrelid = 'files'::regclass
      AND conname LIKE '%failureReason%';
    `, { type: Sequelize.QueryTypes.SELECT });
    
    console.log('\n📋 Found constraints:');
    constraints.forEach(c => {
      console.log(`   - ${c.constraint_name}: ${c.constraint_definition}`);
    });
    
    // Check enum values
    const enumValues = await sequelize.query(`
      SELECT 
        e.enumlabel as enum_value
      FROM pg_type t 
      JOIN pg_enum e ON t.oid = e.enumtypid  
      WHERE t.typname = 'enum_files_failureReason'
      ORDER BY e.enumsortorder;
    `, { type: Sequelize.QueryTypes.SELECT });
    
    console.log('\n📋 Enum values:');
    enumValues.forEach(e => {
      console.log(`   - ${e.enum_value}`);
    });
    
    // If there's a CHECK constraint that doesn't include 'duplicate', we need to drop and recreate it
    if (constraints.length > 0) {
      const constraint = constraints[0];
      if (!constraint.constraint_definition.includes("'duplicate'")) {
        console.log('\n⚠️  CHECK constraint found that may not include "duplicate"');
        console.log('   You may need to drop and recreate the constraint');
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Run check
checkConstraint();

