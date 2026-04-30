/**
 * Migration Script: Add Account Lockout Settings to Settings Table
 * 
 * This script adds the following fields to the settings table:
 * - accountLockoutEnabled (BOOLEAN, default: true)
 * - maxFailedLoginAttempts (INTEGER, default: 5)
 * - lockoutDurationMinutes (INTEGER, default: 30)
 * - lockoutDurationOptions (JSONB, default: predefined options)
 * 
 * Run with: node backend/scripts/add-lockout-settings.js
 */

const { sequelize } = require('../config/database');
const { QueryTypes } = require('sequelize');

async function addLockoutSettings() {
  const transaction = await sequelize.transaction();
  
  try {
    console.log('🔄 Starting migration: Add Account Lockout Settings...');
    
    // Check if columns already exist
    const [existingColumns] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'settings' 
      AND column_name IN ('accountLockoutEnabled', 'maxFailedLoginAttempts', 'lockoutDurationMinutes', 'lockoutDurationOptions')
    `, { transaction });
    
    const existingColumnNames = existingColumns.map(col => col.column_name);
    
    // Add accountLockoutEnabled column
    if (!existingColumnNames.includes('accountLockoutEnabled')) {
      console.log('  ➕ Adding accountLockoutEnabled column...');
      await sequelize.query(`
        ALTER TABLE settings 
        ADD COLUMN "accountLockoutEnabled" BOOLEAN DEFAULT true NOT NULL
      `, { transaction });
      console.log('  ✅ Added accountLockoutEnabled column');
    } else {
      console.log('  ⏭️  accountLockoutEnabled column already exists');
    }
    
    // Add maxFailedLoginAttempts column
    if (!existingColumnNames.includes('maxFailedLoginAttempts')) {
      console.log('  ➕ Adding maxFailedLoginAttempts column...');
      await sequelize.query(`
        ALTER TABLE settings 
        ADD COLUMN "maxFailedLoginAttempts" INTEGER DEFAULT 5 NOT NULL
      `, { transaction });
      console.log('  ✅ Added maxFailedLoginAttempts column');
    } else {
      console.log('  ⏭️  maxFailedLoginAttempts column already exists');
    }
    
    // Add lockoutDurationMinutes column
    if (!existingColumnNames.includes('lockoutDurationMinutes')) {
      console.log('  ➕ Adding lockoutDurationMinutes column...');
      await sequelize.query(`
        ALTER TABLE settings 
        ADD COLUMN "lockoutDurationMinutes" INTEGER DEFAULT 30 NOT NULL
      `, { transaction });
      console.log('  ✅ Added lockoutDurationMinutes column');
    } else {
      console.log('  ⏭️  lockoutDurationMinutes column already exists');
    }
    
    // Add lockoutDurationOptions column
    if (!existingColumnNames.includes('lockoutDurationOptions')) {
      console.log('  ➕ Adding lockoutDurationOptions column...');
      await sequelize.query(`
        ALTER TABLE settings 
        ADD COLUMN "lockoutDurationOptions" JSONB DEFAULT '[
          {"value": 15, "label": "15 minutes"},
          {"value": 30, "label": "30 minutes"},
          {"value": 60, "label": "1 hour"},
          {"value": 120, "label": "2 hours"},
          {"value": null, "label": "Indefinite (admin unlock only)"}
        ]'::jsonb
      `, { transaction });
      console.log('  ✅ Added lockoutDurationOptions column');
    } else {
      console.log('  ⏭️  lockoutDurationOptions column already exists');
    }
    
    // Initialize existing settings with default values
    console.log('  🔄 Initializing default values for existing settings...');
    await sequelize.query(`
      UPDATE settings 
      SET 
        "accountLockoutEnabled" = COALESCE("accountLockoutEnabled", true),
        "maxFailedLoginAttempts" = COALESCE("maxFailedLoginAttempts", 5),
        "lockoutDurationMinutes" = COALESCE("lockoutDurationMinutes", 30),
        "lockoutDurationOptions" = COALESCE("lockoutDurationOptions", '[
          {"value": 15, "label": "15 minutes"},
          {"value": 30, "label": "30 minutes"},
          {"value": 60, "label": "1 hour"},
          {"value": 120, "label": "2 hours"},
          {"value": null, "label": "Indefinite (admin unlock only)"}
        ]'::jsonb)
      WHERE id IN (SELECT id FROM settings LIMIT 1)
    `, { transaction });
    console.log('  ✅ Initialized default values');
    
    await transaction.commit();
    console.log('✅ Migration completed successfully!');
    console.log('');
    console.log('📝 Next steps:');
    console.log('   1. Restart your backend server to reload model definitions');
    
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
  addLockoutSettings()
    .then(() => {
      console.log('✅ Script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { addLockoutSettings };
