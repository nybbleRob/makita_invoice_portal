/**
 * Script to create invoices from existing parsed files that have matched companies
 * but don't have associated invoices yet.
 */

const { File, Invoice, CreditNote, Company } = require('../models');
const { sequelize } = require('../models');

async function createInvoicesFromParsedFiles() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connected');

    // Find files that:
    // 1. Have a matched company (customerId is not null)
    // 2. Are not duplicates
    // 3. Have parsed data with documentType
    // 4. Don't already have an associated invoice/credit note
    const files = await File.findAll({
      where: {
        customerId: { [require('sequelize').Op.ne]: null },
        status: 'parsed',
        [require('sequelize').Op.or]: [
          { metadata: { [require('sequelize').Op.not]: { isDuplicate: true } } },
          { metadata: null }
        ]
      }
    });

    console.log(`\n📋 Found ${files.length} files to process\n`);

    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const file of files) {
      try {
        // Check if invoice/credit note already exists for this file
        const existingInvoice = await Invoice.findOne({
          where: {
            fileUrl: file.filePath,
            companyId: file.customerId
          }
        });

        const existingCreditNote = await CreditNote.findOne({
          where: {
            metadata: {
              fileHash: file.fileHash
            }
          }
        });

        if (existingInvoice || existingCreditNote) {
          console.log(`⏭️  Skipping ${file.fileName} - invoice/credit note already exists`);
          skippedCount++;
          continue;
        }

        const parsedData = file.parsedData || {};
        const documentType = parsedData.documentType?.toLowerCase() || 'invoice';
        const isInvoice = documentType === 'invoice';
        const isCreditNote = documentType === 'credit_note' || documentType === 'credit note';

        if (!isInvoice && !isCreditNote) {
          console.log(`⏭️  Skipping ${file.fileName} - not an invoice or credit note (type: ${documentType})`);
          skippedCount++;
          continue;
        }

        // Parse amounts
        const amountStr = parsedData.amount || '0';
        const amount = parseFloat(amountStr.toString().replace(/[£$€, ]/g, '')) || 0;
        
        const vatAmountStr = parsedData.vatAmount || '0';
        const taxAmount = parseFloat(vatAmountStr.toString().replace(/[£$€, ]/g, '')) || 0;

        // Parse date
        let issueDate = new Date();
        if (parsedData.date) {
          const dateStr = parsedData.date.toString();
          // Try to parse date (format: DD/MM/YY or similar)
          const dateMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
          if (dateMatch) {
            const [, day, month, year] = dateMatch;
            const fullYear = year.length === 2 ? `20${year}` : year;
            issueDate = new Date(`${fullYear}-${month}-${day}`);
            if (isNaN(issueDate.getTime())) {
              issueDate = new Date();
            }
          }
        }

        // Get company name for logging
        const company = await Company.findByPk(file.customerId);
        const companyName = company?.name || 'Unknown';

        if (isInvoice) {
          const invoice = await Invoice.create({
            companyId: file.customerId,
            invoiceNumber: parsedData.invoiceNumber || `INV-${Date.now()}-${file.fileHash.substring(0, 8)}`,
            issueDate: issueDate,
            amount: amount,
            taxAmount: taxAmount,
            status: 'ready',
            fileUrl: file.filePath,
            metadata: {
              source: 'manual_import',
              fileName: file.fileName,
              parsedData: parsedData,
              processingMethod: file.processingMethod,
              fileHash: file.fileHash,
              createdFromFile: true,
              fileId: file.id
            }
          });

          // Update file metadata to link to invoice
          await file.update({
            metadata: {
              ...file.metadata,
              documentId: invoice.id,
              documentType: 'invoice'
            }
          });

          console.log(`✅ Created invoice: ${invoice.invoiceNumber} for ${companyName} (${file.fileName})`);
          createdCount++;
        } else if (isCreditNote) {
          const creditNote = await CreditNote.create({
            companyId: file.customerId,
            creditNoteNumber: parsedData.invoiceNumber || parsedData.creditNoteNumber || `CN-${Date.now()}-${file.fileHash.substring(0, 8)}`,
            issueDate: issueDate,
            amount: amount,
            taxAmount: taxAmount,
            status: 'ready',
            metadata: {
              source: 'manual_import',
              fileName: file.fileName,
              parsedData: parsedData,
              processingMethod: file.processingMethod,
              fileHash: file.fileHash,
              createdFromFile: true,
              fileId: file.id
            }
          });

          // Update file metadata to link to credit note
          await file.update({
            metadata: {
              ...file.metadata,
              documentId: creditNote.id,
              documentType: 'credit_note'
            }
          });

          console.log(`✅ Created credit note: ${creditNote.creditNoteNumber} for ${companyName} (${file.fileName})`);
          createdCount++;
        }
      } catch (error) {
        console.error(`❌ Error processing ${file.fileName}:`, error.message);
        errorCount++;
      }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Created: ${createdCount}`);
    console.log(`   ⏭️  Skipped: ${skippedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log(`\n✅ Done!\n`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

createInvoicesFromParsedFiles();

