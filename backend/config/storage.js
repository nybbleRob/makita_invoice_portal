/**
 * File Storage Configuration
 * Supports local storage with optional separate drive mount point
 * 
 * Usage:
 * - Set FILE_STORAGE_PATH environment variable to use a custom location
 * - Default: ./uploads (relative to backend directory)
 * - Recommended: Mount a separate drive at /mnt/storage and set FILE_STORAGE_PATH=/mnt/storage/invoice-portal
 */

const path = require('path');
const fs = require('fs');

// Get storage path from environment variable or use default
const getStoragePath = () => {
  // Priority: 1) Environment variable, 2) Default relative path
  const envPath = process.env.FILE_STORAGE_PATH;
  
  if (envPath) {
    // Use absolute path from environment variable
    return path.resolve(envPath);
  }
  
  // Default: relative to backend directory
  return path.join(__dirname, '..', 'uploads');
};

// Base storage directory
const STORAGE_BASE = getStoragePath();

// Storage subdirectories
const STORAGE_DIRS = {
  invoices: path.join(STORAGE_BASE, 'invoices'),
  templates: path.join(STORAGE_BASE, 'templates'),
  avatars: path.join(STORAGE_BASE, 'avatars'),
  test: path.join(STORAGE_BASE, 'test'),
  temp: path.join(STORAGE_BASE, 'temp')
};

/**
 * Ensure all storage directories exist
 */
function ensureStorageDirs() {
  // Ensure base directory exists
  if (!fs.existsSync(STORAGE_BASE)) {
    fs.mkdirSync(STORAGE_BASE, { recursive: true });
    console.log(`📁 Created storage directory: ${STORAGE_BASE}`);
  }
  
  // Ensure all subdirectories exist
  Object.entries(STORAGE_DIRS).forEach(([name, dirPath]) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`📁 Created ${name} directory: ${dirPath}`);
    }
  });
  
  // Log storage configuration
  console.log(`💾 File storage configured:`);
  console.log(`   Base path: ${STORAGE_BASE}`);
  console.log(`   Source: ${process.env.FILE_STORAGE_PATH ? 'Environment variable (FILE_STORAGE_PATH)' : 'Default (./uploads)'}`);
  
  // Check available space (if on Linux)
  if (process.platform === 'linux') {
    try {
      const { execSync } = require('child_process');
      const dfOutput = execSync(`df -h "${STORAGE_BASE}" | tail -1`, { encoding: 'utf8' });
      const parts = dfOutput.trim().split(/\s+/);
      const available = parts[3];
      const usePercent = parts[4];
      console.log(`   Available space: ${available} (${usePercent} used)`);
    } catch (error) {
      // Ignore errors (df might not work in all environments)
    }
  }
}

/**
 * Get storage path for a specific type
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
 * Get full file path
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
  // Calculate relative path from storage base
  const fullPath = getFilePath(type, filename);
  const relativePath = path.relative(STORAGE_BASE, fullPath);
  // Normalize to use forward slashes (for web compatibility)
  return '/' + relativePath.replace(/\\/g, '/');
}

module.exports = {
  STORAGE_BASE,
  STORAGE_DIRS,
  ensureStorageDirs,
  getStorageDir,
  getFilePath,
  getRelativePath
};

