/**
 * Migration script to add email 2FA columns to the Users table
 * Run with: node scripts/add-email-2fa-columns.js
 */

require('dotenv').config();
const { sequelize } = require('../models');

async function addEmail2FAColumns() {
  try {
    console.log('Adding email 2FA columns to Users table...');
    
    // Check if columns already exist
    const [results] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'Users' 
      AND column_name IN ('twoFactorMethod', 'emailTwoFactorCode', 'emailTwoFactorExpires')
    `);
    
    const existingColumns = results.map(r => r.column_name);
    console.log('Existing columns:', existingColumns);
    
    // Add twoFactorMethod column if it doesn't exist
    if (!existingColumns.includes('twoFactorMethod')) {
      console.log('Adding twoFactorMethod column...');
      await sequelize.query(`
        ALTER TABLE "Users" 
        ADD COLUMN "twoFactorMethod" VARCHAR(255) DEFAULT NULL
      `);
      console.log('✅ twoFactorMethod column added');
    } else {
      console.log('⏭️  twoFactorMethod column already exists');
    }
    
    // Add emailTwoFactorCode column if it doesn't exist
    if (!existingColumns.includes('emailTwoFactorCode')) {
      console.log('Adding emailTwoFactorCode column...');
      await sequelize.query(`
        ALTER TABLE "Users" 
        ADD COLUMN "emailTwoFactorCode" VARCHAR(6) DEFAULT NULL
      `);
      console.log('✅ emailTwoFactorCode column added');
    } else {
      console.log('⏭️  emailTwoFactorCode column already exists');
    }
    
    // Add emailTwoFactorExpires column if it doesn't exist
    if (!existingColumns.includes('emailTwoFactorExpires')) {
      console.log('Adding emailTwoFactorExpires column...');
      await sequelize.query(`
        ALTER TABLE "Users" 
        ADD COLUMN "emailTwoFactorExpires" TIMESTAMP WITH TIME ZONE DEFAULT NULL
      `);
      console.log('✅ emailTwoFactorExpires column added');
    } else {
      console.log('⏭️  emailTwoFactorExpires column already exists');
    }
    
    console.log('\n✅ Migration complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

addEmail2FAColumns();
