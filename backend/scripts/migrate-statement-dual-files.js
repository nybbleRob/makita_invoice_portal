/**
 * Migration: Statement dual-file support
 *  - Adds pdfFileUrl + xlsFileUrl columns to statements
 *  - Backfills the new columns from the legacy fileUrl based on file extension
 *  - Drops the global unique constraint on statementNumber
 *  - Adds a composite unique index on (companyId, periodEnd)
 *
 * Idempotent: safe to re-run.
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

async function columnExists(table, column) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    { bind: [table, column] }
  );
  return rows.length > 0;
}

async function constraintExists(table, name) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.table_constraints WHERE table_name = $1 AND constraint_name = $2`,
    { bind: [table, name] }
  );
  return rows.length > 0;
}

async function indexExists(name) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM pg_indexes WHERE indexname = $1`,
    { bind: [name] }
  );
  return rows.length > 0;
}

async function migrate() {
  try {
    console.log('Starting migration: Statement dual-file support...');
    await sequelize.authenticate();
    console.log('Database connection established');

    if (!(await columnExists('statements', 'pdfFileUrl'))) {
      console.log('Adding pdfFileUrl column...');
      await sequelize.query(`ALTER TABLE statements ADD COLUMN "pdfFileUrl" VARCHAR(255)`);
      await sequelize.query(`COMMENT ON COLUMN statements."pdfFileUrl" IS 'Path to the PDF rendition of this statement'`);
    } else {
      console.log('pdfFileUrl already exists, skipping');
    }

    if (!(await columnExists('statements', 'xlsFileUrl'))) {
      console.log('Adding xlsFileUrl column...');
      await sequelize.query(`ALTER TABLE statements ADD COLUMN "xlsFileUrl" VARCHAR(255)`);
      await sequelize.query(`COMMENT ON COLUMN statements."xlsFileUrl" IS 'Path to the XLS/XLSX rendition of this statement'`);
    } else {
      console.log('xlsFileUrl already exists, skipping');
    }

    console.log('Backfilling pdfFileUrl/xlsFileUrl from legacy fileUrl...');
    await sequelize.query(`
      UPDATE statements
      SET "pdfFileUrl" = "fileUrl"
      WHERE "pdfFileUrl" IS NULL
        AND "fileUrl" IS NOT NULL
        AND lower("fileUrl") LIKE '%.pdf'
    `);
    await sequelize.query(`
      UPDATE statements
      SET "xlsFileUrl" = "fileUrl"
      WHERE "xlsFileUrl" IS NULL
        AND "fileUrl" IS NOT NULL
        AND (lower("fileUrl") LIKE '%.xls' OR lower("fileUrl") LIKE '%.xlsx')
    `);

    // Drop legacy unique constraint on statementNumber if present.
    // Sequelize commonly names this constraint "statements_statementNumber_key"
    // but we look it up dynamically so an oddly-named one still gets cleaned up.
    const [uniqueRows] = await sequelize.query(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
       AND tc.table_schema = ccu.table_schema
      WHERE tc.table_name = 'statements'
        AND tc.constraint_type = 'UNIQUE'
        AND ccu.column_name = 'statementNumber'
    `);
    for (const row of uniqueRows) {
      console.log(`Dropping legacy unique constraint ${row.constraint_name} on statements.statementNumber`);
      await sequelize.query(`ALTER TABLE statements DROP CONSTRAINT "${row.constraint_name}"`);
    }

    if (!(await indexExists('statements_company_period_end_unique'))) {
      console.log('Pre-flight: deduping any existing rows that would collide on (companyId, periodEnd)...');
      // Keep oldest row per (companyId, periodEnd); merge file URLs from younger duplicates,
      // then delete the duplicates so the unique index can be created.
      await sequelize.query(`
        WITH ranked AS (
          SELECT id, "companyId", "periodEnd", "fileUrl", "pdfFileUrl", "xlsFileUrl",
                 ROW_NUMBER() OVER (
                   PARTITION BY "companyId", "periodEnd"
                   ORDER BY "createdAt" ASC, id ASC
                 ) AS rn
          FROM statements
        ),
        canonical AS (
          SELECT * FROM ranked WHERE rn = 1
        ),
        duplicates AS (
          SELECT * FROM ranked WHERE rn > 1
        )
        UPDATE statements s SET
          "pdfFileUrl" = COALESCE(s."pdfFileUrl", d_pdf."pdfFileUrl"),
          "xlsFileUrl" = COALESCE(s."xlsFileUrl", d_xls."xlsFileUrl")
        FROM canonical c
        LEFT JOIN LATERAL (
          SELECT "pdfFileUrl"
          FROM duplicates d
          WHERE d."companyId" = c."companyId" AND d."periodEnd" = c."periodEnd"
            AND d."pdfFileUrl" IS NOT NULL
          ORDER BY d.rn ASC
          LIMIT 1
        ) d_pdf ON true
        LEFT JOIN LATERAL (
          SELECT "xlsFileUrl"
          FROM duplicates d
          WHERE d."companyId" = c."companyId" AND d."periodEnd" = c."periodEnd"
            AND d."xlsFileUrl" IS NOT NULL
          ORDER BY d.rn ASC
          LIMIT 1
        ) d_xls ON true
        WHERE s.id = c.id;
      `);

      const [{ count: dupCount }] = (await sequelize.query(`
        SELECT COUNT(*)::int AS count FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY "companyId", "periodEnd" ORDER BY "createdAt" ASC, id ASC) AS rn
          FROM statements
        ) r WHERE r.rn > 1
      `))[0];
      if (dupCount > 0) {
        console.log(`Removing ${dupCount} duplicate Statement row(s) collapsed into the canonical row`);
        await sequelize.query(`
          DELETE FROM statements WHERE id IN (
            SELECT id FROM (
              SELECT id, ROW_NUMBER() OVER (PARTITION BY "companyId", "periodEnd" ORDER BY "createdAt" ASC, id ASC) AS rn
              FROM statements
            ) r WHERE r.rn > 1
          )
        `);
      }

      console.log('Adding composite unique index statements_company_period_end_unique...');
      await sequelize.query(`
        CREATE UNIQUE INDEX statements_company_period_end_unique
        ON statements ("companyId", "periodEnd")
      `);
    } else {
      console.log('statements_company_period_end_unique already exists, skipping');
    }

    console.log('Migration completed successfully');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
