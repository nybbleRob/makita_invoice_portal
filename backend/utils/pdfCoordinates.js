/**
 * PDF coordinate-based text extraction
 * Uses pdf-parse for basic operations and pdfjs-dist for coordinate-based extraction
 */

const pdfParse = require('pdf-parse');
let pdfjsLib = null;
let pdfjsLoadPromise = null;

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

// Lazy load pdfjs-dist only when needed (using dynamic import for ES modules)
async function getPdfjsLib() {
  if (pdfjsLib) {
    return pdfjsLib;
  }
  
  if (pdfjsLoadPromise) {
    return pdfjsLoadPromise;
  }
  
  pdfjsLoadPromise = (async () => {
    try {
      // pdfjs-dist 5.x uses ES modules, so we need dynamic import
      // Try the legacy CommonJS build first for better Node.js compatibility
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjsLib = pdfjs.default || pdfjs;
        console.log('✅ pdfjs-dist loaded (legacy build)');
        return pdfjsLib;
      } catch (legacyError) {
        // Fall back to main build
        const pdfjs = await import('pdfjs-dist');
        pdfjsLib = pdfjs.default || pdfjs;
        console.log('✅ pdfjs-dist loaded (main build)');
        return pdfjsLib;
      }
    } catch (error) {
      console.error('❌ Failed to load pdfjs-dist:', error.message);
      throw new Error(`pdfjs-dist failed to load: ${error.message}. Please ensure pdfjs-dist is installed: npm install pdfjs-dist`);
    }
  })();
  
  return pdfjsLoadPromise;
}

// Page cache to avoid reloading the same page multiple times
// Key format: `${pdfFingerprint}-${pageNum}`
const pageCache = new Map();

/**
 * Get cached page data (page object, viewport, textContent)
 * @param {Object} pdf - PDF document object from pdfjs-dist
 * @param {number} pageNum - Page number (1-indexed)
 * @returns {Promise<Object>} - { page, viewport, textContent }
 */
async function getCachedPageData(pdf, pageNum) {
  // Use PDF fingerprint as cache key (unique per PDF document)
  const pdfFingerprint = pdf.fingerprints && pdf.fingerprints.length > 0 
    ? pdf.fingerprints[0] 
    : `pdf-${Date.now()}`;
  const cacheKey = `${pdfFingerprint}-${pageNum}`;
  
  if (!pageCache.has(cacheKey)) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();
    pageCache.set(cacheKey, { page, viewport, textContent });
  }
  
  return pageCache.get(cacheKey);
}

/**
 * Extract text from a specific region in a PDF using normalized coordinates (0-1 system)
 * This is the bulletproof approach - converts text item coordinates to normalized and compares
 * @param {Buffer} pdfBuffer - PDF file buffer (optional if pdfDoc is provided)
 * @param {Object} coordinates - { left, top, right, bottom, page } (all 0-1 normalized)
 * @param {Object} pdfDoc - Optional: Already-loaded PDF document object (avoids reloading)
 * @returns {Promise<string>} - Extracted text
 */
