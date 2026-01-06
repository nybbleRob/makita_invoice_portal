#!/usr/bin/env node

/**
 * Purge Old Documents Script
 * Lists all documents and purges those created before a specified date
 * 
 * Usage:
 *   node backend/scripts/purge-old-documents.js --check
 *   node backend/scripts/purge-old-documents.js --purge --date 2026-01-06
 *   node backend/scripts/purge-old-documents.js --purge --date 2026-01-06 --dry-run
 */

// Load environment variables first
const path = require('path');
const fs = require('fs');
const rootEnv = path.join(__dirname, '..', '..', '.env');
const backendEnv = path.join(__dirname, '..', '.env');

if (fs.existsSync(rootEnv)) {
  require('dotenv').config({ path: rootEnv });
} else if (fs.existsSync(backendEnv)) {
  require('dotenv').config({ path: backendEnv });
} else {
  require('dotenv').config();
}

const { Invoice, CreditNote, Statement, sequelize } = require('../models');
const { Op } = require('sequelize');

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (flag, defaultValue) => {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : defaultValue;
};

const checkOnly = args.includes('--check');
const purge = args.includes('--purge');
const dryRun = args.includes('--dry-run');
const dateStr = getArg('--date', new Date().toISOString().split('T')[0]);

// Parse date (start of day in UTC)
const purgeBeforeDate = new Date(`${dateStr}T00:00:00.000Z`);

console.log('='.repeat(80));
console.log('DOCUMENT PURGE SCRIPT');
console.log('='.repeat(80));
console.log(`Mode: ${checkOnly ? 'CHECK ONLY' : purge ? (dryRun ? 'DRY RUN (no changes)' : 'PURGE') : 'CHECK ONLY'}`);
console.log(`Purge Date: ${dateStr} (documents created BEFORE this date will be purged)`);
console.log(`Purge Before: ${purgeBeforeDate.toISOString()}`);
console.log('');

