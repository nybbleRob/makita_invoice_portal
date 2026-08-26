#!/usr/bin/env node
/**
 * statement-provenance.js
 *
 * READ-ONLY report answering "where did the statements in this portal come
 * from, and what happens to them when Sandbox Mode is switched off?".
 *
 * Runs only SELECT statements. Writes nothing to the database or disk. Safe
 * to run on production at any time.
 *
 * Reads DB credentials from backend/.env via the normal config, so no
 * password ever needs to be typed on the command line or stored in shell
 * history.
 *
 * Usage:
 *   node backend/scripts/statement-provenance.js
 */

// config/database loads backend/.env itself, so credentials come from there
// rather than the command line or shell history.
const { sequelize } = require('../config/database');

// ── tiny output helpers ────────────────────────────────────────────────────

function heading(text) {
  console.log('');
  console.log('═'.repeat(78));
  console.log(`  ${text}`);
  console.log('═'.repeat(78));
}

function fmt(value) {
  if (value === null || value === undefined) return '(none)';
  if (value instanceof Date) return value.toISOString().replace('T', ' ').slice(0, 19);
  return String(value);
}

/** Prints an array of row objects as an aligned table. */
function table(rows) {
  if (!rows || rows.length === 0) {
    console.log('  (no rows)');
    return;
  }
  const cols = Object.keys(rows[0]);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => fmt(r[c]).length))
  );
  console.log('  ' + cols.map((c, i) => c.padEnd(widths[i])).join('  '));
  console.log('  ' + widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) {
    console.log('  ' + cols.map((c, i) => fmt(r[c]).padEnd(widths[i])).join('  '));
  }
}

async function q(sql) {
  const [rows] = await sequelize.query(sql);
  return rows;
}

// ── report ─────────────────────────────────────────────────────────────────

