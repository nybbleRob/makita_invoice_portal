const { sequelize } = require('../config/database');
const { Template } = require('../models');

async function syncModel() {
  try {
    console.log('Syncing Template model with database...');
    
    // Force sync - this will update the table structure to match the model
    await Template.sync({ alter: true });
    
    console.log('Template model synced successfully');
    
  } catch (error) {
    console.error('Error syncing model:', error.message);
    console.error(error);
  } finally {
    await sequelize.close();
  }
}

syncModel();

