const { downloadFile, calculateFileHash, listFiles, moveFile } = require('../utils/ftp');
const { File, Settings, User, Template, Company, Invoice, CreditNote, Statement } = require('../models');
const { extractInvoiceData, extractTextFromPDF } = require('../utils/pdfExtractor');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * File import job processor
 * Downloads files from FTP, checks for duplicates, and processes them
 */

// Google Cloud clients (will be initialized when needed)
let documentAIClient = null;

/**
 * Initialize Google Cloud clients based on settings
 */
async function initGoogleClients(settings = null) {
  // Get settings if not provided
  if (!settings) {
    const { Settings } = require('../models');
    settings = await Settings.getSettings();
  }
  
  const parsingConfig = settings.parsingProvider || {};
  
  // Initialize Document AI if enabled
  if (parsingConfig.documentai?.enabled === true) {
    if (!documentAIClient) {
      // Priority: 1) JSON from env var, 2) JSON from database, 3) File path from env var, 4) File path from settings
      const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || 
                             parsingConfig.documentai?.credentialsJson;
      const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 
                             parsingConfig.documentai?.credentialsPath;
      
      try {
        const documentai = require('@google-cloud/documentai');
        
        if (credentialsJson) {
          // Use JSON from environment variable or database
          const credentials = typeof credentialsJson === 'string' 
            ? JSON.parse(credentialsJson) 
            : credentialsJson;
          documentAIClient = new documentai.DocumentProcessorServiceClient({
            credentials: credentials
          });
          const source = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON 
            ? 'environment variable' 
            : 'database';
          console.log(`✅ Google Document AI initialized (using JSON from ${source})`);
        } else if (credentialsPath) {
          // Use file path
          documentAIClient = new documentai.DocumentProcessorServiceClient({
            keyFilename: credentialsPath
          });
          console.log('✅ Google Document AI initialized (using credentials file)');
        } else {
          // Try default credentials
          documentAIClient = new documentai.DocumentProcessorServiceClient();
          console.log('✅ Google Document AI initialized (using default credentials)');
        }
      } catch (error) {
        console.warn('⚠️  Google Document AI not available:', error.message);
        if (!credentialsJson && !credentialsPath) {
          console.warn('⚠️  Set GOOGLE_APPLICATION_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS environment variable.');
        }
      }
    }
  }
}

/**
 * Process file import job
 */
