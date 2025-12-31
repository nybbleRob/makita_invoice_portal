/**
 * Template Model
 * Defines coordinate-based parsing templates for invoices, credit notes, and statements
 */

module.exports = (sequelize, DataTypes) => {
  const Template = sequelize.define('Template', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Template name (e.g., "Standard Invoice Template", "Makita Invoice")'
    },
    code: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Template code (auto-generated from name)'
    },
    // Template type: 'invoice', 'credit_note', 'statement'
    templateType: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Type of template: invoice, credit_note, or statement'
    },
    // File type: 'pdf' or 'excel'
    fileType: {
      type: DataTypes.STRING,
      defaultValue: 'pdf',
      allowNull: false,
      comment: 'File type this template is for: pdf or excel'
    },
    // Coordinate-based extraction (primary method)
    coordinates: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Coordinate-based field extraction (x, y, width, height, page)'
      // Example:
      // {
      //   document_type: { x: 100, y: 50, width: 200, height: 20, page: 1 }, // REQUIRED
      //   invoice_number: { x: 100, y: 200, width: 200, height: 20, page: 1 },
      //   date: { x: 400, y: 200, width: 150, height: 20, page: 1 },
      //   account_number: { x: 100, y: 250, width: 150, height: 20, page: 1 }
      // }
    },
    // Pattern-based extraction (regex) - optional fallback
    patterns: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Regex patterns for field extraction (optional fallback)'
    },
    // Text markers/anchors for relative extraction
    markers: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Text markers to find fields relative to known text'
      // Example:
      // {
      //   invoiceNumber: { before: 'Invoice Number:', after: null, offset: 1 },
      //   date: { before: 'Date:', after: null, offset: 1 },
      //   amount: { before: 'Total Amount:', after: '£', offset: 1 }
      // }
    },
    // Sample PDF for preview (stored path or base64)
    samplePdfPath: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Path to sample PDF file for template preview'
    },
    // Sample Excel file for preview
    sampleExcelPath: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Path to sample Excel file for template preview'
    },
    // Excel cell mappings (for Excel templates)
    excelCells: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Excel cell-based field extraction (column, row, sheet)'
      // Example:
      // {
      //   document_type: { column: 'A', row: 1, sheet: 0 }, // REQUIRED
      //   invoice_number: { column: 'M', row: 4, sheet: 0 },
      //   date: { column: 'B', row: 5, sheet: 0 },
      //   account_number: { column: 'C', row: 3, sheet: 0 }
      // }
    },
    // Field transformations/cleanup
    transformations: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Post-processing transformations for extracted fields'
      // Example:
      // {
      //   invoiceNumber: { remove: ['INV', '#'], trim: true, uppercase: true },
      //   amount: { remove: [',', '£', '$'], parseFloat: true }
      // }
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    isDefault: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Is this the default template for this type?'
    },
    priority: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Priority order when multiple templates match (higher = first)'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Additional metadata (notes, version, etc.)'
    },
    customFields: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Custom field definitions with displayName, showInTable, showInFilter, dataType, etc.'
    }
  }, {
    tableName: 'templates',
    timestamps: true
  });

  /**
   * Find template by fileType (only one template per fileType is allowed)
   * @param {string} fileType - 'pdf' or 'excel'
   * @param {string} templateType - Optional: 'invoice', 'credit_note', or 'statement' (for future use)
   * @returns {Promise<Template|null>}
   */
  Template.findTemplateByFileType = async function(fileType, templateType = null) {
    const where = {
      fileType: fileType,
      enabled: true
    };
    
    // If templateType is specified, filter by it
    if (templateType) {
      where.templateType = templateType;
    }
    
    // Only check enabled if the field exists
    // Note: enabled field may not exist in all database schemas
    try {
      const template = await this.findOne({
        where: where,
        order: [['isDefault', 'DESC'], ['priority', 'DESC'], ['createdAt', 'DESC']]
      });
      
      // If template has enabled field and it's false, return null
      if (template && template.enabled === false) {
        return null;
      }
      
      return template;
    } catch (error) {
      // If enabled field doesn't exist, try without it
      console.warn(`⚠️  Template.findTemplateByFileType: ${error.message}, trying without enabled check`);
      const whereWithoutEnabled = { fileType: fileType };
      if (templateType) {
        whereWithoutEnabled.templateType = templateType;
      }
      return await this.findOne({
        where: whereWithoutEnabled,
        order: [['isDefault', 'DESC'], ['priority', 'DESC'], ['createdAt', 'DESC']]
      });
    }
  };
  
  /**
   * Find default template for a specific document type and file type
   * @param {string} fileType - 'pdf' or 'excel'
   * @param {string} templateType - 'invoice', 'credit_note', or 'statement'
   * @returns {Promise<Template|null>}
   */
  Template.findDefaultTemplate = async function(fileType, templateType) {
    const where = {
      fileType: fileType,
      enabled: true
    };
    
    if (templateType) {
      where.templateType = templateType;
    }
    
    try {
      // First try to find a template marked as default
      let template = await this.findOne({
        where: {
          ...where,
          isDefault: true
        },
        order: [['priority', 'DESC'], ['createdAt', 'DESC']]
      });
      
      if (template) {
        return template;
      }
      
      // If no default found, get the first enabled template (ordered by priority)
      template = await this.findOne({
        where: where,
        order: [['priority', 'DESC'], ['createdAt', 'DESC']]
      });
      
      return template;
    } catch (error) {
      console.warn(`⚠️  Template.findDefaultTemplate: ${error.message}, trying without enabled check`);
      const whereWithoutEnabled = { fileType: fileType };
      if (templateType) {
        whereWithoutEnabled.templateType = templateType;
      }
      return await this.findOne({
        where: whereWithoutEnabled,
        order: [['isDefault', 'DESC'], ['priority', 'DESC'], ['createdAt', 'DESC']]
      });
    }
  };

  /**
   * Find template by type (backward compatibility - now uses fileType)
   * @param {string} templateType - 'invoice', 'credit_note', or 'statement'
   * @returns {Promise<Template|null>}
   */
  Template.findTemplateByType = async function(templateType) {
    // Try to find PDF template first (preferred for local parsing)
    const pdfTemplate = await this.findTemplateByFileType('pdf', templateType);
    if (pdfTemplate) {
      return pdfTemplate;
    }
    
    // Fallback to Excel template
    return await this.findTemplateByFileType('excel', templateType);
  };
  
  /**
   * Set template as default (unset others of same type)
   */
  Template.prototype.setAsDefault = async function() {
    // Unset other defaults of the same type
    await Template.update(
      { isDefault: false },
      {
        where: {
          templateType: this.templateType,
          id: { [sequelize.Sequelize.Op.ne]: this.id }
        }
      }
    );
    
    // Set this as default
    this.isDefault = true;
    await this.save();
  };

  /**
   * Extract fields using template coordinates
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @param {Object} template - Template instance
   * @returns {Promise<Object>} - Extracted fields
   */
  Template.extractFieldsFromCoordinates = async function(pdfBuffer, template) {
    // Polyfill DOMMatrix for Node.js environment
    if (typeof global.DOMMatrix === 'undefined') {
      try {
        const DOMMatrix = require('@thednp/dommatrix');
        global.DOMMatrix = DOMMatrix;
        global.DOMMatrixReadOnly = DOMMatrix;
      } catch (error) {
        console.warn('Warning: Could not load DOMMatrix polyfill:', error.message);
      }
    }
    
    // Lazy load pdfjs-dist
    let pdfjsLib;
    try {
      pdfjsLib = require('pdfjs-dist');
    } catch (error) {
      throw new Error('pdfjs-dist is not installed. Please run: npm install pdfjs-dist');
    }
    // Initialize with only metadata fields
    // Use standard field names directly (no template prefix)
    const { STANDARD_FIELDS, validateCrucialFields } = require('../utils/standardFields');
    const extracted = {
      templateId: template.id,
      templateName: template.name
    };
    
    try {
      // Convert Buffer to Uint8Array for pdfjs-dist
      const pdfData = pdfBuffer instanceof Buffer 
        ? new Uint8Array(pdfBuffer) 
        : pdfBuffer instanceof Uint8Array 
          ? pdfBuffer 
          : new Uint8Array(pdfBuffer);
      
      // Load PDF
      const loadingTask = pdfjsLib.getDocument({ data: pdfData });
      const pdf = await loadingTask.promise;
      
      // Get total page count immediately to detect multi-page documents
      const totalPages = pdf.numPages;
      const isMultiPage = totalPages > 1;
      console.log(`📄 PDF has ${totalPages} page(s) - ${isMultiPage ? 'Multi-page document' : 'Single page'}`);
      
      // Only extract from defined coordinate regions in the template
      // This ensures we only get the data the user defined in the template
      
      // Extract fields using coordinates (use normalized coordinates)
      if (template.coordinates) {
        console.log(`📋 Extracting ${Object.keys(template.coordinates).length} fields from template coordinates`);
        
        // Import the normalized extraction function and STANDARD_FIELDS
        const { extractTextFromNormalizedRegion, getCachedPageData } = require('../utils/pdfCoordinates');
        const { STANDARD_FIELDS, getCrucialFields } = require('../utils/standardFields');
        
        // Get list of crucial field standard names
        const crucialFieldNames = getCrucialFields().map(f => f.standardName);
        crucialFieldNames.push('pageNo'); // Also include pageNo as crucial for detection
        
        // Sort fields by parsing order for intelligent extraction:
        // 1. pageNo first (to detect multi-page)
        // 2. Crucial fields (documentType, accountNumber, invoiceDate)
        // 3. Important fields (invoiceNumber, creditNumber, customerPO)
        // 4. Amount fields (totalAmount, vatAmount, goodsAmount) - from last page if multi-page
        // 5. Other optional fields
        const sortedFields = Object.entries(template.coordinates).sort(([fieldNameA, coordsA], [fieldNameB, coordsB]) => {
          const standardNameA = mapFieldName(fieldNameA) || fieldNameA;
          const standardNameB = mapFieldName(fieldNameB) || fieldNameB;
          
          const fieldA = STANDARD_FIELDS[standardNameA];
          const fieldB = STANDARD_FIELDS[standardNameB];
          
          // 1. pageNo always first
          if (standardNameA === 'pageNo') return -1;
          if (standardNameB === 'pageNo') return 1;
          
          // 2. Get parsing order (default to 999 if not defined)
          const orderA = fieldA?.parsingOrder ?? 999;
          const orderB = fieldB?.parsingOrder ?? 999;
          
          // 3. If multi-page, prioritize amount fields from last page
          if (isMultiPage) {
            const lastPageFields = ['totalAmount', 'vatAmount', 'goodsAmount'];
            const aIsLastPageField = lastPageFields.includes(standardNameA);
            const bIsLastPageField = lastPageFields.includes(standardNameB);
            const aPage = coordsA?.normalized?.page || coordsA?.page || 1;
            const bPage = coordsB?.normalized?.page || coordsB?.page || 1;
            const aIsOnLastPage = aIsLastPageField && aPage === totalPages;
            const bIsOnLastPage = bIsLastPageField && bPage === totalPages;
            
            // If both are amount fields, prioritize the one on last page
            if (aIsLastPageField && bIsLastPageField) {
              if (aIsOnLastPage && !bIsOnLastPage) return -1;
              if (!aIsOnLastPage && bIsOnLastPage) return 1;
            }
          }
          
          // 4. Sort by parsing order
          if (orderA !== orderB) {
            return orderA - orderB;
          }
          
          // 5. If same order, crucial fields first
          if (fieldA?.isCrucial && !fieldB?.isCrucial) return -1;
          if (!fieldA?.isCrucial && fieldB?.isCrucial) return 1;
          
          // 6. Then mandatory before optional
          if (fieldA?.isMandatory && !fieldB?.isMandatory) return -1;
          if (!fieldA?.isMandatory && fieldB?.isMandatory) return 1;
          
          // 7. Alphabetical for same priority
          return standardNameA.localeCompare(standardNameB);
        });
        
        console.log(`📊 Parsing order: ${sortedFields.map(([name]) => name).join(' → ')}`);
        
        // ============================================
        // PHASE 1: Parse CRUCIAL fields first (with early exit)
        // ============================================
        console.log(`\n🚀 PHASE 1: Parsing crucial fields first...`);
        const crucialFields = sortedFields.filter(([fieldName]) => {
          const standardName = mapFieldName(fieldName) || fieldName;
          return crucialFieldNames.includes(standardName);
        });
        
        const crucialExtracted = { ...extracted };
        
        // Group crucial fields by page for efficient batch processing
        const crucialFieldsByPage = new Map();
        for (const [fieldName, coords] of crucialFields) {
          const pageNum = coords.normalized?.page || coords.page || 1;
          if (!crucialFieldsByPage.has(pageNum)) {
            crucialFieldsByPage.set(pageNum, []);
          }
          crucialFieldsByPage.get(pageNum).push([fieldName, coords]);
        }
        
        // Parse crucial fields page by page
        for (const [pageNum, fields] of Array.from(crucialFieldsByPage.entries()).sort((a, b) => a[0] - b[0])) {
          console.log(`📄 Parsing ${fields.length} crucial field(s) from page ${pageNum}...`);
          
          for (const [fieldName, coords] of fields) {
            const standardFieldName = mapFieldName(fieldName) || fieldName;
            
            if (coords.normalized) {
              const normalized = coords.normalized;
              let pageNumForExtraction = normalized.page || coords.page || 1;
              
              if (normalized.left !== undefined && normalized.top !== undefined && 
                  normalized.right !== undefined && normalized.bottom !== undefined) {
                console.log(`🔍 [CRUCIAL] Extracting "${fieldName}" → "${standardFieldName}" from page ${pageNumForExtraction}`);
                
                try {
                  const value = await extractTextFromNormalizedRegion(pdfBuffer, {
                    left: normalized.left,
                    top: normalized.top,
                    right: normalized.right,
                    bottom: normalized.bottom,
                    page: pageNumForExtraction
                  }, pdf); // Pass PDF object to avoid reloading
                  
                  if (value && value.trim()) {
                    let finalValue = value.trim();
                    
                    if (template.transformations && template.transformations[fieldName]) {
                      finalValue = applyTransformations(finalValue, template.transformations[fieldName]);
                    }
                    
                    const finalFieldName = (standardFieldName === 'date') ? 'invoiceDate' : standardFieldName;
                    crucialExtracted[finalFieldName] = finalValue;
                    console.log(`   ✅ [CRUCIAL] Stored "${finalFieldName}" = "${finalValue}"`);
                  } else {
                    console.log(`   ⚠️  [CRUCIAL] No text found for ${fieldName} (${standardFieldName})`);
                  }
                } catch (error) {
                  console.error(`   ❌ [CRUCIAL] Error extracting ${fieldName}:`, error.message);
                }
              }
            }
          }
        }
        
        // Validate crucial fields IMMEDIATELY after Phase 1
        const validation = validateCrucialFields(crucialExtracted);
        if (!validation.isValid) {
          console.warn(`\n⚠️  CRUCIAL FIELDS VALIDATION FAILED: ${validation.missing.join(', ')}`);
          console.warn(`   Early exit: Skipping remaining field extraction to save time`);
          crucialExtracted._validationErrors = validation.errors;
          crucialExtracted._earlyExit = true;
          crucialExtracted._missingCrucialFields = validation.missing;
          
          // Still create fieldLabels for what we extracted
          crucialExtracted.fieldLabels = {};
          for (const [standardFieldName, fieldDef] of Object.entries(STANDARD_FIELDS)) {
            if (crucialExtracted.hasOwnProperty(standardFieldName)) {
              crucialExtracted.fieldLabels[standardFieldName] = fieldDef.displayName;
            }
          }
          
          return crucialExtracted; // EARLY EXIT - don't parse remaining fields
        }
        
        console.log(`✅ PHASE 1 complete: All crucial fields extracted successfully`);
        
        // ============================================
        // PHASE 2: Parse remaining fields (only if crucial fields passed)
        // ============================================
        console.log(`\n🚀 PHASE 2: Parsing remaining fields...`);
        const remainingFields = sortedFields.filter(([fieldName]) => {
          const standardName = mapFieldName(fieldName) || fieldName;
          return !crucialFieldNames.includes(standardName);
        });
        
        // Group remaining fields by page for efficient batch processing
        const remainingFieldsByPage = new Map();
        for (const [fieldName, coords] of remainingFields) {
          let pageNum = coords.normalized?.page || coords.page || 1;
          const standardFieldName = mapFieldName(fieldName) || fieldName;
          
          // For multi-page documents, ensure amount fields are extracted from last page
          if (isMultiPage) {
            const lastPageFields = ['totalAmount', 'vatAmount', 'goodsAmount'];
            if (lastPageFields.includes(standardFieldName)) {
              if (pageNum !== totalPages) {
                console.warn(`⚠️  Field "${fieldName}" (${standardFieldName}) is on page ${pageNum} but should be on last page (${totalPages}) for multi-page documents. Overriding to last page.`);
                pageNum = totalPages;
              }
            }
          }
          
          if (!remainingFieldsByPage.has(pageNum)) {
            remainingFieldsByPage.set(pageNum, []);
          }
          remainingFieldsByPage.get(pageNum).push([fieldName, coords, pageNum]);
        }
        
        // Parse remaining fields page by page
        for (const [pageNum, fields] of Array.from(remainingFieldsByPage.entries()).sort((a, b) => a[0] - b[0])) {
          console.log(`📄 Parsing ${fields.length} remaining field(s) from page ${pageNum}...`);
          
          for (const [fieldName, coords, actualPageNum] of fields) {
            const standardFieldName = mapFieldName(fieldName) || fieldName;
            
            if (coords.normalized) {
              const normalized = coords.normalized;
              
              if (normalized.left !== undefined && normalized.top !== undefined && 
                  normalized.right !== undefined && normalized.bottom !== undefined) {
                console.log(`🔍 Extracting field "${fieldName}" → "${standardFieldName}" from page ${actualPageNum}`);
                
                try {
                  const value = await extractTextFromNormalizedRegion(pdfBuffer, {
                    left: normalized.left,
                    top: normalized.top,
                    right: normalized.right,
                    bottom: normalized.bottom,
                    page: actualPageNum
                  }, pdf); // Pass PDF object to avoid reloading
                  
                  if (value && value.trim()) {
                    let finalValue = value.trim();
                    
                    // Apply transformations
                    if (template.transformations && template.transformations[fieldName]) {
                      const originalValue = finalValue;
                      finalValue = applyTransformations(finalValue, template.transformations[fieldName]);
                      console.log(`   After transformations: "${finalValue}" (from "${originalValue}")`);
                    }
                    
                    // Clean amount values (remove currency symbols, commas, etc.)
                    let cleanedValue = finalValue;
                    const standardField = STANDARD_FIELDS[standardFieldName];
                    if (standardField && (standardFieldName === 'totalAmount' || standardFieldName === 'vatAmount' || standardFieldName === 'goodsAmount')) {
                      cleanedValue = cleanAmountValue(finalValue);
                    }
                    
                    // Special handling: map 'date' to 'invoiceDate' for consistency
                    const finalFieldName = (standardFieldName === 'date') ? 'invoiceDate' : standardFieldName;
                    
                    // Store with STANDARD field name (not template-prefixed)
                    crucialExtracted[finalFieldName] = cleanedValue;
                    console.log(`   ✅ Stored "${finalFieldName}" = "${cleanedValue}"`);
                  } else {
                    console.log(`   ⚠️  No text found in region for ${fieldName} (${standardFieldName})`);
                  }
                } catch (error) {
                  console.error(`   ❌ Error extracting ${fieldName}:`, error.message);
                }
              } else {
                console.log(`⚠️  Skipping ${fieldName}: incomplete normalized coordinates`);
              }
            } else if (coords.x !== undefined && coords.y !== undefined && coords.width && coords.height) {
              // Fallback to PDF point coordinates (legacy support)
              console.log(`🔍 Extracting field "${fieldName}" from page ${actualPageNum} using PDF point coordinates (legacy)`);
              
              const { viewport, textContent } = await getCachedPageData(pdf, actualPageNum);
              const pageHeight = viewport.height;
              const adjustedY = pageHeight - coords.y - coords.height;
              
              const tolerance = 5;
              const items = textContent.items.filter(item => {
                const transform = item.transform;
                const x = transform[4];
                const y = transform[5];
                
                const inXRange = x >= (coords.x - tolerance) && x <= (coords.x + coords.width + tolerance);
                const inYRange = y >= (adjustedY - tolerance) && y <= (adjustedY + coords.height + tolerance);
                
                return inXRange && inYRange;
              });
              
              if (items.length > 0) {
                const sortedItems = items.sort((a, b) => {
                  const aY = a.transform[5];
                  const bY = b.transform[5];
                  if (Math.abs(aY - bY) > 5) {
                    return bY - aY;
                  }
                  return a.transform[4] - b.transform[4];
                });
                
                let value = sortedItems.map(item => item.str).join(' ').trim();
                
                if (template.transformations && template.transformations[fieldName]) {
                  value = applyTransformations(value, template.transformations[fieldName]);
                }
                
                // Clean amount values (remove currency symbols, commas, etc.)
                let cleanedValue = value;
                const standardField = STANDARD_FIELDS[standardFieldName];
                if (standardField && (standardFieldName === 'totalAmount' || standardFieldName === 'vatAmount' || standardFieldName === 'goodsAmount')) {
                  cleanedValue = cleanAmountValue(value);
                }
                
                // Special handling: map 'date' to 'invoiceDate' for consistency
                const finalFieldName = (standardFieldName === 'date') ? 'invoiceDate' : standardFieldName;
                
                // Store with STANDARD field name (not template-prefixed)
                crucialExtracted[finalFieldName] = cleanedValue;
              }
            } else {
              console.log(`⚠️  Skipping ${fieldName}: missing coordinates or page`);
            }
          }
        }
        
        console.log(`✅ PHASE 2 complete: All remaining fields extracted`);
        
        // Use crucialExtracted (which now contains all fields) as the final extracted object
        Object.assign(extracted, crucialExtracted);
      } else {
        console.log('⚠️  Template has no coordinates defined');
      }
      
      // Normalize document type if present
      if (extracted.documentType) {
        const docTypeUpper = String(extracted.documentType).toUpperCase();
        let normalizedType = 'invoice'; // default
        if (docTypeUpper.includes('CREDIT') || docTypeUpper.includes('CN')) {
          normalizedType = 'credit_note';
        } else if (docTypeUpper.includes('STATEMENT')) {
          normalizedType = 'statement';
        }
        extracted.documentType = normalizedType;
      }
      
      // Final validation (only if we didn't early exit)
      if (!extracted._earlyExit) {
        const finalValidation = validateCrucialFields(extracted);
        if (!finalValidation.isValid) {
          console.warn('⚠️  Missing crucial fields after full extraction:', finalValidation.missing.join(', '));
          extracted._validationErrors = finalValidation.errors;
        }
      }
      
      // Create fieldLabels mapping: standard field name -> display name from STANDARD_FIELDS
      // This maps ALL template-defined fields to their user-friendly display names
      // Include ALL fields that are in the template coordinates, not just extracted ones
      extracted.fieldLabels = {};
      
      // Get all fields defined in template coordinates
      const templateCoordinates = template.coordinates || {};
      const templateCode = template.code || '';
      const { mapToStandardName } = require('../utils/standardFields');
      
      // Extract standard field names from template coordinates
      // Coordinates can be stored as: {templateCode}_standardName or just standardName
      const templateFieldNames = new Set();
      
      for (const [fieldId, coords] of Object.entries(templateCoordinates)) {
        if (!coords || typeof coords !== 'object') continue;
        
        // Extract standard field name from fieldId
        // Remove template code prefix if present
        let standardFieldName = fieldId;
        if (templateCode && fieldId.startsWith(templateCode + '_')) {
          standardFieldName = fieldId.substring(templateCode.length + 1);
        }
        
        // Map to standard name using field mapping function
        const mappedName = mapToStandardName(standardFieldName) || standardFieldName;
        templateFieldNames.add(mappedName);
      }
      
      // Populate fieldLabels for ALL template-defined fields
      for (const standardFieldName of templateFieldNames) {
        const fieldDef = STANDARD_FIELDS[standardFieldName];
        if (fieldDef) {
          extracted.fieldLabels[standardFieldName] = fieldDef.displayName;
        }
      }
      
      // Also include any custom fields from template (invoiceTo, deliveryAddress are now standard fields)
      // Custom fields are no longer used, but keeping this for backward compatibility
      if (template.customFields && typeof template.customFields === 'object') {
        for (const [customFieldName, customFieldConfig] of Object.entries(template.customFields)) {
          extracted.fieldLabels[customFieldName] = customFieldConfig.displayName || customFieldName;
        }
      }

      // Extract custom fields if template has customFields defined
      if (template.customFields && typeof template.customFields === 'object' && Object.keys(template.customFields).length > 0) {
        console.log(`📋 Extracting ${Object.keys(template.customFields).length} custom field(s)...`);
        
        const { extractTextFromNormalizedRegion, getCachedPageData } = require('../utils/pdfCoordinates');
        
        for (const [customFieldName, customFieldConfig] of Object.entries(template.customFields)) {
          // Check if this custom field has coordinates defined
          const templateCode = template.code || '';
          const prefixedFieldName = templateCode ? `${templateCode}_${customFieldName}` : customFieldName;
          
          // Look for coordinates with or without prefix
          const coords = template.coordinates?.[prefixedFieldName] || template.coordinates?.[customFieldName];
          
          if (coords && coords.normalized) {
            const normalized = coords.normalized;
            const pageNum = normalized.page || coords.page || 1;
            
            if (normalized.left !== undefined && normalized.top !== undefined && 
                normalized.right !== undefined && normalized.bottom !== undefined) {
              console.log(`🔍 Extracting custom field "${customFieldName}" from page ${pageNum}`);
              
              try {
                const value = await extractTextFromNormalizedRegion(pdfBuffer, {
                  left: normalized.left,
                  top: normalized.top,
                  right: normalized.right,
                  bottom: normalized.bottom,
                  page: pageNum
                }, pdf);
                
                if (value && value.trim()) {
                  let finalValue = value.trim();
                  
                  // Apply transformations if defined
                  if (template.transformations && template.transformations[prefixedFieldName]) {
                    finalValue = applyTransformations(finalValue, template.transformations[prefixedFieldName]);
                  } else if (template.transformations && template.transformations[customFieldName]) {
                    finalValue = applyTransformations(finalValue, template.transformations[customFieldName]);
                  }
                  
                  // Format value based on dataType
                  if (customFieldConfig.dataType === 'currency' || customFieldConfig.dataType === 'number') {
                    finalValue = cleanAmountValue(finalValue);
                  } else if (customFieldConfig.dataType === 'date') {
                    // Try to parse and normalize date format
                    // Keep as-is for now, can be enhanced later
                  }
                  
                  // Store custom field with its name (not prefixed)
                  extracted[customFieldName] = finalValue;
                  extracted.fieldLabels[customFieldName] = customFieldConfig.displayName || customFieldName;
                  console.log(`   ✅ Stored custom field "${customFieldName}" = "${finalValue}"`);
                } else {
                  console.log(`   ⚠️  No text found for custom field ${customFieldName}`);
                }
              } catch (error) {
                console.error(`   ❌ Error extracting custom field ${customFieldName}:`, error.message);
              }
            }
          } else {
            console.log(`   ⚠️  Custom field "${customFieldName}" has no coordinates defined, skipping`);
          }
        }
      }
      
    } catch (error) {
      console.error('Error extracting fields from coordinates:', error);
      throw error;
    }
    
  return extracted;
};

