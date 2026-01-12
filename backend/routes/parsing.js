const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { Settings } = require('../models');
const globalAdmin = require('../middleware/globalAdmin');
const router = express.Router();
const { bulkParsingQueue } = require('../config/queue');
const bulkTestStore = require('../utils/bulkTestStore');
const { listFiles, downloadFile } = require('../utils/ftp');

// Storage configuration
const { ensureStorageDirs, getStorageDir } = require('../config/storage');
ensureStorageDirs();
const testUploadsDir = getStorageDir('test');
const tempUploadsDir = getStorageDir('temp');

// Configure multer for PDF uploads with preserved file extensions
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, testUploadsDir);
  },
  filename: (req, file, cb) => {
    // Preserve the original filename and extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `test-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept PDF and Excel files
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedMimes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'application/excel'
    ];
    const allowedExts = ['.pdf', '.xlsx', '.xls'];
    
    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and Excel files (.pdf, .xlsx, .xls) are allowed!'), false);
    }
  }
});

// Multer configuration for bulk uploads (temp storage)
const bulkStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempUploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `bulk-test-${uniqueSuffix}${ext}`);
  }
});

const bulkUpload = multer({
  storage: bulkStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 100 // Max 100 files
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.pdf', '.xlsx', '.xls'];
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and Excel files (.pdf, .xlsx, .xls) are allowed!'), false);
    }
  }
});


/**
 * Helper function to detect document type from content
 */
function detectDocumentTypeFromContent(text) {
  const textUpper = text.toUpperCase();
  
  // Most specific first: "CREDIT NOTE" (two words together)
  if (textUpper.includes('CREDIT NOTE') || textUpper.includes('CREDITNOTE')) {
    return 'credit_note';
  }
  // Check for statement indicators
  else if (textUpper.includes('STATEMENT') || textUpper.includes('ACCOUNT STATEMENT') || textUpper.includes('STATEMENT OF ACCOUNT')) {
    return 'statement';
  }
  // Check for invoice indicators (explicit check)
  else if (textUpper.includes('INVOICE') || textUpper.includes('TAX INVOICE') || textUpper.includes('INVOICE NUMBER')) {
    return 'invoice';
  }
  // Less specific: standalone "CREDIT" (but only if not already detected as invoice)
  else if (textUpper.includes('CREDIT') && !textUpper.includes('INVOICE')) {
    // Additional check: if it has "CN" or "CREDIT NOTE" pattern
    if (textUpper.includes(' CN ') || textUpper.match(/\bCN\b/) || textUpper.includes('CREDIT NOTE')) {
      return 'credit_note';
    } else {
      return 'invoice'; // Default to invoice (most common)
    }
  }
  // Default to invoice (most common document type)
  else {
    return 'invoice';
  }
}

/**
 * Test Google Document AI connection
 */
router.post('/test-documentai', globalAdmin, async (req, res) => {
  try {
    const { testDocumentAIConnection } = require('../utils/parsing');
    const settings = await Settings.getSettings();
    
    const documentAIConfig = settings.parsingProvider?.documentai || {};
    
    const result = await testDocumentAIConnection(documentAIConfig);
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        details: result.details
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message,
        error: result.error,
        suggestion: result.suggestion
      });
    }
  } catch (error) {
    console.error('Document AI test error:', error);
    res.status(500).json({
      success: false,
      message: 'Error testing Document AI connection: ' + error.message
    });
  }
});

/**
 * Test PDF parsing with local coordinate-based templates
 */
