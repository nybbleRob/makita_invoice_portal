/**
 * Migration Script: Create supplier tables
 * Creates suppliers, supplier_templates, supplier_documents, and supplier_files tables
 */

const { sequelize } = require('../models');

async function createSupplierTables() {
  const transaction = await sequelize.transaction();
  
  try {
    console.log('🔄 Creating supplier tables...');
    
    // Check if ALL supplier tables already exist
    const [tables] = await sequelize.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name IN ('suppliers', 'supplier_templates', 'supplier_documents', 'supplier_files')
      AND table_schema = 'public'
    `);
    
    const existingTables = tables.map(t => t.table_name);
    const requiredTables = ['suppliers', 'supplier_templates', 'supplier_documents', 'supplier_files'];
    const allExist = requiredTables.every(table => existingTables.includes(table));
    
    if (allExist) {
      console.log('✅ All supplier tables already exist, skipping...');
      await transaction.rollback();
      return;
    }
    
    if (existingTables.length > 0) {
      console.log(`⚠️  Some supplier tables already exist: ${existingTables.join(', ')}`);
      console.log('   The script will attempt to create missing tables only.');
    }
    
    // 1. Create suppliers table
    if (!existingTables.includes('suppliers')) {
      console.log('📝 Creating suppliers table...');
      await sequelize.query(`
        CREATE TABLE suppliers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) UNIQUE,
        email VARCHAR(255),
        phone VARCHAR(50),
        address JSONB DEFAULT '{}',
        "taxId" VARCHAR(50),
        "vatNumber" VARCHAR(50),
        website VARCHAR(255),
        notes TEXT,
        "isActive" BOOLEAN DEFAULT true,
        metadata JSONB DEFAULT '{}',
        "createdById" UUID REFERENCES users(id) ON DELETE SET NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "deletedAt" TIMESTAMP
      )
    `, { transaction });
    
    // Add comments for suppliers table
    await sequelize.query(`
      COMMENT ON TABLE suppliers IS 'Suppliers who send documents to the company';
      COMMENT ON COLUMN suppliers.code IS 'Optional supplier code/identifier';
      COMMENT ON COLUMN suppliers.address IS 'Company address (street, city, state, zip, country)';
      COMMENT ON COLUMN suppliers."taxId" IS 'Tax identification number';
      COMMENT ON COLUMN suppliers."vatNumber" IS 'VAT registration number';
    `, { transaction });
    
    // Create indexes for suppliers
    await sequelize.query(`
      CREATE INDEX suppliers_name_idx ON suppliers(name);
      CREATE INDEX suppliers_code_idx ON suppliers(code) WHERE code IS NOT NULL;
      CREATE INDEX suppliers_isActive_idx ON suppliers("isActive");
      CREATE INDEX suppliers_createdAt_idx ON suppliers("createdAt" DESC);
      CREATE INDEX suppliers_deletedAt_idx ON suppliers("deletedAt") WHERE "deletedAt" IS NULL;
      `, { transaction });
    } else {
      console.log('✅ suppliers table already exists, skipping...');
    }
    
    // 2. Create supplier_templates table
    if (!existingTables.includes('supplier_templates')) {
      console.log('📝 Creating supplier_templates table...');
      await sequelize.query(`
        CREATE TABLE supplier_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "supplierId" UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        code VARCHAR(100) NOT NULL,
        "templateType" VARCHAR(50) NOT NULL CHECK ("templateType" IN ('invoice', 'credit_note', 'statement')),
        "fileType" VARCHAR(20) NOT NULL DEFAULT 'pdf' CHECK ("fileType" IN ('pdf', 'excel')),
        "isDefault" BOOLEAN DEFAULT false,
        enabled BOOLEAN DEFAULT true,
        priority INTEGER DEFAULT 0,
        coordinates JSONB DEFAULT '{}',
        patterns JSONB DEFAULT '{}',
        markers JSONB DEFAULT '{}',
        transformations JSONB DEFAULT '{}',
        "customFields" JSONB DEFAULT '[]',
        "mandatoryFields" JSONB DEFAULT '[]',
        "sampleFileUrl" VARCHAR(500),
        metadata JSONB DEFAULT '{}',
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "deletedAt" TIMESTAMP,
        UNIQUE("supplierId", code, "templateType", "fileType")
      )
    `, { transaction });
    
    // Add comments for supplier_templates
    await sequelize.query(`
      COMMENT ON TABLE supplier_templates IS 'Templates for parsing supplier documents';
      COMMENT ON COLUMN supplier_templates."templateType" IS 'Type of template: invoice, credit_note, or statement';
      COMMENT ON COLUMN supplier_templates."fileType" IS 'File type this template is for: pdf or excel';
      COMMENT ON COLUMN supplier_templates.coordinates IS 'Coordinate-based field extraction (x, y, width, height, page)';
      COMMENT ON COLUMN supplier_templates.patterns IS 'Regex patterns for field extraction (optional fallback)';
      COMMENT ON COLUMN supplier_templates."customFields" IS 'Custom fields that assign to supplier and template';
      COMMENT ON COLUMN supplier_templates."mandatoryFields" IS 'Which fields are mandatory for this template (e.g., ["documentType", "invoiceNumber", "poNumber"])';
    `, { transaction });
    
    // Create indexes for supplier_templates
    await sequelize.query(`
      CREATE INDEX supplier_templates_supplierId_idx ON supplier_templates("supplierId");
      CREATE INDEX supplier_templates_templateType_idx ON supplier_templates("templateType");
      CREATE INDEX supplier_templates_fileType_idx ON supplier_templates("fileType");
      CREATE INDEX supplier_templates_enabled_idx ON supplier_templates(enabled);
      CREATE INDEX supplier_templates_isDefault_idx ON supplier_templates("isDefault");
      CREATE INDEX supplier_templates_supplier_type_file_idx ON supplier_templates("supplierId", "templateType", "fileType");
      CREATE INDEX supplier_templates_deletedAt_idx ON supplier_templates("deletedAt") WHERE "deletedAt" IS NULL;
      `, { transaction });
    } else {
      console.log('✅ supplier_templates table already exists, skipping...');
    }
    
    // 3. Create supplier_documents table
    if (!existingTables.includes('supplier_documents')) {
      console.log('📝 Creating supplier_documents table...');
      await sequelize.query(`
        CREATE TABLE supplier_documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "supplierId" UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        "templateId" UUID REFERENCES supplier_templates(id) ON DELETE SET NULL,
        "documentType" VARCHAR(50) NOT NULL CHECK ("documentType" IN ('invoice', 'credit_note', 'statement')),
        "invoiceNumber" VARCHAR(255),
        "poNumber" VARCHAR(255),
        "documentDate" DATE NOT NULL,
        "dueDate" DATE,
        amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
        "taxAmount" DECIMAL(10, 2) DEFAULT 0,
        "vatAmount" DECIMAL(10, 2) DEFAULT 0,
        "extractedFields" JSONB DEFAULT '{}',
        items JSONB DEFAULT '[]',
        notes TEXT,
        "fileUrl" VARCHAR(500) NOT NULL,
        "originalName" VARCHAR(500),
        "fileHash" VARCHAR(64),
        status VARCHAR(50) DEFAULT 'ready' CHECK (status IN ('ready', 'processed', 'archived', 'failed')),
        "documentStatus" VARCHAR(50) DEFAULT 'ready' CHECK ("documentStatus" IN ('ready', 'review', 'queried')),
        "parsedAt" TIMESTAMP,
        "parsedBy" UUID REFERENCES users(id) ON DELETE SET NULL,
        confidence DECIMAL(5, 2),
        "parsingErrors" JSONB DEFAULT '[]',
        "viewedAt" TIMESTAMP,
        "viewedBy" UUID REFERENCES users(id) ON DELETE SET NULL,
        "queriedAt" TIMESTAMP,
        "queriedBy" UUID REFERENCES users(id) ON DELETE SET NULL,
        metadata JSONB DEFAULT '{}',
        "createdById" UUID REFERENCES users(id) ON DELETE SET NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "deletedAt" TIMESTAMP
      )
    `, { transaction });
    
    // Add unique constraint for supplier + invoice number (if provided)
    await sequelize.query(`
      CREATE UNIQUE INDEX supplier_documents_supplier_invoice_unique_idx 
      ON supplier_documents("supplierId", "invoiceNumber") 
      WHERE "invoiceNumber" IS NOT NULL AND "deletedAt" IS NULL
    `, { transaction });
    
    // Add comments for supplier_documents
    await sequelize.query(`
      COMMENT ON TABLE supplier_documents IS 'Documents received from suppliers (invoices, credit notes, statements)';
      COMMENT ON COLUMN supplier_documents."documentType" IS 'Type of document: invoice, credit_note, or statement';
      COMMENT ON COLUMN supplier_documents."poNumber" IS 'Purchase Order Number (if present)';
      COMMENT ON COLUMN supplier_documents."extractedFields" IS 'All extracted fields from parsing';
      COMMENT ON COLUMN supplier_documents."fileHash" IS 'SHA256 hash for duplicate detection';
      COMMENT ON COLUMN supplier_documents.status IS 'Document status: ready, processed, archived, failed';
      COMMENT ON COLUMN supplier_documents."documentStatus" IS 'Document review status: ready, review, queried';
      COMMENT ON COLUMN supplier_documents.confidence IS 'Parsing confidence percentage';
      COMMENT ON COLUMN supplier_documents."parsingErrors" IS 'Any parsing errors/warnings';
    `, { transaction });
    
    // Create indexes for supplier_documents
    await sequelize.query(`
      CREATE INDEX supplier_documents_supplierId_idx ON supplier_documents("supplierId");
      CREATE INDEX supplier_documents_templateId_idx ON supplier_documents("templateId");
      CREATE INDEX supplier_documents_documentType_idx ON supplier_documents("documentType");
      CREATE INDEX supplier_documents_documentDate_idx ON supplier_documents("documentDate");
      CREATE INDEX supplier_documents_status_idx ON supplier_documents(status);
      CREATE INDEX supplier_documents_documentStatus_idx ON supplier_documents("documentStatus");
      CREATE INDEX supplier_documents_fileHash_idx ON supplier_documents("fileHash");
      CREATE INDEX supplier_documents_invoiceNumber_idx ON supplier_documents("invoiceNumber");
      CREATE INDEX supplier_documents_poNumber_idx ON supplier_documents("poNumber");
      CREATE INDEX supplier_documents_deletedAt_idx ON supplier_documents("deletedAt") WHERE "deletedAt" IS NULL;
      `, { transaction });
    } else {
      console.log('✅ supplier_documents table already exists, skipping...');
    }
    
    // 4. Create supplier_files table (optional - for tracking uploads)
    if (!existingTables.includes('supplier_files')) {
      console.log('📝 Creating supplier_files table...');
      await sequelize.query(`
        CREATE TABLE supplier_files (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "fileName" VARCHAR(500) NOT NULL,
        "originalName" VARCHAR(500),
        "filePath" VARCHAR(500),
        "fileUrl" VARCHAR(500),
        "fileHash" VARCHAR(64) NOT NULL,
        "fileSize" BIGINT,
        "mimeType" VARCHAR(100),
        "supplierId" UUID REFERENCES suppliers(id) ON DELETE SET NULL,
        "templateId" UUID REFERENCES supplier_templates(id) ON DELETE SET NULL,
        "supplierDocumentId" UUID REFERENCES supplier_documents(id) ON DELETE SET NULL,
        status VARCHAR(50) DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processing', 'processed', 'failed')),
        "processingErrors" JSONB DEFAULT '[]',
        "source" VARCHAR(50) DEFAULT 'manual' CHECK ("source" IN ('manual', 'ftp', 'email', 'api')),
        metadata JSONB DEFAULT '{}',
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "deletedAt" TIMESTAMP
      )
    `, { transaction });
    
    // Add comments for supplier_files
    await sequelize.query(`
      COMMENT ON TABLE supplier_files IS 'Track uploaded supplier document files before processing';
      COMMENT ON COLUMN supplier_files."fileHash" IS 'SHA256 hash for duplicate detection';
      COMMENT ON COLUMN supplier_files.status IS 'File status: uploaded, processing, processed, failed';
      COMMENT ON COLUMN supplier_files."source" IS 'File source: manual, ftp, email, api';
    `, { transaction });
    
    // Create indexes for supplier_files
    await sequelize.query(`
      CREATE INDEX supplier_files_fileHash_idx ON supplier_files("fileHash");
      CREATE INDEX supplier_files_supplierId_idx ON supplier_files("supplierId");
      CREATE INDEX supplier_files_templateId_idx ON supplier_files("templateId");
      CREATE INDEX supplier_files_supplierDocumentId_idx ON supplier_files("supplierDocumentId");
      CREATE INDEX supplier_files_status_idx ON supplier_files(status);
      CREATE INDEX supplier_files_source_idx ON supplier_files("source");
      CREATE INDEX supplier_files_createdAt_idx ON supplier_files("createdAt" DESC);
      CREATE INDEX supplier_files_deletedAt_idx ON supplier_files("deletedAt") WHERE "deletedAt" IS NULL;
      `, { transaction });
    } else {
      console.log('✅ supplier_files table already exists, skipping...');
    }
    
    await transaction.commit();
    console.log('✅ Successfully created all supplier tables!');
    console.log('   - suppliers');
    console.log('   - supplier_templates');
    console.log('   - supplier_documents');
    console.log('   - supplier_files');
    
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error creating supplier tables:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  sequelize.authenticate()
    .then(() => {
      console.log('📦 Database connection established');
      return createSupplierTables();
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

module.exports = { createSupplierTables };