/**
 * Clean amount value by removing currency symbols, commas, and other non-numeric characters
 * @param {string} value - Raw amount value (e.g., "£127.96", "$1,234.56", "€100.00")
 * @returns {string} - Cleaned numeric string (e.g., "127.96", "1234.56", "100.00")
 */
function cleanAmountValue(value) {
  if (!value || typeof value !== 'string') {
    return value;
  }
  
  // Remove currency symbols (£, $, €, etc.) and other non-numeric characters except decimal point and minus
  // Keep decimal point and minus sign for negative amounts
  let cleaned = value
    .replace(/[£$€¥₹,\s]/g, '') // Remove currency symbols, commas, spaces
    .replace(/[^\d.-]/g, ''); // Remove any other non-numeric characters except . and -
  
  // Ensure we have a valid number format
  // If it starts with a decimal point, add leading zero
  if (cleaned.startsWith('.')) {
    cleaned = '0' + cleaned;
  }
  
  // If it's empty or just a minus sign, return original
  if (!cleaned || cleaned === '-') {
    return value;
  }
  
  return cleaned;
}

/**
 * Extract base field name from template code prefixed field ID
 * Example: "makita_invoice_template_document_type" → "document_type"
 */
function extractBaseFieldName(fieldName) {
    if (!fieldName) return fieldName;
    
    // Normalize field name: remove trailing periods and convert to lowercase for matching
    const normalized = fieldName.replace(/\.+$/, '').toLowerCase();
    
    // If field name contains underscores, try to extract the base name
    // Template code format: {template_code}_{field_name}
    // We look for common field name patterns (ordered by length, longest first)
    const commonFields = [
      'document_type', 'invoice_number', 'account_number', 'customer_name',
      'customer_po', 'vat_amount', 'goods_amount', 'date_tax_point',
      'page_no', 'invoice_total', 'date', 'amount', 'total'
    ];
    
    // Also handle variants with periods and common abbreviations
    const fieldVariants = {
      'account_no': 'account_number',
      'account_no.': 'account_number',
      'invoice_no': 'invoice_number',
      'invoice_no:': 'invoice_number',
      'invoice_no.': 'invoice_number',
      'page_no': 'page_no',
      'page_no.': 'page_no',
      'vat_total': 'vat_amount',
      'vat_total.': 'vat_amount',
      'invoice_total': 'amount',
      'invoice_total.': 'amount',
      'taxpoint': 'date',
      'taxpoint.': 'date',
      'tax_point': 'date',
      'date_tax_point': 'date'
    };
    
    // Check normalized field name against variants first
    if (fieldVariants[normalized]) {
      return fieldVariants[normalized];
    }
    
    // Check if field name ends with any common field name (longest matches first)
    for (const field of commonFields) {
      if (normalized.endsWith('_' + field) || normalized === field) {
        return field;
      }
    }
    
    // If no match, try to extract the last 1-3 parts after template code
    // (assuming template code doesn't contain the field name)
    const parts = normalized.split('_');
    if (parts.length > 1) {
      // Try last 3 parts (e.g., "date_tax_point")
      if (parts.length >= 3) {
        const lastThree = parts.slice(-3).join('_');
        if (commonFields.includes(lastThree)) {
          return lastThree;
        }
        // Check variant
        if (fieldVariants[lastThree]) {
          return fieldVariants[lastThree];
        }
      }
      // Try last 2 parts (e.g., "document_type", "invoice_number", "account_no")
      if (parts.length >= 2) {
        const lastTwo = parts.slice(-2).join('_');
        if (commonFields.includes(lastTwo)) {
          return lastTwo;
        }
        // Check variant (this handles "account_no", "invoice_no", etc.)
        if (fieldVariants[lastTwo]) {
          return fieldVariants[lastTwo];
        }
      }
      // Try just the last part (remove period if present)
      const lastPart = parts[parts.length - 1].replace(/\.+$/, '');
      if (fieldVariants[lastPart]) {
        return fieldVariants[lastPart];
      }
      // Otherwise return just the last part (without period)
      return lastPart;
    }
    
    // Return normalized version (without trailing period)
    return normalized;
  }
  
  /**
   * Map field name from template to standard field name
   * Uses the standardFields utility for consistent mapping
   */
  function mapFieldName(fieldName) {
    const { mapToStandardName } = require('../utils/standardFields');
    return mapToStandardName(fieldName);
  }

  /**
   * Extract value using text marker
   */
  function extractUsingMarker(text, config) {
    const { before, after, offset = 1 } = config;
    
    if (before) {
      const beforeIndex = text.indexOf(before);
      if (beforeIndex !== -1) {
        const startIndex = beforeIndex + before.length;
        const remainingText = text.substring(startIndex);
        
        if (after) {
          const afterIndex = remainingText.indexOf(after);
          if (afterIndex !== -1) {
            return remainingText.substring(0, afterIndex).trim();
          }
        } else {
          // Take next line or next word
          const lines = remainingText.split('\n');
          if (lines.length > 0) {
            return lines[0].trim();
          }
        }
      }
    }
    
    return null;
  }

  /**
   * Apply transformations to extracted value
   */
  function applyTransformations(value, transformations) {
    let result = value;
    
    if (transformations.remove) {
      for (const char of transformations.remove) {
        result = result.replace(new RegExp(char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
      }
    }
    
    if (transformations.trim) {
      result = result.trim();
    }
    
    if (transformations.uppercase) {
      result = result.toUpperCase();
    }
    
    if (transformations.lowercase) {
      result = result.toLowerCase();
    }
    
    if (transformations.parseFloat) {
      result = parseFloat(result.replace(/[^\d.-]/g, ''));
    }
    
    if (transformations.parseInt) {
      result = parseInt(result.replace(/[^\d-]/g, ''), 10);
    }
    
    return result;
  }

  return Template;
};

