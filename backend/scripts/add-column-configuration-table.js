const { sequelize } = require('../config/database');

async function addColumnConfigurationTable() {
  const transaction = await sequelize.transaction();

  try {
    console.log('🔄 Creating column_configurations table...');

    // Create ENUM type for pageType if it doesn't exist
    console.log('📝 Creating ENUM type for page type...');
    await sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE page_type_enum AS ENUM ('invoices', 'credit_notes');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `, { transaction });

    // Create table
    console.log('📝 Creating column_configurations table...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS column_configurations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "pageType" page_type_enum NOT NULL UNIQUE,
        "visibleColumns" JSONB DEFAULT '[]'::jsonb,
        "columnOrder" JSONB DEFAULT '[]'::jsonb,
        "columnWidths" JSONB DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `, { transaction });

    // Add comments
    await sequelize.query(`
      COMMENT ON TABLE column_configurations IS 'Global column visibility preferences for invoice and credit note tables';
      COMMENT ON COLUMN column_configurations."pageType" IS 'Type of page: invoices or credit_notes';
      COMMENT ON COLUMN column_configurations."visibleColumns" IS 'Array of field names that should be visible as columns';
      COMMENT ON COLUMN column_configurations."columnOrder" IS 'Array of field names in display order';
      COMMENT ON COLUMN column_configurations."columnWidths" IS 'Object mapping field names to column widths';
    `, { transaction });

    // Create indexes
    console.log('📝 Creating indexes...');
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS "column_configurations_pageType_idx" ON column_configurations ("pageType");
    `, { transaction });

    // Initialize default configurations
    console.log('📝 Initializing default configurations...');
    
    // Default visible columns for invoices (standard fields)
    const defaultInvoiceColumns = [
      'type',
      'accountNumber',
      'companyName',
      'invoiceNumber',
      'poNumber',
      'issueDate',
      'amount',
      'status'
    ];

    // Default visible columns for credit notes
    const defaultCreditNoteColumns = [
      'type',
      'accountNumber',
      'companyName',
      'creditNumber',
      'issueDate',
      'amount',
      'status'
    ];

    await sequelize.query(`
      INSERT INTO column_configurations ("pageType", "visibleColumns", "columnOrder", "columnWidths")
      VALUES 
        ('invoices', $1::jsonb, $1::jsonb, '{}'::jsonb),
        ('credit_notes', $2::jsonb, $2::jsonb, '{}'::jsonb)
      ON CONFLICT ("pageType") DO NOTHING;
    `, {
      bind: [
        JSON.stringify(defaultInvoiceColumns),
        JSON.stringify(defaultCreditNoteColumns)
      ],
      transaction
    });

    await transaction.commit();
    console.log('✅ column_configurations table created successfully!');

  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error creating column_configurations table:', error);
    throw error;
  }
}

if (require.main === module) {
  addColumnConfigurationTable()
    .then(() => {
      console.log('✅ Migration completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { addColumnConfigurationTable };

