const { sequelize } = require('../config/database');

async function addCustomFieldsToTemplates() {
  const transaction = await sequelize.transaction();

  try {
    console.log('🔄 Adding customFields column to templates table...');

    // Check if column already exists
    const [results] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'templates' 
      AND column_name = 'customFields';
    `, { transaction });

    if (results.length > 0) {
      console.log('✅ customFields column already exists');
      await transaction.commit();
      return;
    }

    // Add customFields JSONB column
    console.log('📝 Adding customFields column...');
    await sequelize.query(`
      ALTER TABLE templates 
      ADD COLUMN "customFields" JSONB DEFAULT '{}'::jsonb;
    `, { transaction });

    // Add comment
    await sequelize.query(`
      COMMENT ON COLUMN templates."customFields" IS 'Custom field definitions with displayName, showInTable, showInFilter, dataType, etc.';
    `, { transaction });

    // Initialize existing templates with empty object
    await sequelize.query(`
      UPDATE templates 
      SET "customFields" = '{}'::jsonb 
      WHERE "customFields" IS NULL;
    `, { transaction });

    await transaction.commit();
    console.log('✅ customFields column added successfully!');

  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error adding customFields column:', error);
    throw error;
  }
}

if (require.main === module) {
  addCustomFieldsToTemplates()
    .then(() => {
      console.log('✅ Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { addCustomFieldsToTemplates };

