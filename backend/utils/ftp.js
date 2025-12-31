const ftp = require('basic-ftp');
const Client = require('ssh2-sftp-client');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * FTP/SFTP connection utilities
 */

/**
 * Get FTP config with database settings priority
 * Priority: Database settings > Environment variables (fallback only)
 * This ensures that changes made in the Settings UI take effect immediately
 */
function getFtpConfig(ftpConfig) {
  return {
    ...ftpConfig,
    // Use database settings first, fall back to environment variables only if database value is empty
    username: ftpConfig.username || process.env.FTP_USERNAME || process.env.SFTP_USERNAME || '',
    password: ftpConfig.password || process.env.FTP_PASSWORD || process.env.SFTP_PASSWORD || '',
    host: ftpConfig.host || process.env.FTP_HOST || process.env.SFTP_HOST || '',
    port: ftpConfig.port || process.env.FTP_PORT || process.env.SFTP_PORT || (ftpConfig.type === 'sftp' ? 22 : 21)
  };
}

/**
 * Test FTP/SFTP connection
 */
async function testConnection(ftpConfig) {
  const config = getFtpConfig(ftpConfig);
  const { type } = config;
  
  if (type === 'sftp') {
    return await testSFTPConnection(config);
  } else {
    return await testFTPConnection(config);
  }
}

/**
 * Test FTP connection
 */
async function testFTPConnection(ftpConfig) {
  const { host, port, username, password, directory, secure, passive } = ftpConfig;
  const client = new ftp.Client();
  
  try {
    client.ftp.verbose = false; // Set to true for debugging
    
    await client.access({
      host,
      port: port || 21,
      user: username,
      password,
      secure: secure ? 'implicit' : false, // 'implicit' for FTPS
      secureOptions: secure ? { rejectUnauthorized: false } : undefined
    });
    
    // Test directory access
    if (directory && directory !== '/') {
      await client.cd(directory);
    }
    
    // List files to verify access
    const files = await client.list();
    
    // Close connection safely
    try {
      const closeResult = client.close();
      if (closeResult && typeof closeResult.then === 'function') {
        await closeResult.catch(() => {});
      }
    } catch (closeError) {
      // Ignore close errors
    }
    
    return {
      success: true,
      message: `Successfully connected to FTP server. Found ${files.length} item(s) in directory.`,
      fileCount: files.length
    };
  } catch (error) {
    // Close connection safely on error
    try {
      const closeResult = client.close();
      if (closeResult && typeof closeResult.then === 'function') {
        await closeResult.catch(() => {});
      }
    } catch (closeError) {
      // Ignore close errors
    }
    
    // Provide user-friendly error messages
    const errorMessage = error.message || '';
    const errorCode = error.code || '';
    
    // Check for TLS/SSL errors
    if (secure && (
      errorMessage.includes('SSL routines') ||
      errorMessage.includes('TLS') ||
      errorMessage.includes('wrong version number') ||
      errorMessage.includes('tls_validate_record_header') ||
      errorCode === 'ECONNRESET' ||
      errorCode === 'EPROTO'
    )) {
      return {
        success: false,
        message: `FTP server does not support TLS/SSL encryption. Please disable "Use FTPS (FTP over TLS)" in your FTP settings and try again.`,
        error: errorMessage,
        suggestion: 'Try connecting without TLS/SSL enabled.'
      };
    }
    
    // Check for authentication errors
    if (errorMessage.includes('530') || errorMessage.includes('authentication') || errorMessage.includes('login')) {
      return {
        success: false,
        message: `FTP authentication failed. Please check your username and password.`,
        error: errorMessage
      };
    }
    
    // Check for connection errors
    if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('ENOTFOUND') || errorMessage.includes('ETIMEDOUT')) {
      return {
        success: false,
        message: `Cannot connect to FTP server at ${host}:${port || 21}. Please check the host address and port number, and ensure the server is accessible.`,
        error: errorMessage
      };
    }
    
    // Generic error with helpful context
    return {
      success: false,
      message: `FTP connection failed: ${errorMessage}`,
      error: errorMessage
    };
  }
}

