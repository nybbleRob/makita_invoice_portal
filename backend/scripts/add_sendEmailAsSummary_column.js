/**
 * Migration Script: Add sendEmailAsSummary column to users table
 * This column allows users to receive one summary email per import instead of individual emails per document
 */

const { sequelize } = require('../models');

async function addSendEmailAsSummaryColumn() {
  try {
    console.log('🔄 Adding sendEmailAsSummary column to users table...');

    // Check if column already exists
    const [results] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name = 'sendEmailAsSummary'
    `);

    if (results.length > 0) {
      console.log('✅ Column sendEmailAsSummary already exists. Skipping migration.');
      return;
    }

    // Add the column
    await sequelize.query(`
      ALTER TABLE users 
      ADD COLUMN "sendEmailAsSummary" BOOLEAN DEFAULT false
    `);

    // Add comment
    await sequelize.query(`
      COMMENT ON COLUMN users."sendEmailAsSummary" IS 'Send one summary email per import instead of individual emails per document'
    `);

    console.log('✅ Successfully added sendEmailAsSummary column to users table');
  } catch (error) {
    console.error('❌ Error adding sendEmailAsSummary column:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  sequelize.authenticate()
    .then(() => {
      console.log('📦 Database connection established');
      return addSendEmailAsSummaryColumn();
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

module.exports = { addSendEmailAsSummaryColumn };

