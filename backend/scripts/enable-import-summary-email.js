#!/usr/bin/env node

/**
 * Enable Import Summary Email for Admin Users
 * 
 * This script enables the sendImportSummaryReport flag for all Global Admins and Administrators.
 * When enabled, these users will receive an email summary after each import batch completes.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { User } = require('../models');
const { Op } = require('sequelize');

async function enableImportSummaryEmails() {
  try {
    console.log('=== Enable Import Summary Emails ===\n');
    
    // Find all admin users
    const adminUsers = await User.findAll({
      where: {
        role: { [Op.in]: ['global_admin', 'administrator'] },
        isActive: true
      },
      attributes: ['id', 'name', 'email', 'role', 'sendImportSummaryReport']
    });
    
    if (adminUsers.length === 0) {
      console.log('❌ No active admin users found.');
      return;
    }
    
    console.log(`Found ${adminUsers.length} active admin user(s):\n`);
    
    // Show current status
    adminUsers.forEach(user => {
      const status = user.sendImportSummaryReport ? '✅ ENABLED' : '❌ DISABLED';
      console.log(`${status}  ${user.email} (${user.role})`);
    });
    
    // Enable for all who don't have it enabled
    const usersToUpdate = adminUsers.filter(u => !u.sendImportSummaryReport);
    
    if (usersToUpdate.length === 0) {
      console.log('\n✅ All admin users already have import summary emails enabled.');
      return;
    }
    
    console.log(`\n📧 Enabling import summary emails for ${usersToUpdate.length} user(s)...`);
    
    for (const user of usersToUpdate) {
      user.sendImportSummaryReport = true;
      await user.save();
      console.log(`   ✅ Enabled for ${user.email}`);
    }
    
    console.log('\n✅ Import summary emails enabled for all admin users!');
    console.log('\nℹ️  These users will now receive an email after each import batch completes.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

enableImportSummaryEmails();