router.post('/test-parse', globalAdmin, upload.single('file'), async (req, res) => {
  // Set a longer timeout for parsing operations (5 minutes)
  req.setTimeout(5 * 60 * 1000);
  res.setTimeout(5 * 60 * 1000);
  
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: 'No file uploaded. Please select a file to test.',
      error: 'No file provided in request'
    });
  }

  const filePath = req.file.path;
  const fileExt = path.extname(req.file.originalname).toLowerCase();
  const isExcel = ['.xlsx', '.xls', '.csv'].includes(fileExt);
  const parser = req.body.parser || 'local'; // 'local', 'documentai', or 'auto'
  
  // Handle Excel files
  if (isExcel) {
    try {
      const { extractFieldsFromExcel } = require('../utils/excelParser');
      const { Template } = require('../models');
      
      let template = null;
      
      // Check if template is provided in request body (for testing)
      if (req.body.template) {
        try {
          const templateData = typeof req.body.template === 'string' ? JSON.parse(req.body.template) : req.body.template;
          if (templateData.excelCells && Object.keys(templateData.excelCells).length > 0) {
            // Use provided template for testing
            template = {
              excelCells: templateData.excelCells,
              fileType: 'excel',
              name: 'Test Template'
            };
            console.log(`📊 Using test template from request body`);
          }
        } catch (e) {
          console.warn('Error parsing template from request body:', e);
        }
      }
      
      // If no template in request, find the Excel template (only one allowed)
      if (!template) {
        template = await Template.findTemplateByFileType('excel');
        
        if (!template) {
          fs.unlinkSync(filePath);
          return res.status(400).json({
            success: false,
            message: 'No Excel template found. Please create an Excel template first in Templates section.',
            suggestion: 'Go to Templates → Add Excel Template to create a template with cell mappings.'
          });
        }
        
        console.log(`📊 Using Excel template from database: ${template.name} (code: ${template.code})`);
      }
      
      const parsedData = await extractFieldsFromExcel(filePath, template);
      
      fs.unlinkSync(filePath);
      
      return res.json({
        success: true,
        message: `Successfully parsed Excel file using template "${template.name || 'Test Template'}"`,
        results: {
          processingMethod: 'excel_template',
          template: template.name || 'Test Template',
          confidence: (() => {
            const { calculateConfidence } = require('../utils/confidenceCalculator');
            return calculateConfidence({
              parsedData,
              template,
              ocrConfidence: null,
              fullText: parsedData?.fullText || '',
              processingMethod: 'excel_template'
            });
          })(),
          parsedData: parsedData || {},
          fullText: parsedData?.fullText || 'No text extracted',
          // Only return fields that were actually extracted (not all possible fields)
          extractedFields: parsedData || {},
          textLength: parsedData?.fullText?.length || 0,
          wordCount: parsedData?.fullText?.split(/\s+/).filter(word => word.length > 0).length || 0
        }
      });
    } catch (error) {
      console.error('❌ Excel parsing failed:', error);
      console.error('Error stack:', error.stack);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (unlinkError) {
          console.error('Error deleting temp file:', unlinkError);
        }
      }
      return res.status(500).json({
        success: false,
        message: `Excel parsing failed: ${error.message}`,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
    // If Excel file was processed, we already returned, so this won't execute
    return;
  }
  
  // Handle PDF files (existing code)
  // Wrap in try-catch to prevent unhandled promise rejections
  try {
    const settings = await Settings.getSettings();
    let parsedData = null;
    let processingMethod = 'local_coordinates';
    let fullText = '';
    
    // Handle Document AI parsing
    if (parser === 'documentai' || (parser === 'auto' && !parsedData)) {
      try {
        const documentAIConfig = settings.parsingProvider?.documentai || {};
        if (!documentAIConfig.enabled && parser === 'documentai') {
          throw new Error('Google Document AI is not enabled. Please enable it in Settings → Parsing Provider.');
        }
        
        if (documentAIConfig.enabled) {
          console.log('🔍 Attempting Google Document AI extraction...');
          const { parseWithDocumentAI } = require('../jobs/fileImport');
          
          // parseWithDocumentAI takes a file path string
          parsedData = await parseWithDocumentAI(filePath);
          processingMethod = 'document_ai';
          fullText = parsedData?.fullText || parsedData?.rawText || '';
          
          if (parsedData && fullText) {
            console.log(`✅ Document AI extracted ${fullText.length} characters`);
            // If parser is 'documentai', return early
            if (parser === 'documentai') {
              fs.unlinkSync(filePath);
              return res.json({
                success: true,
                message: `Successfully parsed PDF using Google Document AI`,
                results: {
                  processingMethod,
                  confidence: (() => {
                    const { calculateConfidence } = require('../utils/confidenceCalculator');
                    return calculateConfidence({
                      parsedData,
                      template: null,
                      ocrConfidence: parsedData?.ocrConfidence || 0.90,
                      fullText,
                      processingMethod: 'document_ai'
                    });
                  })(),
                  parsedData: parsedData || {},
                  fullText: fullText || 'No text extracted',
                  extractedFields: {
                    documentType: parsedData?.documentType || null,
                    invoiceNumber: parsedData?.invoiceNumber || null,
                    date: parsedData?.date || null,
                    amount: parsedData?.amount || null,
                    customerName: parsedData?.customerName || null,
                    accountNumber: parsedData?.accountNumber || null
                  },
                  textLength: fullText.length,
                  wordCount: fullText.split(/\s+/).filter(word => word.length > 0).length
                }
              });
            }
          }
        }
      } catch (documentAIError) {
        console.error('❌ Document AI extraction failed:', documentAIError.message);
        if (parser === 'documentai') {
          throw documentAIError;
        }
        // If auto mode, fall through to local extraction
      }
    }
    
    // Use local coordinate-based extraction (primary method or fallback)
    let usedTemplate = null; // Store template used for confidence calculation
    if (parser === 'local' || (parser === 'auto' && !parsedData)) {
      try {
        console.log('🔍 Attempting local PDF extraction with coordinate templates...');
        const { Template } = require('../models');
        
        const pdfBuffer = fs.readFileSync(filePath);
        
        // Strategy: Try to detect document type first, then use appropriate template
        // If detection fails, try all templates and use the one that works best
        let template = null;
        let detectedDocType = null;
        
        // Check if template is provided in request body (for testing unsaved templates)
        if (req.body.template) {
          try {
            const templateData = typeof req.body.template === 'string' ? JSON.parse(req.body.template) : req.body.template;
            if (templateData.coordinates && Object.keys(templateData.coordinates).length > 0) {
              // Use provided template for testing
              template = {
                id: null,
                code: templateData.code || 'test_template',
                name: templateData.name || 'Test Template',
                templateType: templateData.templateType || 'invoice',
                fileType: 'pdf',
                coordinates: templateData.coordinates,
                isDefault: false
              };
              console.log(`📊 Using test PDF template from request body: ${template.name}`);
              console.log(`   Template has ${Object.keys(template.coordinates).length} fields configured`);
            }
          } catch (e) {
            console.warn('Error parsing PDF template from request body:', e);
          }
        }
        
        // Only search for templates from database if not provided in request body
        if (!template) {
          // Step 1: Quick document type detection using basic text extraction
          try {
            const { extractTextFromPDF } = require('../utils/pdfExtractor');
            const quickText = await extractTextFromPDF(filePath);
            if (quickText && quickText.length > 0) {
              detectedDocType = detectDocumentTypeFromContent(quickText);
              console.log(`📄 Detected document type: ${detectedDocType} (from quick text scan)`);
            }
          } catch (detectError) {
            console.warn(`⚠️  Could not detect document type: ${detectError.message}`);
          }
          
          // Step 2: Try to find default template matching detected type
          if (detectedDocType) {
            template = await Template.findDefaultTemplate('pdf', detectedDocType);
            if (template && template.templateType === detectedDocType) {
              console.log(`✅ Found DEFAULT template for detected type: ${template.name} (ID: ${template.id}, Type: ${template.templateType})`);
            } else if (template) {
              console.error(`❌ Template type mismatch! Rejecting.`);
              template = null;
            }
          }
          
          // Step 3: If no default template found for detected type, try any template of the correct type
          if (!template && detectedDocType) {
            template = await Template.findTemplateByFileType('pdf', detectedDocType);
            if (template) {
              console.log(`⚠️  Using non-default template for ${detectedDocType}: ${template.name} (ID: ${template.id}, Type: ${template.templateType})`);
            }
          }
          
          // Step 4: If detection failed or no template found, try to find default template for 'invoice' (most common)
          if (!template) {
            console.log(`⚠️  Document type detection failed or no template found. Trying default invoice template...`);
            template = await Template.findDefaultTemplate('pdf', 'invoice');
            if (template) {
              console.log(`✅ Using DEFAULT invoice template: ${template.name} (ID: ${template.id}, Type: ${template.templateType})`);
            }
          }
          
          // Step 5: Last resort - find any enabled PDF template
          if (!template) {
            template = await Template.findTemplateByFileType('pdf');
            if (template) {
              console.log(`⚠️  Using any available PDF template: ${template.name} (ID: ${template.id}, Type: ${template.templateType})`);
            }
          }
          
          // Final check - if still no template, log error
          if (!template) {
            console.error(`❌ CRITICAL: No PDF template found.`);
            console.error(`   Detected type: ${detectedDocType || 'null'}`);
            console.error(`   This document cannot be processed correctly. Please create a default template.`);
          }
        }
        
        if (!template) {
          console.log(`⚠️  No PDF template found. Please create a PDF template in Templates section.`);
          // Fallback to basic extraction
          const { extractInvoiceData } = require('../utils/pdfExtractor');
          parsedData = await extractInvoiceData(filePath);
          processingMethod = 'local_basic';
          if (parsedData && parsedData.fullText) {
            fullText = parsedData.fullText;
          }
        } else {
          console.log(`✅ Using PDF template: ${template.name} (ID: ${template.id})`);
          console.log(`   Template code: ${template.code}`);
          console.log(`   Template type: ${template.templateType}`);
          console.log(`   Template isDefault: ${template.isDefault}`);
          console.log(`   Template has ${Object.keys(template.coordinates || {}).length} fields configured`);
          
          // Use coordinate-based extraction (this extracts only the defined fields)
          parsedData = await Template.extractFieldsFromCoordinates(pdfBuffer, template);
          processingMethod = `local_coordinates_${template.code}`;
          
          // Add template info to parsedData for frontend display
          if (parsedData) {
            parsedData.templateId = template.id;
            parsedData.templateName = template.name;
            parsedData.templateCode = template.code;
          }
          
          // Use fullText from coordinate extraction (which contains only extracted field values)
          // This ensures we only show the data from template-defined regions, not all PDF text
          if (parsedData && parsedData.fullText) {
            fullText = parsedData.fullText; // This now contains only extracted field values, not all PDF text
          } else {
            // Create a summary from extracted fields using display names from template
            const { STANDARD_FIELDS } = require('../utils/standardFields');
            const extractedFieldsList = Object.entries(parsedData || {})
              .filter(([key]) => key !== 'fullText' && key !== 'fieldLabels' && key !== 'templateId' && key !== 'templateName' && parsedData[key] !== null)
              .map(([key, value]) => {
                const fieldDef = STANDARD_FIELDS[key];
                const displayName = fieldDef ? fieldDef.displayName : key;
                return `${displayName}: ${value}`;
              })
              .join('\n');
            fullText = extractedFieldsList || 'No fields extracted from template coordinates';
          }
          
          console.log(`✅ Extracted fields using coordinate template`);
          console.log(`   Extracted data:`, JSON.stringify(parsedData, null, 2));
          
          // Store template for confidence calculation
          usedTemplate = template;
          
          // If we detected a different document type than the template, warn the user
          if (detectedDocType && template.templateType !== detectedDocType) {
            console.warn(`⚠️  Document type mismatch: Detected ${detectedDocType} but using ${template.templateType} template`);
            parsedData._warning = `Document appears to be a ${detectedDocType} but ${template.templateType} template was used. Results may be inaccurate.`;
          }
        }
      } catch (localError) {
        console.error('❌ Local extraction failed:', localError.message);
        throw localError;
      }
    }

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    // Calculate confidence score using improved algorithm
    const { calculateConfidence } = require('../utils/confidenceCalculator');
    
    const confidenceScore = calculateConfidence({
      parsedData,
      template: usedTemplate, // Use the template that was actually used for extraction
      ocrConfidence: parsedData?.ocrConfidence || null, // OCR providers may return this
      fullText,
      processingMethod
    });
    
    // Build extractedFields object with all extracted values (excluding metadata)
    const extractedFields = {};
    const fieldLabels = parsedData?.fieldLabels || {};
    
    if (parsedData) {
      // Include all extracted fields except metadata
      Object.keys(parsedData).forEach(key => {
        if (key !== 'fullText' && key !== 'fieldLabels') {
          extractedFields[key] = parsedData[key];
        }
      });
    }
    
    res.json({
      success: true,
      message: `Successfully parsed PDF using ${processingMethod}`,
      results: {
        processingMethod,
        confidence: confidenceScore,
        templateId: usedTemplate?.id || parsedData?.templateId || null,
        templateName: usedTemplate?.name || parsedData?.templateName || null,
        templateCode: usedTemplate?.code || parsedData?.templateCode || null,
        parsedData: parsedData || {},
        fullText: fullText || 'No text extracted',
        extractedFields: extractedFields, // All extracted fields
        fieldLabels: fieldLabels, // Original field labels from template: { mappedField: label }
        textLength: fullText.length,
        wordCount: fullText.split(/\s+/).filter(word => word.length > 0).length
      }
    });
  } catch (parseError) {
    // Clean up uploaded file
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (cleanupError) {
      console.error('   Failed to cleanup file:', cleanupError.message);
    }
    
    console.error('❌ Parse error:', parseError);
    console.error('   Message:', parseError.message);
    console.error('   Stack:', parseError.stack);
    
    // Make sure we send a response even if there was an error
    // Check if response was already sent to avoid "Cannot set headers after they are sent" error
    if (!res.headersSent) {
      try {
        res.status(400).json({
          success: false,
          message: `Failed to parse PDF: ${parseError.message}`,
          error: parseError.message,
          processingMethod: 'none',
          suggestion: 'Please create a template in Settings → Templates for this document type.'
        });
      } catch (responseError) {
        console.error('   Failed to send error response:', responseError.message);
      }
    } else {
      console.error('   Response already sent, cannot send error response');
    }
  }
});

