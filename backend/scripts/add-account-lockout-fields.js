/**
 * Migration Script: Add Account Lockout Fields to Users Table
 * 
 * This script adds the following columns to the users table:
 * - failedLoginAttempts (INTEGER, default: 0)
 * - accountLockedUntil (TIMESTAMP, nullable)
 * - lastFailedLoginAt (TIMESTAMP, nullable)
 * - lockedBy (UUID, nullable, foreign key to users.id)
 * - lockReason (VARCHAR, nullable)
 * 
 * It also creates indexes on accountLockedUntil and failedLoginAttempts for performance.
 * 
 * Run with: node backend/scripts/add-account-lockout-fields.js
 */

const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

async function addAccountLockoutFields() {
  const transaction = await sequelize.transaction();
  
  try {
    console.log('🔄 Starting migration: Add Account Lockout Fields...');
    
    // Check if columns already exist
    const [existingColumns] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name IN ('failedLoginAttempts', 'accountLockedUntil', 'lastFailedLoginAt', 'lockedBy', 'lockReason')
    `, { transaction });
    
    const existingColumnNames = existingColumns.map(col => col.column_name);
    
    // Add failedLoginAttempts column
    if (!existingColumnNames.includes('failedLoginAttempts')) {
      console.log('  ➕ Adding failedLoginAttempts column...');
      await sequelize.query(`
        ALTER TABLE users 
        ADD COLUMN "failedLoginAttempts" INTEGER DEFAULT 0 NOT NULL
      `, { transaction });
      console.log('  ✅ Added failedLoginAttempts column');
    } else {
      console.log('  ⏭️  failedLoginAttempts column already exists');
    }
    
    // Add accountLockedUntil column
    if (!existingColumnNames.includes('accountLockedUntil')) {
      console.log('  ➕ Adding accountLockedUntil column...');
      await sequelize.query(`
        ALTER TABLE users 
        ADD COLUMN "accountLockedUntil" TIMESTAMP NULL
      `, { transaction });
      console.log('  ✅ Added accountLockedUntil column');
    } else {
      console.log('  ⏭️  accountLockedUntil column already exists');
    }
    
    // Add lastFailedLoginAt column
    if (!existingColumnNames.includes('lastFailedLoginAt')) {
      console.log('  ➕ Adding lastFailedLoginAt column...');
      await sequelize.query(`
        ALTER TABLE users 
        ADD COLUMN "lastFailedLoginAt" TIMESTAMP NULL
      `, { transaction });
      console.log('  ✅ Added lastFailedLoginAt column');
    } else {
      console.log('  ⏭️  lastFailedLoginAt column already exists');
    }
    
    // Add lockedBy column
    if (!existingColumnNames.includes('lockedBy')) {
      console.log('  ➕ Adding lockedBy column...');
      await sequelize.query(`
        ALTER TABLE users 
        ADD COLUMN "lockedBy" UUID NULL
      `, { transaction });
      
      // Add foreign key constraint
      console.log('  ➕ Adding foreign key constraint for lockedBy...');
      await sequelize.query(`
        ALTER TABLE users 
        ADD CONSTRAINT "users_lockedBy_fkey" 
        FOREIGN KEY ("lockedBy") 
        REFERENCES users(id) 
        ON DELETE SET NULL
      `, { transaction });
      console.log('  ✅ Added lockedBy column with foreign key');
    } else {
      console.log('  ⏭️  lockedBy column already exists');
    }
    
    // Add lockReason column
    if (!existingColumnNames.includes('lockReason')) {
      console.log('  ➕ Adding lockReason column...');
      await sequelize.query(`
        ALTER TABLE users 
        ADD COLUMN "lockReason" VARCHAR(255) NULL
      `, { transaction });
      console.log('  ✅ Added lockReason column');
    } else {
      console.log('  ⏭️  lockReason column already exists');
    }
    
    // Check if indexes already exist
    const [existingIndexes] = await sequelize.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'users' 
      AND indexname IN ('users_accountLockedUntil_idx', 'users_failedLoginAttempts_idx')
    `, { transaction });
    
    const existingIndexNames = existingIndexes.map(idx => idx.indexname);
    
    // Create index on accountLockedUntil
    if (!existingIndexNames.includes('users_accountLockedUntil_idx')) {
      console.log('  ➕ Creating index on accountLockedUntil...');
      await sequelize.query(`
        CREATE INDEX "users_accountLockedUntil_idx" 
        ON users("accountLockedUntil")
      `, { transaction });
      console.log('  ✅ Created index on accountLockedUntil');
    } else {
      console.log('  ⏭️  Index on accountLockedUntil already exists');
    }
    
    // Create index on failedLoginAttempts
    if (!existingIndexNames.includes('users_failedLoginAttempts_idx')) {
      console.log('  ➕ Creating index on failedLoginAttempts...');
      await sequelize.query(`
        CREATE INDEX "users_failedLoginAttempts_idx" 
        ON users("failedLoginAttempts")
      `, { transaction });
      console.log('  ✅ Created index on failedLoginAttempts');
    } else {
      console.log('  ⏭️  Index on failedLoginAttempts already exists');
    }
    
    // Initialize existing users with default values
    console.log('  🔄 Initializing default values for existing users...');
    await sequelize.query(`
      UPDATE users 
      SET "failedLoginAttempts" = 0 
      WHERE "failedLoginAttempts" IS NULL
    `, { transaction });
    console.log('  ✅ Initialized default values');
    
    await transaction.commit();
    console.log('✅ Migration completed successfully!');
    console.log('');
    console.log('📝 Next steps:');
    console.log('   1. Restart your backend server to reload model definitions');
    console.log('   2. Run the Settings migration script to add lockout configuration');
    
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Migration failed:', error.message);
    console.error('   Stack:', error.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Run migration
if (require.main === module) {
  addAccountLockoutFields()
    .then(() => {
      console.log('✅ Script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { addAccountLockoutFields };