async function processFileImport(job) {
  const { fileName, remotePath, ftpConfig } = job.data;
  
  console.log(`📥 Processing file import: ${fileName}`);
  
  try {
    // Get settings for file storage path
    const settings = await Settings.getSettings();
    const parsingConfig = settings.parsingProvider || {};
    const { ensureStorageDirs, getStorageDir } = require('../config/storage');
    
    // Ensure storage directories exist
    ensureStorageDirs();
    const uploadsDir = getStorageDir('invoices');
    
    // Generate unique local filename
    const fileExt = path.extname(fileName);
    const uniqueFileName = `${crypto.randomUUID()}${fileExt}`;
    const localPath = path.join(uploadsDir, uniqueFileName);
    
    // Download file from FTP
    console.log(`⬇️  Downloading ${fileName} from FTP...`);
    await downloadFile(ftpConfig, remotePath || fileName, localPath);
    
    // Calculate file hash to check for duplicates
    console.log(`🔍 Calculating file hash...`);
    const fileHash = calculateFileHash(localPath);
    const fileStats = fs.statSync(localPath);
    
    // File type will be detected from PDF content during parsing
    // Default to 'unknown' until parsed
    let fileType = 'unknown';
    const ftpFolder = job.data.ftpFolder || null;
    
    // Get retention settings for duplicate detection
    const retentionDays = settings.fileRetentionDays;
    
    // Check if file already exists (duplicate)
    // Allow re-upload if file was deleted more than retentionDays ago
    const { Op } = require('sequelize');
    let existingFile = await File.findOne({
      where: {
        fileHash: fileHash,
        deletedAt: null // Only check non-deleted files
      }
    });
    
    // If not found, check if there's a deleted file that can be re-uploaded
    if (!existingFile && retentionDays !== null) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      
      // Find deleted file that's beyond retention period (can be re-uploaded)
      const deletedFile = await File.findOne({
        where: {
          fileHash: fileHash,
          deletedAt: {
            [Op.lt]: cutoffDate // Deleted more than retentionDays ago
          }
        },
        order: [['deletedAt', 'DESC']] // Get most recently deleted
      });
      
      if (deletedFile) {
        console.log(`ℹ️  File was previously deleted (${deletedFile.id}), allowing re-upload`);
        // Allow re-upload - don't treat as duplicate
        existingFile = null;
      }
    }
    
    if (existingFile) {
      console.log(`⚠️  Duplicate file detected: ${fileName} (hash: ${fileHash.substring(0, 8)}...)`);
      
      // Delete downloaded file (duplicate)
      fs.unlinkSync(localPath);
      
      // Get folder structure for moving duplicate
      const folderStructure = settings.ftp?.folderStructure || {
        unprocessed: '/Unprocessed',
        processed: '/Processed',
        failed: '/Failed'
      };
      
      // Move duplicate file to a Duplicates subfolder in Processed
      const relativeSourcePath = ftpFolder ? `${ftpFolder}/${fileName}` : fileName;
      const dateFolder = new Date().toISOString().split('T')[0];
      const duplicatePath = `${folderStructure.processed}/Duplicates/${dateFolder}/${fileName}`;
      
      try {
        await moveFile(ftpConfig, relativeSourcePath, duplicatePath);
        console.log(`✅ Moved duplicate file to: ${duplicatePath}`);
      } catch (moveError) {
        console.error(`⚠️  Failed to move duplicate file: ${moveError.message}`);
      }
      
      // Create file record with duplicate status
      const file = await File.create({
        fileName,
        fileHash,
        filePath: localPath, // Will be cleaned up
        fileSize: fileStats.size,
        status: 'duplicate',
        fileType,
        ftpFolder,
        metadata: {
          originalFileId: existingFile.id,
          ftpSource: remotePath || fileName,
          jobId: job.id,
          duplicateOf: existingFile.id,
          ftpDuplicatePath: duplicatePath,
          movedAt: new Date().toISOString()
        }
      });
      
      return {
        success: true,
        status: 'duplicate',
        fileId: file.id,
        message: `File ${fileName} is a duplicate of existing file ${existingFile.id}`,
        movedTo: duplicatePath
      };
    }
    
    // Find system user (or use null for FTP imports)
    const systemUser = await User.findOne({ where: { email: 'system@localhost' } }).catch(() => null);
    
    // Create file record
    const file = await File.create({
      fileName,
      fileHash,
      filePath: localPath,
      fileSize: fileStats.size,
      status: 'processing',
      fileType,
      ftpFolder,
      uploadedById: systemUser?.id || null,
      metadata: {
        ftpSource: remotePath || fileName,
        jobId: job.id,
        originalFileName: fileName
      }
    });
    
    // Update job progress
    await job.updateProgress(25);
    
    // Check if file is Excel (reuse fileExt from above, just convert to lowercase)
    const fileExtLower = fileExt.toLowerCase();
    const isExcel = ['.xlsx', '.xls'].includes(fileExtLower);
    
    // Handle Excel files
    if (isExcel) {
      console.log(`📊 Processing Excel file: ${fileName}`);
      const { extractFieldsFromExcel } = require('../utils/excelParser');
      
      // ALWAYS use the default template for Excel files
      const template = await Template.findDefaultTemplate('excel', null);
      
      if (!template) {
        throw new Error('No default Excel template found. Please create and set a default Excel template first.');
      }
      
      console.log(`   Using DEFAULT Excel template: ${template.name} (ID: ${template.id}, isDefault: ${template.isDefault})`);
      
      // Extract data using template
      const extractedData = await extractFieldsFromExcel(localPath, template);
      
      // Determine file type from extracted data
      fileType = extractedData.documentType || 'invoice';
      
      // Update file record with extracted data
      await file.update({
        status: 'processed',
        fileType,
        invoiceNumber: extractedData.invoiceNumber,
        date: extractedData.date,
        amount: extractedData.amount,
        accountNumber: extractedData.accountNumber,
        customerName: extractedData.customerName,
        metadata: {
          ...file.metadata,
          extractedData,
          template: template.name,
          templateId: template.id,
          processingMethod: 'excel_template'
        }
      });
      
      console.log(`✅ Excel file processed successfully`);
      console.log(`   Invoice Number: ${extractedData.invoiceNumber || 'N/A'}`);
      console.log(`   Account Number: ${extractedData.accountNumber || 'N/A'}`);
      console.log(`   Amount: ${extractedData.amount || 'N/A'}`);
      
      return {
        success: true,
        status: 'processed',
        fileId: file.id,
        extractedData
      };
    }
    
    // Use local PDF extraction with coordinate-based templates
    console.log(`🔍 Attempting to parse ${fileName} with local PDF extraction...`);
    console.log(`   File path: ${localPath}`);
    console.log(`   File size: ${fileStats.size} bytes`);
    let parsedData = null;
    let processingMethod = 'local_coordinates';
    let supplierTemplate = null;
    
    try {
      // Read PDF buffer
      const pdfBuffer = fs.readFileSync(localPath);
      
      // Try to detect document type from content first
      const { extractTextFromPDF } = require('../utils/pdfExtractor');
      const extractedText = await extractTextFromPDF(localPath);
      console.log(`✅ Extracted ${extractedText.text.length} characters of text locally`);
      
      // Detect document type from content
      const detectedType = detectDocumentTypeFromContent(extractedText.text);
      console.log(`📄 Detected document type: ${detectedType}`);
      
      // ALWAYS use the default template for the detected document type
      // CRITICAL: Never use a template of a different type - this causes field mismatches!
      let template = await Template.findDefaultTemplate('pdf', detectedType);
      
      if (template) {
        // Validate that template type matches detected type
        if (template.templateType !== detectedType) {
          console.error(`❌ TEMPLATE TYPE MISMATCH! Detected: ${detectedType}, Template: ${template.templateType}`);
          console.error(`   This will cause field extraction errors! Rejecting this template.`);
          template = null; // Reject mismatched template
        } else {
          console.log(`✅ Using DEFAULT template: ${template.name} (${template.templateType}, ID: ${template.id}, isDefault: ${template.isDefault})`);
        }
      }
      
      // If no matching template found, try to find any template of the correct type (even if not default)
      if (!template && detectedType) {
        template = await Template.findTemplateByFileType('pdf', detectedType);
        if (template) {
          console.log(`⚠️  Using non-default template for ${detectedType}: ${template.name} (ID: ${template.id}, templateType: ${template.templateType})`);
        }
      }
      
      if (template) {
        // Use coordinate-based extraction
        parsedData = await Template.extractFieldsFromCoordinates(pdfBuffer, template);
        processingMethod = `local_coordinates_${template.code}`;
        console.log(`✅ Extracted fields using coordinate template`);
        
        // Validate template type matches (double-check)
        if (template.templateType !== detectedType) {
          console.error(`❌ CRITICAL MISMATCH: Detected document type: ${detectedType}, but using template type: ${template.templateType}`);
          if (!parsedData.metadata) parsedData.metadata = {};
          parsedData.metadata.templateTypeMismatch = {
            detected: detectedType,
            templateUsed: template.templateType,
            templateName: template.name,
            warning: `Document detected as ${detectedType} but parsed with ${template.templateType} template`
          };
        } else {
          console.log(`✅ Template type validation passed: Detected ${detectedType}, Template ${template.templateType}`);
        }
      } else {
        console.error(`❌ CRITICAL: No PDF template found for detected type: ${detectedType}`);
        console.error(`   This document cannot be processed correctly. Please create a default template for ${detectedType}.`);
        // Fallback to basic extraction (no template)
        parsedData = await extractInvoiceData(localPath);
        processingMethod = 'local_basic';
      }
      
      if (parsedData && parsedData.fullText) {
        const textLength = parsedData.fullText.length;
        console.log(`✅ Successfully parsed locally`);
        console.log(`   Extracted ${textLength} characters of text`);
        console.log(`   Invoice #: ${parsedData.invoiceNumber || 'Not found'}`);
        console.log(`   Account #: ${parsedData.accountNumber || 'Not found'}`);
        console.log(`   Date: ${parsedData.date || 'Not found'}`);
        console.log(`   Amount: ${parsedData.amount || 'Not found'}`);
        
        // Use detected type or parsed document type
        if (parsedData.documentType) {
          fileType = parsedData.documentType;
        } else {
          fileType = detectedType;
        }
        console.log(`📄 Document type: ${fileType}`);
      } else {
        console.log(`⚠️  Local extraction returned no data`);
      }
    } catch (localError) {
      console.error(`❌ Local PDF extraction failed: ${localError.message}`);
      console.error(`   Error stack:`, localError.stack);
      // No fallback - local extraction is primary method
      parsedData = null;
    }
    
    // Update file with parsing results
    await job.updateProgress(75);
    
    // Get folder structure from settings
    const folderStructure = settings.ftp?.folderStructure || {
      unprocessed: '/Unprocessed',
      processed: '/Processed',
      failed: '/Failed'
    };
    
    // Determine destination folder based on status
    let destinationPath = null;
    
    if (parsedData) {
      // Match company by account number (referenceNo)
      // IMPORTANT: Documents are assigned to companies using account number/company number (referenceNo)
      // This is a CORE feature requirement
      let matchedCompanyId = null;
      let document = null;
      
      if (parsedData.accountNumber) {
        // Try to find company by referenceNo (account number)
        const company = await Company.findOne({
          where: {
            referenceNo: parsedData.accountNumber.toString().trim()
          }
        });
        
        if (company) {
          matchedCompanyId = company.id;
          console.log(`✅ Matched company: ${company.name} (Account: ${company.referenceNo})`);
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/a71118e4-5010-40f5-8a55-7b39cd0c3d75',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fileImport.js:402',message:'Company matched',data:{companyId:company.id,companyName:company.name,accountNumber:parsedData.accountNumber},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H2'})}).catch(()=>{});
          // #endregion
          
          // Create invoice/credit note/statement based on document type
          // Only create for INVOICE or CREDIT_NOTE document types
          if (fileType === 'invoice' || parsedData.documentType?.toLowerCase() === 'invoice') {
            try {
              const issueDate = parsedData.date ? new Date(parsedData.date) : new Date();
              
              document = await Invoice.create({
                companyId: matchedCompanyId,
                invoiceNumber: parsedData.invoiceNumber || `INV-${Date.now()}-${file.id.substring(0, 8)}`,
                issueDate: issueDate,
                amount: parsedData.amount || 0,
                taxAmount: parsedData.vatAmount || 0,
                status: 'draft',
                fileUrl: file.filePath,
                metadata: {
                  source: 'ftp_import',
                  fileId: file.id,
                  fileName: fileName,
                  parsedData: parsedData,
                  processingMethod: processingMethod
                }
              });
              
              console.log(`✅ Created invoice: ${document.invoiceNumber} for company: ${company.name}`);
              // #region agent log
              fetch('http://127.0.0.1:7244/ingest/a71118e4-5010-40f5-8a55-7b39cd0c3d75',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fileImport.js:429',message:'Invoice created',data:{invoiceId:document.id,invoiceNumber:document.invoiceNumber,companyId:matchedCompanyId},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1-H4'})}).catch(()=>{});
              // #endregion
            } catch (invoiceError) {
              console.error(`⚠️  Failed to create invoice:`, invoiceError.message);
              // Continue processing even if invoice creation fails
            }
          } else if (fileType === 'credit_note' || parsedData.documentType?.toLowerCase() === 'credit_note') {
            try {
              const issueDate = parsedData.date ? new Date(parsedData.date) : new Date();
              
              document = await CreditNote.create({
                companyId: matchedCompanyId,
                creditNoteNumber: parsedData.invoiceNumber || parsedData.creditNoteNumber || `CN-${Date.now()}-${file.id.substring(0, 8)}`,
                issueDate: issueDate,
                amount: parsedData.amount || 0,
                status: 'draft',
                fileUrl: file.filePath, // Will be updated after file is moved
                metadata: {
                  source: 'ftp_import',
                  fileId: file.id,
                  fileName: fileName,
                  parsedData: parsedData,
                  processingMethod: processingMethod
                }
              });
              
              console.log(`✅ Created credit note: ${document.creditNoteNumber} for company: ${company.name}`);
            } catch (creditNoteError) {
              console.error(`⚠️  Failed to create credit note:`, creditNoteError.message);
            }
          }
        } else {
          console.log(`⚠️  No company found with account number: ${parsedData.accountNumber}`);
          console.log(`   File will be marked as unallocated`);
        }
      } else {
        console.log(`⚠️  No account number found in parsed data`);
        console.log(`   File will be marked as unallocated`);
      }
      
      // Determine status based on whether company was matched
      let finalStatus = 'parsed';
      let failureReason = null;
      
      if (!matchedCompanyId) {
        finalStatus = 'unallocated';
        failureReason = 'no_company_match';
      }
      
      await file.update({
        status: finalStatus,
        processingMethod,
        parsedData,
        processedAt: new Date(),
        failureReason: failureReason,
        customerId: matchedCompanyId // File model uses customerId field (legacy, but works with Company)
      });
      
      // Move file to Processed folder
      const relativeSourcePath = ftpFolder ? `${ftpFolder}/${fileName}` : fileName;
      
      // Create destination path with date folder for organization
      const dateFolder = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      destinationPath = `${folderStructure.processed}/${dateFolder}/${fileName}`;
      
      // Move file on FTP server
      try {
        await moveFile(ftpConfig, relativeSourcePath, destinationPath);
        console.log(`✅ Moved file to Processed: ${destinationPath}`);
        
        // Update file metadata with new location
        await file.update({
          metadata: {
            ...file.metadata,
            ftpProcessedPath: destinationPath,
            movedAt: new Date().toISOString()
          }
        });
        
        // CRITICAL: Update the document's fileUrl with the new location
        // so email attachments can find the file
        if (document) {
          await document.update({ fileUrl: destinationPath });
          console.log(`✅ Updated document fileUrl to: ${destinationPath}`);
        }
      } catch (moveError) {
        console.error(`⚠️  Failed to move file to Processed folder: ${moveError.message}`);
        // Don't fail the job if move fails - file is still processed
      }
      
      await job.updateProgress(100);
      
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/a71118e4-5010-40f5-8a55-7b39cd0c3d75',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'fileImport.js:520',message:'Job returning result',data:{matchedCompanyId,documentId:document?.id,documentExists:!!document,documentType:document?(fileType==='invoice'||parsedData.documentType?.toLowerCase()==='invoice'?'invoice':'credit_note'):null,fileName,finalStatus},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1-H2-H4'})}).catch(()=>{});
      // #endregion
      return {
        success: true,
        status: finalStatus,
        fileId: file.id,
        processingMethod,
        message: matchedCompanyId 
          ? `File ${fileName} successfully parsed and matched to company` 
          : `File ${fileName} successfully parsed but no company match found`,
        movedTo: destinationPath,
        companyId: matchedCompanyId,
        documentId: document?.id,
        documentType: document ? (fileType === 'invoice' || parsedData.documentType?.toLowerCase() === 'invoice' ? 'invoice' : 'credit_note') : null
      };
    } else {
      // Parsing failed
      await file.update({
        status: 'failed',
        errorMessage: 'Local PDF extraction failed - no template found or extraction error'
      });
      
      // Move file to Failed folder
      const relativeSourcePath = ftpFolder ? `${ftpFolder}/${fileName}` : fileName;
      
      // Create destination path with date folder
      const dateFolder = new Date().toISOString().split('T')[0];
      destinationPath = `${folderStructure.failed}/${dateFolder}/${fileName}`;
      
      // Move file on FTP server
      try {
        await moveFile(ftpConfig, relativeSourcePath, destinationPath);
        console.log(`⚠️  Moved failed file to Failed folder: ${destinationPath}`);
        
        // Update file metadata
        await file.update({
          metadata: {
            ...file.metadata,
            ftpFailedPath: destinationPath,
            movedAt: new Date().toISOString()
          }
        });
      } catch (moveError) {
        console.error(`⚠️  Failed to move file to Failed folder: ${moveError.message}`);
      }
      
      return {
        success: false,
        status: 'failed',
        fileId: file.id,
        message: `File ${fileName} could not be parsed automatically`,
        movedTo: destinationPath
      };
    }
    
  } catch (error) {
    console.error(`❌ Error processing file ${fileName}:`, error.message);
    
    // Try to create file record with error status
    try {
      const file = await File.create({
        fileName,
        fileHash: 'error', // Placeholder
        filePath: '',
        fileSize: 0,
        status: 'failed',
        errorMessage: error.message,
        metadata: {
          ftpSource: remotePath || fileName,
          jobId: job.id
        }
      });
      
      return {
        success: false,
        status: 'failed',
        fileId: file.id,
        error: error.message
      };
    } catch (createError) {
      return {
        success: false,
        status: 'error',
        error: error.message
      };
    }
  }
}