/**
 * Bulk parsing test - upload multiple files (max 100)
 */
router.post('/test-parse-bulk', globalAdmin, bulkUpload.array('files', 100), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No files uploaded. Please select at least one file.',
        error: 'No files provided'
      });
    }

    // Limit to 100 files
    if (req.files.length > 100) {
      // Delete uploaded files
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
      return res.status(400).json({
        success: false,
        message: 'Maximum 100 files allowed for bulk testing.',
        error: 'Too many files'
      });
    }

    const parser = req.body.parser || 'local';
    const testId = uuidv4();

    // Collect all file paths for cleanup
    const filePaths = req.files.map(file => file.path);

    // Create test session with all file paths
    const test = bulkTestStore.createTest(testId, req.files.length, filePaths);

    // Get user email for notification
    const userEmail = req.user?.email || null;
    
    // Add files to queue (BullMQ format: name, data, options)
    const jobPromises = req.files.map(file => {
      return bulkParsingQueue.add('bulk-parse', {
        testId,
        filePath: file.path,
        fileName: file.originalname,
        parser,
        userEmail // Include user email for notification
      }, {
        jobId: `${testId}-${path.basename(file.path)}`
      });
    });

    // Wait for all jobs to be added
    await Promise.all(jobPromises);

    console.log(`✅ Added ${req.files.length} files to bulk parsing queue (testId: ${testId})`);

    res.json({
      success: true,
      testId,
      message: `Processing ${req.files.length} file(s)`,
      totalFiles: req.files.length
    });
  } catch (error) {
    console.error('Bulk parsing test error:', error);
    
    // Clean up uploaded files on error
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          try {
            fs.unlinkSync(file.path);
          } catch (unlinkError) {
            console.error('Error deleting file:', unlinkError);
          }
        }
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error starting bulk parsing test: ' + error.message
    });
  }
});