async function checkAndPurgeDocuments() {
  try {
    // 1. Count all documents
    console.log('1. DOCUMENT COUNTS');
    console.log('-'.repeat(80));
    
    const [allInvoices, allCreditNotes, allStatements] = await Promise.all([
      Invoice.findAll({
        where: { deletedAt: null },
        attributes: ['id', 'invoiceNumber', 'companyId', 'createdAt', 'deletedAt']
      }),
      CreditNote.findAll({
        attributes: ['id', 'creditNoteNumber', 'companyId', 'createdAt']
      }),
      Statement.findAll({
        attributes: ['id', 'statementNumber', 'companyId', 'createdAt']
      })
    ]);

    console.log(`Total Invoices: ${allInvoices.length}`);
    console.log(`Total Credit Notes: ${allCreditNotes.length}`);
    console.log(`Total Statements: ${allStatements.length}`);
    console.log(`Total Documents: ${allInvoices.length + allCreditNotes.length + allStatements.length}`);

    // 2. Group by creation date
    console.log('\n2. DOCUMENTS BY CREATION DATE');
    console.log('-'.repeat(80));
    
    const invoicesToKeep = allInvoices.filter(doc => new Date(doc.createdAt) >= purgeBeforeDate);
    const invoicesToPurge = allInvoices.filter(doc => new Date(doc.createdAt) < purgeBeforeDate);
    
    const creditNotesToKeep = allCreditNotes.filter(doc => new Date(doc.createdAt) >= purgeBeforeDate);
    const creditNotesToPurge = allCreditNotes.filter(doc => new Date(doc.createdAt) < purgeBeforeDate);
    
    const statementsToKeep = allStatements.filter(doc => new Date(doc.createdAt) >= purgeBeforeDate);
    const statementsToPurge = allStatements.filter(doc => new Date(doc.createdAt) < purgeBeforeDate);

    console.log(`\nInvoices:`);
    console.log(`  To Keep (created >= ${dateStr}): ${invoicesToKeep.length}`);
    console.log(`  To Purge (created < ${dateStr}): ${invoicesToPurge.length}`);
    
    console.log(`\nCredit Notes:`);
    console.log(`  To Keep (created >= ${dateStr}): ${creditNotesToKeep.length}`);
    console.log(`  To Purge (created < ${dateStr}): ${creditNotesToPurge.length}`);
    
    console.log(`\nStatements:`);
    console.log(`  To Keep (created >= ${dateStr}): ${statementsToKeep.length}`);
    console.log(`  To Purge (created < ${dateStr}): ${statementsToPurge.length}`);

    const totalToKeep = invoicesToKeep.length + creditNotesToKeep.length + statementsToKeep.length;
    const totalToPurge = invoicesToPurge.length + creditNotesToPurge.length + statementsToPurge.length;

    console.log(`\nTOTAL:`);
    console.log(`  To Keep: ${totalToKeep}`);
    console.log(`  To Purge: ${totalToPurge}`);

    // 3. Show sample of documents to be purged
    if (totalToPurge > 0) {
      console.log('\n3. SAMPLE OF DOCUMENTS TO BE PURGED');
      console.log('-'.repeat(80));
      
      const sampleInvoices = invoicesToPurge.slice(0, 5);
      const sampleCreditNotes = creditNotesToPurge.slice(0, 5);
      const sampleStatements = statementsToPurge.slice(0, 5);

      if (sampleInvoices.length > 0) {
        console.log('\nSample Invoices to purge:');
        sampleInvoices.forEach((inv, idx) => {
          console.log(`  ${idx + 1}. ${inv.invoiceNumber} - Created: ${new Date(inv.createdAt).toISOString()}`);
        });
        if (invoicesToPurge.length > 5) {
          console.log(`  ... and ${invoicesToPurge.length - 5} more invoices`);
        }
      }

      if (sampleCreditNotes.length > 0) {
        console.log('\nSample Credit Notes to purge:');
        sampleCreditNotes.forEach((cn, idx) => {
          console.log(`  ${idx + 1}. ${cn.creditNoteNumber} - Created: ${new Date(cn.createdAt).toISOString()}`);
        });
        if (creditNotesToPurge.length > 5) {
          console.log(`  ... and ${creditNotesToPurge.length - 5} more credit notes`);
        }
      }

      if (sampleStatements.length > 0) {
        console.log('\nSample Statements to purge:');
        sampleStatements.forEach((stmt, idx) => {
          console.log(`  ${idx + 1}. ${stmt.statementNumber} - Created: ${new Date(stmt.createdAt).toISOString()}`);
        });
        if (statementsToPurge.length > 5) {
          console.log(`  ... and ${statementsToPurge.length - 5} more statements`);
        }
      }
    }

    // 4. Show sample of documents to keep
    if (totalToKeep > 0) {
      console.log('\n4. SAMPLE OF DOCUMENTS TO KEEP');
      console.log('-'.repeat(80));
      
      const sampleInvoices = invoicesToKeep.slice(0, 5);
      const sampleCreditNotes = creditNotesToKeep.slice(0, 5);
      const sampleStatements = statementsToKeep.slice(0, 5);

      if (sampleInvoices.length > 0) {
        console.log('\nSample Invoices to keep:');
        sampleInvoices.forEach((inv, idx) => {
          console.log(`  ${idx + 1}. ${inv.invoiceNumber} - Created: ${new Date(inv.createdAt).toISOString()}`);
        });
        if (invoicesToKeep.length > 5) {
          console.log(`  ... and ${invoicesToKeep.length - 5} more invoices`);
        }
      }

      if (sampleCreditNotes.length > 0) {
        console.log('\nSample Credit Notes to keep:');
        sampleCreditNotes.forEach((cn, idx) => {
          console.log(`  ${idx + 1}. ${cn.creditNoteNumber} - Created: ${new Date(cn.createdAt).toISOString()}`);
        });
        if (creditNotesToKeep.length > 5) {
          console.log(`  ... and ${creditNotesToKeep.length - 5} more credit notes`);
        }
      }

      if (sampleStatements.length > 0) {
        console.log('\nSample Statements to keep:');
        sampleStatements.forEach((stmt, idx) => {
          console.log(`  ${idx + 1}. ${stmt.statementNumber} - Created: ${new Date(stmt.createdAt).toISOString()}`);
        });
        if (statementsToKeep.length > 5) {
          console.log(`  ... and ${statementsToKeep.length - 5} more statements`);
        }
      }
    }

    // 5. Perform purge if requested
    if (purge && totalToPurge > 0) {
      console.log('\n5. PURGING DOCUMENTS');
      console.log('-'.repeat(80));
      
      if (dryRun) {
        console.log('DRY RUN MODE - No changes will be made');
        console.log(`Would purge ${totalToPurge} documents:`);
        console.log(`  - ${invoicesToPurge.length} invoices`);
        console.log(`  - ${creditNotesToPurge.length} credit notes`);
        console.log(`  - ${statementsToPurge.length} statements`);
      } else {
        console.log(`Purging ${totalToPurge} documents...`);
        
        // Purge invoices (soft delete)
        if (invoicesToPurge.length > 0) {
          const invoiceIds = invoicesToPurge.map(inv => inv.id);
          const result = await Invoice.update(
            {
              deletedAt: new Date(),
              deletedBy: null, // System purge
              deletedReason: `Bulk purge: Documents created before ${dateStr}`
            },
            {
              where: {
                id: { [Op.in]: invoiceIds },
                deletedAt: null
              }
            }
          );
          console.log(`  ✓ Soft-deleted ${result[0]} invoices`);
        }

        // Purge credit notes (hard delete - they don't have deletedAt)
        if (creditNotesToPurge.length > 0) {
          const creditNoteIds = creditNotesToPurge.map(cn => cn.id);
          const deleted = await CreditNote.destroy({
            where: {
              id: { [Op.in]: creditNoteIds }
            }
          });
          console.log(`  ✓ Deleted ${deleted} credit notes`);
        }

        // Purge statements (hard delete - they don't have deletedAt)
        if (statementsToPurge.length > 0) {
          const statementIds = statementsToPurge.map(stmt => stmt.id);
          const deleted = await Statement.destroy({
            where: {
              id: { [Op.in]: statementIds }
            }
          });
          console.log(`  ✓ Deleted ${deleted} statements`);
        }

        console.log(`\n✓ Purge completed successfully!`);
        console.log(`  Total documents purged: ${totalToPurge}`);
      }
    } else if (purge && totalToPurge === 0) {
      console.log('\n5. PURGE SKIPPED');
      console.log('-'.repeat(80));
      console.log('No documents to purge. All documents were created on or after the purge date.');
    } else if (!purge) {
      console.log('\n5. NEXT STEPS');
      console.log('-'.repeat(80));
      console.log('To perform the purge, run:');
      console.log(`  node backend/scripts/purge-old-documents.js --purge --date ${dateStr}`);
      console.log('\nFor a dry run (no changes):');
      console.log(`  node backend/scripts/purge-old-documents.js --purge --date ${dateStr} --dry-run`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('Report completed');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

// Run the script
checkAndPurgeDocuments();