async function main() {
  await sequelize.authenticate();

  // 1. Current mode + headline numbers.
  heading('1. Current state');

  const [mode] = await q(`
    SELECT "statementSandboxMode" AS sandbox,
           "documentRetentionPeriod"        AS shared_retention_days,
           "documentRetentionDateTrigger"   AS shared_retention_trigger,
           "statementRetentionPeriod"       AS statement_retention_days,
           "statementRetentionDateTrigger"  AS statement_retention_trigger
    FROM settings LIMIT 1;
  `);

  const sandboxOn = !mode || mode.sandbox !== false;
  console.log(`  Statement Sandbox Mode : ${sandboxOn ? 'ON  (global admins only, no customer emails)' : 'OFF (LIVE to customers, emails enabled)'}`);
  console.log(`  Retention (statements) : ${
    mode?.statement_retention_days == null
      ? `inherits invoices/credit notes -> ${fmt(mode?.shared_retention_days)} days, trigger ${fmt(mode?.shared_retention_trigger)}`
      : `${mode.statement_retention_days} days, trigger ${fmt(mode.statement_retention_trigger)}`
  }`);

  const [totals] = await q(`
    SELECT COUNT(*)                                    AS total,
           COUNT(DISTINCT "companyId")                 AS companies,
           MIN("periodEnd")::date                      AS oldest_period,
           MAX("periodEnd")::date                      AS newest_period,
           MIN("createdAt")                            AS first_created,
           MAX("createdAt")                            AS last_created
    FROM statements;
  `);
  console.log('');
  table([totals]);

  if (Number(totals.total) === 0) {
    heading('Nothing else to report - there are no statements in the portal.');
    return;
  }

  // 2. Where they came from.
  heading('2. Provenance: what created each statement');
  console.log("  'generated' + generated_pdf/xlsx  = built by the ACR11P generator");
  console.log("  'manual_upload'                   = a finished PDF/XLS uploaded via portal or FTP");
  console.log('');
  table(await q(`
    SELECT COALESCE(metadata->>'source', '(unset)')           AS source,
           COALESCE(metadata->>'processingMethod', '(unset)') AS method,
           COUNT(*)                                           AS statements,
           COUNT(DISTINCT "companyId")                        AS companies,
           MIN("createdAt")                                   AS first_seen,
           MAX("createdAt")                                   AS last_seen
    FROM statements
    GROUP BY 1, 2
    ORDER BY statements DESC;
  `));

  // 3. Batches.
  heading('3. Batches: each date these were generated on');
  table(await q(`
    SELECT DATE("createdAt")           AS created_on,
           COUNT(*)                    AS statements,
           COUNT(DISTINCT "companyId") AS companies,
           MIN("periodEnd")::date      AS oldest_period,
           MAX("periodEnd")::date      AS newest_period
    FROM statements
    GROUP BY 1
    ORDER BY 1;
  `));

  // 4. Source export files.
  heading('4. Source .TXT exports each batch was built from');
  table(await q(`
    SELECT COALESCE(f.metadata->>'generatedFrom', '(unknown)') AS source_export,
           COALESCE(f.metadata->>'source', '(unset)')          AS import_route,
           COUNT(DISTINCT f.id)                                AS files,
           MIN(f."createdAt")                                  AS started,
           MAX(f."createdAt")                                  AS finished
    FROM files f
    WHERE f."fileType" = 'statement'
    GROUP BY 1, 2
    ORDER BY started;
  `));

  // 5. Who ran them.
  heading('5. Who created them');
  table(await q(`
    SELECT COALESCE(u.email, '(system / no user recorded)') AS created_by,
           COALESCE(u.role, '-')                            AS role,
           COUNT(*)                                         AS statements
    FROM statements s
    LEFT JOIN users u ON u.id = s."createdById"
    GROUP BY 1, 2
    ORDER BY statements DESC;
  `));

  // 6. What customers would see at go-live.
  heading('6. What customers would see the moment Sandbox Mode is switched off');
  const [visible] = await q(`
    SELECT COUNT(*)                                                   AS statements,
           COUNT(DISTINCT s."companyId")                              AS companies,
           COUNT(DISTINCT s."periodEnd")                              AS distinct_periods
    FROM statements s
    JOIN companies c ON c.id = s."companyId";
  `);
  table([visible]);
  console.log('');
  console.log('  Per company (top 15 by statement count):');
  console.log('');
  table(await q(`
    SELECT c."referenceNo"          AS cust_no,
           c.name                   AS company,
           c.type                   AS type,
           COUNT(*)                 AS statements,
           MIN(s."periodEnd")::date AS oldest,
           MAX(s."periodEnd")::date AS newest
    FROM statements s
    JOIN companies c ON c.id = s."companyId"
    GROUP BY 1, 2, 3
    ORDER BY statements DESC
    LIMIT 15;
  `));

  // 7. Retention exposure - the one that is irreversible.
  heading('7. Retention exposure (nightly cleanup HARD DELETES, no undo)');
  const [expiry] = await q(`
    SELECT COUNT(*)                                                                    AS total,
           COUNT(*) FILTER (WHERE "retentionExpiryDate" IS NULL)                       AS never_expire,
           COUNT(*) FILTER (WHERE "retentionExpiryDate" <= NOW())                      AS deleted_next_run,
           COUNT(*) FILTER (WHERE "retentionExpiryDate" > NOW()
                              AND "retentionExpiryDate" <= NOW() + INTERVAL '30 days') AS expire_within_30d,
           MIN("retentionExpiryDate")                                                  AS earliest_expiry
    FROM statements;
  `);
  table([expiry]);
  console.log('');
  if (Number(expiry.deleted_next_run) > 0) {
    console.log(`  ⚠️  ${expiry.deleted_next_run} statement(s) are already past their retention expiry.`);
    console.log('     The document-retention-cleanup job runs daily at midnight and HARD');
    console.log('     DELETES these rows and their PDF/XLSX files. There is no undo.');
    console.log('     To keep them, either set a Statement Retention override in Settings,');
    console.log('     or change the retention trigger to Upload Date before midnight.');
  } else {
    console.log('  ✅ Nothing is due for deletion on the next cleanup run.');
  }

  console.log('');
}

main()
  .then(async () => { await sequelize.close(); process.exit(0); })
  .catch(async (err) => {
    console.error('');
    console.error('❌ Report failed:', err.message);
    try { await sequelize.close(); } catch (_) {}
    process.exit(1);
  });