/**
 * Get bulk test status
 */
router.get('/test-parse-bulk/:testId', globalAdmin, async (req, res) => {
  try {
    const { testId } = req.params;
    const test = bulkTestStore.getTest(testId);

    if (!test) {
      return res.status(404).json({
        success: false,
        message: 'Test not found'
      });
    }

    res.json({
      success: true,
      test: {
        testId: test.testId,
        totalFiles: test.totalFiles,
        processedFiles: test.processedFiles,
        status: test.status,
        createdAt: test.createdAt,
        completedAt: test.completedAt,
        progress: Math.round((test.processedFiles / test.totalFiles) * 100)
      }
    });
  } catch (error) {
    console.error('Error getting bulk test status:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting test status: ' + error.message
    });
  }
});

/**
 * Get bulk test results
 */
router.get('/test-parse-bulk/:testId/results', globalAdmin, async (req, res) => {
  try {
    const { testId } = req.params;
    const test = bulkTestStore.getTest(testId);

    if (!test) {
      return res.status(404).json({
        success: false,
        message: 'Test not found'
      });
    }

    // Calculate summary statistics
    const successful = test.results.filter(r => r.success).length;
    const failed = test.results.filter(r => !r.success).length;
    const totalProcessingTime = test.results.reduce((sum, r) => sum + (r.processingTime || 0), 0);
    const avgProcessingTime = test.results.length > 0 ? totalProcessingTime / test.results.length : 0;
    const avgConfidence = test.results.length > 0
      ? test.results.filter(r => r.success).reduce((sum, r) => sum + (r.confidence || 0), 0) / successful
      : 0;

    res.json({
      success: true,
      test: {
        testId: test.testId,
        totalFiles: test.totalFiles,
        processedFiles: test.processedFiles,
        status: test.status,
        createdAt: test.createdAt,
        completedAt: test.completedAt,
        summary: {
          filesImported: test.totalFiles,
          filesParsed: successful,
          filesCompleted: test.processedFiles,
          filesFailed: failed,
          avgConfidence: Math.round(avgConfidence),
          avgProcessingTime: Math.round(avgProcessingTime),
          totalProcessingTime: Math.round(totalProcessingTime)
        },
        source: test.source || 'upload', // Include source in results
        results: test.results
      }
    });
  } catch (error) {
    console.error('Error getting bulk test results:', error);
    res.status(500).json({
      success: false,
      message: 'Error getting test results: ' + error.message
    });
  }
});

