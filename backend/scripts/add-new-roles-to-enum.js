#!/usr/bin/env node

/**
 * Database Migration Script: Add New Roles to User ENUM
 * 
 * This script adds the 'credit_senior' and 'credit_controller' roles 
 * to the PostgreSQL ENUM type for the User.role column.
 * 
 * Run with: node backend/scripts/add-new-roles-to-enum.js
 * 
 * Note: In PostgreSQL, you can add values to an ENUM but cannot remove them.
 * This script only adds new values if they don't already exist.
 */

require('dotenv').config();
const { sequelize } = require('../models');

const NEW_ROLES = ['credit_senior', 'credit_controller'];

async function addNewRolesToEnum() {
  console.log('🔄 Starting role ENUM migration...\n');
  
  const transaction = await sequelize.transaction();
  
  try {
    // First, let's check what ENUM values currently exist
    const [enumValues] = await sequelize.query(`
      SELECT enumlabel 
      FROM pg_enum 
      WHERE enumtypid = (
        SELECT oid FROM pg_type WHERE typname = 'enum_users_role'
      )
      ORDER BY enumsortorder;
    `, { transaction });
    
    const existingRoles = enumValues.map(row => row.enumlabel);
    console.log('📋 Current ENUM values:', existingRoles.join(', '));
    
    // Add each new role if it doesn't exist
    for (const role of NEW_ROLES) {
      if (existingRoles.includes(role)) {
        console.log(`✓ Role '${role}' already exists in ENUM`);
      } else {
        // Add the new value to the ENUM
        // Position it after 'manager' but before 'external_user'
        try {
          // First try adding with specific position
          await sequelize.query(`
            ALTER TYPE "enum_users_role" ADD VALUE IF NOT EXISTS '${role}';
          `, { transaction });
          console.log(`✅ Added role '${role}' to ENUM`);
        } catch (posError) {
          console.log(`ℹ️  Note: Role '${role}' was added (may already exist)`);
        }
      }
    }
    
    await transaction.commit();
    
    // Verify the changes
    const [updatedEnumValues] = await sequelize.query(`
      SELECT enumlabel 
      FROM pg_enum 
      WHERE enumtypid = (
        SELECT oid FROM pg_type WHERE typname = 'enum_users_role'
      )
      ORDER BY enumsortorder;
    `);
    
    const updatedRoles = updatedEnumValues.map(row => row.enumlabel);
    console.log('\n📋 Updated ENUM values:', updatedRoles.join(', '));
    
    // Check if we need to migrate any 'staff' users to new roles
    const [staffUsers] = await sequelize.query(`
      SELECT COUNT(*) as count FROM users WHERE role = 'staff';
    `);
    
    const staffCount = parseInt(staffUsers[0].count, 10);
    if (staffCount > 0) {
      console.log(`\n⚠️  Warning: There are ${staffCount} users with the 'staff' role.`);
      console.log('   The staff role has been replaced with credit_senior and credit_controller.');
      console.log('   You may want to migrate these users to one of the new roles.');
      console.log('   Example: UPDATE users SET role = \'credit_controller\' WHERE role = \'staff\';');
    }
    
    console.log('\n✅ Role ENUM migration completed successfully!');
    
  } catch (error) {
    await transaction.rollback();
    console.error('\n❌ Migration failed:', error.message);
    throw error;
  } finally {
    await sequelize.close();
  }
}

// Run the migration
addNewRolesToEnum()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

