/**
 * Script to clean up temporary and one-time use scripts
 * Run: node scripts/cleanup-scripts.js
 */

const fs = require('fs');
const path = require('path');

const scriptsDir = __dirname;

// Files to DELETE (temporary/testing)
const filesToDelete = [
  // Password reset scripts
  'reset-password-wsl-simple.sh',
  'reset-password-wsl.sh',
  'reset-password-now.ps1',
  'reset-postgres-password.ps1',
  'find-db-password.js',
  'test-db-passwords.js',
  'reset-db-password-guide.md',
  'reset-password-simple.md',
  'reset-password-wsl-guide.md',
  'reset-postgres-password.md',
  
  // Test scripts
  'test-parsing-direct.js',
  'test-template-query.js',
  'test-admin-permissions.js',
  
  // Diagnostic scripts
  'check-admin-user.js',
  'check-all-users.js',
  'check-excel-columns.js',
  'check-file-columns.js',
  'check-queue-status.js',
  'check-template-columns.js',
  'check-tables.js',
  
  // User-specific
  'reset-rob-password.js',
  'create-rob-admin.js',
  
  // Note: update-env.js is referenced in package.json but appears to be one-time use
  // 'update-env.js', // Commented out - check if still needed
  
  // One-time migrations (already applied)
  'add-edi-column.js',
  'add-edi-column-direct.js',
  'add-email-provider-column.js',
  'add-file-columns.js',
  'add-file-failure-fields.js',
  'add-file-table.js',
  'add-filetype-column.js',
  'add-global-system-email-column.js',
  'add-must-change-password-column.js',
  'add-parsing-provider-column.js',
  'add-settings-columns-manual.js',
  'add-settings-columns.js',
  'add-settings-ftp-columns.js',
  'add-user-email-preference-columns.js',
  'create-documents-tables.js',
  'create-email-templates-table.js',
  'create-file-table-manual.js',
  'create-logs-table.js',
  'create-supplier-templates-table.js',
  'create-tables.js',
  'create-user-companies-table.js',
  'migrate-settings-company-info.js',
  'update-branding-to-einvoice.js',
];

// Files to KEEP (useful utilities)
const filesToKeep = [
  'cleanup-old-logs.js',
  'run-file-cleanup.js',
  'create-admin-user.js',
  'clear-all-rate-limits.js',
  'clear-api-rate-limit.js',
  'clear-rate-limit.js',
  'test-connection.js',
  'check-setup.js',
  'sync-template-model.js',
  'cleanup-scripts.js', // This script itself
  // CLEANUP_PLAN.md moved to docs/ folder
];

function cleanup(dryRun = true) {
  const mode = dryRun ? 'DRY RUN' : 'DELETING';
  console.log(`🧹 Starting scripts cleanup (${mode})...\n`);
  
  // Check package.json for references
  const packageJsonPath = path.join(scriptsDir, '..', 'package.json');
  let packageJson = {};
  if (fs.existsSync(packageJsonPath)) {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  }
  
  const scriptsInPackage = packageJson.scripts || {};
  const referencedScripts = [];
  
  // Check which files to delete are referenced in package.json
  filesToDelete.forEach(file => {
    const scriptName = file.replace('.js', '').replace('.sh', '').replace('.ps1', '');
    Object.keys(scriptsInPackage).forEach(key => {
      if (scriptsInPackage[key].includes(file)) {
        referencedScripts.push({ file, script: key, command: scriptsInPackage[key] });
      }
    });
  });
  
  if (referencedScripts.length > 0) {
    console.log('⚠️  WARNING: Some files to delete are referenced in package.json:');
    referencedScripts.forEach(({ file, script, command }) => {
      console.log(`   ${file} -> npm run ${script}`);
    });
    console.log('\n💡 You may want to remove these npm scripts first.\n');
  }
  
  let deletedCount = 0;
  let notFoundCount = 0;
  let errors = [];
  
  filesToDelete.forEach(file => {
    const filePath = path.join(scriptsDir, file);
    
    if (fs.existsSync(filePath)) {
      if (dryRun) {
        console.log(`[DRY RUN] Would delete: ${file}`);
        deletedCount++;
      } else {
        try {
          fs.unlinkSync(filePath);
          console.log(`✅ Deleted: ${file}`);
          deletedCount++;
        } catch (error) {
          console.error(`❌ Error deleting ${file}:`, error.message);
          errors.push({ file, error: error.message });
        }
      }
    } else {
      console.log(`⚠️  Not found: ${file} (already deleted?)`);
      notFoundCount++;
    }
  });
  
  console.log('\n📊 Summary:');
  console.log(`   Deleted: ${deletedCount} files`);
  console.log(`   Not found: ${notFoundCount} files`);
  console.log(`   Errors: ${errors.length}`);
  
  if (errors.length > 0) {
    console.log('\n❌ Errors:');
    errors.forEach(({ file, error }) => {
      console.log(`   ${file}: ${error}`);
    });
  }
  
  if (dryRun) {
    console.log('\n✅ Dry run complete!');
    console.log('\n💡 To actually delete files, run: node scripts/cleanup-scripts.js --delete');
  } else {
    console.log('\n✅ Cleanup complete!');
  }
  
  console.log('\n📋 Remaining useful scripts:');
  filesToKeep.forEach(file => {
    const filePath = path.join(scriptsDir, file);
    if (fs.existsSync(filePath)) {
      console.log(`   ✓ ${file}`);
    }
  });
  
  console.log('\n💡 Tip: Review docs/CLEANUP_PLAN.md for details on what was removed.');
}

// Check command line arguments
const args = process.argv.slice(2);
const shouldDelete = args.includes('--delete') || args.includes('-d');

if (!shouldDelete) {
  console.log('ℹ️  Running in DRY RUN mode. No files will be deleted.');
  console.log('   Use --delete flag to actually delete files.\n');
}

// Run cleanup
cleanup(!shouldDelete);

