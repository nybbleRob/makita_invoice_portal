#!/usr/bin/env node

/**
 * List Manual Uploads (Import Button)
 * Shows invoices and credit notes that were uploaded via the Invoices/Credit Notes
 * import button (not FTP/system uploads).
 *
 * Usage:
 *   node backend/scripts/list-manual-uploads.js          (default: last 2 days)
 *   node backend/scripts/list-manual-uploads.js --since 2025-01-01
 *   node backend/scripts/list-manual-uploads.js --days 7
 *   node backend/scripts/list-manual-uploads.js --limit 50
 *   Omit --since/--days to limit to last 2 days.
 */

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

const { Invoice, CreditNote, Company, sequelize } = require('../models');
const { Op } = require('sequelize');
const { QueryTypes } = require('sequelize');

const args = process.argv.slice(2);
const getArg = (flag, defaultValue) => {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : defaultValue;
};

const sinceStr = getArg('--since', null);
const daysArg = getArg('--days', null);
const limit = Math.min(parseInt(getArg('--limit', '500'), 10) || 500, 5000);

function parseSince() {
  if (daysArg) {
    const d = new Date();
    d.setDate(d.getDate() - parseInt(daysArg, 10));
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (sinceStr) {
    const d = new Date(sinceStr);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Default last 2 days (today + yesterday) if no --since or --days
const since = parseSince() ?? (() => {
  const d = new Date();
  d.setDate(d.getDate() - 2);
  d.setHours(0, 0, 0, 0);
  return d;
})();

async function run() {
  try {
    console.log('='.repeat(80));
    console.log('MANUAL UPLOADS (Import button – not FTP)');
    console.log('='.repeat(80));
    if (since) {
      console.log(`Filter: createdAt >= ${since.toISOString()}`);
    }
    console.log(`Limit: ${limit} per document type`);
    console.log('');

    // JSONB filter: metadata.source = 'manual_import'
    // findAll: use model alias (Sequelize aliases main table when using include)
    const invoiceWhere = { [Op.and]: [sequelize.literal(`("Invoice".metadata->>'source') = 'manual_import'`)] };
    const creditNoteWhere = { [Op.and]: [sequelize.literal(`("CreditNote".metadata->>'source') = 'manual_import'`)] };
    if (since) {
      invoiceWhere.createdAt = { [Op.gte]: since };
      creditNoteWhere.createdAt = { [Op.gte]: since };
    }

    // Count via raw SQL so we use table names (invoices / credit_notes) and avoid alias issues
    const sinceClause = since ? `AND "createdAt" >= :since` : '';
    const [invCountRows, cnCountRows, invoices, creditNotes] = await Promise.all([
      sequelize.query(
        `SELECT COUNT(*)::int AS c FROM invoices WHERE (metadata->>'source') = 'manual_import' ${sinceClause}`,
        { replacements: since ? { since } : {}, type: QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT COUNT(*)::int AS c FROM credit_notes WHERE (metadata->>'source') = 'manual_import' ${sinceClause}`,
        { replacements: since ? { since } : {}, type: QueryTypes.SELECT }
      ),
      Invoice.findAll({
        where: invoiceWhere,
        include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }],
        order: [['createdAt', 'DESC']],
        limit,
        attributes: ['id', 'invoiceNumber', 'companyId', 'amount', 'issueDate', 'createdAt', 'metadata']
      }),
      CreditNote.findAll({
        where: creditNoteWhere,
        include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }],
        order: [['createdAt', 'DESC']],
        limit,
        attributes: ['id', 'creditNoteNumber', 'companyId', 'amount', 'issueDate', 'createdAt', 'metadata']
      })
    ]);
    const totalInvoices = invCountRows[0]?.c ?? 0;
    const totalCreditNotes = cnCountRows[0]?.c ?? 0;

    console.log('SUMMARY');
    console.log('-'.repeat(80));
    console.log(`Invoices (manual import):   ${totalInvoices} total${since ? ` since ${since.toISOString().split('T')[0]}` : ''}`);
    console.log(`Credit notes (manual import): ${totalCreditNotes} total${since ? ` since ${since.toISOString().split('T')[0]}` : ''}`);
    console.log('');

    if (invoices.length > 0) {
      console.log('INVOICES (manual import)' + (invoices.length < totalInvoices ? ` – showing latest ${invoices.length}` : ''));
      console.log('-'.repeat(80));
      invoices.forEach((inv, i) => {
        const fileName = inv.metadata?.fileName || inv.metadata?.parsedData?.fileName || '–';
        const companyName = inv.company?.name || inv.companyId || '–';
        const created = inv.createdAt ? new Date(inv.createdAt).toISOString().replace('T', ' ').slice(0, 19) : '–';
        console.log(`  ${String(i + 1).padStart(3)}  ${inv.invoiceNumber.padEnd(24)}  ${companyName.slice(0, 30).padEnd(30)}  ${created}  ${fileName.slice(0, 40)}`);
      });
      console.log('');
    }

    if (creditNotes.length > 0) {
      console.log('CREDIT NOTES (manual import)' + (creditNotes.length < totalCreditNotes ? ` – showing latest ${creditNotes.length}` : ''));
      console.log('-'.repeat(80));
      creditNotes.forEach((cn, i) => {
        const fileName = cn.metadata?.fileName || cn.metadata?.parsedData?.fileName || '–';
        const companyName = cn.company?.name || cn.companyId || '–';
        const created = cn.createdAt ? new Date(cn.createdAt).toISOString().replace('T', ' ').slice(0, 19) : '–';
        const num = (cn.creditNoteNumber || cn.creditNumber || '').toString();
        console.log(`  ${String(i + 1).padStart(3)}  ${num.padEnd(24)}  ${companyName.slice(0, 30).padEnd(30)}  ${created}  ${fileName.slice(0, 40)}`);
      });
      console.log('');
    }

    if (invoices.length === 0 && creditNotes.length === 0) {
      console.log('No manual uploads found.');
      if (since) console.log('Try without --since or --days to see all time.');
    }

    console.log('='.repeat(80));
  } catch (err) {
    console.error('Error:', err.message);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

run();
