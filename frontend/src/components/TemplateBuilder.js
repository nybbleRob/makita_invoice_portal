import React, { useState, useRef, useEffect, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import api from '../services/api';
import toast from '../utils/toast';
import { getAvailableFields } from '../utils/standardFields';

// Set up pdfjs worker - use local file from public folder
pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ''}/pdf.worker.js`;

// Suppress font warnings from pdfjs (harmless but annoying)
if (typeof window !== 'undefined') {
  const originalWarn = console.warn;
  console.warn = (...args) => {
    if (args[0] && typeof args[0] === 'string' && args[0].includes('TT: undefined function')) {
      return; // Suppress font warnings
    }
    originalWarn.apply(console, args);
  };
}

const TemplateBuilder = ({ template, onSave, onCancel }) => {
  
  // Generate template code from name (same logic as backend)
  const generateTemplateCode = (name) => {
    if (!name) return '';
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  };
  
  const templateType = template?.templateType || 'invoice';
  
  // Get all available fields from standardFields based on template type (mandatory + optional)
  // This includes mandatory fields plus optional fields like goodsAmount for invoices
  const REQUIRED_FIELDS = useMemo(() => {
    const available = getAvailableFields(templateType);
    // Sort: documentType first, then mandatory/crucial fields, then optional fields
    return available.sort((a, b) => {
      if (a.standardName === 'documentType') return -1;
      if (b.standardName === 'documentType') return 1;
      if (a.isCrucial && !b.isCrucial) return -1;
      if (!a.isCrucial && b.isCrucial) return 1;
      if (a.isMandatory && !b.isMandatory) return -1;
      if (!a.isMandatory && b.isMandatory) return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [templateType]);
  
  // Initialize fields from template or create empty mandatory fields
  const initializeFields = () => {
    const templateCode = template?.code || generateTemplateCode(template?.name || '');
    
    return REQUIRED_FIELDS.map(field => {
      // Use standard field name directly (no template prefix in UI)
      const standardName = field.standardName;
      
      // Check if this field exists in template coordinates
      let hasCoordinates = false;
      let coordinates = null;
      
      if (template?.coordinates) {
        // Check both with and without template prefix (for backward compatibility)
        // Also check for old naming (e.g., document_type vs documentType)
        const prefixedId = templateCode ? `${templateCode}_${standardName}` : standardName;
        const oldSnakeCase = standardName.replace(/([A-Z])/g, '_$1').toLowerCase();
        const prefixedOld = templateCode ? `${templateCode}_${oldSnakeCase}` : oldSnakeCase;
        
        const coords = template.coordinates[prefixedId] || 
                      template.coordinates[standardName] || 
                      template.coordinates[prefixedOld] ||
                      template.coordinates[oldSnakeCase];
        
        if (coords && (
          (coords.normalized && coords.normalized.left !== undefined) ||
          (coords.x !== undefined && coords.y !== undefined && coords.width && coords.height)
        )) {
          hasCoordinates = true;
          coordinates = coords;
        }
      }
      
      return {
        standardName: standardName,
        label: field.displayName,
        mapsTo: standardName,
        required: field.isMandatory,
        isCrucial: field.isCrucial,
        hasCoordinates: hasCoordinates,
        coordinates: coordinates
      };
    });
  };
  
  const initialFields = initializeFields();
  
  const [templateData, setTemplateData] = useState({
    name: template?.name || '',
    templateType: templateType,
    isDefault: template?.isDefault || false,
    fields: initialFields
  });

  // Keep regions for rendering (synced with fields)
  const [regions, setRegions] = useState(() => {
    // Convert fields to regions format for existing rendering code
    const templateCode = template?.code || generateTemplateCode(template?.name || '');
    const regionsList = [];
    
    initialFields.forEach(field => {
      if (field.hasCoordinates && field.coordinates) {
        const fieldId = templateCode ? `${templateCode}_${field.standardName}` : field.standardName;
        regionsList.push({
          fieldId: fieldId,
          label: field.label,
          ...field.coordinates,
          extractedText: ''
        });
      }
    });
    
    return regionsList;
  });
  
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfPage, setPdfPage] = useState(null);
  const [pdfDimensions, setPdfDimensions] = useState(null);
  const [currentPage, setCurrentPage] = useState(1); // Current page being viewed/edited
  const [totalPages, setTotalPages] = useState(1); // Total pages in PDF
  const [scale, setScale] = useState(1.0); // 100% zoom default
  const [drawingMode, setDrawingMode] = useState(false);
  const [pendingFieldLabel, setPendingFieldLabel] = useState(null); // Field label waiting for region drawing
  const [drawingBox, setDrawingBox] = useState(null);
  const [startPos, setStartPos] = useState(null);
  const [extractingRegion, setExtractingRegion] = useState(false);
  
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const renderTaskRef = useRef(null); // Track current render task to cancel if needed
  
  // Render PDF page on canvas
  const renderPDF = async (pdf, pageNum = 1) => {
    try {
      // Cancel any previous render task
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch (e) {
          // Ignore cancellation errors
        }
        renderTaskRef.current = null;
      }
      
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      
      setPdfPage(page);
      
      // Get actual PDF page dimensions (in points, not viewport pixels)
      const pdfPageSize = page.view;
      const pdfPageWidth = pdfPageSize[2] - pdfPageSize[0]; // right - left
      const pdfPageHeight = pdfPageSize[3] - pdfPageSize[1]; // top - bottom
      
      setPdfDimensions({
        width: viewport.width, // Display width in pixels
        height: viewport.height, // Display height in pixels
        pdfWidth: pdfPageWidth, // PDF width in points
        pdfHeight: pdfPageHeight, // PDF height in points
        numPages: pdf.numPages
      });
      
      // Update total pages
      setTotalPages(pdf.numPages);
      
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        
        // Clear the canvas first to avoid rendering artifacts
        context.clearRect(0, 0, canvas.width, canvas.height);
        
        // Handle device pixel ratio for high-DPI displays
        const devicePixelRatio = window.devicePixelRatio || 1;
        const displayWidth = viewport.width;
        const displayHeight = viewport.height;
        
        // Set actual canvas size in memory (scaled by device pixel ratio)
        canvas.width = displayWidth * devicePixelRatio;
        canvas.height = displayHeight * devicePixelRatio;
        
        // Scale the canvas back down using CSS
        canvas.style.width = displayWidth + 'px';
        canvas.style.height = displayHeight + 'px';
        
        // Scale the drawing context so everything draws at the correct size
        context.scale(devicePixelRatio, devicePixelRatio);
        
        const renderContext = {
          canvasContext: context,
          viewport: viewport
        };
        
        // Start render and track the task
        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;
        
        // Wait for render to complete
        await renderTask.promise;
        
        // Clear the reference once done
        renderTaskRef.current = null;
      }
    } catch (error) {
      // Ignore cancellation errors
      if (error.name === 'RenderingCancelledException' || error.message?.includes('cancelled')) {
        console.log('Render cancelled (this is normal when changing zoom/page)');
        return;
      }
      console.error('Error rendering PDF:', error);
      toast.error('Failed to render PDF: ' + error.message);
      renderTaskRef.current = null;
    }
  };
  
  // Navigate to a specific page
  const goToPage = async (pageNum) => {
    if (!pdfDoc || pageNum < 1 || pageNum > totalPages) return;
    setCurrentPage(pageNum);
    await renderPDF(pdfDoc, pageNum);
  };
  
  // Navigate to next page
  const nextPage = async () => {
    if (currentPage < totalPages) {
      await goToPage(currentPage + 1);
    }
  };
  
  // Navigate to previous page
  const prevPage = async () => {
    if (currentPage > 1) {
      await goToPage(currentPage - 1);
    }
  };
  
  // Load PDF from file or stored path
  const loadPDF = async (source) => {
    try {
      let pdfData;
      
      if (source instanceof File) {
        const arrayBuffer = await source.arrayBuffer();
        pdfData = { data: arrayBuffer };
      } else if (typeof source === 'string') {
        // Base64 data URL
        const base64Data = source.split(',')[1];
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        pdfData = { data: bytes };
      }
      
      const loadingTask = pdfjsLib.getDocument(pdfData);
      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      setCurrentPage(1); // Reset to page 1 when loading new PDF
      await renderPDF(pdf, 1);
    } catch (error) {
      console.error('Error loading PDF:', error);
      toast.error('Failed to load PDF: ' + error.message);
    }
  };
  
  // Load stored PDF when editing existing template
  useEffect(() => {
    if (template?.id && template?.samplePdfPath && !pdfFile && !pdfDoc) {
      api.get(`/api/templates/${template.id}/pdf`)
        .then(res => {
          loadPDF(res.data.pdfData);
        })
        .catch(err => {
          console.warn('Could not load stored PDF:', err.response?.data?.message || err.message);
        });
    }
  }, [template?.id, template?.samplePdfPath]);
  
  // Compute template code from current name (updates when name changes)
  // Use template code from template if available, otherwise generate from current name
  const templateCode = useMemo(() => {
    return template?.code || generateTemplateCode(templateData.name || template?.name || '');
  }, [template?.code, templateData.name, template?.name]);
  
  // Check if document_type exists and is configured (with valid coordinates)
  const hasDocumentType = templateData.fields.some(f => 
    f.standardName === 'documentType' && f.hasCoordinates
  );
  
  // Handle PDF file selection
  const handlePdfSelect = (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'application/pdf') {
      setPdfFile(file);
      loadPDF(file);
    } else {
      toast.error('Please select a PDF file');
    }
  };
  
  // Start drawing box
  const handleMouseDown = (e) => {
    if (!drawingMode || !containerRef.current || !canvasRef.current) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    // Get canvas position relative to viewport (CSS pixels)
    const canvasRect = canvasRef.current.getBoundingClientRect();
    
    // Calculate coordinates in CSS pixels (display size, not internal canvas size)
    const x = e.clientX - canvasRect.left;
    const y = e.clientY - canvasRect.top;
    
    // Clamp to canvas display bounds
    const clampedX = Math.max(0, Math.min(x, canvasRect.width));
    const clampedY = Math.max(0, Math.min(y, canvasRect.height));
    
    console.log('🎯 Mouse down:', { x, y, clampedX, clampedY, canvasRect });
    
    setStartPos({ x: clampedX, y: clampedY });
    setDrawingBox({ x: clampedX, y: clampedY, width: 0, height: 0 });
  };
  
  // Update drawing box
  const handleMouseMove = (e) => {
    if (!drawingMode || !startPos || !containerRef.current || !canvasRef.current) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const canvasRect = canvasRef.current.getBoundingClientRect();
    
    // Calculate coordinates in CSS pixels (display size)
    const x = e.clientX - canvasRect.left;
    const y = e.clientY - canvasRect.top;
    
    // Clamp to canvas display bounds
    const clampedX = Math.max(0, Math.min(x, canvasRect.width));
    const clampedY = Math.max(0, Math.min(y, canvasRect.height));
    
    const newBox = {
      x: Math.min(startPos.x, clampedX),
      y: Math.min(startPos.y, clampedY),
      width: Math.abs(clampedX - startPos.x),
      height: Math.abs(clampedY - startPos.y)
    };
    
    console.log('🖱️ Mouse move:', { x, y, clampedX, clampedY, newBox });
    
    setDrawingBox(newBox);
  };
  
  // Finish drawing box and extract text from region
  const handleMouseUp = async (e) => {
    if (!drawingMode || !startPos || !drawingBox || !pdfPage) return;
    
    // Only process if we actually drew a box
    if (drawingBox.width > 5 && drawingBox.height > 5) {
      // Use pendingFieldLabel (set from table button)
      const fieldLabel = pendingFieldLabel;
      
      if (!fieldLabel || !fieldLabel.trim()) {
        toast.error('Please enter a field label first');
        setDrawingMode(false);
        setDrawingBox(null);
        setStartPos(null);
        setPendingFieldLabel(null);
        return;
      }
      
      setExtractingRegion(true);
      
      try {
        // ====================================================================
        // NORMALIZED COORDINATE CONVERSION (0-1 system)
        // ====================================================================
        // This makes coordinates immune to zoom, screen size, DPI, resolution
        // 
        // Step 1: Get canvas display size (CSS pixels)
        // Step 2: Convert screen pixels → normalized (0-1) coordinates
        // Step 3: Store normalized coordinates in database
        // Step 4: When extracting, convert PDF coordinates → normalized
        // Step 5: Compare normalized values → perfect match every time
        // ====================================================================
        
        const canvasRect = canvasRef.current.getBoundingClientRect();
        const viewWidth = canvasRect.width;  // Display width in CSS pixels
        const viewHeight = canvasRect.height; // Display height in CSS pixels
        
        // Convert screen pixels to normalized coordinates (0-1)
        // left: x position as fraction of width
        // top: y position as fraction of height  
        // right: (x + width) as fraction of width
        // bottom: (y + height) as fraction of height
        const left = drawingBox.x / viewWidth;
        const top = drawingBox.y / viewHeight;
        const right = (drawingBox.x + drawingBox.width) / viewWidth;
        const bottom = (drawingBox.y + drawingBox.height) / viewHeight;
        
        // Clamp to 0-1 range
        const normalizedCoords = {
          left: Math.max(0, Math.min(1, left)),
          top: Math.max(0, Math.min(1, top)),
          right: Math.max(0, Math.min(1, right)),
          bottom: Math.max(0, Math.min(1, bottom))
        };
        
        // Also get PDF page dimensions for reference (in points)
        const pdfPageSize = pdfPage.view;
        const pdfPageWidth = pdfPageSize[2] - pdfPageSize[0];
        const pdfPageHeight = pdfPageSize[3] - pdfPageSize[1];
        
        // Convert normalized to PDF points for extraction
        // PDF coordinates use bottom-left origin, so we need to flip Y
        const pdfX = normalizedCoords.left * pdfPageWidth;
        const pdfWidth_coord = (normalizedCoords.right - normalizedCoords.left) * pdfPageWidth;
        const pdfHeight_coord = (normalizedCoords.bottom - normalizedCoords.top) * pdfPageHeight;
        const pdfY = pdfPageHeight - (normalizedCoords.bottom * pdfPageHeight); // Flip Y: bottom-left origin
        
        console.log('\n========== NORMALIZED COORDINATE CONVERSION ==========');
        console.log('Screen coordinates (CSS pixels):');
        console.log('  x:', drawingBox.x, 'px');
        console.log('  y:', drawingBox.y, 'px');
        console.log('  width:', drawingBox.width, 'px');
        console.log('  height:', drawingBox.height, 'px');
        console.log('  viewWidth:', viewWidth, 'px');
        console.log('  viewHeight:', viewHeight, 'px');
        
        console.log('\nNormalized coordinates (0-1, zoom/resolution independent):');
        console.log('  left:', normalizedCoords.left.toFixed(4));
        console.log('  top:', normalizedCoords.top.toFixed(4));
        console.log('  right:', normalizedCoords.right.toFixed(4));
        console.log('  bottom:', normalizedCoords.bottom.toFixed(4));
        
        console.log('\nPDF coordinates (points, for extraction):');
        console.log('  x:', pdfX.toFixed(2), 'pt');
        console.log('  y:', pdfY.toFixed(2), 'pt (bottom-left origin)');
        console.log('  width:', pdfWidth_coord.toFixed(2), 'pt');
        console.log('  height:', pdfHeight_coord.toFixed(2), 'pt');
        console.log('  PDF page size:', pdfPageWidth, '×', pdfPageHeight, 'pt');
        console.log('======================================================\n');
        
        // Extract text from this specific region
        const formData = new FormData();
        
        // If we have a file, use it; otherwise use template ID
        if (pdfFile) {
          formData.append('pdf', pdfFile);
        } else if (template?.id) {
          formData.append('templateId', template.id);
        } else {
          throw new Error('No PDF available. Please upload a PDF first.');
        }
        
        // Send ONLY normalized coordinates (0-1 system) - bulletproof approach!
        // The backend will convert text item coordinates to normalized and compare
        formData.append('left', normalizedCoords.left);
        formData.append('top', normalizedCoords.top);
        formData.append('right', normalizedCoords.right);
        formData.append('bottom', normalizedCoords.bottom);
        formData.append('page', currentPage);
        
        console.log('\n📤 Sending request to backend:');
        console.log('  URL: /api/templates/extract-region-text');
        console.log('  Normalized coordinates (0-1):', normalizedCoords);
        console.log('  Has PDF file:', !!pdfFile);
        console.log('  Template ID:', template?.id);
        
        const response = await api.post('/api/templates/extract-region-text', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        
        console.log('✅ Backend response received');
        
        const extractedText = response.data.text || '';
        const itemCount = response.data.itemCount || 0;
        
        console.log('\n========== EXTRACTION RESULT ==========');
        console.log('Extracted text:', extractedText || '(empty)');
        console.log('Text length:', extractedText.length);
        console.log('Item count:', itemCount);
        console.log('Full response:', JSON.stringify(response.data, null, 2));
        console.log('==========================================\n');
        
        if (!extractedText.trim()) {
          toast.warning(`No text found in this region (checked ${itemCount} items). Try a different area or check console for details.`);
          console.warn('⚠️  No text extracted. Check backend terminal for coordinate details.');
        } else {
          toast.success(`Found ${itemCount} text item(s): "${extractedText.substring(0, 50)}${extractedText.length > 50 ? '...' : ''}"`);
        }
        
        // Find the field by label (from standard fields)
        const field = templateData.fields.find(f => f.label === fieldLabel);
        if (!field) {
          toast.error(`Field "${fieldLabel}" not found`);
          return;
        }
        
        const standardName = field.standardName;
        const fieldId = templateCode ? `${templateCode}_${standardName}` : standardName;
        
        // Update the field with coordinates
        setTemplateData(prev => ({
          ...prev,
          fields: prev.fields.map(f => 
            f.standardName === standardName
              ? {
                  ...f,
                  hasCoordinates: true,
                  coordinates: {
                    x: pdfX,
                    y: pdfY,
                    width: pdfWidth_coord,
                    height: pdfHeight_coord,
                    page: currentPage,
                    normalized: normalizedCoords,
                    label: fieldLabel
                  }
                }
              : f
          )
        }));
        
        // Also update regions for rendering (keep in sync)
        setRegions(prev => {
          const existingIndex = prev.findIndex(r => r.fieldId === fieldId);
          const regionData = {
            fieldId,
            label: fieldLabel,
            x: pdfX,
            y: pdfY,
            width: pdfWidth_coord,
            height: pdfHeight_coord,
            page: currentPage,
            normalized: normalizedCoords,
            extractedText
          };
          
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = regionData;
            return updated;
          } else {
            return [...prev, regionData];
          }
        });
        
        // Reset form
        setPendingFieldLabel(null);
        toast.success(`Area defined for: ${fieldLabel}`);
      } catch (error) {
        console.error('Error extracting region text:', error);
        toast.error('Failed to extract text from region: ' + (error.response?.data?.message || error.message));
      } finally {
        setExtractingRegion(false);
        setDrawingMode(false);
        setDrawingBox(null);
        setStartPos(null);
        setPendingFieldLabel(null);
      }
    } else {
      setDrawingMode(false);
      setDrawingBox(null);
      setStartPos(null);
      setPendingFieldLabel(null);
    }
  };
  
  // Save template
  const handleSave = async () => {
    if (!templateData.name.trim()) {
      toast.error('Template name is required');
      return;
    }
    
    // Ensure at least one field has coordinates
    const fieldsWithCoordinates = templateData.fields.filter(f => f.hasCoordinates);
    if (fieldsWithCoordinates.length === 0) {
      toast.error('Please define at least one field area');
      return;
    }
    
    // Ensure document_type exists and is configured
    if (!hasDocumentType) {
      toast.error('Document Type area is required. Please define it first.');
      return;
    }
    
    // Get template code for field ID prefixing (use existing template code or generate from name)
    const saveTemplateCode = template?.code || generateTemplateCode(templateData.name);
    
    // Convert fields to coordinates format - use standard field names directly
    const coordinates = {};
    
    // Get PDF page dimensions for coordinate conversion
    const pdfPageSize = pdfPage?.view;
    const pdfPageWidth = pdfPageSize ? (pdfPageSize[2] - pdfPageSize[0]) : (pdfDimensions?.width || 612);
    const pdfPageHeight = pdfPageSize ? (pdfPageSize[3] - pdfPageSize[1]) : (pdfDimensions?.height || 792);
    
    templateData.fields.forEach(field => {
      // Only include fields with coordinates
      if (field.hasCoordinates && field.coordinates) {
        const coords = field.coordinates;
        
        // Use standard field name directly (no template prefix in storage)
        // Backend will handle mapping
        const fieldId = saveTemplateCode ? `${saveTemplateCode}_${field.standardName}` : field.standardName;
        
        // Calculate PDF coordinates from normalized if not already stored
        let pdfX, pdfY, pdfWidth, pdfHeight;
        
        if (coords.x !== undefined && coords.y !== undefined && coords.width && coords.height) {
          // Use existing PDF coordinates if available
          pdfX = coords.x;
          pdfY = coords.y;
          pdfWidth = coords.width;
          pdfHeight = coords.height;
        } else if (coords.normalized) {
          // Calculate PDF coordinates from normalized
          pdfX = coords.normalized.left * pdfPageWidth;
          pdfWidth = (coords.normalized.right - coords.normalized.left) * pdfPageWidth;
          pdfHeight = (coords.normalized.bottom - coords.normalized.top) * pdfPageHeight;
          // PDF uses bottom-left origin, so flip Y
          pdfY = pdfPageHeight - (coords.normalized.bottom * pdfPageHeight);
        } else {
          return; // Skip if no valid coordinates
        }
        
        coordinates[fieldId] = {
          x: pdfX,
          y: pdfY,
          width: pdfWidth,
          height: pdfHeight,
          page: coords.page || 1,
          // Store normalized coordinates for accurate display (required!)
          normalized: coords.normalized,
          // Store the label so we can display it in parsing results
          label: field.label
        };
      }
    });

    // Double-check that document_type is in coordinates
    const docTypeFieldId = saveTemplateCode ? `${saveTemplateCode}_documentType` : 'documentType';
    if (!coordinates[docTypeFieldId]) {
      toast.error('Document Type area is missing. Please define it first.');
      return;
    }
    
    // Generate template code from name (same as backend)
    const code = generateTemplateCode(templateData.name);
    
    if (!code) {
      toast.error('Template name is required');
      return;
    }
    
    const formData = new FormData();
    formData.append('name', templateData.name);
    formData.append('templateType', templateData.templateType);
    formData.append('fileType', 'pdf');
    formData.append('coordinates', JSON.stringify(coordinates));
    formData.append('isDefault', templateData.isDefault || false);
    if (pdfFile) {
      // POST route expects 'sampleExcel' (backend checks fileType to determine storage)
      // PUT route expects 'samplePdf'
      if (template?.id) {
        formData.append('samplePdf', pdfFile);
      } else {
        formData.append('sampleExcel', pdfFile); // Backend will handle based on fileType='pdf'
      }
    }
    
    try {
      // Debug: Log what we're sending
      console.log('Saving PDF template with coordinates:', coordinates);
      console.log('Document Type field ID:', docTypeFieldId);
      console.log('Has document_type in coordinates:', !!coordinates[docTypeFieldId]);
      
      if (template?.id) {
        await api.put(`/api/templates/${template.id}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        toast.success('Template updated successfully');
      } else {
        await api.post('/api/templates', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        toast.success('Template created successfully');
      }
      
      if (onSave) onSave();
    } catch (err) {
      console.error('Error saving template:', err);
      console.error('Error response:', err.response?.data);
      const errorMessage = err.response?.data?.message || err.message || 'Unknown error';
      toast.error('Failed to save template: ' + errorMessage);
    }
  };
  
  // Re-render when scale or currentPage changes
  useEffect(() => {
    if (pdfDoc) {
      renderPDF(pdfDoc, currentPage);
    }
  }, [scale, currentPage]);
  
  return (
    <div className="row" style={{ height: 'calc(100vh - 200px)' }}>
      {/* Field Mapper - Left Column (33%) */}
      <div className="col-md-4">
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Template Configuration</h3>
          </div>
          <div className="card-body">
            {/* Template Name */}
            <div className="mb-3">
              <label className="form-label">
                Template Name <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                className="form-control"
                value={templateData.name}
                onChange={(e) => setTemplateData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Makita Invoice Template"
                required
                readOnly={!!template?.id}
                disabled={!!template?.id}
              />
              <small className="text-muted">
                Code: <code>{generateTemplateCode(templateData.name) || 'template_name'}</code>
              </small>
            </div>
            
            {/* Template Type - Read Only */}
            <div className="mb-3">
              <label className="form-label">Template Type</label>
              <input
                type="text"
                className="form-control"
                value={templateData.templateType === 'invoice' ? 'Invoice' : templateData.templateType === 'credit_note' ? 'Credit Note' : 'Statement'}
                readOnly
                disabled
                style={{ backgroundColor: '#f5f5f5', cursor: 'not-allowed' }}
              />
            </div>
            
            {/* Is Default Checkbox */}
            <div className="mb-3">
              <label className="form-check form-switch">
                <input
                  className="form-check-input"
                  type="checkbox"
                  checked={templateData.isDefault || false}
                  onChange={(e) => setTemplateData(prev => ({ ...prev, isDefault: e.target.checked }))}
                />
                <span className="form-check-label">Set as default template for this type</span>
              </label>
            </div>
            
            <hr />
            
            <h4 className="card-title mb-3">Field Mapper</h4>
            <div className="table-responsive">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Maps To</th>
                    <th>Define Area</th>
                  </tr>
                </thead>
                <tbody>
                  {templateData.fields.map((field) => {
                    const fieldHasCoordinates = field.hasCoordinates;
                    const isDefining = drawingMode && pendingFieldLabel === field.label;
                    
                    return (
                      <tr 
                        key={field.standardName} 
                        className={!fieldHasCoordinates && field.required ? 'table-warning' : ''}
                      >
                        <td>
                          <strong>{field.label}</strong>
                          {field.isCrucial && (
                            <span className="badge bg-danger-lt ms-2" title="Crucial field - must parse correctly">Crucial</span>
                          )}
                          {field.required && !field.isCrucial && (
                            <span className="badge bg-warning-lt ms-2" title="Required field">Required</span>
                          )}
                          {field.hasCoordinates && field.coordinates?.page && (
                            <span className="badge bg-info-lt ms-2" title={`Extracted from page ${field.coordinates.page}`}>
                              Page {field.coordinates.page}
                            </span>
                          )}
                        </td>
                        <td>
                          <small className="text-muted">{field.mapsTo}</small>
                        </td>
                        <td>
                          {fieldHasCoordinates ? (
                            <div className="d-flex gap-2 align-items-center">
                              <span className="badge bg-success-lt">Defined</span>
                              <button
                                className="btn btn-sm btn-outline-primary"
                                onClick={() => {
                                  setPendingFieldLabel(field.label);
                                  setDrawingMode(true);
                                  // Navigate to the page where this field is defined (if it has coordinates)
                                  if (field.coordinates?.page && field.coordinates.page !== currentPage) {
                                    goToPage(field.coordinates.page);
                                  }
                                  // Remove existing coordinates to allow redraw
                                  setTemplateData(prev => ({
                                    ...prev,
                                    fields: prev.fields.map(f => 
                                      f.standardName === field.standardName 
                                        ? { ...f, hasCoordinates: false, coordinates: null }
                                        : f
                                    )
                                  }));
                                }}
                                disabled={drawingMode || extractingRegion}
                                title="Redefine area"
                              >
                                ↻
                              </button>
                            </div>
                          ) : (
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => {
                                setPendingFieldLabel(field.label);
                                setDrawingMode(true);
                              }}
                              disabled={!pdfDoc || drawingMode || extractingRegion}
                            >
                              {isDefining ? 'Drawing...' : 'Define Area'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            {drawingMode && pendingFieldLabel && (
              <div className="alert alert-info mt-3">
                <strong>Drawing mode active</strong>
                <p className="mb-0 mt-1">Field: <strong>{pendingFieldLabel}</strong></p>
                <p className="mb-0">Click and drag on the PDF to select a region</p>
                <button
                  className="btn btn-sm btn-secondary mt-2"
                  onClick={() => {
                    setDrawingMode(false);
                    setDrawingBox(null);
                    setStartPos(null);
                    setPendingFieldLabel(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
            
            <div className="mt-3">
              <button
                className="btn btn-success w-100"
                onClick={handleSave}
                disabled={!templateData.name.trim() || !templateData.fields.some(f => f.hasCoordinates)}
              >
                {template?.id ? 'Update Template' : 'Save Template'}
              </button>
              <button className="btn btn-secondary w-100 mt-2" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* PDF Preview - Right Column (66%) */}
      <div className="col-8" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div className="card-header">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <h3 className="card-title mb-0">PDF Preview</h3>
              <div className="d-flex align-items-center gap-3 flex-wrap">
                {/* Page Navigation */}
                {totalPages > 1 && (
                  <>
                    <div className="d-flex gap-2 align-items-center">
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={prevPage}
                        disabled={currentPage === 1}
                        title="Previous page"
                      >
                        ← Prev
                      </button>
                      <span className="text-muted">
                        Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
                      </span>
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={nextPage}
                        disabled={currentPage === totalPages}
                        title="Next page"
                      >
                        Next →
                      </button>
                      {totalPages > 5 && (
                        <select
                          className="form-select form-select-sm"
                          style={{ width: 'auto' }}
                          value={currentPage}
                          onChange={(e) => goToPage(parseInt(e.target.value))}
                        >
                          {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                            <option key={page} value={page}>Page {page}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="text-warning small">
                      <strong>⚠️ Multi-page:</strong> Select regions on the correct page
                    </div>
                  </>
                )}
                <div className="d-flex align-items-center gap-2">
                  <label className="form-label mb-0">Zoom:</label>
                  <input
                    type="range"
                    className="form-range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={scale}
                    onChange={(e) => setScale(parseFloat(e.target.value))}
                    style={{ width: '100px' }}
                  />
                  <span className="text-muted">{Math.round(scale * 100)}%</span>
                </div>
              </div>
            </div>
          </div>
          <div className="card-body" style={{ flex: 1, overflow: 'auto', padding: 0 }}>
            {!pdfDoc ? (
              <div className="text-center p-5" style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handlePdfSelect}
                  className="form-control"
                  style={{ maxWidth: '400px', margin: '0 auto' }}
                />
                <p className="text-muted mt-3">Upload a sample PDF to define field regions</p>
              </div>
            ) : (
              <div
                ref={containerRef}
                style={{ 
                  position: 'relative', 
                  border: '1px solid #ddd',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'flex-start',
                  padding: '20px',
                  minHeight: '100%',
                  overflow: 'auto'
                }}
              >
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <canvas
                    ref={canvasRef}
                    style={{
                      border: '1px solid #ccc',
                      cursor: drawingMode ? 'crosshair' : 'default',
                      pointerEvents: 'none', // Canvas doesn't need pointer events - overlay handles them
                      display: 'block'
                    }}
                  />
                  
                  {/* Drawing overlay - positioned relative to canvas wrapper */}
                  {drawingMode && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        cursor: 'crosshair',
                        zIndex: 15,
                        backgroundColor: 'transparent',
                        pointerEvents: 'auto'
                      }}
                      onMouseDown={handleMouseDown}
                      onMouseMove={handleMouseMove}
                      onMouseUp={handleMouseUp}
                      onMouseLeave={handleMouseUp}
                    >
                      {extractingRegion && (
                        <div style={{
                          position: 'absolute',
                          top: '50%',
                          left: '50%',
                          transform: 'translate(-50%, -50%)',
                          backgroundColor: 'rgba(0, 0, 0, 0.8)',
                          color: 'white',
                          padding: '20px',
                          borderRadius: '8px',
                          zIndex: 20
                        }}>
                          <div className="spinner-border spinner-border-sm me-2" role="status" />
                          Extracting text from region...
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Draw existing regions using normalized coordinates - positioned relative to canvas wrapper */}
                  {/* Only show regions for the current page */}
                  {regions.filter(region => (region.page || 1) === currentPage).map((region, index) => {
                    if (!region.normalized && 
                        ((region.x === undefined || region.x === null) || 
                         (region.y === undefined || region.y === null) || 
                         !region.width || !region.height)) return null;
                    
                    const canvasRect = canvasRef.current?.getBoundingClientRect();
                    if (!canvasRect) return null;
                    
                    let displayX, displayY, displayWidth, displayHeight;
                    
                    if (region.normalized) {
                      // Use normalized coordinates (0-1) - zoom/resolution independent!
                      displayX = region.normalized.left * canvasRect.width;
                      displayY = region.normalized.top * canvasRect.height;
                      displayWidth = (region.normalized.right - region.normalized.left) * canvasRect.width;
                      displayHeight = (region.normalized.bottom - region.normalized.top) * canvasRect.height;
                    } else {
                      // Fallback: convert PDF coordinates (for old templates without normalized)
                      const viewport = pdfPage?.getViewport({ scale: 1.0 });
                      const pageHeight = viewport?.height || pdfDimensions?.height || 792;
                      const pageWidth = viewport?.width || pdfDimensions?.width || 612;
                      
                      // Convert PDF points to normalized, then to display pixels
                      const normalizedLeft = region.x / pageWidth;
                      const normalizedTop = 1 - ((region.y + region.height) / pageHeight); // Flip Y
                      const normalizedRight = (region.x + region.width) / pageWidth;
                      const normalizedBottom = 1 - (region.y / pageHeight); // Flip Y
                      
                      displayX = normalizedLeft * canvasRect.width;
                      displayY = normalizedTop * canvasRect.height;
                      displayWidth = (normalizedRight - normalizedLeft) * canvasRect.width;
                      displayHeight = (normalizedBottom - normalizedTop) * canvasRect.height;
                    }
                    
                    // Dim existing regions when drawing a new one
                    const isDrawing = drawingMode;
                    const regionOpacity = isDrawing ? 0.3 : 1;
                    
                    return (
                      <div
                        key={index}
                        style={{
                          position: 'absolute',
                          left: `${displayX}px`,
                          top: `${displayY}px`,
                          width: `${displayWidth}px`,
                          height: `${displayHeight}px`,
                          border: `2px solid rgba(32, 107, 196, ${regionOpacity})`,
                          backgroundColor: `rgba(32, 107, 196, ${0.1 * regionOpacity})`,
                          pointerEvents: 'none',
                          zIndex: 10,
                          opacity: regionOpacity,
                          transition: 'opacity 0.2s ease-in-out'
                        }}
                      >
                        <span style={{
                          position: 'absolute',
                          top: '-25px',
                          left: 0,
                          fontSize: '11px',
                          backgroundColor: `rgba(32, 107, 196, ${regionOpacity})`,
                          color: 'white',
                          padding: '2px 6px',
                          borderRadius: '3px',
                          whiteSpace: 'nowrap',
                          opacity: regionOpacity
                        }}>
                          {region.label}
                        </span>
                      </div>
                    );
                  })}
                  
                  {/* Drawing box - positioned relative to canvas wrapper */}
                  {drawingBox && (drawingBox.width > 0 || drawingBox.height > 0) && (
                    <div
                      style={{
                        position: 'absolute',
                        left: `${drawingBox.x}px`,
                        top: `${drawingBox.y}px`,
                        width: `${Math.max(1, drawingBox.width)}px`,
                        height: `${Math.max(1, drawingBox.height)}px`,
                        border: '3px dashed #206bc4',
                        backgroundColor: 'rgba(32, 107, 196, 0.2)',
                        pointerEvents: 'none',
                        zIndex: 20,
                        boxShadow: '0 0 8px rgba(32, 107, 196, 0.5)'
                      }}
                    />
                  )}
                  {/* Debug: Show drawing box state */}
                  {drawingBox && (
                    <div style={{
                      position: 'absolute',
                      top: '-30px',
                      left: 0,
                      fontSize: '10px',
                      backgroundColor: 'rgba(0,0,0,0.7)',
                      color: 'white',
                      padding: '2px 4px',
                      zIndex: 100
                    }}>
                      Box: x={drawingBox.x.toFixed(0)}, y={drawingBox.y.toFixed(0)}, w={drawingBox.width.toFixed(0)}, h={drawingBox.height.toFixed(0)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TemplateBuilder;