/**
 * Finish bulk test - delete test and all temp files
 */
router.delete('/test-parse-bulk/:testId', globalAdmin, async (req, res) => {
  try {
    const { testId } = req.params;
    
    // Get test info before deleting (for orphan cleanup)
    const testBeforeDelete = bulkTestStore.getTest(testId);
    const testCreatedAt = testBeforeDelete ? new Date(testBeforeDelete.createdAt) : new Date();
    const testSource = testBeforeDelete?.source || 'upload'; // 'upload' or 'ftp'
    
    // Delete test and get file paths
    const filePaths = bulkTestStore.deleteTest(testId);
    
    // Only delete files if they came from FTP (downloaded files)
    // For uploaded files, we still delete them as they're temp test files
    // But we make it clear in the response

    // Delete all temp files
    let deletedCount = 0;
    let errorCount = 0;

    for (const filePath of filePaths) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deletedCount++;
          console.log(`✅ Deleted temp file: ${filePath}`);
        } else {
          console.log(`⚠️  File not found (may have been deleted already): ${filePath}`);
        }
      } catch (error) {
        console.error(`❌ Error deleting file ${filePath}:`, error.message);
        errorCount++;
      }
    }

    // Also clean up any orphaned files in temp directory that match the test pattern
    // (in case some files weren't tracked properly)
    try {
      const tempDir = getStorageDir('temp');
      if (fs.existsSync(tempDir)) {
        const files = fs.readdirSync(tempDir);
        const testFilePattern = /^bulk-test-/;
        let orphanedDeleted = 0;
        
        for (const file of files) {
          if (testFilePattern.test(file)) {
            const orphanedPath = path.join(tempDir, file);
            try {
              if (fs.existsSync(orphanedPath)) {
                const stats = fs.statSync(orphanedPath);
                // Check if file was created around the same time as the test (within 10 minutes)
                const fileAge = Math.abs(stats.birthtime.getTime() - testCreatedAt.getTime());
                if (fileAge < 10 * 60 * 1000) {
                  fs.unlinkSync(orphanedPath);
                  orphanedDeleted++;
                  console.log(`✅ Deleted orphaned temp file: ${orphanedPath}`);
                }
              }
            } catch (error) {
              // File might have been deleted, ignore
            }
          }
        }
        
        if (orphanedDeleted > 0) {
          console.log(`🧹 Cleaned up ${orphanedDeleted} orphaned file(s) for test ${testId}`);
        }
      }
    } catch (error) {
      // Ignore errors in orphan cleanup (directory might not exist, etc.)
      console.log('Note: Could not check for orphaned files:', error.message);
    }

    const sourceMessage = testSource === 'ftp' 
      ? `FTP bulk test finished. Deleted ${deletedCount} downloaded file(s).`
      : `Bulk test finished. Deleted ${deletedCount} file(s).`;

    res.json({
      success: true,
      message: sourceMessage,
      deletedFiles: deletedCount,
      errors: errorCount > 0 ? `${errorCount} file(s) could not be deleted` : null,
      source: testSource
    });
  } catch (error) {
    console.error('Error finishing bulk test:', error);
    res.status(500).json({
      success: false,
      message: 'Error finishing test: ' + error.message
    });
  }
});

