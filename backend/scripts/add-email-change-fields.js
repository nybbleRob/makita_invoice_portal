/**
 * Migration script to add email change fields to users table
 * Run with: node backend/scripts/add-email-change-fields.js
 */

const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

async function addEmailChangeFields() {
  try {
    console.log('Starting migration: Adding email change fields to users table...');
    
    const transaction = await sequelize.transaction();
    
    try {
      // Check if columns already exist
      const [results] = await sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' 
        AND column_name IN ('pendingEmail', 'emailChangeToken', 'emailChangeExpires')
      `, { transaction });
      
      const existingColumns = results.map(r => r.column_name);
      
      // Add pendingEmail column if it doesn't exist
      if (!existingColumns.includes('pendingEmail')) {
        await sequelize.query(`
          ALTER TABLE users 
          ADD COLUMN "pendingEmail" VARCHAR(255) NULL,
          ADD CONSTRAINT "users_pendingEmail_check" CHECK ("pendingEmail" IS NULL OR "pendingEmail" ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$')
        `, { transaction });
        console.log('✓ Added pendingEmail column');
      } else {
        console.log('⚠ pendingEmail column already exists');
      }
      
      // Add emailChangeToken column if it doesn't exist
      if (!existingColumns.includes('emailChangeToken')) {
        await sequelize.query(`
          ALTER TABLE users 
          ADD COLUMN "emailChangeToken" VARCHAR(255) NULL
        `, { transaction });
        console.log('✓ Added emailChangeToken column');
      } else {
        console.log('⚠ emailChangeToken column already exists');
      }
      
      // Add emailChangeExpires column if it doesn't exist
      if (!existingColumns.includes('emailChangeExpires')) {
        await sequelize.query(`
          ALTER TABLE users 
          ADD COLUMN "emailChangeExpires" TIMESTAMP WITH TIME ZONE NULL
        `, { transaction });
        console.log('✓ Added emailChangeExpires column');
      } else {
        console.log('⚠ emailChangeExpires column already exists');
      }
      
      await transaction.commit();
      console.log('✅ Migration completed successfully!');
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Run migration
if (require.main === module) {
  addEmailChangeFields()
    .then(() => {
      console.log('✅ Script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { addEmailChangeFields };