/**
 * Parse PDF with Google Document AI
 */
async function parseWithDocumentAI(filePath) {
  if (!documentAIClient) {
    const { Settings } = require('../models');
    const settings = await Settings.getSettings();
    await initGoogleClients(settings);
    if (!documentAIClient) {
      throw new Error('Google Document AI not configured. Please enable it in Parsing Provider settings.');
    }
  }
  
  // Get settings to retrieve Document AI configuration
  const { Settings } = require('../models');
  const settings = await Settings.getSettings();
  const parsingConfig = settings.parsingProvider || {};
  
  const projectId = parsingConfig.documentai?.projectId || process.env.GOOGLE_CLOUD_PROJECT_ID;
  const location = parsingConfig.documentai?.location || process.env.GOOGLE_CLOUD_LOCATION || 'us';
  const processorId = parsingConfig.documentai?.processorId || process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID;
  
  if (!projectId || !processorId) {
    throw new Error('Google Document AI not fully configured. Please set projectId and processorId in Parsing Provider settings.');
  }
  
  const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;
  
  // Read file
  const fileContent = fs.readFileSync(filePath);
  
  const request = {
    name,
    rawDocument: {
      content: fileContent.toString('base64'),
      mimeType: 'application/pdf'
    }
  };
  
  const [result] = await documentAIClient.processDocument(request);
  const document = result.document;
  
  // Extract structured data from Document AI
  // Extract structured data from Document AI
  // Document AI provides entities which are more reliable than regex
  const parsedData = {
    fullText: document.text,
    invoiceNumber: extractInvoiceNumber(document.text),
    date: extractDate(document.text),
    amount: extractAmount(document.text),
    customerName: extractCustomerName(document.text),
    accountNumber: extractAccountNumber(document.text),
    // Additional fields
    customerPO: extractCustomerPO(document.text),
    vatAmount: extractVATAmount(document.text),
    goodsAmount: extractGoodsAmount(document.text),
    entities: document.entities || [],
    rawText: document.text
  };
  
  // Try to extract from Document AI entities if available (more reliable)
  if (document.entities && Array.isArray(document.entities)) {
    for (const entity of document.entities) {
      const type = entity.type?.toLowerCase() || '';
      const value = entity.mentionText || entity.normalizedValue?.textValue || '';
      
      if (value) {
        // Map Document AI entity types to our fields
        if (type.includes('invoice_number') || type.includes('invoice_id')) {
          parsedData.invoiceNumber = value;
        } else if (type.includes('date') || type.includes('invoice_date')) {
          parsedData.date = value;
        } else if (type.includes('total') || type.includes('amount')) {
          const amount = parseFloat(value.replace(/[^0-9.]/g, ''));
          if (!isNaN(amount)) {
            parsedData.amount = amount;
          }
        } else if (type.includes('account') || type.includes('account_number')) {
          parsedData.accountNumber = value;
        } else if (type.includes('customer') || type.includes('customer_name')) {
          parsedData.customerName = value;
        }
      }
    }
  }
  
  return parsedData;
}

