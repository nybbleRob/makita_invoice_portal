/**
 * File Storage Configuration
 * Restructured storage system with clear folder hierarchy on /mnt/data
 * 
 * Folder Structure:
 * /mnt/data/
 * ├── invoice-portal/
 * │   └── uploads/          <- FTP users upload here (chroot target)
 * ├── unprocessed/
 * │   ├── duplicates/       <- Files detected as duplicates (hash match)
 * │   └── failed/           <- Files that failed parsing/allocation
 * ├── processed/
 * │   ├── invoices/YYYY/MM/DD/
 * │   ├── creditnotes/YYYY/MM/DD/
 * │   └── statements/YYYY/MM/DD/
 */

const path = require('path');
const fs = require('fs');

// ============================================
// PATH CONFIGURATION
// ============================================

// Base path for all storage (the mounted data drive)
const DATA_DRIVE = process.env.DATA_DRIVE_PATH || '/mnt/data';

// FTP Upload path - where SFTP users drop files
const FTP_UPLOAD_PATH = process.env.FTP_UPLOAD_PATH || path.join(DATA_DRIVE, 'invoice-portal', 'uploads');

// Unprocessed files paths
const UNPROCESSED_BASE = process.env.UNPROCESSED_PATH || path.join(DATA_DRIVE, 'unprocessed');
const UNPROCESSED_DUPLICATES = path.join(UNPROCESSED_BASE, 'duplicates');
const UNPROCESSED_FAILED = path.join(UNPROCESSED_BASE, 'failed');

// Processed files paths
const PROCESSED_BASE = process.env.PROCESSED_PATH || path.join(DATA_DRIVE, 'processed');
const PROCESSED_INVOICES = path.join(PROCESSED_BASE, 'invoices');
const PROCESSED_CREDITNOTES = path.join(PROCESSED_BASE, 'creditnotes');
const PROCESSED_STATEMENTS = path.join(PROCESSED_BASE, 'statements');

// Legacy storage base (for backward compatibility with existing code)
const STORAGE_BASE = process.env.FILE_STORAGE_PATH || path.join(__dirname, '..', 'uploads');

// ============================================
// STORAGE PATHS OBJECT
// ============================================

const STORAGE_PATHS = {
  // Data drive base
  dataDrive: DATA_DRIVE,
  
  // FTP upload folder
  ftpUpload: FTP_UPLOAD_PATH,
  
  // Unprocessed folders
  unprocessed: {
    base: UNPROCESSED_BASE,
    duplicates: UNPROCESSED_DUPLICATES,
    failed: UNPROCESSED_FAILED
  },
  
  // Processed folders
  processed: {
    base: PROCESSED_BASE,
    invoices: PROCESSED_INVOICES,
    creditnotes: PROCESSED_CREDITNOTES,
    statements: PROCESSED_STATEMENTS
  },
  
  // Legacy paths (for branding, templates, etc.)
  legacy: {
    base: STORAGE_BASE,
    templates: path.join(STORAGE_BASE, 'templates'),
    avatars: path.join(STORAGE_BASE, 'avatars'),
    temp: path.join(STORAGE_BASE, 'temp')
  }
};

// Legacy STORAGE_DIRS for backward compatibility
const STORAGE_DIRS = {
  invoices: PROCESSED_INVOICES,
  templates: path.join(STORAGE_BASE, 'templates'),
  avatars: path.join(STORAGE_BASE, 'avatars'),
  test: path.join(STORAGE_BASE, 'test'),
  temp: path.join(STORAGE_BASE, 'temp')
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Ensure a directory exists, creating it if necessary
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`📁 Created directory: ${dirPath}`);
  }
  return dirPath;
}

/**
 * Get dated folder path for processed/unprocessed files
 * Creates YYYY/MM/DD structure for organization
 * @param {string} basePath - Base directory path
 * @param {Date} date - Date to use (defaults to now)
 * @returns {string} Full path to dated folder
 */
function getDatedFolder(basePath, date = new Date()) {
  const year = date.getFullYear().toString();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  const datedPath = path.join(basePath, year, month, day);
  ensureDir(datedPath);
  return datedPath;
}

/**
 * Get the correct processed folder for a document type
 * @param {string} documentType - 'invoice', 'creditnote', 'credit_note', or 'statement'
 * @returns {string} Path to the document type folder
 */
function getProcessedFolder(documentType) {
  const type = documentType.toLowerCase().replace('_', '');
  
  switch (type) {
    case 'invoice':
    case 'invoices':
      return PROCESSED_INVOICES;
    case 'creditnote':
    case 'creditnotes':
    case 'credit_note':
    case 'credit_notes':
      return PROCESSED_CREDITNOTES;
    case 'statement':
    case 'statements':
      return PROCESSED_STATEMENTS;
    default:
      // Default to invoices for unknown types
      console.warn(`Unknown document type: ${documentType}, defaulting to invoices`);
      return PROCESSED_INVOICES;
  }
}

