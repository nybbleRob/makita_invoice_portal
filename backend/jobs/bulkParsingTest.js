/**
 * Bulk Parsing Test Job Processor
 * Processes individual PDF files for bulk testing
 */

const fs = require('fs');
const path = require('path');
const { Template } = require('../models');
const { extractTextFromPDF } = require('../utils/pdfExtractor');

/**
 * Process a single PDF file for bulk testing
 * @param {Object} job - Bull job object
 * @returns {Promise<Object>} Parsing results
 */
async function processBulkParsingTest(job) {
  const { filePath, fileName, parser, testId } = job.data;
  const startTime = Date.now();
  
  try {
    // Update job progress
    await job.updateProgress(10);
    
    // Read PDF buffer
    const pdfBuffer = fs.readFileSync(filePath);
    await job.updateProgress(30);
    
    // Find PDF template - try to detect document type first
    let template = null;
    let detectedDocType = null;
    
    if (parser === 'local') {
      // Improved document type detection
      try {
        const { extractTextFromPDF } = require('../utils/pdfExtractor');
        const quickTextResult = await extractTextFromPDF(filePath);
        const quickText = quickTextResult.text || quickTextResult;
        if (quickText && quickText.length > 0) {
          const textUpper = quickText.toUpperCase();
          
          // Most specific first: "CREDIT NOTE" (two words together)
          if (textUpper.includes('CREDIT NOTE') || textUpper.includes('CREDITNOTE')) {
            detectedDocType = 'credit_note';
          }
          // Check for statement indicators
          else if (textUpper.includes('STATEMENT') || textUpper.includes('ACCOUNT STATEMENT') || textUpper.includes('STATEMENT OF ACCOUNT')) {
            detectedDocType = 'statement';
          }
          // Check for invoice indicators (explicit check)
          else if (textUpper.includes('INVOICE') || textUpper.includes('TAX INVOICE') || textUpper.includes('INVOICE NUMBER')) {
            detectedDocType = 'invoice';
          }
          // Less specific: standalone "CREDIT" (but only if not already detected as invoice)
          else if (textUpper.includes('CREDIT') && !textUpper.includes('INVOICE')) {
            if (textUpper.includes(' CN ') || textUpper.match(/\bCN\b/) || textUpper.includes('CREDIT NOTE')) {
              detectedDocType = 'credit_note';
            } else {
              detectedDocType = 'invoice'; // Default to invoice
            }
          }
          // Default to invoice
          else {
            detectedDocType = 'invoice';
          }
          console.log(`📄 [Bulk Test ${testId}] Detected document type: ${detectedDocType}`);
        }
      } catch (detectError) {
        console.warn(`⚠️  [Bulk Test ${testId}] Could not detect document type: ${detectError.message}`);
        detectedDocType = 'invoice'; // Default on error
      }
      
      // Try to find default template matching detected type
      if (detectedDocType) {
        template = await Template.findDefaultTemplate('pdf', detectedDocType);
        if (template && template.templateType === detectedDocType) {
          console.log(`✅ [Bulk Test ${testId}] Found DEFAULT template for detected type: ${template.name} (${template.templateType})`);
        } else if (template) {
          console.error(`❌ [Bulk Test ${testId}] Template type mismatch! Rejecting.`);
          template = null;
        }
      }
      
      // If no default, try any template of the correct type
      if (!template && detectedDocType) {
        template = await Template.findTemplateByFileType('pdf', detectedDocType);
        if (template) {
          console.log(`⚠️  [Bulk Test ${testId}] Using non-default template for ${detectedDocType}: ${template.name}`);
        }
      }
      
      // Do NOT fall back to wrong template type
      if (!template) {
        console.error(`❌ [Bulk Test ${testId}] No template found for detected type: ${detectedDocType}`);
      }
      
      await job.updateProgress(50);
    }
    
    let parsedData = {};
    let fullText = '';
    let processingMethod = parser;
    
    // Use local coordinate-based extraction
    if (parser === 'local' && template) {
      console.log(`🔍 [Bulk Test ${testId}] Processing ${fileName} with template: ${template.name} (${template.templateType})`);
      
      // Use coordinate-based extraction (this extracts only the defined fields)
      parsedData = await Template.extractFieldsFromCoordinates(pdfBuffer, template);
      processingMethod = `local_coordinates_${template.code}`;
      
      // Warn if document type mismatch
      if (detectedDocType && template.templateType !== detectedDocType) {
        console.warn(`⚠️  [Bulk Test ${testId}] Document type mismatch: Detected ${detectedDocType} but using ${template.templateType} template`);
        parsedData._warning = `Document appears to be a ${detectedDocType} but ${template.templateType} template was used.`;
      }
      
      // Use fullText from coordinate extraction (which contains only extracted field values)
      if (parsedData && parsedData.fullText) {
        fullText = parsedData.fullText;
      } else {
        // Create a summary from extracted fields if fullText wasn't set
        const extractedFieldsList = Object.entries(parsedData || {})
          .filter(([key]) => key !== 'fullText' && key !== 'fieldLabels' && parsedData[key] !== null)
          .map(([key, value]) => `${key}: ${value}`)
          .join('\n');
        fullText = extractedFieldsList || 'No fields extracted from template coordinates';
      }
      
      await job.updateProgress(80);
    } else if (parser === 'local' && !template) {
      // Fallback to basic extraction if no template
      const { extractInvoiceData } = require('../utils/pdfExtractor');
      parsedData = await extractInvoiceData(filePath);
      processingMethod = 'local_basic';
      if (parsedData && parsedData.fullText) {
        fullText = parsedData.fullText;
      }
      await job.updateProgress(80);
    } else {
      // For other parsers (vision, documentai), we'd need to implement them here
      // For now, just extract text
      const extractedText = await extractTextFromPDF(filePath);
      fullText = extractedText.text;
      await job.updateProgress(80);
    }
    
    // Calculate confidence score using improved algorithm
    const { calculateConfidence } = require('../utils/confidenceCalculator');
    const confidenceScore = calculateConfidence({
      parsedData,
      template,
      ocrConfidence: parsedData?.ocrConfidence || null,
      fullText,
      processingMethod
    });
    
    const processingTime = Date.now() - startTime;
    
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
    
    await job.updateProgress(100);
    
    return {
      success: true,
      fileName,
      filePath,
      processingMethod,
      confidence: confidenceScore,
      parsedData: parsedData || {},
      fullText: fullText || 'No text extracted',
      extractedFields,
      fieldLabels,
      textLength: fullText.length,
      wordCount: fullText.split(/\s+/).filter(word => word.length > 0).length,
      processingTime, // in milliseconds
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ [Bulk Test ${testId}] Error processing ${fileName}:`, error.message);
    
    return {
      success: false,
      fileName,
      filePath,
      error: error.message || 'Unknown error',
      processingTime,
      timestamp: new Date().toISOString(),
      confidence: 0,
      extractedFields: {},
      fieldLabels: {},
      fullText: '',
      textLength: 0,
      wordCount: 0
    };
  }
}

module.exports = {
  processBulkParsingTest
};

