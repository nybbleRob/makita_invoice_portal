#!/usr/bin/env node
/**
 * Statement routing safety net.
 *
 * Run with: `node scripts/test-statement-routing.js`
 *
 * This is not a real test framework (the project doesn't ship one). It's a
 * standalone script that exercises the three routing guarantees the plan
 * promises, using stubbed Sequelize models so it can run on a developer's
 * machine without a database. Exits non-zero on assertion failure so it
 * can be wired into CI later if desired.
 *
 * Scenarios covered:
 *  1. PDF + XLS for account 33 produce a single Statement record (dedupe).
 *  2. The second-format pairing reports `isNew=false` so callers skip the
 *     duplicate notification.
 *  3. A non-CORP company match for a statement-typed document is rejected;
 *     no Statement is created.
 *  4. `getNotificationRecipients(companyId, 'statement')` only returns users
 *     who opted in to statement emails (`sendStatementEmail: true`); a user
 *     opted in for invoices but not statements is excluded from the list.
 *  5. The notification recipient object exposes per-format flags
 *     (`sendPdfAttachment`, `sendXlsAttachment`) instead of the legacy
 *     single-toggle `sendAttachment`.
 */

'use strict';

const assert = require('assert');
const Module = require('module');
const path = require('path');

let failures = 0;
const tests = [];
function ok(name, fn) {
  tests.push({ name, fn });
}
async function runTests() {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ok  - ${name}`);
    } catch (err) {
      failures++;
      console.log(`  FAIL - ${name}`);
      console.log(`         ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n         ') : err}`);
    }
  }
}

/**
 * Hijack require() for a single sub-tree of modules so we can substitute the
 * Sequelize-backed models with in-memory stubs. Restored at the end of the
 * script. This is the same trick proxyquire uses, written inline because the
 * project doesn't ship proxyquire.
 */