/**
 * Extract invoice number from text
 * Improved patterns to handle various formats including "Invoice No.5942501"
 */
function extractInvoiceNumber(text) {
  const patterns = [
    // "Invoice No. 5942480" or "Invoice No.5942501" or "Invoice No: 5942501" or "Invoice No 5942501"
    // This pattern specifically handles the space after "No." and captures the number
    /invoice\s+no\.?\s+:?\s*(\d{4,}[A-Z0-9\-_]*)/i,
    // "Invoice #5942501" or "Invoice #: 5942501"
    /invoice\s*#\s*:?\s*([A-Z0-9\-_]+)/i,
    // "Invoice Number: 5942501" or "Invoice Number 5942501"
    /invoice\s+number\s*:?\s*([A-Z0-9\-_]+)/i,
    // "INV-5942501" or "INV 5942501"
    /(?:^|\s)(INV[-\s]?[A-Z0-9\-_]+)/i,
    // "OC1_INV_05942483" format
    /(?:^|\s)([A-Z]{2,}[-\s_]?INV[-\s_]?\d+[A-Z0-9\-_]*)/i,
    // Generic: "Invoice 5942501"
    /invoice\s+([A-Z0-9\-_]+)/i,
    // Fallback: long numeric sequences that might be invoice numbers (7+ digits)
    /(?:^|\s)(\d{7,}[A-Z0-9\-_]*)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const invoiceNum = match[1].trim();
      // Validate it looks like an invoice number
      // Must be at least 4 characters (to avoid matching "No" or short numbers)
      if (invoiceNum.length >= 4 && invoiceNum.length <= 50) {
        // Don't match if it's just "No" or common words
        if (!/^(no|yes|na|n\/a)$/i.test(invoiceNum)) {
          return invoiceNum;
        }
      }
    }
  }
  
  return null;
}

