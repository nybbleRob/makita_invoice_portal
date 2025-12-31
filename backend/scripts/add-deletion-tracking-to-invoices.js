/**
 * Migration script to add deletion tracking fields to invoices table
 */

const { sequelize } = require('../models');

async function addDeletionTrackingFields() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');

    const queryInterface = sequelize.getQueryInterface();

    // Check if deletedBy column exists
    const tableDescription = await queryInterface.describeTable('invoices');
    
    if (!tableDescription.deletedBy) {
      await queryInterface.addColumn('invoices', 'deletedBy', {
        type: sequelize.Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        comment: 'User who deleted this invoice'
      });
      console.log('✅ Added deletedBy column');
    } else {
      console.log('⏭️  deletedBy column already exists');
    }

    if (!tableDescription.deletedReason) {
      await queryInterface.addColumn('invoices', 'deletedReason', {
        type: sequelize.Sequelize.TEXT,
        allowNull: true,
        comment: 'Reason for deletion (required for accountability)'
      });
      console.log('✅ Added deletedReason column');
    } else {
      console.log('⏭️  deletedReason column already exists');
    }

    if (!tableDescription.deletedAt) {
      await queryInterface.addColumn('invoices', 'deletedAt', {
        type: sequelize.Sequelize.DATE,
        allowNull: true,
        comment: 'Date when invoice was deleted'
      });
      console.log('✅ Added deletedAt column');
    } else {
      console.log('⏭️  deletedAt column already exists');
    }

    console.log('\n✅ Migration complete!\n');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

addDeletionTrackingFields();