/**
 * Get full path for a processed document
 * @param {string} documentType - Type of document
 * @param {string} fileName - Name of the file
 * @param {Date} date - Date for folder structure (defaults to now)
 * @returns {string} Full path to store the document
 */
function getProcessedFilePath(documentType, fileName, date = new Date()) {
  const baseFolder = getProcessedFolder(documentType);
  const datedFolder = getDatedFolder(baseFolder, date);
  return path.join(datedFolder, fileName);
}

/**
 * Get full path for an unprocessed/failed document
 * @param {string} reason - 'duplicate' or 'failed'
 * @param {string} fileName - Name of the file
 * @param {Date} date - Date for folder structure (defaults to now)
 * @returns {string} Full path to store the document
 */
function getUnprocessedFilePath(reason, fileName, date = new Date()) {
  const baseFolder = reason === 'duplicate' ? UNPROCESSED_DUPLICATES : UNPROCESSED_FAILED;
  const year = date.getFullYear().toString();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const datedFolder = path.join(baseFolder, `${year}-${month}-${day}`);
  ensureDir(datedFolder);
  return path.join(datedFolder, fileName);
}

/**
 * Ensure all storage directories exist
 */
function ensureStorageDirs() {
  console.log(`💾 File storage configuration:`);
  console.log(`   Data drive: ${DATA_DRIVE}`);
  console.log(`   FTP upload: ${FTP_UPLOAD_PATH}`);
  console.log(`   Unprocessed: ${UNPROCESSED_BASE}`);
  console.log(`   Processed: ${PROCESSED_BASE}`);
  console.log(`   Legacy uploads: ${STORAGE_BASE}`);
  
  // Ensure all directories exist
  const dirsToCreate = [
    FTP_UPLOAD_PATH,
    UNPROCESSED_DUPLICATES,
    UNPROCESSED_FAILED,
    PROCESSED_INVOICES,
    PROCESSED_CREDITNOTES,
    PROCESSED_STATEMENTS,
    STORAGE_DIRS.templates,
    STORAGE_DIRS.avatars,
    STORAGE_DIRS.temp
  ];
  
  for (const dir of dirsToCreate) {
    try {
      ensureDir(dir);
    } catch (error) {
      console.warn(`   ⚠️ Could not create directory: ${dir} (${error.message})`);
    }
  }
  
  // Check available space (if on Linux)
  if (process.platform === 'linux') {
    try {
      const { execSync } = require('child_process');
      const dfOutput = execSync(`df -h "${DATA_DRIVE}" 2>/dev/null | tail -1`, { encoding: 'utf8' });
      const parts = dfOutput.trim().split(/\s+/);
      if (parts.length >= 5) {
        const available = parts[3];
        const usePercent = parts[4];
        console.log(`   Available space: ${available} (${usePercent} used)`);
      }
    } catch (error) {
      // Ignore errors (df might not work in all environments)
    }
  }
}

/**
 * Get storage path for a specific type (legacy support)
 * @param {string} type - 'invoices', 'templates', 'avatars', 'test', 'temp'
 * @returns {string} Full path to storage directory
 */
function getStorageDir(type) {
  const dir = STORAGE_DIRS[type];
  if (!dir) {
    throw new Error(`Unknown storage type: ${type}. Valid types: ${Object.keys(STORAGE_DIRS).join(', ')}`);
  }
  return dir;
}

/**
 * Get full file path (legacy support)
 * @param {string} type - Storage type
 * @param {string} filename - Filename
 * @returns {string} Full file path
 */
function getFilePath(type, filename) {
  return path.join(getStorageDir(type), filename);
}

/**
 * Get relative path from storage base (for database storage)
 * @param {string} type - Storage type
 * @param {string} filename - Filename
 * @returns {string} Relative path (e.g., /uploads/invoices/file.pdf)
 */
function getRelativePath(type, filename) {
  const fullPath = getFilePath(type, filename);
  const relativePath = path.relative(STORAGE_BASE, fullPath);
  return '/' + relativePath.replace(/\\/g, '/');
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // New storage paths
  STORAGE_PATHS,
  FTP_UPLOAD_PATH,
  UNPROCESSED_BASE,
  UNPROCESSED_DUPLICATES,
  UNPROCESSED_FAILED,
  PROCESSED_BASE,
  PROCESSED_INVOICES,
  PROCESSED_CREDITNOTES,
  PROCESSED_STATEMENTS,
  
  // Legacy exports for backward compatibility
  STORAGE_BASE,
  STORAGE_DIRS,
  
  // Helper functions
  ensureDir,
  getDatedFolder,
  getProcessedFolder,
  getProcessedFilePath,
  getUnprocessedFilePath,
  ensureStorageDirs,
  getStorageDir,
  getFilePath,
  getRelativePath
};