/**
 * Extract date from text
 * Handles various date formats including UK format (DD/MM/YYYY)
 */
function extractDate(text) {
  const patterns = [
    // UK format: DD/MM/YYYY or DD-MM-YYYY (most common for invoices)
    /(?:date|invoice\s+date|issue\s+date|dated?)\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    // US format: MM/DD/YYYY or YYYY-MM-DD
    /(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/,
    // UK format without label
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/,
    // Written format
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}/i,
    // Short month format
    /(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4})/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const dateStr = match[1].trim();
      // Validate it looks like a date
      if (dateStr.length >= 6 && dateStr.length <= 20) {
        return dateStr;
      }
    }
  }
  
  return null;
}

/**
 * Extract amount/total from text
 * Handles UK currency (£) and various formats
 */
function extractAmount(text) {
  const patterns = [
    // "Invoice Total£0.00" or "Invoice Total: £0.00" - most specific
    /invoice\s+total\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // "Total: £0.00" or "Total £0.00"
    /(?:^|\s)total\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // "Amount Due: £0.00"
    /(?:amount\s+due|balance\s+due|grand\s+total)\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // Currency symbol followed by amount (get the last one, usually the total)
    /[£$€]\s*([\d,]+\.?\d{2})/g
  ];
  
  // Try specific patterns first
  for (let i = 0; i < patterns.length - 1; i++) {
    const pattern = patterns[i];
    const match = text.match(pattern);
    if (match && match[1]) {
      const amountStr = match[1].trim().replace(/,/g, '');
      const amount = parseFloat(amountStr);
      if (!isNaN(amount)) {
        return amount;
      }
    }
  }
  
  // For currency pattern, get all matches and return the last one (usually the total)
  const currencyPattern = patterns[patterns.length - 1];
  const matches = [...text.matchAll(currencyPattern)];
  if (matches && matches.length > 0) {
    // Return the last match (usually the total/invoice total)
    const lastMatch = matches[matches.length - 1];
    if (lastMatch && lastMatch[1]) {
      const amountStr = lastMatch[1].trim().replace(/,/g, '');
      const amount = parseFloat(amountStr);
      if (!isNaN(amount)) {
        return amount;
      }
    }
  }
  
  return null;
}

