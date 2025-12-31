/**
 * Migration: Add documentStatus field to invoices, credit_notes, and statements tables
 * Also add queriedAt timestamp and edit tracking fields
 */

require('dotenv').config();
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false
  }
);

async function migrate() {
  try {
    console.log('🔄 Starting migration: Add documentStatus to invoices, credit_notes, and statements...');
    
    await sequelize.authenticate();
    console.log('✅ Database connection established');
    
    const queryInterface = sequelize.getQueryInterface();
    
    // Add documentStatus ENUM type
    console.log('📝 Creating documentStatus ENUM type...');
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE enum_document_status AS ENUM ('ready', 'review', 'viewed', 'downloaded', 'queried');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    
    // Add documentStatus to invoices
    console.log('📝 Adding documentStatus to invoices table...');
    try {
      // Check if column already exists
      const [results] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='invoices' AND column_name='documentStatus';
      `);
      
      if (results.length === 0) {
        await queryInterface.sequelize.query(`
          ALTER TABLE invoices 
          ADD COLUMN "documentStatus" enum_document_status DEFAULT 'ready';
        `);
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN invoices."documentStatus" IS 'Document status: ready (no issues), review (error/alert), viewed, downloaded, queried';
        `);
        console.log('✅ Added documentStatus to invoices');
      } else {
        console.log('⚠️  documentStatus column already exists in invoices, skipping...');
      }
    } catch (error) {
      console.error('Error adding documentStatus to invoices:', error.message);
      throw error;
    }
    
    // Add queriedAt to invoices
    console.log('📝 Adding queriedAt to invoices table...');
    try {
      const [results] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='invoices' AND column_name='queriedAt';
      `);
      
      if (results.length === 0) {
        await queryInterface.addColumn('invoices', 'queriedAt', {
          type: Sequelize.DATE,
          allowNull: true
        });
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN invoices."queriedAt" IS 'Date when document was queried by customer';
        `);
        console.log('✅ Added queriedAt to invoices');
      } else {
        console.log('⚠️  queriedAt column already exists in invoices, skipping...');
      }
    } catch (error) {
      console.error('Error adding queriedAt to invoices:', error.message);
      throw error;
    }
    
    // Add edit tracking fields to invoices
    console.log('📝 Adding edit tracking fields to invoices...');
    try {
      const [editedByExists] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='invoices' AND column_name='editedBy';
      `);
      
      if (editedByExists.length === 0) {
        await queryInterface.addColumn('invoices', 'editedBy', {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: 'users',
            key: 'id'
          }
        });
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN invoices."editedBy" IS 'User who last edited this invoice';
        `);
      }
      
      const [editReasonExists] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='invoices' AND column_name='editReason';
      `);
      
      if (editReasonExists.length === 0) {
        await queryInterface.addColumn('invoices', 'editReason', {
          type: Sequelize.TEXT,
          allowNull: true
        });
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN invoices."editReason" IS 'Reason for last edit (required for accountability)';
        `);
      }
      
      const [editHistoryExists] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='invoices' AND column_name='editHistory';
      `);
      
      if (editHistoryExists.length === 0) {
        await queryInterface.addColumn('invoices', 'editHistory', {
          type: Sequelize.JSONB,
          allowNull: true,
          defaultValue: []
        });
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN invoices."editHistory" IS 'History of all edits made to this invoice';
        `);
      }
      
      console.log('✅ Added edit tracking fields to invoices');
    } catch (error) {
      console.error('Error adding edit tracking fields to invoices:', error.message);
      throw error;
    }
    
    // Add viewedAt to credit_notes
    console.log('📝 Adding viewedAt to credit_notes table...');
    try {
      const [results] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='credit_notes' AND column_name='viewedAt';
      `);
      
      if (results.length === 0) {
        await queryInterface.addColumn('credit_notes', 'viewedAt', {
          type: Sequelize.DATE,
          allowNull: true
        });
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN credit_notes."viewedAt" IS 'Date when document was first viewed by customer';
        `);
        console.log('✅ Added viewedAt to credit_notes');
      } else {
        console.log('⚠️  viewedAt column already exists in credit_notes, skipping...');
      }
    } catch (error) {
      console.error('Error adding viewedAt to credit_notes:', error.message);
      throw error;
    }
    
    // Add downloadedAt to credit_notes
    console.log('📝 Adding downloadedAt to credit_notes table...');
    try {
      const [results] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='credit_notes' AND column_name='downloadedAt';
      `);
      
      if (results.length === 0) {
        await queryInterface.addColumn('credit_notes', 'downloadedAt', {
          type: Sequelize.DATE,
          allowNull: true
        });
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN credit_notes."downloadedAt" IS 'Date when document was first downloaded by customer';
        `);
        console.log('✅ Added downloadedAt to credit_notes');
      } else {
        console.log('⚠️  downloadedAt column already exists in credit_notes, skipping...');
      }
    } catch (error) {
      console.error('Error adding downloadedAt to credit_notes:', error.message);
      throw error;
    }
    
    // Add documentStatus to credit_notes
    console.log('📝 Adding documentStatus to credit_notes table...');
    try {
      const [results] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='credit_notes' AND column_name='documentStatus';
      `);
      
      if (results.length === 0) {
        await queryInterface.sequelize.query(`
          ALTER TABLE credit_notes 
          ADD COLUMN "documentStatus" enum_document_status DEFAULT 'ready';
        `);
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN credit_notes."documentStatus" IS 'Document status: ready (no issues), review (error/alert), viewed, downloaded, queried';
        `);
        console.log('✅ Added documentStatus to credit_notes');
      } else {
        console.log('⚠️  documentStatus column already exists in credit_notes, skipping...');
      }
    } catch (error) {
      console.error('Error adding documentStatus to credit_notes:', error.message);
      throw error;
    }
    
    // Add queriedAt to credit_notes
    console.log('📝 Adding queriedAt to credit_notes table...');
    try {
      const [results] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='credit_notes' AND column_name='queriedAt';
      `);
      
      if (results.length === 0) {
        await queryInterface.addColumn('credit_notes', 'queriedAt', {
          type: Sequelize.DATE,
          allowNull: true
        });
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN credit_notes."queriedAt" IS 'Date when document was queried by customer';
        `);
        console.log('✅ Added queriedAt to credit_notes');
      } else {
        console.log('⚠️  queriedAt column already exists in credit_notes, skipping...');
      }
    } catch (error) {
      console.error('Error adding queriedAt to credit_notes:', error.message);
      throw error;
    }
    
    // Add edit tracking fields to credit_notes
    console.log('📝 Adding edit tracking fields to credit_notes...');
    try {
      const [editedByExists] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='credit_notes' AND column_name='editedBy';
      `);
      
      if (editedByExists.length === 0) {
        await queryInterface.addColumn('credit_notes', 'editedBy', {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: 'users',
            key: 'id'
          }
        });
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN credit_notes."editedBy" IS 'User who last edited this credit note';
        `);
      }
      
      const [editReasonExists] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='credit_notes' AND column_name='editReason';
      `);
      
      if (editReasonExists.length === 0) {
        await queryInterface.addColumn('credit_notes', 'editReason', {
          type: Sequelize.TEXT,
          allowNull: true
        });
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN credit_notes."editReason" IS 'Reason for last edit (required for accountability)';
        `);
      }
      
      const [editHistoryExists] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='credit_notes' AND column_name='editHistory';
      `);
      
      if (editHistoryExists.length === 0) {
        await queryInterface.addColumn('credit_notes', 'editHistory', {
          type: Sequelize.JSONB,
          allowNull: true,
          defaultValue: []
        });
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN credit_notes."editHistory" IS 'History of all edits made to this credit note';
        `);
      }
      
      console.log('✅ Added edit tracking fields to credit_notes');
    } catch (error) {
      console.error('Error adding edit tracking fields to credit_notes:', error.message);
      throw error;
    }
    
    // Add viewedAt to statements
    console.log('📝 Adding viewedAt to statements table...');
    try {
      const [results] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='statements' AND column_name='viewedAt';
      `);
      
      if (results.length === 0) {
        await queryInterface.addColumn('statements', 'viewedAt', {
          type: Sequelize.DATE,
          allowNull: true
        });
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN statements."viewedAt" IS 'Date when document was first viewed by customer';
        `);
        console.log('✅ Added viewedAt to statements');
      } else {
        console.log('⚠️  viewedAt column already exists in statements, skipping...');
      }
    } catch (error) {
      console.error('Error adding viewedAt to statements:', error.message);
      throw error;
    }
    
    // Add downloadedAt to statements
    console.log('📝 Adding downloadedAt to statements table...');
    try {
      const [results] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='statements' AND column_name='downloadedAt';
      `);
      
      if (results.length === 0) {
        await queryInterface.addColumn('statements', 'downloadedAt', {
          type: Sequelize.DATE,
          allowNull: true
        });
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN statements."downloadedAt" IS 'Date when document was first downloaded by customer';
        `);
        console.log('✅ Added downloadedAt to statements');
      } else {
        console.log('⚠️  downloadedAt column already exists in statements, skipping...');
      }
    } catch (error) {
      console.error('Error adding downloadedAt to statements:', error.message);
      throw error;
    }
    
    // Add documentStatus to statements
    console.log('📝 Adding documentStatus to statements table...');
    try {
      const [results] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='statements' AND column_name='documentStatus';
      `);
      
      if (results.length === 0) {
        await queryInterface.sequelize.query(`
          ALTER TABLE statements 
          ADD COLUMN "documentStatus" enum_document_status DEFAULT 'ready';
        `);
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN statements."documentStatus" IS 'Document status: ready (no issues), review (error/alert), viewed, downloaded, queried';
        `);
        console.log('✅ Added documentStatus to statements');
      } else {
        console.log('⚠️  documentStatus column already exists in statements, skipping...');
      }
    } catch (error) {
      console.error('Error adding documentStatus to statements:', error.message);
      throw error;
    }
    
    // Add queriedAt to statements
    console.log('📝 Adding queriedAt to statements table...');
    try {
      const [results] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='statements' AND column_name='queriedAt';
      `);
      
      if (results.length === 0) {
        await queryInterface.addColumn('statements', 'queriedAt', {
          type: Sequelize.DATE,
          allowNull: true
        });
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN statements."queriedAt" IS 'Date when document was queried by customer';
        `);
        console.log('✅ Added queriedAt to statements');
      } else {
        console.log('⚠️  queriedAt column already exists in statements, skipping...');
      }
    } catch (error) {
      console.error('Error adding queriedAt to statements:', error.message);
      throw error;
    }
    
    // Add edit tracking fields to statements
    console.log('📝 Adding edit tracking fields to statements...');
    try {
      const [editedByExists] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='statements' AND column_name='editedBy';
      `);
      
      if (editedByExists.length === 0) {
        await queryInterface.addColumn('statements', 'editedBy', {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: 'users',
            key: 'id'
          }
        });
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN statements."editedBy" IS 'User who last edited this statement';
        `);
      }
      
      const [editReasonExists] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='statements' AND column_name='editReason';
      `);
      
      if (editReasonExists.length === 0) {
        await queryInterface.addColumn('statements', 'editReason', {
          type: Sequelize.TEXT,
          allowNull: true
        });
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN statements."editReason" IS 'Reason for last edit (required for accountability)';
        `);
      }
      
      const [editHistoryExists] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='statements' AND column_name='editHistory';
      `);
      
      if (editHistoryExists.length === 0) {
        await queryInterface.addColumn('statements', 'editHistory', {
          type: Sequelize.JSONB,
          allowNull: true,
          defaultValue: []
        });
        await queryInterface.sequelize.query(`
          COMMENT ON COLUMN statements."editHistory" IS 'History of all edits made to this statement';
        `);
      }
      
      console.log('✅ Added edit tracking fields to statements');
    } catch (error) {
      console.error('Error adding edit tracking fields to statements:', error.message);
      throw error;
    }
    
    // Update existing records: set documentStatus based on viewedAt/downloadedAt
    console.log('📝 Updating existing records...');
    await queryInterface.sequelize.query(`
      UPDATE invoices 
      SET "documentStatus" = CASE
        WHEN "downloadedAt" IS NOT NULL THEN 'downloaded'::enum_document_status
        WHEN "viewedAt" IS NOT NULL THEN 'viewed'::enum_document_status
        ELSE 'ready'::enum_document_status
      END
      WHERE "documentStatus" IS NULL;
    `);
    
    await queryInterface.sequelize.query(`
      UPDATE credit_notes 
      SET "documentStatus" = CASE
        WHEN "downloadedAt" IS NOT NULL THEN 'downloaded'::enum_document_status
        WHEN "viewedAt" IS NOT NULL THEN 'viewed'::enum_document_status
        ELSE 'ready'::enum_document_status
      END
      WHERE "documentStatus" IS NULL;
    `);
    
    await queryInterface.sequelize.query(`
      UPDATE statements 
      SET "documentStatus" = CASE
        WHEN "downloadedAt" IS NOT NULL THEN 'downloaded'::enum_document_status
        WHEN "viewedAt" IS NOT NULL THEN 'viewed'::enum_document_status
        ELSE 'ready'::enum_document_status
      END
      WHERE "documentStatus" IS NULL;
    `);
    
    console.log('✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();