/**
 * Connect to FTP and list available files (PDF or Excel) - preview before parsing
 */
router.post('/test-ftp-connect', globalAdmin, async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    
    if (!settings.ftp || !settings.ftp.enabled) {
      return res.status(400).json({
        success: false,
        message: 'FTP is not enabled. Please enable and configure FTP settings first.'
      });
    }

    const fileType = req.body.fileType || 'pdf'; // 'pdf' or 'excel'
    console.log(`🔍 FTP Connect: Requested file type: ${fileType}`);

    // Test FTP connection
    const { testConnection } = require('../utils/ftp');
    const connectionTest = await testConnection(settings.ftp);
    if (!connectionTest.success) {
      return res.status(400).json({
        success: false,
        message: 'FTP connection failed: ' + connectionTest.message
      });
    }

    // List files from FTP
    const ftpFiles = await listFiles(settings.ftp);
    console.log(`📁 Listed ${ftpFiles.length} total files from FTP`);
    
    // Filter files based on type
    let filteredFiles = [];
    if (fileType === 'pdf') {
      filteredFiles = ftpFiles.filter(file => {
        const ext = path.extname(file.name).toLowerCase();
        return ext === '.pdf' && !file.name.startsWith('.');
      });
      console.log(`📄 Filtered ${filteredFiles.length} PDF files from ${ftpFiles.length} total files`);
    } else if (fileType === 'excel') {
      filteredFiles = ftpFiles.filter(file => {
        const ext = path.extname(file.name).toLowerCase();
        return (ext === '.xlsx' || ext === '.xls') && !file.name.startsWith('.');
      });
      console.log(`📊 Filtered ${filteredFiles.length} Excel files (.xlsx/.xls) from ${ftpFiles.length} total files`);
    }

    // Return connection status and file list
    const fileTypeLabel = fileType === 'pdf' ? 'PDF' : 'Excel';
    const fileKey = fileType === 'pdf' ? 'pdfFiles' : 'excelFiles';
    const totalKey = fileType === 'pdf' ? 'totalPdfFiles' : 'totalExcelFiles';

    res.json({
      success: true,
      connected: true,
      fileType: fileType,
      [totalKey]: filteredFiles.length,
      [fileKey]: filteredFiles.slice(0, 100).map(file => ({
        name: file.name,
        size: file.size || 0,
        modified: file.date || null
      })),
      message: `Connected to FTP server. Found ${filteredFiles.length} ${fileTypeLabel} file(s).`
    });
  } catch (error) {
    console.error('FTP connection test error:', error);
    res.status(500).json({
      success: false,
      connected: false,
      message: 'Error connecting to FTP: ' + error.message
    });
  }
});

