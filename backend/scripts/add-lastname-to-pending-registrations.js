/**
 * Migration Script: Add lastName column to pending_registrations table
 */

const { sequelize } = require('../models');

async function addLastNameToPendingRegistrations() {
  try {
    console.log('🔄 Adding lastName column to pending_registrations table...');
    
    // Check if column already exists
    const [results] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'pending_registrations' 
      AND column_name = 'lastName'
    `);
    
    if (results.length > 0) {
      console.log('✅ Column already exists, skipping...');
      return;
    }
    
    // Add the column
    await sequelize.query(`
      ALTER TABLE pending_registrations 
      ADD COLUMN "lastName" VARCHAR(255)
    `);
    
    console.log('✅ Successfully added lastName column!');
    
  } catch (error) {
    console.error('❌ Error adding column:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  sequelize.authenticate()
    .then(() => {
      console.log('📦 Database connection established');
      return addLastNameToPendingRegistrations();
    })
    .then(() => {
      console.log('✅ Migration complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { addLastNameToPendingRegistrations };

