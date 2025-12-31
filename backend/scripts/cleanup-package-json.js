/**
 * Remove npm script references to deleted scripts from package.json
 * Run: node scripts/cleanup-package-json.js
 */

const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '..', 'package.json');

// Scripts to remove from package.json
const scriptsToRemove = [
  'create:rob',
  'update:env',
  'test:parse',
  'queue:status',
  'create:templates'
];

function cleanupPackageJson() {
  console.log('📦 Cleaning up package.json scripts...\n');
  
  if (!fs.existsSync(packageJsonPath)) {
    console.error('❌ package.json not found!');
    process.exit(1);
  }
  
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const scripts = packageJson.scripts || {};
  
  let removedCount = 0;
  const removed = [];
  
  scriptsToRemove.forEach(scriptName => {
    if (scripts[scriptName]) {
      removed.push({ name: scriptName, command: scripts[scriptName] });
      delete scripts[scriptName];
      removedCount++;
      console.log(`✅ Removed: ${scriptName}`);
    } else {
      console.log(`⚠️  Not found: ${scriptName}`);
    }
  });
  
  packageJson.scripts = scripts;
  
  // Write back
  fs.writeFileSync(
    packageJsonPath,
    JSON.stringify(packageJson, null, 2) + '\n',
    'utf8'
  );
  
  console.log(`\n📊 Summary: Removed ${removedCount} script references`);
  console.log('\n✅ package.json updated!');
  
  if (removed.length > 0) {
    console.log('\n📋 Removed scripts:');
    removed.forEach(({ name, command }) => {
      console.log(`   ${name}: ${command}`);
    });
  }
}

cleanupPackageJson();