/**
 * Test SFTP connection
 */
async function testSFTPConnection(ftpConfig) {
  const { host, port, username, password, directory } = ftpConfig;
  const client = new Client();
  
  try {
    await client.connect({
      host,
      port: port || 22,
      username,
      password
    });
    
    // Test directory access
    if (directory && directory !== '/') {
      await client.cwd(directory);
    }
    
    // List files to verify access
    const files = await client.list(directory || '.');
    
    try {
      await client.end();
    } catch (endError) {
      // Ignore end errors
    }
    
    return {
      success: true,
      message: `Successfully connected to SFTP server. Found ${files.length} item(s) in directory.`,
      fileCount: files.length
    };
  } catch (error) {
    try {
      await client.end();
    } catch (endError) {
      // Ignore end errors
    }
    return {
      success: false,
      message: `SFTP connection failed: ${error.message}`,
      error: error.message
    };
  }
}

/**
 * Download a file from FTP/SFTP
 */
async function downloadFile(ftpConfig, remotePath, localPath) {
  const config = getFtpConfig(ftpConfig);
  const { type } = config;
  
  if (type === 'sftp') {
    return await downloadFromSFTP(config, remotePath, localPath);
  } else {
    return await downloadFromFTP(config, remotePath, localPath);
  }
}

/**
 * Download file from FTP
 */
async function downloadFromFTP(ftpConfig, remotePath, localPath) {
  const { host, port, username, password, directory, secure, passive } = ftpConfig;
  const client = new ftp.Client();
  
  try {
    console.log(`🔽 [FTP] Connecting to ${host}:${port || 21}...`);
    await client.access({
      host,
      port: port || 21,
      user: username,
      password,
      secure: secure ? 'implicit' : false,
      secureOptions: secure ? { rejectUnauthorized: false } : undefined
    });
    console.log(`✅ [FTP] Connected successfully`);
    
    if (directory && directory !== '/') {
      console.log(`📁 [FTP] Changing to directory: ${directory}`);
      await client.cd(directory);
    }
    
    // Ensure local directory exists
    const localDir = path.dirname(localPath);
    if (!fs.existsSync(localDir)) {
      console.log(`📁 [FTP] Creating local directory: ${localDir}`);
      fs.mkdirSync(localDir, { recursive: true });
    }
    
    console.log(`⬇️  [FTP] Downloading ${remotePath} to ${localPath}...`);
    await client.downloadTo(localPath, remotePath);
    console.log(`✅ [FTP] Download complete: ${localPath}`);
    
    // Verify file was actually written
    if (fs.existsSync(localPath)) {
      const stats = fs.statSync(localPath);
      console.log(`✅ [FTP] File verified: ${localPath} (${stats.size} bytes)`);
    } else {
      console.error(`❌ [FTP] File not found after download: ${localPath}`);
      throw new Error(`File not found after download: ${localPath}`);
    }
    
    // Close connection safely
    try {
      const closeResult = client.close();
      if (closeResult && typeof closeResult.then === 'function') {
        await closeResult.catch(() => {});
      }
    } catch (closeError) {
      // Ignore close errors
    }
    
    return { success: true, localPath };
  } catch (error) {
    console.error(`❌ [FTP] Download error for ${remotePath}:`, error.message);
    // Close connection safely on error
    try {
      const closeResult = client.close();
      if (closeResult && typeof closeResult.then === 'function') {
        await closeResult.catch(() => {});
      }
    } catch (closeError) {
      // Ignore close errors
    }
    throw error;
  }
}

/**
 * Download file from SFTP
 */