/**
 * Extract customer name from text
 * Looks for "Bill To", "Customer", "Sold To" labels
 */
function extractCustomerName(text) {
  const patterns = [
    /(?:bill\s+to|customer|client|sold\s+to)[\s:]*\n?\s*([A-Z][A-Za-z\s&,\.\-']{2,50})/i,
    /(?:bill\s+to|customer|client)[\s:]*\n?\s*([A-Z][A-Za-z\s&,\.\-']{2,50})/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Take first line only (usually the company name)
      return name.split('\n')[0].trim();
    }
  }
  
  // Fallback: look for company-like names in first 10 lines
  const lines = text.split('\n').slice(0, 10);
  for (const line of lines) {
    const trimmed = line.trim();
    // Look for lines that look like company names (not dates, numbers, or too short)
    if (trimmed.length > 3 && trimmed.length < 50 && 
        !trimmed.match(/^\d/) && 
        !trimmed.match(/^\d{1,2}[\/\-]\d{1,2}/) && // Not a date
        !trimmed.match(/^[£$€]/)) { // Not a currency amount
      return trimmed;
    }
  }
  
  return null;
}

/**
 * Extract Customer PO (Purchase Order) from text
 * Handles both numeric POs and text-based POs like "DROP OFF"
 * Also handles cases where PO value is on a different line
 */
function extractCustomerPO(text) {
  // First, try patterns that match on the same line
  const sameLinePatterns = [
    // "Customer PO: DROP OFF" or "Customer PO: ABC123" - handles multi-word POs
    /customer\s+po\s*:?\s*([A-Z0-9\s\-_]{2,50})/i,
    // "PO Number: ABC123" or "PO: DROP OFF"
    /po\s+(?:number\s*)?:?\s*([A-Z0-9\s\-_]{2,50})/i,
    // "Purchase Order: ABC123"
    /purchase\s+order\s*:?\s*([A-Z0-9\s\-_]{2,50})/i,
    // "PO #: ABC123"
    /po\s*#?\s*:?\s*([A-Z0-9\s\-_]{2,50})/i
  ];
  
  for (const pattern of sameLinePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const po = match[1].trim();
      // Validate it looks like a PO (at least 2 chars, max 50)
      // Can contain spaces for multi-word POs like "DROP OFF"
      if (po.length >= 2 && po.length <= 50 && !/^(no|yes|na|n\/a)$/i.test(po)) {
        return po;
      }
    }
  }
  
  // If no match on same line, try to find "Customer PO:" and then look for value on next line(s)
  const poLabelMatch = text.match(/customer\s+po\s*:?\s*/i);
  if (poLabelMatch) {
    const afterLabel = text.substring(poLabelMatch.index + poLabelMatch[0].length);
    // Look for PO value in the next 200 characters (could be on next line)
    const nextSection = afterLabel.substring(0, 200);
    // Try to find a valid PO value (alphanumeric, possibly with spaces/hyphens)
    const poValueMatch = nextSection.match(/\b([A-Z0-9\s\-_]{2,50})\b/);
    if (poValueMatch && poValueMatch[1]) {
      const po = poValueMatch[1].trim();
      // Validate it's not just whitespace or common words
      if (po.length >= 2 && po.length <= 50 && 
          !/^(no|yes|na|n\/a|order|date|packing|list|number)$/i.test(po) &&
          !po.match(/^\d{1,2}[\/\-]\d{1,2}/)) { // Not a date
        return po;
      }
    }
  }
  
  // Standalone "PO ABC123" or "PO-ABC123" or "DROP OFF" near "Customer PO"
  const standaloneMatch = text.match(/(?:^|\s)(?:PO[-\s]+|)([A-Z][A-Z0-9\s\-_]{1,49})/);
  if (standaloneMatch && standaloneMatch[1]) {
    const po = standaloneMatch[1].trim();
    // Check if it's near "Customer PO" in the text
    const poIndex = text.toLowerCase().indexOf('customer po');
    const matchIndex = standaloneMatch.index;
    if (poIndex >= 0 && Math.abs(matchIndex - poIndex) < 500) {
      if (po.length >= 2 && po.length <= 50 && 
          !/^(no|yes|na|n\/a|order|date|packing|list|number|invoice|account)$/i.test(po)) {
        return po;
      }
    }
  }
  
  return null;
}

/**
 * Extract VAT Amount from text
 * Handles formats like "VAT£0.00" or "VAT: £0.00" or "VAT £0.00"
 */
function extractVATAmount(text) {
  const patterns = [
    // "VAT£0.00" or "VAT: £0.00" or "VAT £0.00"
    /vat\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // "VAT Amount: £0.00"
    /vat\s+amount\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // "Tax Amount: £0.00"
    /tax\s+amount\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // "Tax: £0.00"
    /tax\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const amountStr = match[1].replace(/,/g, '');
      const amount = parseFloat(amountStr);
      if (!isNaN(amount)) {
        return amount;
      }
    }
  }
  
  return null;
}

/**
 * Extract Goods/Subtotal Amount (before VAT) from text
 * Handles formats like "Goods£0.00" or "Goods: £0.00"
 */
function extractGoodsAmount(text) {
  const patterns = [
    // "Goods£0.00" or "Goods: £0.00" or "Goods £0.00"
    /goods\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // "Net Amount: £0.00"
    /net\s+amount\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // "Subtotal: £0.00"
    /subtotal\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i,
    // "Goods Value: £0.00"
    /goods\s+value\s*:?\s*[£$€]?\s*([\d,]+\.?\d{2})/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const amountStr = match[1].replace(/,/g, '');
      const amount = parseFloat(amountStr);
      if (!isNaN(amount)) {
        return amount;
      }
    }
  }
  
  return null;
}