async function extractTextFromNormalizedRegion(pdfBuffer, coordinates, pdfDoc = null) {
  try {
    let pdf = pdfDoc;
    
    // Only load PDF if not provided (optimization: reuse already-loaded PDF)
    if (!pdf) {
      // Convert Buffer to Uint8Array for pdfjs-dist
      const pdfData = pdfBuffer instanceof Buffer 
        ? new Uint8Array(pdfBuffer) 
        : pdfBuffer instanceof Uint8Array 
          ? pdfBuffer 
          : new Uint8Array(pdfBuffer);
      
      const pdfjs = await getPdfjsLib();
      const loadingTask = pdfjs.getDocument({ data: pdfData });
      pdf = await loadingTask.promise;
    }
    
    if (coordinates.page > pdf.numPages) {
      throw new Error(`Page ${coordinates.page} does not exist in PDF`);
    }
    
    // Use cached page data to avoid reloading the same page
    const { viewport, textContent } = await getCachedPageData(pdf, coordinates.page);
    
    // Normalized coordinates from frontend (0-1 system, top-left origin)
    const zoneLeft = parseFloat(coordinates.left);
    const zoneTop = parseFloat(coordinates.top);
    const zoneRight = parseFloat(coordinates.right);
    const zoneBottom = parseFloat(coordinates.bottom);
    
    const pageWidth = viewport.width;
    const pageHeight = viewport.height;
    
    console.log(`\n🔍 Extracting text from normalized region:`);
    console.log(`   Normalized zone: left=${zoneLeft.toFixed(4)}, top=${zoneTop.toFixed(4)}, right=${zoneRight.toFixed(4)}, bottom=${zoneBottom.toFixed(4)}`);
    console.log(`   Page size: ${pageWidth.toFixed(2)} × ${pageHeight.toFixed(2)} pt`);
    
    // Convert each text item's coordinates to normalized (0-1) and compare
    // PDF text items have coordinates in PDF points with bottom-left origin
    const items = [];
    
    for (const item of textContent.items) {
      const transform = item.transform;
      const itemX = transform[4]; // x position in PDF points (from left)
      const itemY = transform[5]; // y position in PDF points (from bottom)
      
      // Convert PDF coordinates to normalized (0-1)
      // X: straightforward (left to right)
      const normalizedX = itemX / pageWidth;
      
      // Y: PDF uses bottom-left origin, normalized uses top-left origin
      // So we need to flip: normalizedY = 1 - (itemY / pageHeight)
      const normalizedY = 1 - (itemY / pageHeight);
      
      // Check if normalized coordinates fall within the zone
      // We also need to account for text item width/height, but for simplicity
      // we'll check if the item's position (typically the baseline) is within bounds
      const inXRange = normalizedX >= zoneLeft && normalizedX <= zoneRight;
      const inYRange = normalizedY >= zoneTop && normalizedY <= zoneBottom;
      
      if (inXRange && inYRange) {
        items.push(item);
        console.log(`     ✓ Found: "${item.str}" at PDF(${itemX.toFixed(1)}, ${itemY.toFixed(1)}) → Normalized(${normalizedX.toFixed(4)}, ${normalizedY.toFixed(4)})`);
      }
    }
    
    console.log(`   Found ${items.length} text items in region`);
    
    // Combine text from items, preserving order
    // Sort by Y (top to bottom) then X (left to right) for natural reading order
    items.sort((a, b) => {
      // Convert PDF Y coordinates to normalized (0-1, top to bottom)
      // PDF uses bottom-left origin, normalized uses top-left origin
      const aY = 1 - (a.transform[5] / pageHeight); // Normalized Y (0 = top, 1 = bottom)
      const bY = 1 - (b.transform[5] / pageHeight);
      
      // First sort by Y (top to bottom) - smaller Y values first (top of page)
      if (Math.abs(aY - bY) > 0.01) { // Different lines (tolerance for same line)
        return aY - bY; // Top to bottom (smaller Y = higher on page)
      }
      
      // Same line, sort by X (left to right) - smaller X values first
      return a.transform[4] - b.transform[4]; // Left to right
    });
    
    // Join items with spaces, but preserve the order
    const text = items.map(item => item.str).join(' ').trim();
    
    return text;
  } catch (error) {
    throw new Error(`Failed to extract text from normalized region: ${error.message}`);
  }
}

/**
 * Extract text from a specific region in a PDF (legacy function using PDF points)
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {Object} coordinates - { x, y, width, height, page }
 * @returns {Promise<string>} - Extracted text
 */
async function extractTextFromRegion(pdfBuffer, coordinates) {
  try {
    // Convert Buffer to Uint8Array for pdfjs-dist
    const pdfData = pdfBuffer instanceof Buffer 
      ? new Uint8Array(pdfBuffer) 
      : pdfBuffer instanceof Uint8Array 
        ? pdfBuffer 
        : new Uint8Array(pdfBuffer);
    
    const pdfjs = await getPdfjsLib();
    const loadingTask = pdfjs.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;
    
    if (coordinates.page > pdf.numPages) {
      throw new Error(`Page ${coordinates.page} does not exist in PDF`);
    }
    
    const page = await pdf.getPage(coordinates.page);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();
    
    // PDF coordinates: origin is at bottom-left
    // We need to convert from top-left coordinates (from UI) to bottom-left
    const pageHeight = viewport.height;
    const adjustedY = pageHeight - coordinates.y - coordinates.height;
    
    // Filter text items within the coordinate bounds
    const items = textContent.items.filter(item => {
      const transform = item.transform;
      const x = transform[4]; // x position
      const y = transform[5]; // y position (from bottom)
      
      return x >= coordinates.x && 
             x <= (coordinates.x + coordinates.width) &&
             y >= adjustedY && 
             y <= (adjustedY + coordinates.height);
    });
    
    // Combine text from items
    const text = items.map(item => item.str).join(' ').trim();
    
    return text;
  } catch (error) {
    throw new Error(`Failed to extract text from region: ${error.message}`);
  }
}

/**
 * Get PDF page dimensions
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {number} pageNumber - Page number (1-indexed)
 * @returns {Promise<Object>} - { width, height, numPages }
 */
async function getPageDimensions(pdfBuffer, pageNumber = 1) {
  try {
    // Use pdf-parse for simple dimension extraction (no native dependencies)
    const pdfData = await pdfParse(pdfBuffer);
    return {
      width: 612, // Standard US Letter width in points
      height: 792, // Standard US Letter height in points  
      numPages: pdfData.numpages
    };
  } catch (error) {
    throw new Error(`Failed to get page dimensions: ${error.message}`);
  }
}

/**
 * Render PDF page as image for preview
 * Note: This function is not used - PDF preview is handled by frontend using base64 data URL
 */
async function renderPageAsImage(pdfBuffer, pageNumber = 1, scale = 1.5) {
  // Not implemented - frontend handles PDF rendering via iframe with base64 data URL
  return {
    width: 0,
    height: 0,
    scale: scale
  };
}

module.exports = {
  extractTextFromRegion, // Legacy function (PDF points)
  extractTextFromNormalizedRegion, // New bulletproof function (normalized 0-1)
  getPageDimensions,
  renderPageAsImage,
  getCachedPageData // Export for use in SupplierTemplate.js
};
