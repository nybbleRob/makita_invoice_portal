/**
 * Supplier Document Processor Service
 * Processes supplier documents using templates (similar to invoiceImport.js but for suppliers)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SupplierDocument, Supplier, SupplierTemplate, SupplierFile, User, Settings } = require('../models');
const { Op } = require('sequelize');
const { extractTextFromPDF } = require('../utils/pdfExtractor');
const { 
  ensureStorageDirs, 
  getDatedFolder,
  getProcessedFilePath,
  getUnprocessedFilePath,
  PROCESSED_SUPPLIER_DOCUMENTS,
  UNPROCESSED_SUPPLIER_FAILED,
  ensureDir
} = require('../config/storage');
const { logActivity, ActivityType } = require('../services/activityLogger');
const { validateMandatoryFields, getMandatoryFields } = require('../utils/supplierStandardFields');

/**
 * Process a supplier document file
 * @param {Object} job - Bull job object with file data
 * @returns {Promise<Object>} Processing result
 */
async function processSupplierDocumentImport(job) {
  const { filePath, fileName, originalName, supplierId, templateId, fileHash, supplierFileId, userId, documentId } = job.data;
  const startTime = Date.now();
  const importId = documentId || supplierFileId || 'supplier-import';
  
  try {
    await job.updateProgress(10);
    
    // Verify file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    // Read file buffer
    const fileBuffer = fs.readFileSync(filePath);
    
    // Calculate hash if not provided
    let calculatedHash = fileHash;
    if (!calculatedHash) {
      calculatedHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    }
    
    await job.updateProgress(20);
    
    // Verify supplier exists
    const supplier = await Supplier.findByPk(supplierId);
    if (!supplier) {
      throw new Error(`Supplier not found: ${supplierId}`);
    }
    
    // Check for duplicate
    const existingDocument = await SupplierDocument.findOne({
      where: {
        fileHash: calculatedHash,
        deletedAt: null
      }
    });
    
    if (existingDocument && !documentId) {
      // This is a duplicate (unless we're re-parsing)
      // For supplier documents, use a separate duplicate folder or reuse unprocessed/duplicates
      const duplicatePath = path.join(UNPROCESSED_SUPPLIER_FAILED, `${new Date().toISOString().split('T')[0]}`, fileName);
      ensureDir(path.dirname(duplicatePath));
      fs.copyFileSync(filePath, duplicatePath);
      
      // Update supplier file status
      if (supplierFileId) {
        const supplierFile = await SupplierFile.findByPk(supplierFileId);
        if (supplierFile) {
          supplierFile.status = 'failed';
          supplierFile.processingErrors = [{ message: 'Duplicate file detected' }];
          await supplierFile.save();
        }
      }
      
      return {
        success: false,
        fileName: originalName || fileName,
        error: 'Duplicate file detected',
        duplicateDocumentId: existingDocument.id,
        processingTime: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
    }
    
    await job.updateProgress(30);
    
    // Determine file type
    const fileExt = path.extname(fileName).toLowerCase();
    const isExcel = ['.xlsx', '.xls', '.csv'].includes(fileExt);
    const isPDF = fileExt === '.pdf';
    
    if (!isPDF && !isExcel) {
      throw new Error('Unsupported file type. Only PDF and Excel files are supported.');
    }
    
    // Find template - use provided templateId or find default for supplier
    let template = null;
    if (templateId) {
      template = await SupplierTemplate.findByPk(templateId);
      if (!template || template.supplierId !== supplierId) {
        throw new Error(`Template not found or does not belong to supplier: ${templateId}`);
      }
    }
    
    // If no template provided, try to detect document type and find appropriate template
    let detectedDocType = null;
    if (!template && isPDF) {
      try {
        const quickTextResult = await extractTextFromPDF(filePath);
        const quickText = quickTextResult.text || quickTextResult;
        if (quickText && quickText.length > 0) {
          const textUpper = quickText.toUpperCase();
          if (textUpper.includes('CREDIT NOTE') || textUpper.includes('CREDITNOTE')) {
            detectedDocType = 'credit_note';
          } else if (textUpper.includes('STATEMENT')) {
            detectedDocType = 'statement';
          } else {
            detectedDocType = 'invoice';
          }
        }
      } catch (e) {
        console.warn(`Could not detect document type: ${e.message}`);
      }
    }
    
    // Find default template for supplier if not provided
    if (!template && supplierId) {
      const fileType = isPDF ? 'pdf' : 'excel';
      const docType = detectedDocType || 'invoice';
      template = await SupplierTemplate.findDefaultForSupplier(supplierId, docType, fileType);
    }
    
    if (!template) {
      throw new Error(`No template found for supplier ${supplierId}. Please create a template first.`);
    }
    
    await job.updateProgress(40);
    
    // Parse document using template
    let parsedData = {};
    let processingMethod = 'template';
    
    try {
      if (isPDF) {
        // Extract fields using coordinate-based extraction
        // Reuse Template extraction logic (same as customer templates)
        const { Template } = require('../models');
        parsedData = await Template.extractFieldsFromCoordinates(fileBuffer, template);
        processingMethod = `supplier_template_${template.code}`;
      } else if (isExcel) {
        // Use Excel parser
        const { extractFieldsFromExcel } = require('../utils/excelParser');
        parsedData = await extractFieldsFromExcel(filePath, template);
        processingMethod = `supplier_excel_${template.code}`;
      }
    } catch (parseError) {
      console.error(`Error parsing document: ${parseError.message}`);
      throw new Error(`Failed to parse document: ${parseError.message}`);
    }
    
    await job.updateProgress(60);
    
    // Extract document type from parsed data
    const documentType = parsedData.documentType || template.templateType || detectedDocType || 'invoice';
    
    // Validate mandatory fields
    const mandatoryFields = getMandatoryFields(documentType, template.mandatoryFields || []);
    const validation = validateMandatoryFields(parsedData, mandatoryFields);
    
    if (!validation.isValid) {
      // Move to supplier failed folder
      const failedPath = path.join(UNPROCESSED_SUPPLIER_FAILED, `${new Date().toISOString().split('T')[0]}`, fileName);
      ensureDir(path.dirname(failedPath));
      fs.copyFileSync(filePath, failedPath);
      fs.unlinkSync(filePath); // Remove temp file
      
      // Update supplier file status
      if (supplierFileId) {
        const supplierFile = await SupplierFile.findByPk(supplierFileId);
        if (supplierFile) {
          supplierFile.status = 'failed';
          supplierFile.processingErrors = validation.errors;
          await supplierFile.save();
        }
      }
      
      return {
        success: false,
        fileName: originalName || fileName,
        error: `Missing mandatory fields: ${validation.missing.join(', ')}`,
        missingFields: validation.missing,
        errors: validation.errors,
        processingTime: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
    }
    
    // Extract fields
    const invoiceNumber = parsedData.invoiceNumber || parsedData.invoice_number || null;
    const poNumber = parsedData.poNumber || parsedData.po_number || parsedData.customerPO || parsedData.customer_po || null;
    const documentDate = parsedData.documentDate || parsedData.document_date || parsedData.invoiceDate || parsedData.invoice_date || parsedData.date;
    const dueDate = parsedData.dueDate || parsedData.due_date || null;
    const amount = parseFloat(parsedData.totalAmount || parsedData.total_amount || parsedData.amount || parsedData.total || 0);
    const taxAmount = parseFloat(parsedData.taxAmount || parsedData.tax_amount || parsedData.tax || 0);
    const vatAmount = parseFloat(parsedData.vatAmount || parsedData.vat_amount || parsedData.vat || 0);
    const items = parsedData.items || [];
    
    // Validate document date
    let docDate = null;
    if (documentDate) {
      docDate = new Date(documentDate);
      if (isNaN(docDate.getTime())) {
        throw new Error(`Invalid document date: ${documentDate}`);
      }
    } else {
      throw new Error('Document date is required');
    }
    
    await job.updateProgress(70);
    
    // Check for duplicate invoice number (if provided)
    if (invoiceNumber) {
      const existingDoc = await SupplierDocument.findOne({
        where: {
          supplierId,
          invoiceNumber,
          deletedAt: null,
          ...(documentId ? { id: { [Op.ne]: documentId } } : {})
        }
      });
      
      if (existingDoc) {
        // Move to supplier failed folder
        const failedPath = path.join(UNPROCESSED_SUPPLIER_FAILED, `${new Date().toISOString().split('T')[0]}`, fileName);
        ensureDir(path.dirname(failedPath));
        fs.copyFileSync(filePath, failedPath);
        fs.unlinkSync(filePath);
        
        return {
          success: false,
          fileName: originalName || fileName,
          error: `Invoice number ${invoiceNumber} already exists for this supplier`,
          duplicateDocumentId: existingDoc.id,
          processingTime: Date.now() - startTime,
          timestamp: new Date().toISOString()
        };
      }
    }
    
    // Move file to processed storage: /mnt/data/processed/supplier-documents/{supplierId}/{YYYY}/{MM}/{DD}/
    const year = docDate.getFullYear().toString();
    const month = String(docDate.getMonth() + 1).padStart(2, '0');
    const day = String(docDate.getDate()).padStart(2, '0');
    const datedFolder = path.join(PROCESSED_SUPPLIER_DOCUMENTS, supplierId.toString(), year, month, day);
    ensureDir(datedFolder);
    const finalFileName = `${Date.now()}-${fileName}`;
    const finalPath = path.join(datedFolder, finalFileName);
    
    fs.copyFileSync(filePath, finalPath);
    fs.unlinkSync(filePath); // Remove temp file
    
    await job.updateProgress(80);
    
    // Create or update supplier document
    let document = null;
    if (documentId) {
      // Re-parsing existing document
      document = await SupplierDocument.findByPk(documentId);
      if (!document) {
        throw new Error(`Document not found: ${documentId}`);
      }
      
      // Update fields
      document.invoiceNumber = invoiceNumber;
      document.poNumber = poNumber;
      document.documentDate = docDate;
      document.dueDate = dueDate ? new Date(dueDate) : null;
      document.amount = amount;
      document.taxAmount = taxAmount;
      document.vatAmount = vatAmount;
      document.extractedFields = parsedData;
      document.items = items;
      document.fileUrl = finalPath;
      document.templateId = template.id;
      document.parsedAt = new Date();
      document.parsedBy = userId;
      document.confidence = 100; // TODO: Calculate confidence
      document.status = 'ready';
      
      await document.save();
    } else {
      // Create new document
      document = await SupplierDocument.create({
        supplierId,
        templateId: template.id,
        documentType,
        invoiceNumber,
        poNumber,
        documentDate: docDate,
        dueDate: dueDate ? new Date(dueDate) : null,
        amount,
        taxAmount,
        vatAmount,
        extractedFields: parsedData,
        items,
        fileUrl: finalPath,
        originalName: originalName || fileName,
        fileHash: calculatedHash,
        status: 'ready',
        documentStatus: 'ready',
        parsedAt: new Date(),
        parsedBy: userId,
        confidence: 100, // TODO: Calculate confidence
        createdById: userId
      });
    }
    
    // Update supplier file status
    if (supplierFileId) {
      const supplierFile = await SupplierFile.findByPk(supplierFileId);
      if (supplierFile) {
        supplierFile.status = 'processed';
        supplierFile.supplierDocumentId = document.id;
        supplierFile.fileUrl = finalPath;
        await supplierFile.save();
      }
    }
    
    await job.updateProgress(100);
    
    // Log activity
    await logActivity({
      type: ActivityType.SUPPLIER_DOCUMENT_CREATED,
      userId: userId,
      description: `Processed supplier document: ${invoiceNumber || fileName} for ${supplier.name}`,
      metadata: {
        documentId: document.id,
        supplierId: supplier.id,
        invoiceNumber: invoiceNumber,
        documentType: documentType
      }
    });
    
    return {
      success: true,
      fileName: originalName || fileName,
      documentId: document.id,
      invoiceNumber,
      documentType,
      processingTime: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      processingMethod
    };
    
  } catch (error) {
    console.error(`❌ [${importId}] Error processing supplier document:`, error.message);
    
    // Move to supplier failed folder
    try {
      if (fs.existsSync(filePath)) {
        const failedPath = path.join(UNPROCESSED_SUPPLIER_FAILED, `${new Date().toISOString().split('T')[0]}`, fileName);
        ensureDir(path.dirname(failedPath));
        fs.copyFileSync(filePath, failedPath);
        fs.unlinkSync(filePath);
      }
    } catch (moveError) {
      console.error(`Error moving file to failed folder: ${moveError.message}`);
    }
    
    // Update supplier file status
    if (supplierFileId) {
      try {
        const supplierFile = await SupplierFile.findByPk(supplierFileId);
        if (supplierFile) {
          supplierFile.status = 'failed';
          supplierFile.processingErrors = [{ message: error.message }];
          await supplierFile.save();
        }
      } catch (updateError) {
        console.error(`Error updating supplier file status: ${updateError.message}`);
      }
    }
    
    throw error;
  }
}

module.exports = {
  processSupplierDocumentImport
};
