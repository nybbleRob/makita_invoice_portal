/**
 * Invoice Import Job Processor
 * Processes individual PDF/Excel files for invoice import
 * Parses files, matches to companies, and creates invoices
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { File, Template, Company, Invoice, CreditNote, User, Sequelize, Settings } = require('../models');
const { Op } = Sequelize;
const { extractTextFromPDF } = require('../utils/pdfExtractor');
const { 
  ensureStorageDirs, 
  getStorageDir, 
  getFilePath,
  getProcessedFilePath,
  getUnprocessedFilePath,
  PROCESSED_BASE,
  UNPROCESSED_FAILED,
  FTP_UPLOAD_PATH,
  ensureDir
} = require('../config/storage');
const { logActivity, ActivityType } = require('../services/activityLogger');
const { calculateDocumentRetentionDates } = require('../utils/documentRetention');
const { isEmailEnabled } = require('../utils/emailService');

/**
 * Process a single file for invoice import
 * @param {Object} job - Bull job object
 * @returns {Promise<Object>} Import results
 */
async function processInvoiceImport(job) {
  const { filePath, fileName, originalName, importId, userId } = job.data;
  const startTime = Date.now();
  
  // Check if import was cancelled
  if (importId) {
    const importStore = require('../utils/importStore');
    if (await importStore.isCancelled(importId)) {
      console.log(`🛑 [Import ${importId}] Import was cancelled. Skipping job for ${originalName || fileName}`);
      throw new Error('Import was cancelled by user');
    }
  }
  
  try {
    // Update job progress
    await job.updateProgress(10);
    
    // Ensure storage directories exist
    ensureStorageDirs();
    const invoicesDir = getStorageDir('invoices');
    
    // Log the file path we're looking for
    console.log(`🔍 [Import ${importId}] Looking for file at: ${filePath}`);
    console.log(`🔍 [Import ${importId}] File path is absolute: ${path.isAbsolute(filePath)}`);
    console.log(`🔍 [Import ${importId}] File path exists: ${fs.existsSync(filePath)}`);
    
    // If file doesn't exist, check if it's in temp directory with a different path
    if (!fs.existsSync(filePath)) {
      const tempDir = getStorageDir('temp');
      const fileNameOnly = path.basename(filePath);
      const altPath = path.join(tempDir, fileNameOnly);
      console.log(`🔍 [Import ${importId}] Checking alternative path: ${altPath}`);
      console.log(`🔍 [Import ${importId}] Alternative path exists: ${fs.existsSync(altPath)}`);
      
      if (fs.existsSync(altPath)) {
        console.log(`✅ [Import ${importId}] Found file at alternative path, using: ${altPath}`);
        // Update filePath to the correct location
        job.data.filePath = altPath;
        filePath = altPath;
      }
    }
    
    // Verify file exists - ONE ATTEMPT ONLY (no retries)
    if (!fs.existsSync(filePath)) {
      // List files in temp directory for debugging
      const tempDir = getStorageDir('temp');
      try {
        const tempFiles = fs.readdirSync(tempDir);
        console.log(`📁 [Import ${importId}] Files in temp directory (${tempDir}):`, tempFiles.slice(0, 10));
      } catch (dirError) {
        console.error(`❌ [Import ${importId}] Cannot read temp directory:`, dirError.message);
      }
      throw new Error(`File not found: ${filePath}. File may have been deleted or path is incorrect.`);
    }
    
    console.log(`✅ [Import ${importId}] File found: ${filePath}`);
    
    // Read file buffer - needed for both hash calculation and PDF parsing
    const fileBuffer = fs.readFileSync(filePath);
    
    // Use pre-calculated hash from batch check if available, otherwise calculate it
    let fileHash = job.data.fileHash;
    let isDuplicate = job.data.isDuplicate || false;
    let duplicateFileId = job.data.duplicateFileId || null;
    let existingFile = null;
    
    if (!fileHash) {
      // Fallback: calculate hash if not provided (for backwards compatibility)
      fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      console.log(`⚠️  [Import ${importId}] Hash not provided in job data, calculated: ${fileHash.substring(0, 16)}...`);
    } else {
      console.log(`✅ [Import ${importId}] Using pre-calculated hash: ${fileHash.substring(0, 16)}...`);
    }
    
    await job.updateProgress(20);
    
    // If duplicate info was pre-calculated, use it; otherwise check now (backwards compatibility)
    if (isDuplicate && duplicateFileId) {
      // Fetch the existing file for duplicate checking logic
      existingFile = await File.findByPk(duplicateFileId);
      if (!existingFile) {
        console.log(`⚠️  [Import ${importId}] Pre-calculated duplicate file ID ${duplicateFileId} not found, treating as new file`);
        isDuplicate = false;
        duplicateFileId = null;
        existingFile = null;
      } else {
        console.log(`✅ [Import ${importId}] Using pre-calculated duplicate info: existing file ${duplicateFileId}`);
      }
    } else if (!isDuplicate) {
      // Not a duplicate from batch check, but verify with retention period logic
      // Check for duplicate file (by SHA256 hash) - including deleted files within retention period
      const { Settings } = require('../models');
      const settings = await Settings.findOne();
      const retentionDays = settings?.fileRetentionDays || null;
      const retentionDate = retentionDays ? new Date(Date.now() - (retentionDays * 24 * 60 * 60 * 1000)) : null;
      
      const duplicateWhere = { fileHash };
      
      // If retention period is set, check deleted files too (to keep hash records)
      if (retentionDate) {
        duplicateWhere[Op.or] = [
          { deletedAt: null }, // Non-deleted files
          { deletedAt: { [Op.gte]: retentionDate } } // Deleted files within retention period
        ];
      }
      // If no retention period, check all files (including deleted) to keep hash records forever
      
      existingFile = await File.findOne({
        where: duplicateWhere,
        order: [['createdAt', 'DESC']] // Get the most recent file with this hash
      });
      
      if (existingFile) {
        isDuplicate = true;
        duplicateFileId = existingFile.id;
        console.log(`⚠️  [Import ${importId}] Duplicate file detected (not found in batch check): ${fileHash.substring(0, 16)}...`);
      }
    }
    
    if (existingFile) {
      // IMPORTANT: Check if there's a linked Invoice/CreditNote/Statement for ANY status
      // After a purge, File records might still exist but their linked documents were deleted
      // If no linked document exists, it's NOT a duplicate (it's an orphaned record from purge)
      let linkedDocumentExists = false;
      
      // Try multiple methods to find linked documents
      const searchPatterns = [];
      
      // Method 1: Use filePath if available
      if (existingFile.filePath) {
        searchPatterns.push(existingFile.filePath);
        const basename = path.basename(existingFile.filePath);
        if (basename && basename !== existingFile.filePath) {
          searchPatterns.push(basename);
        }
      }
      
      // Method 2: Use fileName if available
      if (existingFile.fileName) {
        searchPatterns.push(existingFile.fileName);
      }
      
      // Method 3: Check metadata for fileId references (some documents store fileId in metadata)
      if (existingFile.id) {
        // Check if any Invoice/CreditNote/Statement has this fileId in metadata
        const { Statement } = require('../models');
        
        // Check Invoice metadata
        const invoiceByMetadata = await Invoice.findOne({
          where: {
            'metadata.fileId': existingFile.id,
            deletedAt: null
          }
        });
        if (invoiceByMetadata) {
          linkedDocumentExists = true;
          console.log(`🔍 [Import ${importId}] Found linked Invoice (ID: ${invoiceByMetadata.id}) via metadata.fileId`);
        }
        
        // Check CreditNote metadata
        if (!linkedDocumentExists) {
          const creditNoteByMetadata = await CreditNote.findOne({
            where: {
              'metadata.fileId': existingFile.id
            }
          });
          if (creditNoteByMetadata) {
            linkedDocumentExists = true;
            console.log(`🔍 [Import ${importId}] Found linked CreditNote (ID: ${creditNoteByMetadata.id}) via metadata.fileId`);
          }
        }
        
        // Check Statement metadata
        if (!linkedDocumentExists) {
          const statementByMetadata = await Statement.findOne({
            where: {
              'metadata.fileId': existingFile.id
            }
          });
          if (statementByMetadata) {
            linkedDocumentExists = true;
            console.log(`🔍 [Import ${importId}] Found linked Statement (ID: ${statementByMetadata.id}) via metadata.fileId`);
          }
        }
      }
      
      // Try to find linked documents using filePath/fileName patterns (only if not already found via metadata)
      if (!linkedDocumentExists && searchPatterns.length > 0) {
        for (const pattern of searchPatterns) {
          if (!pattern) continue;
          
          // Check for linked invoice
          const linkedInvoice = await Invoice.findOne({
            where: {
              fileUrl: { [Op.like]: `%${pattern}%` },
              deletedAt: null
            }
          });
          
          if (linkedInvoice) {
            linkedDocumentExists = true;
            console.log(`🔍 [Import ${importId}] Found linked Invoice (ID: ${linkedInvoice.id}) using pattern: ${pattern}`);
            break;
          }
          
          // Check for linked credit note
          const linkedCreditNote = await CreditNote.findOne({
            where: {
              fileUrl: { [Op.like]: `%${pattern}%` }
            }
          });
          
          if (linkedCreditNote) {
            linkedDocumentExists = true;
            console.log(`🔍 [Import ${importId}] Found linked CreditNote (ID: ${linkedCreditNote.id}) using pattern: ${pattern}`);
            break;
          }
          
          // Check for linked statement
          const { Statement } = require('../models');
          const linkedStatement = await Statement.findOne({
            where: {
              fileUrl: { [Op.like]: `%${pattern}%` }
            }
          });
          
          if (linkedStatement) {
            linkedDocumentExists = true;
            console.log(`🔍 [Import ${importId}] Found linked Statement (ID: ${linkedStatement.id}) using pattern: ${pattern}`);
            break;
          }
        }
      }
      
      // If no search patterns available and no metadata match, log it
      if (searchPatterns.length === 0 && !linkedDocumentExists) {
        console.log(`⚠️  [Import ${importId}] Cannot check for linked documents - no filePath, fileName, or metadata.fileId available`);
        console.log(`   File ID: ${existingFile.id}, Status: ${existingFile.status}`);
      }
      
      // Additional checks for orphaned records
      // If file has status 'unallocated', 'failed', or 'duplicate', it's already unallocated - don't treat as duplicate
      // If file has status 'parsed' but no linked document, it's orphaned from purge
      const isOrphanedStatus = ['unallocated', 'failed', 'duplicate'].includes(existingFile.status);
      const isOrphanedParsed = existingFile.status === 'parsed' && !linkedDocumentExists;
      
      if (isOrphanedStatus) {
        console.log(`⚠️  [Import ${importId}] Existing File has status '${existingFile.status}' - this is NOT a duplicate, it's an unallocated/failed record`);
        console.log(`   File ID: ${existingFile.id}, FileName: ${existingFile.fileName}`);
        linkedDocumentExists = false; // Force not a duplicate
      } else if (isOrphanedParsed) {
        console.log(`⚠️  [Import ${importId}] File has status 'parsed' but no linked document found - this is an orphaned record from purge`);
        console.log(`   File ID: ${existingFile.id}, FileName: ${existingFile.fileName}, FilePath: ${existingFile.filePath || 'N/A'}`);
        linkedDocumentExists = false; // Force not a duplicate - orphaned records should not block new uploads
      }
      
      // CRITICAL: If no linked document exists, it's NOT a duplicate regardless of File status
      // This handles cases where:
      // 1. File was purged (Invoice/CreditNote deleted but File record remains)
      // 2. File has status 'unallocated'/'failed'/'duplicate' but no linked document
      // 3. File has status 'parsed' but linked document was deleted
      if (!linkedDocumentExists) {
        // No linked document exists - this is NOT a duplicate
        // The File record is orphaned (likely from a purge or failed processing)
        console.log(`✅ [Import ${importId}] File hash matches existing File record (ID: ${existingFile.id}), but no linked document found.`);
        console.log(`   Existing file status: ${existingFile.status}, deletedAt: ${existingFile.deletedAt || 'null'}`);
        console.log(`   FilePath: ${existingFile.filePath || 'N/A'}, FileName: ${existingFile.fileName || 'N/A'}`);
        console.log(`   Search patterns tried: ${searchPatterns.join(', ') || 'none (no filePath/fileName)'}`);
        console.log(`   This is NOT a duplicate - the linked document was purged or never created. Processing as new file.`);
        isDuplicate = false;
        duplicateFileId = null;
      } else {
        // Linked document still exists, so it's a true duplicate
        isDuplicate = true;
        duplicateFileId = existingFile.id;
        console.log(`⚠️  [Import ${importId}] Duplicate file detected! Hash: ${fileHash.substring(0, 16)}...`);
        console.log(`   Existing file: ${existingFile.fileName} (ID: ${existingFile.id})`);
        console.log(`   Existing file path: ${existingFile.filePath || 'N/A'}`);
        console.log(`   Existing file status: ${existingFile.status}, deletedAt: ${existingFile.deletedAt || 'null'}`);
        console.log(`   Linked document still exists - will store as duplicate for staff review`);
      }
    } else {
      console.log(`✅ [Import ${importId}] File is unique. Hash: ${fileHash.substring(0, 16)}...`);
      // Debug: Check if there are any deleted files with this hash
      const deletedFile = await File.findOne({
        where: { 
          fileHash,
          deletedAt: { [Op.ne]: null } // Check for deleted files
        },
        attributes: ['id', 'fileName', 'deletedAt', 'status']
      });
      if (deletedFile) {
        console.log(`   ℹ️  [Import ${importId}] Found deleted file with same hash (ID: ${deletedFile.id}, deletedAt: ${deletedFile.deletedAt}) - this is NOT a duplicate`);
      }
    }
    
    await job.updateProgress(30);
    
    // Determine file type
    const fileExt = path.extname(fileName).toLowerCase();
    const isExcel = ['.xlsx', '.xls', '.csv'].includes(fileExt);
    const isPDF = fileExt === '.pdf';
    
    if (!isPDF && !isExcel) {
      const errorResult = {
        success: false,
        fileName: originalName || fileName,
        error: 'Unsupported file type. Only PDF and Excel files are supported.',
        processingTime: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
      if (importId) {
        const importStore = require('../utils/importStore');
        await importStore.addResult(importId, errorResult);
      }
      return errorResult;
    }
    
    // Find template - try to detect document type first for better template matching
    let template = null;
    let quickDetectedDocType = null;
    
    try {
      if (isPDF) {
        // Improved document type detection using basic text extraction
        // Priority: Check for specific document type keywords in order of specificity
        try {
          const { extractTextFromPDF } = require('../utils/pdfExtractor');
          const quickTextResult = await extractTextFromPDF(filePath);
          const quickText = quickTextResult.text || quickTextResult;
          if (quickText && quickText.length > 0) {
            const textUpper = quickText.toUpperCase();
            
            // Most specific first: "CREDIT NOTE" (two words together)
            if (textUpper.includes('CREDIT NOTE') || textUpper.includes('CREDITNOTE')) {
              quickDetectedDocType = 'credit_note';
              console.log(`📄 [Import ${importId}] Detected as CREDIT NOTE (found "CREDIT NOTE" in text)`);
            }
            // Check for statement indicators
            else if (textUpper.includes('STATEMENT') || textUpper.includes('ACCOUNT STATEMENT') || textUpper.includes('STATEMENT OF ACCOUNT')) {
              quickDetectedDocType = 'statement';
              console.log(`📄 [Import ${importId}] Detected as STATEMENT (found "STATEMENT" in text)`);
            }
            // Check for invoice indicators (explicit check)
            else if (textUpper.includes('INVOICE') || textUpper.includes('TAX INVOICE') || textUpper.includes('INVOICE NUMBER')) {
              quickDetectedDocType = 'invoice';
              console.log(`📄 [Import ${importId}] Detected as INVOICE (found "INVOICE" in text)`);
            }
            // Less specific: standalone "CREDIT" (but only if not already detected as invoice)
            // This is less reliable, so we check it after invoice
            else if (textUpper.includes('CREDIT') && !textUpper.includes('INVOICE')) {
              // Additional check: if it has "CN" or "CREDIT NOTE" pattern
              if (textUpper.includes(' CN ') || textUpper.match(/\bCN\b/) || textUpper.includes('CREDIT NOTE')) {
                quickDetectedDocType = 'credit_note';
                console.log(`📄 [Import ${importId}] Detected as CREDIT NOTE (found "CREDIT" with CN pattern)`);
              } else {
                // Ambiguous - default to invoice (most common)
                quickDetectedDocType = 'invoice';
                console.log(`📄 [Import ${importId}] Ambiguous detection (found "CREDIT" but no clear indicator) - defaulting to INVOICE`);
              }
            }
            // Default to invoice (most common document type)
            else {
              quickDetectedDocType = 'invoice';
              console.log(`📄 [Import ${importId}] No clear document type indicator found - defaulting to INVOICE`);
            }
            
            console.log(`📄 [Import ${importId}] Final detected document type: ${quickDetectedDocType} (from quick text scan)`);
          }
        } catch (detectError) {
          console.warn(`⚠️  [Import ${importId}] Could not detect document type: ${detectError.message}`);
          // Default to invoice on error
          quickDetectedDocType = 'invoice';
        }
        
        // ALWAYS use the default template for the detected document type
        // This ensures we use the correct template with the correct field mappings
        // CRITICAL: Never use a template of a different type - this causes field mismatches!
        if (quickDetectedDocType) {
          template = await Template.findDefaultTemplate('pdf', quickDetectedDocType);
          if (template) {
            // Validate that template type matches detected type
            if (template.templateType !== quickDetectedDocType) {
              console.error(`❌ [Import ${importId}] TEMPLATE TYPE MISMATCH! Detected: ${quickDetectedDocType}, Template: ${template.templateType}`);
              console.error(`   This will cause field extraction errors! Rejecting this template.`);
              template = null; // Reject mismatched template
            } else {
              console.log(`✅ [Import ${importId}] Using DEFAULT template for ${quickDetectedDocType}: ${template.name} (ID: ${template.id}, isDefault: ${template.isDefault}, templateType: ${template.templateType})`);
            }
          }
        }
        
        // If no matching template found, try to find any template of the correct type (even if not default)
        if (!template && quickDetectedDocType) {
          template = await Template.findTemplateByFileType('pdf', quickDetectedDocType);
          if (template) {
            console.log(`⚠️  [Import ${importId}] Using non-default template for ${quickDetectedDocType}: ${template.name} (ID: ${template.id}, templateType: ${template.templateType})`);
          }
        }
        
        // Last resort: only if absolutely no template of the correct type exists
        // This should rarely happen and will log a strong warning
        if (!template) {
          console.error(`❌ [Import ${importId}] CRITICAL: No PDF template found for detected type: ${quickDetectedDocType}`);
          console.error(`   This document cannot be processed correctly. Please create a default template for ${quickDetectedDocType}.`);
          // Do NOT fall back to wrong template type - this causes data corruption
        }
        
        console.log(`🔍 [Import ${importId}] PDF template lookup: ${template ? `Found: ${template.name} (${template.templateType}, ID: ${template.id})` : 'No template found'}`);
      } else if (isExcel) {
        // For Excel, try to use default template for detected type, or any default
        if (quickDetectedDocType) {
          template = await Template.findDefaultTemplate('excel', quickDetectedDocType);
        }
        if (!template) {
          template = await Template.findDefaultTemplate('excel', null);
        }
        if (!template) {
          template = await Template.findTemplateByFileType('excel');
        }
        console.log(`🔍 [Import ${importId}] Excel template lookup: ${template ? `Found: ${template.name} (ID: ${template.id})` : 'No template found'}`);
      }
    } catch (templateError) {
      console.error(`⚠️  [Import ${importId}] Error finding template:`, templateError.message);
      console.error(`   Stack:`, templateError.stack);
      // Continue with fallback extraction
    }
    
    await job.updateProgress(40);
    
    let parsedData = {};
    let processingMethod = 'local';
    
    // Parse file using template
    try {
      if (template) {
        if (isPDF) {
          console.log(`📄 [Import ${importId}] Extracting from PDF using template: ${template.name} (${template.templateType})`);
          parsedData = await Template.extractFieldsFromCoordinates(fileBuffer, template);
          processingMethod = `local_coordinates_${template.code}`;
          console.log(`✅ [Import ${importId}] PDF extraction complete. Fields: ${Object.keys(parsedData).filter(k => k !== 'templateId' && k !== 'templateName' && k !== 'fieldLabels').length}`);
          
          // Warn if document type mismatch
          if (quickDetectedDocType && template.templateType !== quickDetectedDocType) {
            console.warn(`⚠️  [Import ${importId}] Document type mismatch: Detected ${quickDetectedDocType} but using ${template.templateType} template`);
          }
        } else if (isExcel) {
          console.log(`📊 [Import ${importId}] Extracting from Excel using template: ${template.name}`);
          // Use Excel parser utility
          const { extractFieldsFromExcel } = require('../utils/excelParser');
          parsedData = await extractFieldsFromExcel(filePath, template);
          processingMethod = `excel_template_${template.code}`;
          console.log(`✅ [Import ${importId}] Excel extraction complete. Fields: ${Object.keys(parsedData).length}`);
        }
      } else {
        // Fallback to basic extraction
        if (isPDF) {
          console.log(`📄 [Import ${importId}] No template found, using basic PDF extraction`);
          const { extractInvoiceData } = require('../utils/pdfExtractor');
          parsedData = await extractInvoiceData(filePath);
          processingMethod = 'local_basic';
          console.log(`✅ [Import ${importId}] Basic PDF extraction complete`);
        } else {
          const errorResult = {
            success: false,
            fileName: originalName || fileName,
            error: 'No Excel template found. Please create an Excel template first.',
            processingTime: Date.now() - startTime,
            timestamp: new Date().toISOString()
          };
          if (importId) {
            const importStore = require('../utils/importStore');
            await importStore.addResult(importId, errorResult);
          }
          return errorResult;
        }
      }
    } catch (parseError) {
      console.error(`❌ [Import ${importId}] Error parsing file:`, parseError.message);
      console.error(`   Stack:`, parseError.stack);
      throw new Error(`Failed to parse file: ${parseError.message}`);
    }
    
    await job.updateProgress(60);
    
    // Determine file storage structure based on document type
    // NEW STRUCTURE:
    // - Processed (allocated): /mnt/data/processed/{invoices|creditnotes|statements}/YYYY/MM/DD/
    // - Unprocessed (failed): /mnt/data/unprocessed/failed/YYYY-MM-DD/
    
    // Helper to get parsed values by standard field name
    const { getParsedValue } = require('../utils/parsedDataHelper');
    
    // Determine document type from parsed data
    const detectedDocType = (getParsedValue(parsedData, 'documentType') || parsedData.documentType)?.toLowerCase() || 'invoice';
    let docTypeFolder = 'invoices'; // Default folder
    if (detectedDocType.includes('credit') || detectedDocType === 'credit_note') {
      docTypeFolder = 'creditnotes';
    } else if (detectedDocType.includes('statement')) {
      docTypeFolder = 'statements';
    } else {
      docTypeFolder = 'invoices';
    }
    
    // Date components for folder structure
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    
    // IMPORTANT: Preserve original filename from FTP/SFTP
    // The temp file has a unique name (sftp-{timestamp}-{random}-{index}.pdf) to avoid collisions,
    // but we ALWAYS use the original filename for the final stored file.
    // originalName = the original filename from FTP (e.g., "invoice_12345.pdf")
    // fileName = the temp filename (e.g., "sftp-1765559216392-777203141-65.pdf")
    // We prioritize originalName, falling back to fileName only if originalName is missing
    const originalFileName = path.basename(originalName || fileName);
    console.log(`📝 [Import ${importId}] Original filename: ${originalName || 'not provided, using temp name'}`);
    console.log(`📝 [Import ${importId}] Temp filename: ${fileName}`);
    console.log(`📝 [Import ${importId}] Final filename will be: ${originalFileName}`);
    const sanitizedFileName = originalFileName.replace(/[<>:"|?*\x00-\x1f]/g, '_'); // Sanitize invalid filesystem chars
    
    // Use original filename - handle filesystem conflicts
    let uniqueFileName = sanitizedFileName;
    let counter = 1;
    
    // Build paths for both processed and unprocessed locations
    // Processed: /mnt/data/processed/{docType}/YYYY/MM/DD/
    // Unprocessed: /mnt/data/unprocessed/failed/YYYY-MM-DD/
    const processedCheckDir = path.join(PROCESSED_BASE, docTypeFolder, String(year), month, day);
    const unprocessedCheckDir = path.join(UNPROCESSED_FAILED, `${year}-${month}-${day}`);
    
    // Check for conflicts in processed folder
    let checkPath = path.join(processedCheckDir, uniqueFileName);
    
    while (fs.existsSync(checkPath)) {
      const nameWithoutExt = path.basename(sanitizedFileName, fileExt);
      uniqueFileName = `${nameWithoutExt}_${counter}${fileExt}`;
      checkPath = path.join(processedCheckDir, uniqueFileName);
      counter++;
    }
    
    console.log(`📝 [Import ${importId}] Using filename: ${uniqueFileName}`);
    
    // File stays in temp until database insert succeeds
    // Note: Retries are currently disabled - files are processed once only
    
    await job.updateProgress(70);
    
    // Match company by account number
    let matchedCompanyId = null;
    let document = null;
    let documentType = null;
    
    // If this is a requeued file with an existing File record, check if it already has a customerId
    // This happens when a file is manually edited and requeued with a company assignment
    if (job.data.fileId) {
      const { File } = require('../models');
      const existingFile = await File.findByPk(job.data.fileId);
      if (existingFile && existingFile.customerId) {
        // File was already assigned to a company during requeue
        matchedCompanyId = existingFile.customerId;
        console.log(`✅ [Import ${importId}] Using existing company assignment from file record: ${matchedCompanyId}`);
        // Also update parsedData.accountNumber to match company's referenceNo for consistency
        if (existingFile.parsedData && existingFile.parsedData.accountNumber) {
          accountNumber = existingFile.parsedData.accountNumber;
        }
      }
    }
    
    // Try to find account number in parsed data (check both mapped and template field names)
    let accountNumber = getParsedValue(parsedData, 'accountNumber') || parsedData.accountNumber;
    
    // If accountNumber not found in mapped field, try template field names
    if (!accountNumber) {
      // Look for any field containing "account" in the parsed data
      for (const key in parsedData) {
        if (key !== 'templateId' && key !== 'templateName' && key !== 'fieldLabels' && 
            (key.toLowerCase().includes('account') || key.toLowerCase().includes('account_no'))) {
          accountNumber = parsedData[key];
          console.log(`🔍 [Import ${importId}] Found account number in template field "${key}": ${accountNumber}`);
          break;
        }
      }
    }
    
    // Only try to match by account number if we don't already have a matchedCompanyId from file.customerId
    if (accountNumber && !matchedCompanyId) {
      // Convert to string and trim, then normalize (remove any non-numeric characters except leading/trailing spaces)
      let accountStr = accountNumber.toString().trim();
      
      // Remove any non-numeric characters that might have been extracted (like commas, dashes, etc.)
      // But keep the original for logging
      const accountStrOriginal = accountStr;
      accountStr = accountStr.replace(/[^\d]/g, ''); // Remove all non-digits
      
      // If we removed characters, log it
      if (accountStrOriginal !== accountStr) {
        console.log(`🔍 [Import ${importId}] Normalized account number from "${accountStrOriginal}" to "${accountStr}"`);
      }
      
      const accountInt = parseInt(accountStr, 10);
      
      console.log(`🔍 [Import ${importId}] Searching for company with account number: "${accountStr}" (as integer: ${accountInt})`);
      
      // Try matching as integer first (since referenceNo is INTEGER)
      let company = await Company.findOne({
        where: {
          referenceNo: accountInt
        }
      });
      
      // If not found by referenceNo, try matching by code field (alternative account identifier)
      if (!company && !isNaN(accountInt)) {
        company = await Company.findOne({
          where: {
            code: accountStr
          }
        });
        if (company) {
          console.log(`🔍 [Import ${importId}] Matched company by code field: ${company.name} (Code: ${company.code})`);
        }
      }
      
      // If still not found, try using Sequelize's cast to handle type conversion
      if (!company && !isNaN(accountInt)) {
        // Try with explicit cast to INTEGER using Sequelize.literal
        company = await Company.findOne({
          where: Sequelize.where(
            Sequelize.cast(Sequelize.col('referenceNo'), 'INTEGER'),
            accountInt
          )
        });
        if (company) {
          console.log(`🔍 [Import ${importId}] Matched company using cast: ${company.name} (Account: ${company.referenceNo})`);
        }
      }
      
      // Last resort: try exact string match on referenceNo (in case it's stored as text somehow)
      if (!company) {
        company = await Company.findOne({
          where: Sequelize.where(
            Sequelize.cast(Sequelize.col('referenceNo'), 'TEXT'),
            accountStr
          )
        });
        if (company) {
          console.log(`🔍 [Import ${importId}] Matched company using text cast: ${company.name} (Account: ${company.referenceNo})`);
        }
      }
      
      if (company) {
        matchedCompanyId = company.id;
        console.log(`✅ [Import ${importId}] Matched company: ${company.name} (Account: ${company.referenceNo}, ID: ${company.id})`);
      } else {
        console.log(`⚠️  [Import ${importId}] No company found with account number: "${accountStr}" (tried as integer: ${accountInt})`);
        console.log(`   Parsed data keys: ${Object.keys(parsedData).filter(k => k !== 'templateId' && k !== 'templateName' && k !== 'fieldLabels' && k !== 'fullText').join(', ')}`);
        console.log(`   Account number value from parsed data: ${JSON.stringify(accountNumber)}`);
        
        // Debug: List all companies with similar reference numbers
        // Cast referenceNo to TEXT before using LIKE (PostgreSQL doesn't allow LIKE on integers)
        const similarCompanies = await Company.findAll({
          where: Sequelize.where(
            Sequelize.cast(Sequelize.col('referenceNo'), 'TEXT'),
            Op.like,
            `%${accountStr.slice(-4)}%` // Last 4 digits
          ),
          attributes: ['id', 'name', 'referenceNo', 'code'],
          limit: 5
        });
        if (similarCompanies.length > 0) {
          console.log(`   Found ${similarCompanies.length} companies with similar reference numbers:`);
          similarCompanies.forEach(c => {
            console.log(`     - ${c.name}: referenceNo=${c.referenceNo} (type: ${typeof c.referenceNo}), code=${c.code}`);
          });
        }
      }
    } else {
      console.log(`⚠️  [Import ${importId}] No account number found in parsed data`);
      console.log(`   Parsed data keys: ${Object.keys(parsedData).filter(k => k !== 'templateId' && k !== 'templateName' && k !== 'fieldLabels').join(', ')}`);
    }
    
    await job.updateProgress(80);
    
    // Determine specific failure reasons by checking what's missing
    // Note: accountNumber is already declared above, so we reuse it
    let failureReason = null;
    const missingFields = [];
    
    // Check for missing crucial fields (reuse accountNumber from above)
    const invoiceTotal = getParsedValue(parsedData, 'totalAmount') || getParsedValue(parsedData, 'amount') || parsedData.amount || parsedData.totalAmount;
    const invoiceNumber = getParsedValue(parsedData, 'invoiceNumber') || parsedData.invoiceNumber;
    const invoiceDate = getParsedValue(parsedData, 'invoiceDate') || getParsedValue(parsedData, 'date') || parsedData.date || parsedData.invoiceDate;
    const vatAmount = getParsedValue(parsedData, 'vatAmount') || parsedData.vatAmount;
    const customerPO = getParsedValue(parsedData, 'customerPO') || parsedData.customerPO;
    
    // Use STANDARD_FIELDS to get proper display names for error messages
    const { STANDARD_FIELDS } = require('../utils/standardFields');
    
    if (!accountNumber || accountNumber.toString().trim() === '') {
      const fieldDef = STANDARD_FIELDS.accountNumber;
      missingFields.push(fieldDef ? fieldDef.displayName : 'Account Number');
    }
    // Allow 0.00 as a valid amount - only check if it's missing or invalid
    const parsedTotal = invoiceTotal ? parseFloat(invoiceTotal.toString().replace(/[£$€,]/g, '').trim()) : null;
    if (invoiceTotal === null || invoiceTotal === undefined || invoiceTotal.toString().trim() === '' || isNaN(parsedTotal)) {
      const fieldDef = STANDARD_FIELDS.totalAmount;
      missingFields.push(fieldDef ? fieldDef.displayName : 'Total');
    }
    if (!invoiceNumber || invoiceNumber.toString().trim() === '') {
      const fieldDef = STANDARD_FIELDS.invoiceNumber;
      missingFields.push(fieldDef ? fieldDef.displayName : 'Invoice Number');
    }
    if (!vatAmount || vatAmount.toString().trim() === '') {
      const fieldDef = STANDARD_FIELDS.vatAmount;
      missingFields.push(fieldDef ? fieldDef.displayName : 'VAT Amount');
    }
    if (!customerPO || customerPO.toString().trim() === '') {
      const fieldDef = STANDARD_FIELDS.customerPO;
      missingFields.push(fieldDef ? fieldDef.displayName : 'PO Number');
    }
    
    // Check date format - use intelligent parsing (same logic as parseDate function below)
    let dateValid = false;
    if (invoiceDate) {
      try {
        const dateStr = invoiceDate.toString().trim();
        
        // Try multiple date format patterns (same as parseDate function)
        const datePatterns = [
          // dd/mm/yy or dd/mm/yyyy
          { pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/, format: 'dd/mm/yy' },
          // dd-mm-yy or dd-mm-yyyy
          { pattern: /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/, format: 'dd-mm-yy' },
          // dd.mm.yy or dd.mm.yyyy
          { pattern: /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/, format: 'dd.mm.yy' },
          // yyyy-mm-dd (ISO format)
          { pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, format: 'yyyy-mm-dd' },
          // yyyy/mm/dd
          { pattern: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, format: 'yyyy/mm/dd' },
          // dd MMM yyyy or dd MMM yy (e.g., "05 Dec 2025" or "05 Dec 25")
          { pattern: /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{2,4})$/, format: 'dd MMM yyyy' },
          // MMM dd, yyyy (e.g., "Dec 05, 2025")
          { pattern: /^([A-Za-z]{3,})\s+(\d{1,2}),\s+(\d{2,4})$/, format: 'MMM dd, yyyy' }
        ];
        
        for (const { pattern, format } of datePatterns) {
          const match = dateStr.match(pattern);
          if (match) {
            let day, month, year;
            
            if (format.includes('MMM')) {
              // Text month format
              const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
              const monthStr = (format === 'dd MMM yyyy' ? match[2] : match[1]).toLowerCase();
              month = monthNames.findIndex(m => monthStr.startsWith(m)) + 1;
              
              if (month === 0) continue; // Month not found
              
              if (format === 'dd MMM yyyy') {
                day = parseInt(match[1], 10);
                year = parseInt(match[3], 10);
              } else {
                // MMM dd, yyyy
                day = parseInt(match[2], 10);
                year = parseInt(match[3], 10);
              }
            } else {
              // Numeric format
              if (format.startsWith('yyyy')) {
                // yyyy-mm-dd or yyyy/mm/dd format
                year = parseInt(match[1], 10);
                month = parseInt(match[2], 10);
                day = parseInt(match[3], 10);
              } else {
                // dd/mm/yy or dd-mm-yy format
                day = parseInt(match[1], 10);
                month = parseInt(match[2], 10);
                year = parseInt(match[3], 10);
              }
            }
            
            // Convert 2-digit year to 4-digit (assume 2000s if < 50, 1900s if >= 50)
            if (year < 100) {
              year = year < 50 ? 2000 + year : 1900 + year;
            }
            
            // Validate and create date
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
              const testDate = new Date(year, month - 1, day);
              if (testDate.getFullYear() === year && 
                  testDate.getMonth() === month - 1 && 
                  testDate.getDate() === day) {
                dateValid = true;
                break;
              }
            }
          }
        }
        
        // If no pattern matched, try standard Date parsing as fallback
        if (!dateValid) {
          const standardDate = new Date(dateStr);
          if (!isNaN(standardDate.getTime()) && standardDate.getFullYear() > 1900) {
            dateValid = true;
          }
        }
      } catch (e) {
        // Date parsing failed
        console.log(`⚠️  [Import ${importId}] Date validation error for "${invoiceDate}":`, e.message);
      }
    }
    if (!invoiceDate || !dateValid) {
      missingFields.push('invalid_date_format');
    }
    
    // Determine file status and failure reason
    // IMPORTANT: failureReason ENUM only allows: 'unallocated', 'parsing_error', 'validation_error', 'duplicate', 'other'
    // Store specific reason in metadata, but use allowed ENUM value here
    let fileStatus = 'parsed';
    let specificFailureReason = null; // Store the detailed reason for metadata
    
    // Initialize duplicate invoice number check (will be set later if duplicate found)
    let isDuplicateInvoiceNumber = false;
    let duplicateInvoiceNumber = null;
    
    // If duplicate (file hash), set status to 'unallocated' with reason 'duplicate'
    // Note: isDuplicateInvoiceNumber will be checked later after we parse the invoice number
    if (isDuplicate) {
      fileStatus = 'unallocated';
      failureReason = 'duplicate';
      specificFailureReason = 'duplicate';
      // Don't create document if duplicate
      matchedCompanyId = null;
    } else if (!matchedCompanyId) {
      fileStatus = 'unallocated';
      // Set specific failure reason based on what we found
      if (accountNumber && accountNumber.toString().trim() !== '') {
        // Account number was extracted but company not found
        specificFailureReason = 'company_not_found';
        failureReason = 'unallocated'; // Use allowed ENUM value
      } else {
        // Account number was not extracted
        specificFailureReason = 'Missing Account Number';
        failureReason = 'unallocated'; // Use allowed ENUM value
      }
    } else if (missingFields.length > 0) {
      // Company matched but some fields are missing - still create document but mark for review
      // Use the first missing field as the primary reason (already uses display name from STANDARD_FIELDS)
      specificFailureReason = `Missing ${missingFields[0]}`;
      // Map specific reasons to allowed ENUM values
      if (missingFields[0].includes('date') || missingFields[0].includes('format')) {
        failureReason = 'validation_error'; // Date format issues are validation errors
      } else if (missingFields[0].includes('parsing') || missingFields[0].includes('parse')) {
        failureReason = 'parsing_error';
      } else {
        failureReason = 'validation_error'; // Missing fields are validation errors
      }
      fileStatus = 'parsed'; // Still parsed, but needs review
    }
    
    // SIMPLIFIED: Determine final file path
    // Success (company matched) → /mnt/data/processed/{docType}/YYYY/MM/DD/
    // Failure (no match or duplicate) → /mnt/data/unprocessed/failed/YYYY-MM-DD/
    const isAllocated = matchedCompanyId && !isDuplicate;
    
    let actualFilePath;
    let finalStatusFolder;
    
    if (isAllocated) {
      // Processed: /mnt/data/processed/{invoices|creditnotes|statements}/YYYY/MM/DD/filename
      finalStatusFolder = 'processed';
      const processedDir = path.join(PROCESSED_BASE, docTypeFolder, String(year), month, day);
      ensureDir(processedDir);
      actualFilePath = path.join(processedDir, uniqueFileName);
      console.log(`📁 [Import ${importId}] File will be stored in: ${PROCESSED_BASE}/${docTypeFolder}/${year}/${month}/${day}/`);
    } else {
      // Unprocessed: /mnt/data/unprocessed/failed/YYYY-MM-DD/filename
      finalStatusFolder = 'unprocessed';
      const unprocessedDir = path.join(UNPROCESSED_FAILED, `${year}-${month}-${day}`);
      ensureDir(unprocessedDir);
      actualFilePath = path.join(unprocessedDir, uniqueFileName);
      console.log(`📁 [Import ${importId}] File will be stored in: ${UNPROCESSED_FAILED}/${year}-${month}-${day}/`);
    }
    
    await job.updateProgress(90);
    
    // Determine document type
    // First try from parsed data (most accurate - from template extraction)
    let detectedType = (getParsedValue(parsedData, 'documentType') || parsedData.documentType)?.toLowerCase();
    
    // If not found in parsed data, use quick detection result as fallback
    if (!detectedType || detectedType === '' || detectedType === 'unknown') {
      if (quickDetectedDocType) {
        detectedType = quickDetectedDocType;
        console.log(`📄 [Import ${importId}] Using quick detection result: ${detectedType}`);
      } else {
        // Default to invoice if no detection available
        detectedType = 'invoice';
        console.log(`📄 [Import ${importId}] No document type detected, defaulting to invoice`);
      }
    }
    
    // Normalize detected type
    if (detectedType && (detectedType.includes('credit') || detectedType === 'credit_note' || detectedType === 'credit note' || detectedType === 'cn')) {
      detectedType = 'credit_note';
    } else if (detectedType && detectedType.includes('statement')) {
      detectedType = 'statement';
    } else {
      // Default to invoice for any other case (including null, undefined, empty string)
      detectedType = 'invoice';
    }
    
    const isInvoice = detectedType === 'invoice';
    const isCreditNote = detectedType === 'credit_note';
    
    console.log(`📄 [Import ${importId}] Final document type determination: ${detectedType} (isInvoice: ${isInvoice}, isCreditNote: ${isCreditNote})`);
    
    // Helper function to intelligently parse date from various formats
    const parseDate = (dateStr) => {
      if (!dateStr) return new Date();
      
      try {
        const str = dateStr.toString().trim();
        
        // Try multiple date format patterns (same as validation above)
        const datePatterns = [
          // dd/mm/yy or dd/mm/yyyy
          { pattern: /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/, format: 'dd/mm/yy' },
          // dd-mm-yy or dd-mm-yyyy
          { pattern: /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/, format: 'dd-mm-yy' },
          // dd.mm.yy or dd.mm.yyyy
          { pattern: /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/, format: 'dd.mm.yy' },
          // yyyy-mm-dd (ISO format)
          { pattern: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, format: 'yyyy-mm-dd' },
          // yyyy/mm/dd
          { pattern: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, format: 'yyyy/mm/dd' },
          // dd MMM yyyy or dd MMM yy (e.g., "05 Dec 2025" or "05 Dec 25")
          { pattern: /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{2,4})$/, format: 'dd MMM yyyy' },
          // MMM dd, yyyy (e.g., "Dec 05, 2025")
          { pattern: /^([A-Za-z]{3,})\s+(\d{1,2}),\s+(\d{2,4})$/, format: 'MMM dd, yyyy' }
        ];
        
        for (const { pattern, format } of datePatterns) {
          const match = str.match(pattern);
          if (match) {
            let day, month, year;
            
            if (format.includes('MMM')) {
              // Text month format
              const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
              const monthStr = (format === 'dd MMM yyyy' ? match[2] : match[1]).toLowerCase();
              month = monthNames.findIndex(m => monthStr.startsWith(m)) + 1;
              
              if (month === 0) continue; // Month not found
              
              if (format === 'dd MMM yyyy') {
                day = parseInt(match[1], 10);
                year = parseInt(match[3], 10);
              } else {
                // MMM dd, yyyy
                day = parseInt(match[2], 10);
                year = parseInt(match[3], 10);
              }
            } else {
              // Numeric format
              if (format.startsWith('yyyy')) {
                // yyyy-mm-dd or yyyy/mm/dd format
                year = parseInt(match[1], 10);
                month = parseInt(match[2], 10);
                day = parseInt(match[3], 10);
              } else {
                // dd/mm/yy or dd-mm-yy format
                day = parseInt(match[1], 10);
                month = parseInt(match[2], 10);
                year = parseInt(match[3], 10);
              }
            }
            
            // Convert 2-digit year to 4-digit (assume 2000s if < 50, 1900s if >= 50)
            if (year < 100) {
              year = year < 50 ? 2000 + year : 1900 + year;
            }
            
            // Validate day and month ranges
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
              // Create date using UTC to avoid timezone issues
              const parsedDate = new Date(Date.UTC(year, month - 1, day));
              
              // Verify the date is valid (handles invalid dates like Feb 30)
              if (parsedDate.getUTCFullYear() === year && 
                  parsedDate.getUTCMonth() === month - 1 && 
                  parsedDate.getUTCDate() === day) {
                console.log(`✅ [Import ${importId}] Parsed date "${str}" as ${day}/${month}/${year} (${parsedDate.toISOString().split('T')[0]})`);
                return parsedDate;
              } else {
                console.log(`⚠️  [Import ${importId}] Invalid date: ${day}/${month}/${year} (e.g., Feb 30)`);
              }
            }
          }
        }
        
        // If no pattern matched, try standard Date parsing as fallback
        const standardDate = new Date(str);
        if (!isNaN(standardDate.getTime()) && standardDate.getFullYear() > 1900) {
          console.log(`✅ [Import ${importId}] Parsed date "${str}" using standard Date parser: ${standardDate.toISOString().split('T')[0]}`);
          return standardDate;
        }
      } catch (e) {
        console.log(`⚠️  [Import ${importId}] Date parsing error for "${dateStr}":`, e.message);
      }
      console.log(`⚠️  [Import ${importId}] Could not parse date "${dateStr}", using current date as fallback`);
      return new Date(); // Fallback to current date
    };
    
    // Helper function to clean and parse amount (handles currency symbols, commas, decimals)
    const parseAmount = (amountStr) => {
      if (!amountStr) return 0;
      try {
        // Remove currency symbols, commas, spaces
        const cleaned = amountStr.toString()
          .replace(/[£$€,]/g, '')
          .replace(/\s+/g, '')
          .trim();
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? 0 : parsed;
      } catch (e) {
        return 0;
      }
    };
    
    // Check for duplicate invoice/credit note numbers BEFORE creating documents
    // This is separate from file hash duplicates - this checks if the invoice number already exists
    // Note: isDuplicateInvoiceNumber and duplicateInvoiceNumber are already declared above
    const invoiceNumberValue = getParsedValue(parsedData, 'invoiceNumber') || parsedData.invoiceNumber;
    const creditNoteNumberValue = getParsedValue(parsedData, 'creditNumber') || parsedData.creditNumber;
    
    if (matchedCompanyId && (isInvoice || isCreditNote)) {
      if (isInvoice && invoiceNumberValue) {
        // IMPORTANT: Only check non-deleted invoices - if an invoice was purged/deleted, it's not a duplicate
        const existingInvoice = await Invoice.findOne({
          where: { 
            invoiceNumber: invoiceNumberValue.toString().trim(),
            deletedAt: null // Only check invoices that haven't been deleted
          }
        });
        if (existingInvoice) {
          isDuplicateInvoiceNumber = true;
          duplicateInvoiceNumber = invoiceNumberValue.toString().trim();
          console.warn(`⚠️  [Import ${importId}] Duplicate invoice number detected: "${duplicateInvoiceNumber}" (existing invoice ID: ${existingInvoice.id})`);
        } else {
          console.log(`✅ [Import ${importId}] Invoice number "${invoiceNumberValue}" is unique (no non-deleted invoice found with this number)`);
        }
      } else if (isCreditNote && (creditNoteNumberValue || invoiceNumberValue)) {
        const cnNumber = creditNoteNumberValue || invoiceNumberValue;
        // IMPORTANT: Only check non-deleted credit notes - if a credit note was purged/deleted, it's not a duplicate
        // Note: CreditNote model may not have deletedAt field, so we check if it exists
        const creditNoteWhere = { creditNoteNumber: cnNumber.toString().trim() };
        // Only add deletedAt filter if the model supports it (Invoice has it, CreditNote might not)
        // For now, we'll check without deletedAt for CreditNote since it doesn't have that field
        const existingCreditNote = await CreditNote.findOne({
          where: creditNoteWhere
        });
        if (existingCreditNote) {
          isDuplicateInvoiceNumber = true;
          duplicateInvoiceNumber = cnNumber.toString().trim();
          console.warn(`⚠️  [Import ${importId}] Duplicate credit note number detected: "${duplicateInvoiceNumber}" (existing credit note ID: ${existingCreditNote.id})`);
        } else {
          console.log(`✅ [Import ${importId}] Credit note number "${cnNumber}" is unique (no non-deleted credit note found with this number)`);
        }
      }
    }
    
    // If duplicate invoice number found, mark as duplicate and put in unallocated
    if (isDuplicateInvoiceNumber) {
      isDuplicate = true; // Treat as duplicate
      fileStatus = 'unallocated';
      failureReason = 'duplicate';
      specificFailureReason = 'Possible Duplicate';
      matchedCompanyId = null; // Don't create document, force to unallocated
      console.log(`⚠️  [Import ${importId}] File will be marked as unallocated due to duplicate invoice/credit note number`);
    }
    
    // Create invoice or credit note if company matched (after file is in correct location)
    // Skip document creation for duplicates - staff will review and decide
    console.log(`🔍 [Import ${importId}] Document creation check: isDuplicate=${isDuplicate}, isDuplicateInvoiceNumber=${isDuplicateInvoiceNumber}, matchedCompanyId=${matchedCompanyId}, isInvoice=${isInvoice}, isCreditNote=${isCreditNote}`);
    if (!isDuplicate && !isDuplicateInvoiceNumber && matchedCompanyId && (isInvoice || isCreditNote)) {
      try {
        const dateValue = getParsedValue(parsedData, 'invoiceDate') || getParsedValue(parsedData, 'date') || parsedData.date || parsedData.invoiceDate;
        console.log(`📅 [Import ${importId}] Raw date value: "${dateValue}"`);
        const issueDate = parseDate(dateValue);
        console.log(`📅 [Import ${importId}] Parsed date result: ${issueDate.toISOString().split('T')[0]} (${issueDate.toLocaleDateString('en-GB')})`);
        
        if (isInvoice) {
          // Clean and convert amount values to numbers (with decimal support)
          const amountValue = getParsedValue(parsedData, 'totalAmount') || getParsedValue(parsedData, 'amount') || parsedData.amount || parsedData.totalAmount;
          const taxAmountValue = getParsedValue(parsedData, 'vatAmount') || parsedData.vatAmount;
          const amount = parseAmount(amountValue);
          const taxAmount = parseAmount(taxAmountValue);
          
          // If successfully parsed and matched to company, documentStatus is 'ready'
          // If parsed but not matched, it stays as unallocated (no invoice created)
          const invoiceStatus = matchedCompanyId ? 'ready' : 'draft';
          // documentStatus: 'ready' if no issues, 'review' if there were errors/alerts
          const documentStatus = (matchedCompanyId && fileStatus === 'parsed') ? 'ready' : 'review';
          
          const invoiceNumberValue = getParsedValue(parsedData, 'invoiceNumber') || parsedData.invoiceNumber;
          const finalInvoiceNumber = invoiceNumberValue || `INV-${Date.now()}-${fileHash.substring(0, 8)}`;
          
          // Get settings for retention calculation
          const settings = await Settings.getSettings();
          
          // Prepare document data for retention calculation
          const documentDataForRetention = {
            issueDate: issueDate,
            createdAt: new Date(),
            documentStatus: documentStatus
          };
          
          // Calculate retention dates
          const retentionDates = calculateDocumentRetentionDates(documentDataForRetention, settings);
          
          // Invoice number duplicate check already done above, so we can create safely
          document = await Invoice.create({
            companyId: matchedCompanyId,
            invoiceNumber: finalInvoiceNumber,
            issueDate: issueDate,
            amount: amount,
            taxAmount: taxAmount,
            status: invoiceStatus,
            documentStatus: documentStatus,
            fileUrl: actualFilePath, // Use actual path after status folder move
            retentionStartDate: retentionDates.retentionStartDate,
            retentionExpiryDate: retentionDates.retentionExpiryDate,
            metadata: {
              source: 'manual_import',
              fileName: originalName || fileName,
              parsedData: parsedData,
              processingMethod: processingMethod,
              fileHash: fileHash
            }
          });
          documentType = 'invoice';
          console.log(`✅ [Import ${importId}] Created invoice: ${document.invoiceNumber} for company: ${matchedCompanyId}`);
        } else if (isCreditNote) {
          // Clean and convert amount values to numbers (with decimal support)
          const amountValue = getParsedValue(parsedData, 'totalAmount') || getParsedValue(parsedData, 'amount') || parsedData.amount || parsedData.totalAmount;
          const taxAmountValue = getParsedValue(parsedData, 'vatAmount') || parsedData.vatAmount;
          const amount = parseAmount(amountValue);
          const taxAmount = parseAmount(taxAmountValue);
          
          // If successfully parsed and matched to company, documentStatus is 'ready'
          // If parsed but not matched, it stays as unallocated (no credit note created)
          const creditNoteStatus = matchedCompanyId ? 'ready' : 'draft';
          // documentStatus: 'ready' if no issues, 'review' if there were errors/alerts
          const documentStatus = (matchedCompanyId && fileStatus === 'parsed') ? 'ready' : 'review';
          
          const invoiceNumberValue = getParsedValue(parsedData, 'invoiceNumber') || parsedData.invoiceNumber;
          const creditNoteNumberValue = getParsedValue(parsedData, 'creditNumber') || parsedData.creditNumber;
          
          // Get settings for retention calculation
          const settingsForRetention = await Settings.getSettings();
          
          // Prepare document data for retention calculation
          const creditNoteDataForRetention = {
            issueDate: issueDate,
            createdAt: new Date(),
            documentStatus: documentStatus
          };
          
          // Calculate retention dates
          const creditNoteRetentionDates = calculateDocumentRetentionDates(creditNoteDataForRetention, settingsForRetention);
          
          document = await CreditNote.create({
            companyId: matchedCompanyId,
            creditNoteNumber: invoiceNumberValue || creditNoteNumberValue || `CN-${Date.now()}-${fileHash.substring(0, 8)}`,
            issueDate: issueDate,
            amount: amount,
            taxAmount: taxAmount,
            status: creditNoteStatus,
            documentStatus: documentStatus,
            fileUrl: actualFilePath, // Use actual path after status folder move
            retentionStartDate: creditNoteRetentionDates.retentionStartDate,
            retentionExpiryDate: creditNoteRetentionDates.retentionExpiryDate,
            metadata: {
              source: 'manual_import',
              fileName: originalName || fileName,
              parsedData: parsedData,
              processingMethod: processingMethod,
              fileHash: fileHash
            }
          });
          documentType = 'credit_note';
          console.log(`✅ [Import ${importId}] Created credit note: ${document.creditNoteNumber} for company: ${matchedCompanyId}`);
        }
      } catch (docError) {
        console.error(`❌ [Import ${importId}] Failed to create document:`, docError.message);
        console.error(`   Error name:`, docError.name);
        console.error(`   Error code:`, docError.original?.code || docError.code);
        if (docError.errors) {
          console.error(`   Validation errors:`, JSON.stringify(docError.errors, null, 2));
        }
        console.error(`   Stack:`, docError.stack);
        console.error(`   Document data attempted:`, {
          companyId: matchedCompanyId,
          invoiceNumber: isInvoice ? (getParsedValue(parsedData, 'invoiceNumber') || parsedData.invoiceNumber || 'GENERATED') : 'N/A',
          creditNoteNumber: isCreditNote ? (getParsedValue(parsedData, 'creditNumber') || parsedData.creditNumber || 'GENERATED') : 'N/A',
          issueDate: getParsedValue(parsedData, 'invoiceDate') || getParsedValue(parsedData, 'date') || parsedData.date || 'N/A',
          amount: isInvoice ? parseAmount(getParsedValue(parsedData, 'totalAmount') || parsedData.amount) : 'N/A'
        });
        // Continue processing even if document creation fails
        // But log it prominently so it's noticed
        console.error(`⚠️  [Import ${importId}] IMPORTANT: Document was NOT created due to error above. File was processed but no invoice/credit note record exists.`);
      }
    }
    
    // Copy file to final location before database insert
    // Note: Retries are currently disabled - files are processed once only
    if (actualFilePath !== filePath) {
      // Ensure target directory exists
      const targetDir = path.dirname(actualFilePath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      
      // Copy file to final location (keep original in temp for now)
      fs.copyFileSync(filePath, actualFilePath);
      console.log(`📁 [Import ${importId}] Copied file to final location: ${actualFilePath} (${finalStatusFolder})`);
    } else {
      // File already in correct location (duplicates folder)
      console.log(`📁 [Import ${importId}] File already in correct location: ${actualFilePath}`);
    }
    
    // Create file record (this is where constraint errors can occur)
    // If duplicate, use existing file record instead of creating a new one
    // Also check if this is a requeued file with an existing File record
    let file;
    if (job.data.fileId) {
      // This is a requeued file - use the existing file record
      file = await File.findByPk(job.data.fileId);
      if (file) {
        console.log(`🔄 [Import ${importId}] Using existing file record (requeued): ${file.id}`);
        // Update file status and path if needed
        file.status = fileStatus;
        file.failureReason = failureReason;
        file.filePath = actualFilePath;
        file.parsedData = parsedData;
        file.processingMethod = processingMethod;
        await file.save();
      } else {
        console.warn(`⚠️  [Import ${importId}] File ID ${job.data.fileId} not found, creating new record`);
        file = await File.create({
          fileName: originalName || fileName,
          fileHash,
          filePath: actualFilePath,
          fileSize: fileBuffer.length,
          fileType: isInvoice ? 'invoice' : (isCreditNote ? 'credit_note' : 'unknown'),
          status: fileStatus,
          failureReason: failureReason,
          parsedData: parsedData,
          processingMethod: processingMethod,
          customerId: matchedCompanyId, // File model uses customerId (legacy, but works with Company)
          uploadedById: userId,
          metadata: {
            source: 'manual_import',
            fileName: originalName || fileName,
            parsedData: parsedData,
            processingMethod: processingMethod,
            fileHash: fileHash
          }
        });
      }
    } else if (existingFile) {
      // File with this hash already exists (duplicate or orphaned) - update existing record
      // This handles both true duplicates and orphaned records from purge
      file = existingFile;
      
      // Update the existing file record with new data
      await file.update({
        fileName: originalName || fileName,
        filePath: actualFilePath,
        fileSize: fileBuffer.length,
        fileType: isInvoice ? 'invoice' : (isCreditNote ? 'credit_note' : 'unknown'),
        status: fileStatus,
        failureReason: failureReason,
        processingMethod: processingMethod,
        parsedData: parsedData,
        customerId: matchedCompanyId,
        uploadedById: userId,
        deletedAt: null, // Restore if it was soft-deleted
        metadata: {
          ...(file.metadata || {}),
          source: 'manual_import',
          importId: importId,
          originalFileName: originalName || fileName,
          documentId: document?.id,
          documentType: documentType,
          storagePath: actualFilePath,
          docTypeFolder: docTypeFolder,
          statusFolder: finalStatusFolder,
          fileHash: fileHash,
          isDuplicate: isDuplicate || isDuplicateInvoiceNumber,
          duplicateFileId: duplicateFileId,
          duplicateInvoiceNumber: isDuplicateInvoiceNumber ? duplicateInvoiceNumber : undefined,
          specificFailureReason: specificFailureReason,
          missingFields: missingFields.length > 0 ? missingFields : undefined
        }
      });
      
      if (isDuplicate) {
        console.log(`⚠️  [Import ${importId}] Updated existing file record (duplicate): ${file.id}`);
      } else {
        console.log(`✅ [Import ${importId}] Updated existing file record (orphaned, now restored): ${file.id}`);
      }
    } else {
      // No existing file found - create new file record
      // First check if a file with this hash exists (including soft-deleted) to avoid unique constraint violation
      const { Op } = require('sequelize');
      const existingFileByHash = await File.findOne({
        where: { fileHash },
        paranoid: false // Include soft-deleted records
      });
      
      if (existingFileByHash) {
        // File with this hash exists (possibly soft-deleted) - update it instead
        file = existingFileByHash;
        await file.update({
          fileName: originalName || fileName,
          filePath: actualFilePath,
          fileSize: fileBuffer.length,
          fileType: isInvoice ? 'invoice' : (isCreditNote ? 'credit_note' : 'unknown'),
          status: fileStatus,
          failureReason: failureReason,
          processingMethod: processingMethod,
          parsedData: parsedData,
          customerId: matchedCompanyId,
          uploadedById: userId,
          deletedAt: null, // Restore if it was soft-deleted
          metadata: {
            ...(file.metadata || {}),
            source: 'manual_import',
            importId: importId,
            originalFileName: originalName || fileName,
            documentId: document?.id,
            documentType: documentType,
            storagePath: actualFilePath,
            docTypeFolder: docTypeFolder,
            statusFolder: finalStatusFolder,
            fileHash: fileHash,
            isDuplicate: isDuplicate || isDuplicateInvoiceNumber,
            duplicateFileId: duplicateFileId,
            duplicateInvoiceNumber: isDuplicateInvoiceNumber ? duplicateInvoiceNumber : undefined,
            specificFailureReason: specificFailureReason,
            missingFields: missingFields.length > 0 ? missingFields : undefined
          }
        });
        console.log(`✅ [Import ${importId}] Updated existing file record (found by hash): ${file.id}`);
      } else {
        // Truly new file - create new record
        try {
          file = await File.create({
            fileName: originalName || fileName,
            fileHash,
            filePath: actualFilePath,
            fileSize: fileBuffer.length,
            fileType: isInvoice ? 'invoice' : (isCreditNote ? 'credit_note' : 'unknown'),
            status: fileStatus,
            failureReason: failureReason,
            processingMethod: processingMethod, // Now STRING type, can store any value
            parsedData: parsedData,
            customerId: matchedCompanyId, // File model uses customerId (legacy, but works with Company)
            uploadedById: userId,
            metadata: {
              source: 'manual_import',
              importId: importId,
              originalFileName: originalName || fileName,
              documentId: document?.id,
              documentType: documentType,
              storagePath: actualFilePath, // Store full path for reference
              docTypeFolder: docTypeFolder,
              statusFolder: finalStatusFolder,
              fileHash: fileHash, // Store hash in metadata for easy lookup
              isDuplicate: isDuplicate || isDuplicateInvoiceNumber,
              duplicateFileId: duplicateFileId, // Reference to original file if duplicate (file hash)
              duplicateInvoiceNumber: isDuplicateInvoiceNumber ? duplicateInvoiceNumber : undefined, // Store duplicate invoice number if found
              specificFailureReason: specificFailureReason, // Store detailed failure reason (e.g., 'company_not_found', 'missing_account_number', 'invalid_date_format', 'Possible Duplicate')
              missingFields: missingFields.length > 0 ? missingFields : undefined // Store all missing fields for reference
            }
          });
          
          console.log(`✅ [Import ${importId}] Created file record: ${file.id}`);
        } catch (fileError) {
          console.error(`❌ [Import ${importId}] Error creating file record:`, fileError.message);
          if (fileError.errors) {
            console.error(`   Validation errors:`, JSON.stringify(fileError.errors, null, 2));
          }
          console.error(`   File data:`, {
            fileName: originalName || fileName,
            fileType: isInvoice ? 'invoice' : (isCreditNote ? 'credit_note' : 'unknown'),
            status: fileStatus,
            failureReason: failureReason
          });
          throw new Error(`Validation error: ${fileError.message}`);
        }
      }
    }
    
    // Send email notification for duplicates
    if (isDuplicate && existingFile) {
      try {
        const { sendEmail } = require('../utils/emailService');
        const { wrapEmailContent, emailButton } = require('../utils/emailTheme');
        const { Settings, User } = require('../models');
        
        const settings = await Settings.getSettings();
        
        // Get staff/admin users to notify
        const staffUsers = await User.findAll({
          where: {
            role: {
              [require('sequelize').Op.in]: ['global_admin', 'administrator', 'manager', 'staff']
            },
            isActive: true
          }
        });
        
        if (staffUsers.length > 0 && isEmailEnabled(settings)) {
          const { getFrontendUrl } = require('../utils/urlConfig');
          const frontendUrl = getFrontendUrl();
          const reviewUrl = `${frontendUrl}/unallocated`; // Link to unallocated/duplicates page
          
          const emailSubject = `Duplicate File Detected: ${originalName || fileName}`;
          const emailContent = `
            <h2 style="color: ${settings.primaryColor || '#066fd1'}; margin-top: 0;">Duplicate File Detected</h2>
            <p>A duplicate file has been uploaded and requires your review:</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #e0e0e0;"><strong>New File:</strong></td>
                <td style="padding: 8px; border-bottom: 1px solid #e0e0e0;">${originalName || fileName}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #e0e0e0;"><strong>Original File:</strong></td>
                <td style="padding: 8px; border-bottom: 1px solid #e0e0e0;">${existingFile.fileName} (ID: ${existingFile.id})</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #e0e0e0;"><strong>File Hash:</strong></td>
                <td style="padding: 8px; border-bottom: 1px solid #e0e0e0;">${fileHash.substring(0, 16)}...</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #e0e0e0;"><strong>Status:</strong></td>
                <td style="padding: 8px; border-bottom: 1px solid #e0e0e0;">Stored as duplicate for review</td>
              </tr>
            </table>
            <p><strong>Action Required:</strong></p>
            <ul>
              <li>Review the duplicate file in the system</li>
              <li>If it's a true duplicate, delete it from the system (this will delete the file completely)</li>
              <li>If it's a different file with same content, edit the information and change status to allocated</li>
            </ul>
            ${emailButton('Review Duplicate Files', reviewUrl, settings)}
          `;
          
          const themedContent = wrapEmailContent(emailContent, settings);
          
          // Send email to all staff users
          for (const user of staffUsers) {
            if (user.email) {
              try {
                await sendEmail({
                  to: user.email,
                  subject: emailSubject,
                  html: themedContent,
                  settings: settings
                });
                console.log(`📧 [Import ${importId}] Sent duplicate notification to: ${user.email}`);
              } catch (emailError) {
                console.error(`⚠️  [Import ${importId}] Failed to send email to ${user.email}:`, emailError.message);
              }
            }
          }
        }
      } catch (emailError) {
        console.error(`⚠️  [Import ${importId}] Error sending duplicate notification:`, emailError.message);
        // Don't fail the import if email fails
      }
    }
    
    await job.updateProgress(100);
    
    // Clean up source file after successful copy
    // Delete if: temp file, OR in FTP upload folder (since we've copied to processed/unprocessed)
    const isTempFile = filePath.includes(path.join('temp', path.sep)) || 
                       path.basename(filePath).startsWith('sftp-') ||
                       path.basename(filePath).startsWith('ftp-');
    const isInUploadFolder = FTP_UPLOAD_PATH && filePath.startsWith(FTP_UPLOAD_PATH);
    
    if (fs.existsSync(filePath) && filePath !== actualFilePath && (isTempFile || isInUploadFolder)) {
      try {
        // Add a small delay before cleanup to ensure file is fully processed
        await new Promise(resolve => setTimeout(resolve, 100));
        fs.unlinkSync(filePath);
        console.log(`[Import ${importId}] Cleaned up source file: ${filePath} (${isInUploadFolder ? 'uploads folder' : 'temp file'})`);
      } catch (cleanupError) {
        console.warn(`[Import ${importId}] Failed to cleanup source file: ${cleanupError.message}`);
      }
    }
    
    const processingTime = Date.now() - startTime;

    // Resolve existing document number for duplicates (so import summary can show "already in system as Invoice/CN X")
    let duplicateDocumentNumber = null;
    let duplicateDocumentType = null;
    if (isDuplicate && existingFile) {
      const docId = existingFile.metadata?.documentId;
      const fileType = (existingFile.fileType || existingFile.metadata?.documentType || '').toLowerCase();
      if (docId) {
        if (fileType.includes('invoice')) {
          const inv = await Invoice.findByPk(docId, { attributes: ['invoiceNumber'] });
          if (inv) {
            duplicateDocumentNumber = inv.invoiceNumber;
            duplicateDocumentType = 'invoice';
          }
        } else if (fileType.includes('credit')) {
          const cn = await CreditNote.findByPk(docId, { attributes: ['creditNoteNumber'] });
          if (cn) {
            duplicateDocumentNumber = cn.creditNoteNumber || cn.creditNumber;
            duplicateDocumentType = 'credit_note';
          }
        }
      }
    }

    // Add result to import store
    const importStore = require('../utils/importStore');
    const result = {
      success: true,
      fileName: originalName || fileName,
      fileId: file.id,
      companyId: matchedCompanyId,
      documentId: document?.id,
      documentType: documentType,
      status: fileStatus,
      isDuplicate: isDuplicate || isDuplicateInvoiceNumber,
      duplicateFileId: duplicateFileId,
      duplicateDocumentNumber: duplicateDocumentNumber || (isDuplicateInvoiceNumber ? duplicateInvoiceNumber : null),
      duplicateDocumentType: duplicateDocumentType || (isDuplicateInvoiceNumber ? (isCreditNote ? 'credit_note' : 'invoice') : null),
      invoiceNumber: getParsedValue(parsedData, 'invoiceNumber') || parsedData.invoiceNumber,
      creditNoteNumber: getParsedValue(parsedData, 'creditNumber') || parsedData.creditNumber,
      accountNumber: getParsedValue(parsedData, 'accountNumber') || parsedData.accountNumber,
      amount: getParsedValue(parsedData, 'amount') || parsedData.amount,
      processingTime,
      timestamp: new Date().toISOString()
    };
    
    await importStore.addResult(importId, result);
    
    // Record job completion for batch notification tracking
    try {
      const { recordJobCompletion } = require('../services/batchNotificationService');
      await recordJobCompletion(importId, result);
    } catch (batchError) {
      console.warn(`⚠️  [Import ${importId}] Failed to record batch completion:`, batchError.message);
    }
    
    // Log file import activity (success or failure)
    try {
      let user = null;
      if (userId) {
        user = await User.findByPk(userId);
      }
      
      await logActivity({
        type: result.success ? ActivityType.FILE_IMPORT : ActivityType.FILE_IMPORT_FAILED,
        userId: userId || null,
        userEmail: user?.email || 'system',
        userRole: user?.role || 'system',
        action: result.success 
          ? `Imported file: ${originalName || fileName}${matchedCompanyId ? ` (matched to company)` : ` (unallocated)`}`
          : `Failed to import file: ${originalName || fileName}`,
        details: {
          importId: importId,
          fileName: originalName || fileName,
          fileId: file?.id,
          documentId: document?.id,
          documentType: documentType,
          companyId: matchedCompanyId,
          status: fileStatus,
          isDuplicate: isDuplicate,
          error: result.success ? null : result.error,
          processingTime: processingTime
        },
        companyId: matchedCompanyId,
        companyName: matchedCompanyId ? (await Company.findByPk(matchedCompanyId))?.name : null,
        ipAddress: null, // System queue, no IP
        userAgent: 'system_queue'
      });
    } catch (logError) {
      // Don't fail the import if logging fails
      console.error(`⚠️  [Import ${importId}] Failed to log activity:`, logError.message);
    }
    
    return result;
  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMessage = error.message || 'Unknown error';
    const errorStack = error.stack || '';
    
    console.error(`❌ [Import ${importId}] Error processing ${fileName}:`, errorMessage);
    console.error(`   Stack trace:`, errorStack);
    console.error(`   File path: ${filePath}`);
    console.error(`   File exists: ${fs.existsSync(filePath)}`);
    
    // Clean up temp file on error (only if it's actually a temp file)
    // Don't delete files that might still be needed for retry
    const isTempFile = filePath.includes(path.join('temp', path.sep)) || 
                       path.basename(filePath).startsWith('sftp-') ||
                       path.basename(filePath).startsWith('ftp-');
    
    if (fs.existsSync(filePath) && isTempFile) {
      try {
        // Only delete temp files on error, and only after a delay
        // This prevents deleting files that might be retried
        await new Promise(resolve => setTimeout(resolve, 500));
        if (fs.existsSync(filePath)) { // Double-check it still exists
          fs.unlinkSync(filePath);
          console.log(`🧹 [Import ${importId}] Cleaned up temp file after error: ${filePath}`);
        }
      } catch (cleanupError) {
        console.warn(`⚠️  [Import ${importId}] Failed to cleanup temp file: ${cleanupError.message}`);
      }
    }
    
    // Add error result to import store
    const importStore = require('../utils/importStore');
    const errorResult = {
      success: false,
      fileName: originalName || fileName,
      error: errorMessage,
      errorDetails: errorStack.substring(0, 500), // First 500 chars of stack
      processingTime,
      timestamp: new Date().toISOString()
    };
    
    await importStore.addResult(importId, errorResult);
    
    // Record job failure for batch notification tracking
    try {
      const { recordJobCompletion } = require('../services/batchNotificationService');
      await recordJobCompletion(importId, errorResult);
    } catch (batchError) {
      console.warn(`⚠️  [Import ${importId}] Failed to record batch failure:`, batchError.message);
    }
    
    // Log file import failure
    try {
      let user = null;
      if (userId) {
        user = await User.findByPk(userId);
      }
      
      await logActivity({
        type: ActivityType.FILE_IMPORT_FAILED,
        userId: userId || null,
        userEmail: user?.email || 'system',
        userRole: user?.role || 'system',
        action: `Failed to import file: ${originalName || fileName}`,
        details: {
          importId: importId,
          fileName: originalName || fileName,
          error: errorMessage,
          errorDetails: errorStack.substring(0, 500),
          processingTime: processingTime
        },
        companyId: null,
        companyName: null,
        ipAddress: null, // System queue, no IP
        userAgent: 'system_queue'
      });
    } catch (logError) {
      // Don't fail the import if logging fails
      console.error(`⚠️  [Import ${importId}] Failed to log activity:`, logError.message);
    }
    
    // Re-throw to let Bull handle it
    throw error;
  }
}

module.exports = {
  processInvoiceImport
};