async function downloadFromSFTP(ftpConfig, remotePath, localPath) {
  const { host, port, username, password, directory } = ftpConfig;
  const client = new Client();
  
  try {
    console.log(`🔽 [SFTP] Connecting to ${host}:${port || 22}...`);
    await client.connect({
      host,
      port: port || 22,
      username,
      password
    });
    console.log(`✅ [SFTP] Connected successfully`);
    
    const fullRemotePath = directory && directory !== '/' 
      ? path.posix.join(directory, remotePath)
      : remotePath;
    console.log(`📁 [SFTP] Remote path: ${fullRemotePath}`);
    
    // Ensure local directory exists
    const localDir = path.dirname(localPath);
    if (!fs.existsSync(localDir)) {
      console.log(`📁 [SFTP] Creating local directory: ${localDir}`);
      fs.mkdirSync(localDir, { recursive: true });
    }
    
    console.log(`⬇️  [SFTP] Downloading ${fullRemotePath} to ${localPath}...`);
    await client.fastGet(fullRemotePath, localPath);
    console.log(`✅ [SFTP] Download complete: ${localPath}`);
    
    // Verify file was actually written
    if (fs.existsSync(localPath)) {
      const stats = fs.statSync(localPath);
      console.log(`✅ [SFTP] File verified: ${localPath} (${stats.size} bytes)`);
    } else {
      console.error(`❌ [SFTP] File not found after download: ${localPath}`);
      throw new Error(`File not found after download: ${localPath}`);
    }
    
    try {
      await client.end();
    } catch (endError) {
      // Ignore end errors
    }
    
    return { success: true, localPath };
  } catch (error) {
    console.error(`❌ [SFTP] Download error for ${remotePath}:`, error.message);
    try {
      await client.end();
    } catch (endError) {
      // Ignore end errors
    }
    throw error;
  }
}

/**
 * List files in FTP/SFTP directory
 */
async function listFiles(ftpConfig, pattern = null) {
  const config = getFtpConfig(ftpConfig);
  const { type } = config;
  
  if (type === 'sftp') {
    return await listSFTPFiles(config, pattern);
  } else {
    return await listFTPFiles(config, pattern);
  }
}

/**
 * List files in FTP directory
 */
async function listFTPFiles(ftpConfig, pattern = null) {
  const { host, port, username, password, directory, secure } = ftpConfig;
  const client = new ftp.Client();
  
  try {
    await client.access({
      host,
      port: port || 21,
      user: username,
      password,
      secure: secure ? 'implicit' : false,
      secureOptions: secure ? { rejectUnauthorized: false } : undefined
    });
    
    if (directory && directory !== '/') {
      await client.cd(directory);
    }
    
    let files = await client.list();
    
    // Apply pattern if provided (no file type filtering here - let route handlers do it)
    if (pattern) {
      const regex = new RegExp(pattern, 'i');
      files = files.filter(file => regex.test(file.name));
    }
    
    // Close connection safely
    try {
      const closeResult = client.close();
      if (closeResult && typeof closeResult.then === 'function') {
        await closeResult.catch(() => {});
      }
    } catch (closeError) {
      // Ignore close errors
    }
    
    return files;
  } catch (error) {
    // Close connection safely on error
    try {
      const closeResult = client.close();
      if (closeResult && typeof closeResult.then === 'function') {
        await closeResult.catch(() => {});
      }
    } catch (closeError) {
      // Ignore close errors
    }
    throw error;
  }
}

/**
 * List files in SFTP directory
 */
async function listSFTPFiles(ftpConfig, pattern = null) {
  const { host, port, username, password, directory } = ftpConfig;
  const client = new Client();
  
  try {
    await client.connect({
      host,
      port: port || 22,
      username,
      password
    });
    
    const dir = directory || '.';
    let files = await client.list(dir);
    
    // Filter out directories (keep only regular files)
    files = files.filter(file => file.type === '-');
    
    // Apply pattern if provided (no file type filtering here - let route handlers do it)
    if (pattern) {
      const regex = new RegExp(pattern, 'i');
      files = files.filter(file => regex.test(file.name));
    }
    
    try {
      await client.end();
    } catch (endError) {
      // Ignore end errors
    }
    
    return files;
  } catch (error) {
    try {
      await client.end();
    } catch (endError) {
      // Ignore end errors
    }
    throw error;
  }
}