function withMockedRequires(moduleStubs, body) {
  const originalResolve = Module._resolveFilename;
  const originalLoad = Module._load;
  const stubs = new Map(Object.entries(moduleStubs).map(([k, v]) => [path.normalize(k), v]));

  Module._load = function (request, parent, isMain) {
    // Try to resolve the request relative to the parent so we can match against
    // both './models' and '../models' forms.
    let resolved;
    try {
      resolved = originalResolve.call(this, request, parent, isMain);
    } catch (e) {
      resolved = null;
    }

    for (const [key, stub] of stubs) {
      if (resolved && resolved.endsWith(key)) return stub;
      if (request === key) return stub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  return body().finally(() => {
    Module._load = originalLoad;
  });
}

/**
 * In-memory Statement table that mimics the bits of the Sequelize model
 * findOrCreateStatement actually uses (findOne + create + .update).
 */
function makeStatementStore() {
  const rows = [];
  let nextId = 1;

  function makeInstance(data) {
    const inst = { ...data };
    inst.update = async function (updates) {
      Object.assign(inst, updates);
      return inst;
    };
    return inst;
  }

  return {
    rows,
    findOne: async function ({ where }) {
      return rows.find(r =>
        r.companyId === where.companyId &&
        new Date(r.periodEnd).getTime() === new Date(where.periodEnd).getTime()
      ) || null;
    },
    create: async function (data) {
      const inst = makeInstance({ id: String(nextId++), ...data });
      rows.push(inst);
      return inst;
    }
  };
}

function makeCompanyStoreFrom(initialCompanies) {
  const store = {
    companies: [...initialCompanies],
    findOne: async function ({ where }) {
      return store.companies.find(c =>
        String(c.referenceNo) === String(where.referenceNo) &&
        (!where.type || c.type === where.type)
      ) || null;
    },
    findByPk: async function (id) {
      return store.companies.find(c => c.id === id) || null;
    }
  };
  return store;
}
function makeCompanyStore({ corpId = 'corp-33', subId = 'sub-33-branch' } = {}) {
  return makeCompanyStoreFrom([
    { id: corpId, name: 'Account 33 (Corporate)', referenceNo: 33, type: 'CORP', parentId: null },
    { id: subId, name: 'Account 33 (Branch)', referenceNo: 33, type: 'BRANCH', parentId: corpId }
  ]);
}

function makeUserStore(users) {
  return {
    findAll: async function ({ where = {} } = {}) {
      return users.filter(u => {
        if (where.isActive !== undefined && u.isActive !== where.isActive) return false;
        if (where.sendInvoiceEmail !== undefined && u.sendInvoiceEmail !== where.sendInvoiceEmail) return false;
        if (where.sendStatementEmail !== undefined && u.sendStatementEmail !== where.sendStatementEmail) return false;
        return true;
      });
    }
  };
}

console.log('# Statement routing safety net');

// ===========================================================================
// Scenario 1+2: PDF then XLS for account 33 produces one record (isNew flips).
// ===========================================================================
ok('PDF then XLS for the same statement period dedupes to one row (isNew flips)', async () => {
  const StatementStore = makeStatementStore();
  const CompanyStore = makeCompanyStore();

  const stubs = {
    [path.join('models', 'index.js')]: {
      Statement: StatementStore,
      Company: CompanyStore,
      sequelize: {}
    },
    [path.join('utils', 'documentRetention.js')]: {
      calculateDocumentRetentionDates: () => ({ retentionStartDate: null, retentionExpiryDate: null })
    }
  };

  await withMockedRequires(stubs, async () => {
    // Reload statementImport with mocked deps. Bust require cache first.
    const helperPath = require.resolve('../utils/statementImport');
    delete require.cache[helperPath];
    const { findOrCreateStatement } = require('../utils/statementImport');

    const matchedCompanyId = 'corp-33';
    const statementDate = new Date('2026-04-30');
    const parsedData = {
      totalBalance: 12345.67,
      currentAmount: 100,
      overdue1To30: 200,
      overdue31To60: 300,
      overdue61To90: 400,
      overdue91Plus: 500
    };

    const first = await findOrCreateStatement({
      matchedCompanyId,
      statementDate,
      parsedData,
      filePath: '/storage/statements/account-33-april.pdf',
      fileMeta: { fileId: 'pdf-1' }
    });

    assert.strictEqual(first.isNew, true, 'first PDF arrival must be a new statement');
    assert.strictEqual(first.fileSlot, 'pdf');
    assert.strictEqual(first.statement.pdfFileUrl, '/storage/statements/account-33-april.pdf');
    assert.strictEqual(first.statement.xlsFileUrl, null);
    assert.strictEqual(StatementStore.rows.length, 1);

    const second = await findOrCreateStatement({
      matchedCompanyId,
      statementDate,
      parsedData,
      filePath: '/storage/statements/account-33-april.xlsx',
      fileMeta: { fileId: 'xls-1' }
    });

    assert.strictEqual(second.isNew, false, 'second-format pairing must not create a new statement');
    assert.strictEqual(second.fileSlot, 'xls');
    assert.strictEqual(StatementStore.rows.length, 1, 'still exactly one statement row');
    assert.strictEqual(second.statement.pdfFileUrl, '/storage/statements/account-33-april.pdf');
    assert.strictEqual(second.statement.xlsFileUrl, '/storage/statements/account-33-april.xlsx');
  });
});

// ===========================================================================
// Scenario 3: A non-CORP company match must not produce a Statement.
// ===========================================================================
ok('findCorpCompanyByAccountNumber returns null when only a BRANCH/SUB matches', async () => {
  // Only a BRANCH exists for account 33 - no CORP available.
  const CompanyStore = makeCompanyStoreFrom([
    { id: 'branch-only', name: 'Account 33 (Branch)', referenceNo: 33, type: 'BRANCH', parentId: 'absent' }
  ]);

  const stubs = {
    [path.join('models', 'index.js')]: {
      Statement: makeStatementStore(),
      Company: CompanyStore,
      sequelize: {}
    },
    [path.join('utils', 'documentRetention.js')]: {
      calculateDocumentRetentionDates: () => ({ retentionStartDate: null, retentionExpiryDate: null })
    }
  };

  await withMockedRequires(stubs, async () => {
    const helperPath = require.resolve('../utils/statementImport');
    delete require.cache[helperPath];
    const { findCorpCompanyByAccountNumber } = require('../utils/statementImport');
    const corp = await findCorpCompanyByAccountNumber(33);
    assert.strictEqual(corp, null, 'must not match a non-CORP company for a statement');
  });
});

ok('findCorpCompanyByAccountNumber returns the CORP when one exists', async () => {
  const CompanyStore = makeCompanyStore();
  const stubs = {
    [path.join('models', 'index.js')]: {
      Statement: makeStatementStore(),
      Company: CompanyStore,
      sequelize: {}
    },
    [path.join('utils', 'documentRetention.js')]: {
      calculateDocumentRetentionDates: () => ({ retentionStartDate: null, retentionExpiryDate: null })
    }
  };

  await withMockedRequires(stubs, async () => {
    const helperPath = require.resolve('../utils/statementImport');
    delete require.cache[helperPath];
    const { findCorpCompanyByAccountNumber } = require('../utils/statementImport');
    const corp = await findCorpCompanyByAccountNumber(33);
    assert.ok(corp, 'CORP company should be returned when one exists');
    assert.strictEqual(corp.type, 'CORP');
    assert.strictEqual(corp.id, 'corp-33');
  });
});

// ===========================================================================
// Scenario 4+5: Notification recipient shape for statements.
// ===========================================================================
ok('getNotificationRecipients excludes invoice-only opted-in users for statements', async () => {
  // Three users:
  //  - alice: opted in for invoices only (must NOT be a statement recipient)
  //  - bob:   opted in for statements with PDF only
  //  - carol: opted in for statements with XLS only
  const users = [
    {
      id: 'u-alice', name: 'Alice', email: 'alice@example.com', role: 'external_user',
      isActive: true,
      sendInvoiceEmail: true, sendInvoiceAttachment: true,
      sendStatementEmail: false, sendStatementPdfAttachment: false, sendStatementXlsAttachment: false,
      sendEmailAsSummary: false
    },
    {
      id: 'u-bob', name: 'Bob', email: 'bob@example.com', role: 'external_user',
      isActive: true,
      sendInvoiceEmail: false, sendInvoiceAttachment: false,
      sendStatementEmail: true, sendStatementPdfAttachment: true, sendStatementXlsAttachment: false,
      sendEmailAsSummary: false
    },
    {
      id: 'u-carol', name: 'Carol', email: 'carol@example.com', role: 'external_user',
      isActive: true,
      sendInvoiceEmail: false, sendInvoiceAttachment: false,
      sendStatementEmail: true, sendStatementPdfAttachment: false, sendStatementXlsAttachment: true,
      sendEmailAsSummary: false
    }
  ];

  const UserStore = makeUserStore(users);

  const corpCompany = {
    id: 'corp-33', name: 'Account 33', referenceNo: 33, type: 'CORP', parentId: null,
    sendInvoiceEmail: false, sendInvoiceAttachment: false,
    sendStatementEmail: false,
    sendStatementPdfAttachment: false, sendStatementXlsAttachment: false,
    sendEmailAsSummary: false,
    primaryContact: null,
    primaryContactId: null,
    isActive: true
  };

  const CompanyStore = {
    companies: [corpCompany],
    findOne: async () => null,
    findByPk: async (id) => corpCompany.id === id ? corpCompany : null
  };

  const stubs = {
    [path.join('models', 'index.js')]: {
      User: UserStore,
      UserCompany: { findAll: async () => [] },
      Company: CompanyStore,
      Statement: makeStatementStore(),
      Invoice: makeStatementStore(),
      EmailLog: { create: async () => ({}) },
      Settings: { getSettings: async () => ({}) },
      sequelize: {}
    },
    [path.join('utils', 'companyHierarchy.js')]: {
      getAncestorCompanyIds: async () => [],
      getDescendantCompanyIds: async () => []
    },
    [path.join('utils', 'testMode.js')]: {
      getTestModeConfig: async () => ({ enabled: false })
    },
    [path.join('utils', 'emailQueue.js')]: {
      queueEmail: async () => ({ job: { id: 'mock' } })
    },
    [path.join('utils', 'tablerEmailRenderer.js')]: {
      renderTemplate: () => '<html></html>',
      formatDate: (d) => String(d),
      formatCurrency: (n) => String(n)
    },
    [path.join('config', 'queue.js')]: {
      emailQueue: { add: async () => ({ id: 'mock' }) },
      defaultEmailOptions: {},
      invoiceImportQueue: { add: async () => ({ id: 'mock' }) }
    },
    sequelize: {
      Op: new Proxy({}, { get: (_t, p) => Symbol.for(`Op.${String(p)}`) })
    }
  };

  await withMockedRequires(stubs, async () => {
    const servicePath = require.resolve('../services/documentNotificationService');
    delete require.cache[servicePath];
    const svc = require('../services/documentNotificationService');
    const recipients = await svc.getNotificationRecipients('corp-33', 'statement');
    const emails = recipients.map(r => r.email).sort();
    assert.deepStrictEqual(
      emails,
      ['bob@example.com', 'carol@example.com'],
      'invoice-only opted-in users must not receive statement emails'
    );

    const bob = recipients.find(r => r.email === 'bob@example.com');
    assert.strictEqual(typeof bob.sendPdfAttachment, 'boolean', 'recipient exposes sendPdfAttachment');
    assert.strictEqual(typeof bob.sendXlsAttachment, 'boolean', 'recipient exposes sendXlsAttachment');
    assert.strictEqual(bob.sendPdfAttachment, true);
    assert.strictEqual(bob.sendXlsAttachment, false);

    const carol = recipients.find(r => r.email === 'carol@example.com');
    assert.strictEqual(carol.sendPdfAttachment, false);
    assert.strictEqual(carol.sendXlsAttachment, true);
  });
});

runTests().then(() => {
  if (failures > 0) {
    console.log(`\n${failures} test(s) failed.`);
    process.exit(1);
  } else {
    console.log('\nAll routing-safety checks passed.');
    process.exit(0);
  }
});