/**
 * Detect supplier from filename
 */
function detectSupplierFromFilename(fileName) {
  const upperFileName = fileName.toUpperCase();
  
  // Common supplier patterns in filenames
  const suppliers = ['MAKITA', 'BOSCH', 'DEWALT', 'HILTI', 'STANLEY'];
  
  for (const supplier of suppliers) {
    if (upperFileName.includes(supplier)) {
      return supplier;
    }
  }
  
  return null;
}

/**
 * Detect supplier from text content
 */
function detectSupplierFromText(text) {
  const upperText = text.toUpperCase();
  
  // Look for supplier names in text
  const suppliers = ['MAKITA', 'BOSCH', 'DEWALT', 'HILTI', 'STANLEY'];
  
  for (const supplier of suppliers) {
    if (upperText.includes(supplier)) {
      return supplier;
    }
  }
  
  return null;
}

/**
 * Detect document type using supplier template patterns
 */
function detectDocumentTypeFromTemplate(text, template) {
  if (!template.documentTypePatterns) {
    return detectDocumentTypeFromContent(text);
  }
  
  const upperText = text.toUpperCase();
  
  // Check each document type pattern
  for (const [type, patterns] of Object.entries(template.documentTypePatterns)) {
    if (Array.isArray(patterns)) {
      for (const pattern of patterns) {
        if (upperText.includes(pattern.toUpperCase())) {
          return type; // 'invoice', 'credit_note', 'statement'
        }
      }
    }
  }
  
  // Fallback to content-based detection
  return detectDocumentTypeFromContent(text);
}