/**
 * FTP Bulk parsing test - download files from FTP and test parsing (max 100)
 */
router.post('/test-parse-bulk-ftp', globalAdmin, async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    
    if (!settings.ftp || !settings.ftp.enabled) {
      return res.status(400).json({
        success: false,
        message: 'FTP is not enabled. Please enable and configure FTP settings first.'
      });
    }

    const parser = req.body.parser || 'local';
    const maxFiles = Math.min(parseInt(req.body.maxFiles) || 100, 100); // Limit to 100
    const fileType = req.body.fileType || 'pdf'; // 'pdf' or 'excel'
    const testId = uuidv4();

    // Test FTP connection first
    const { testConnection } = require('../utils/ftp');
    const connectionTest = await testConnection(settings.ftp);
    if (!connectionTest.success) {
      return res.status(400).json({
        success: false,
        message: 'FTP connection failed: ' + connectionTest.message
      });
    }

    // List files from FTP
    const ftpFiles = await listFiles(settings.ftp);
    
    // Filter files based on type
    let filteredFiles = [];
    if (fileType === 'pdf') {
      filteredFiles = ftpFiles.filter(file => {
        const ext = path.extname(file.name).toLowerCase();
        return ext === '.pdf' && !file.name.startsWith('.');
      });
    } else if (fileType === 'excel') {
      filteredFiles = ftpFiles.filter(file => {
        const ext = path.extname(file.name).toLowerCase();
        return (ext === '.xlsx' || ext === '.xls') && !file.name.startsWith('.');
      });
    }

    const fileTypeLabel = fileType === 'pdf' ? 'PDF' : 'Excel';
    if (filteredFiles.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No ${fileTypeLabel} files found on FTP server.`
      });
    }

    // Limit to maxFiles
    const filesToDownload = filteredFiles.slice(0, maxFiles);
    const tempDir = getStorageDir('temp');
    const downloadedFiles = [];
    const filePaths = [];

    // Download files from FTP
    console.log(`📥 Downloading ${filesToDownload.length} PDF files from FTP for bulk test...`);
    for (const ftpFile of filesToDownload) {
      try {
        const localFileName = `ftp-test-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(ftpFile.name)}`;
        const localPath = path.join(tempDir, localFileName);
        
        const downloadResult = await downloadFile(settings.ftp, ftpFile.name, localPath);
        
        if (downloadResult.success) {
          downloadedFiles.push({
            name: ftpFile.name,
            path: localPath,
            size: ftpFile.size || 0
          });
          filePaths.push(localPath);
        } else {
          console.error(`Failed to download ${ftpFile.name}:`, downloadResult.error);
        }
      } catch (error) {
        console.error(`Error downloading ${ftpFile.name}:`, error.message);
      }
    }

    if (downloadedFiles.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'Failed to download any files from FTP server.'
      });
    }

    // Get user email for notification
    const userEmail = req.user?.email || null;

    // Create test session with FTP source
    const test = bulkTestStore.createTest(testId, downloadedFiles.length, filePaths, 'ftp');

    // Add files to queue (BullMQ format: name, data, options)
    const jobPromises = downloadedFiles.map(file => {
      return bulkParsingQueue.add('bulk-parse', {
        testId,
        filePath: file.path,
        fileName: file.name,
        parser,
        userEmail,
        source: 'ftp' // Mark as FTP source
      }, {
        jobId: `${testId}-${path.basename(file.path)}`
      });
    });

    // Wait for all jobs to be added
    await Promise.all(jobPromises);

    console.log(`✅ Added ${downloadedFiles.length} ${fileTypeLabel} files from FTP to bulk parsing queue (testId: ${testId})`);

    res.json({
      success: true,
      testId,
      message: `Processing ${downloadedFiles.length} ${fileTypeLabel} file(s) from FTP`,
      totalFiles: downloadedFiles.length,
      source: 'ftp',
      fileType: fileType
    });
  } catch (error) {
    console.error('FTP bulk parsing test error:', error);
    res.status(500).json({
      success: false,
      message: 'Error starting FTP bulk parsing test: ' + error.message
    });
  }
});

/**
 * Manually clean temp folder (delete all files in temp directory)
 */
router.delete('/clean-temp-folder', globalAdmin, async (req, res) => {
  try {
    const tempDir = getStorageDir('temp');
    
    if (!fs.existsSync(tempDir)) {
      return res.json({
        success: true,
        message: 'Temp folder does not exist',
        deletedFiles: 0
      });
    }

    const files = fs.readdirSync(tempDir);
    let deletedCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const file of files) {
      const filePath = path.join(tempDir, file);
      try {
        const stats = fs.statSync(filePath);
        
        // Only delete files, not directories
        if (stats.isFile()) {
          fs.unlinkSync(filePath);
          deletedCount++;
          console.log(`✅ Deleted temp file: ${filePath}`);
        } else {
          console.log(`⚠️  Skipping directory: ${filePath}`);
        }
      } catch (error) {
        console.error(`❌ Error deleting file ${filePath}:`, error.message);
        errorCount++;
        errors.push({ file, error: error.message });
      }
    }

    const message = deletedCount > 0
      ? `Cleaned temp folder: Deleted ${deletedCount} file(s)${errorCount > 0 ? `, ${errorCount} error(s)` : ''}`
      : 'Temp folder is already empty';

    res.json({
      success: true,
      message,
      deletedFiles: deletedCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error cleaning temp folder:', error);
    res.status(500).json({
      success: false,
      message: 'Error cleaning temp folder: ' + error.message
    });
  }
});

module.exports = router;
