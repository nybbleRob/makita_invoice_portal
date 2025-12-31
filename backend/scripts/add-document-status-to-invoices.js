/**
 * Migration script to add viewedAt and downloadedAt fields to invoices table
 */

const { sequelize } = require('../models');

async function addDocumentStatusFields() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');

    const queryInterface = sequelize.getQueryInterface();

    // Check if viewedAt column exists
    const tableDescription = await queryInterface.describeTable('invoices');
    
    if (!tableDescription.viewedAt) {
      await queryInterface.addColumn('invoices', 'viewedAt', {
        type: sequelize.Sequelize.DATE,
        allowNull: true,
        comment: 'Date when document was first viewed by customer'
      });
      console.log('✅ Added viewedAt column');
    } else {
      console.log('⏭️  viewedAt column already exists');
    }

    if (!tableDescription.downloadedAt) {
      await queryInterface.addColumn('invoices', 'downloadedAt', {
        type: sequelize.Sequelize.DATE,
        allowNull: true,
        comment: 'Date when document was first downloaded by customer'
      });
      console.log('✅ Added downloadedAt column');
    } else {
      console.log('⏭️  downloadedAt column already exists');
    }

    console.log('\n✅ Migration complete!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

addDocumentStatusFields();