/**
 * Detect document type from PDF content
 * Looks for keywords in the document text to determine if it's an invoice, credit note, or statement
 */
function detectDocumentTypeFromContent(text) {
  const upperText = text.toUpperCase();
  
  // Check for credit note indicators (most specific first)
  if (upperText.includes('CREDIT NOTE') || 
      upperText.includes('CREDITNOTE') ||
      upperText.includes('CREDIT NOTE') ||
      (upperText.includes('CREDIT') && upperText.includes('NOTE'))) {
    return 'credit_note';
  }
  
  // Check for statement indicators
  if (upperText.includes('STATEMENT') || 
      upperText.includes('ACCOUNT STATEMENT') ||
      upperText.includes('STATEMENT OF ACCOUNT')) {
    return 'statement';
  }
  
  // Check for invoice indicators
  if (upperText.includes('INVOICE') || 
      upperText.includes('TAX INVOICE') ||
      upperText.includes('INVOICE NUMBER')) {
    return 'invoice';
  }
  
  // Default to invoice if no clear indicator (most common document type)
  return 'invoice';
}

/**
 * Extract account number from text
 * Looks for common patterns like "Account Number:", "Account:", "Acc No:", etc.
 * IMPORTANT: Excludes bank account numbers (usually longer, near "Bank Details")
 */
function extractAccountNumber(text) {
  // First, try to find customer account number (usually shorter, near top)
  // Exclude bank account numbers which are usually longer and near "Bank Details"
  const bankAccountSection = text.toLowerCase().indexOf('bank details');
  const textBeforeBank = bankAccountSection > 0 ? text.substring(0, bankAccountSection) : text;
  
  const patterns = [
    // "Account No.: 999999" or "Account No.999401" or "Account No: 999401" or "Account No 999401"
    // This pattern handles the colon after "No." and captures the number
    /account\s+no\.?\s*:?\s*(\d{4,}[A-Z0-9\-]*)/i,
    // "Account #999401" or "Account #: 999401"
    /account\s*#\s*:?\s*([A-Z0-9\-]+)/i,
    // "Account Number: 999401" or "Account Number 999401"
    /account\s+number\s*:?\s*([A-Z0-9\-]+)/i,
    // "Acc No.999401" or "Acc No: 999401"
    /acc\s+no\.?\s*:?\s*(\d+[A-Z0-9\-]*)/i,
    // "Account Code: 999401"
    /account\s+code\s*:?\s*([A-Z0-9\-]+)/i,
    // "Customer Account: 999401"
    /customer\s+account\s*:?\s*([A-Z0-9\-]+)/i,
    // "Account ID: 999401"
    /account\s+id\s*:?\s*([A-Z0-9\-]+)/i
  ];
  
  // Search in text before bank details section first (customer account is usually at top)
  for (const pattern of patterns) {
    const match = textBeforeBank.match(pattern);
    if (match && match[1]) {
      const accountNumber = match[1].trim();
      // Validate it looks like an account number
      // Must be at least 4 characters (to avoid matching "No")
      // Usually customer accounts are shorter than bank accounts
      if (accountNumber.length >= 4 && accountNumber.length <= 20) {
        // Don't match if it's just "No" or common words
        if (!/^(no|yes|na|n\/a)$/i.test(accountNumber)) {
          return accountNumber;
        }
      }
    }
  }
  
  // Try to find account number in common positions (near top of document, before bank details)
  const lines = textBeforeBank.split('\n').slice(0, 20); // Check first 20 lines
  for (const line of lines) {
    // Look for lines that might contain account numbers
    // Pattern: alphanumeric, usually starts with letters then numbers
    const accountMatch = line.match(/\b([A-Z0-9]{4,20})\b/);
    if (accountMatch && accountMatch[1]) {
      const potentialAccount = accountMatch[1];
      // Check if line contains account-related keywords
      if ((line.toLowerCase().includes('account') || line.toLowerCase().includes('acc')) &&
          !line.toLowerCase().includes('bank')) {
        // Validate it looks like an account number (not just numbers, reasonable length)
        if (potentialAccount.length >= 4 && potentialAccount.length <= 20) {
          return potentialAccount;
        }
      }
    }
  }
  
  return null;
}


module.exports = {
  processFileImport,
  initGoogleClients,
  parseWithDocumentAI,
  detectDocumentTypeFromContent,
  extractAccountNumber
};