/**
 * Move/rename file on FTP/SFTP server
 */
async function moveFile(ftpConfig, sourcePath, destinationPath) {
  const config = getFtpConfig(ftpConfig);
  const { type } = config;
  
  if (type === 'sftp') {
    return await moveFileSFTP(config, sourcePath, destinationPath);
  } else {
    return await moveFileFTP(config, sourcePath, destinationPath);
  }
}

/**
 * Move file on FTP server
 */
async function moveFileFTP(ftpConfig, sourcePath, destinationPath) {
  const { host, port, username, password, directory, secure } = ftpConfig;
  const client = new ftp.Client();
  
  try {
    await client.access({
      host,
      port: port || 21,
      user: username,
      password,
      secure: secure ? 'implicit' : false,
      secureOptions: secure ? { rejectUnauthorized: false } : undefined
    });
    
    // Navigate to base directory if specified
    if (directory && directory !== '/') {
      await client.cd(directory);
    }
    
    // Ensure destination directory exists
    const destDir = path.posix.dirname(destinationPath);
    if (destDir && destDir !== '.' && destDir !== '/') {
      try {
        // Try to change to directory - if it fails, create it
        try {
          await client.cd(destDir);
        } catch (cdError) {
          // Directory doesn't exist, create it
          const parts = destDir.split('/').filter(p => p);
          let currentPath = '';
          for (const part of parts) {
            currentPath += '/' + part;
            try {
              await client.cd(currentPath);
            } catch {
              await client.uploadFrom(Buffer.from(''), currentPath + '/.keep');
              // Remove the .keep file
              try {
                await client.remove(currentPath + '/.keep');
              } catch {}
            }
          }
        }
      } catch (dirError) {
        // Directory might already exist or creation failed, continue
        console.warn(`Could not ensure directory exists: ${destDir}`, dirError.message);
      }
    }
    
    // Move/rename the file
    await client.rename(sourcePath, destinationPath);
    
    // Close connection safely
    try {
      const closeResult = client.close();
      if (closeResult && typeof closeResult.then === 'function') {
        await closeResult.catch(() => {});
      }
    } catch (closeError) {
      // Ignore close errors
    }
    
    return { success: true, destinationPath };
  } catch (error) {
    // Close connection safely on error
    try {
      const closeResult = client.close();
      if (closeResult && typeof closeResult.then === 'function') {
        await closeResult.catch(() => {});
      }
    } catch (closeError) {
      // Ignore close errors
    }
    throw error;
  }
}

/**
 * Move file on SFTP server
 */
async function moveFileSFTP(ftpConfig, sourcePath, destinationPath) {
  const { host, port, username, password, directory } = ftpConfig;
  const client = new Client();
  
  try {
    await client.connect({
      host,
      port: port || 22,
      username,
      password
    });
    
    // Build full paths
    const fullSourcePath = directory && directory !== '/' 
      ? path.posix.join(directory, sourcePath)
      : sourcePath;
    
    const fullDestPath = directory && directory !== '/' 
      ? path.posix.join(directory, destinationPath)
      : destinationPath;
    
    // Ensure destination directory exists
    const destDir = path.posix.dirname(fullDestPath);
    try {
      await client.mkdir(destDir, true); // true = recursive
    } catch (dirError) {
      // Directory might already exist, continue
    }
    
    // Move/rename the file
    await client.rename(fullSourcePath, fullDestPath);
    
    try {
      await client.end();
    } catch (endError) {
      // Ignore end errors
    }
    
    return { success: true, destinationPath: fullDestPath };
  } catch (error) {
    try {
      await client.end();
    } catch (endError) {
      // Ignore end errors
    }
    throw error;
  }
}

/**
 * Calculate file hash (SHA256)
 */
function calculateFileHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

module.exports = {
  testConnection,
  downloadFile,
  listFiles,
  moveFile,
  calculateFileHash
};

