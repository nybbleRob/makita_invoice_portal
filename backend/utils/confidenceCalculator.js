/**
 * Confidence Score Calculator
 * Calculates confidence scores based on OCR confidence, template field matching, and extracted data quality
 */

/**
 * Calculate confidence score for parsed data
 * @param {Object} options - Calculation options
 * @param {Object} options.parsedData - Extracted data from parsing
 * @param {Object} options.template - Template used for extraction (optional)
 * @param {number} options.ocrConfidence - OCR confidence score from provider (0-1, optional)
 * @param {string} options.fullText - Full extracted text
 * @param {string} options.processingMethod - Method used (e.g., 'local_coordinates', 'vision_api', 'document_ai')
 * @returns {number} Confidence score (0-100)
 */
function calculateConfidence({ parsedData = {}, template = null, ocrConfidence = null, fullText = '', processingMethod = '' }) {
  let confidenceScore = 0;
  
  // 1. Base OCR Confidence (if available from provider) - 40% weight
  if (ocrConfidence !== null && ocrConfidence !== undefined) {
    // OCR confidence is typically 0-1, convert to 0-100 scale
    const ocrScore = typeof ocrConfidence === 'number' ? ocrConfidence : parseFloat(ocrConfidence) || 0;
    confidenceScore += Math.min(ocrScore, 1.0) * 0.4; // Up to 40%
  } else {
    // Fallback: Use default confidence based on processing method
    if (processingMethod.includes('vision_api')) {
      confidenceScore += 0.85 * 0.4; // 34% (85% default * 40% weight)
    } else if (processingMethod.includes('document_ai')) {
      confidenceScore += 0.90 * 0.4; // 36% (90% default * 40% weight)
    } else if (processingMethod.includes('local_coordinates')) {
      confidenceScore += 0.80 * 0.4; // 32% (80% default for local * 40% weight)
    } else {
      confidenceScore += 0.70 * 0.4; // 28% (70% default * 40% weight)
    }
  }
  
  // 2. Template Field Matching (if template exists) - 35% weight
  if (template && template.coordinates) {
    const templateFields = Object.keys(template.coordinates || {});
    const extractedFields = Object.keys(parsedData || {}).filter(
      key => key !== 'fullText' && key !== 'fieldLabels' && parsedData[key] !== null && parsedData[key] !== undefined && parsedData[key] !== ''
    );
    
    if (templateFields.length > 0) {
      // Calculate match ratio
      const matchedFields = extractedFields.filter(field => {
        // Check if field matches template field (with or without template code prefix)
        return templateFields.some(tf => {
          const fieldWithoutPrefix = field.replace(new RegExp(`^${template.code}_`, 'i'), '');
          return tf === field || tf === fieldWithoutPrefix || field.includes(tf) || tf.includes(fieldWithoutPrefix);
        });
      });
      
      const matchRatio = matchedFields.length / templateFields.length;
      confidenceScore += matchRatio * 0.35; // Up to 35%
      
      // Bonus for mandatory fields (if settings available)
      if (template.mandatoryFields && Array.isArray(template.mandatoryFields)) {
        const mandatoryFields = template.mandatoryFields;
        const mandatoryFound = mandatoryFields.filter(mf => {
          return extractedFields.some(ef => {
            const fieldWithoutPrefix = ef.replace(new RegExp(`^${template.code}_`, 'i'), '');
            return mf === ef || mf === fieldWithoutPrefix || ef.includes(mf) || mf.includes(fieldWithoutPrefix);
          });
        });
        
        if (mandatoryFields.length > 0) {
          const mandatoryRatio = mandatoryFound.length / mandatoryFields.length;
          // Add bonus up to 10% for mandatory fields
          confidenceScore += mandatoryRatio * 0.10;
        }
      }
    }
  } else {
    // No template: Use basic field detection - 25% weight
    const hasInvoiceNumber = parsedData?.invoiceNumber ? 0.15 : 0;
    const hasDate = parsedData?.date ? 0.10 : 0;
    confidenceScore += hasInvoiceNumber + hasDate;
  }
  
  // 3. Text Quality Indicators - 15% weight
  if (fullText && fullText.length > 0) {
    // Text length indicator (up to 10%)
    const textLengthScore = Math.min(fullText.length / 2000, 0.10); // Max at 2000 chars
    confidenceScore += textLengthScore;
    
    // Amount field presence (5%)
    const hasAmount = parsedData?.amount || parsedData?.total || parsedData?.invoiceTotal ? 0.05 : 0;
    confidenceScore += hasAmount;
  }
  
  // 4. Data Quality Checks - 10% weight
  // Check if extracted values look valid
  let qualityScore = 0;
  if (parsedData?.invoiceNumber && parsedData.invoiceNumber.length > 0) {
    qualityScore += 0.03; // Invoice number has content
  }
  if (parsedData?.date && parsedData.date.length > 0) {
    qualityScore += 0.03; // Date has content
  }
  if (parsedData?.amount || parsedData?.total || parsedData?.invoiceTotal) {
    const amountValue = parsedData.amount || parsedData.total || parsedData.invoiceTotal;
    // Check if amount looks like a number/currency
    if (typeof amountValue === 'number' || (typeof amountValue === 'string' && /[\d.,£$€]/.test(amountValue))) {
      qualityScore += 0.04; // Amount looks valid
    }
  }
  confidenceScore += Math.min(qualityScore, 0.10);
  
  // Cap at 100% (1.0)
  confidenceScore = Math.min(confidenceScore, 1.0);
  
  // Convert to percentage (0-100)
  return Math.round(confidenceScore * 100);
}

module.exports = {
  calculateConfidence
};

