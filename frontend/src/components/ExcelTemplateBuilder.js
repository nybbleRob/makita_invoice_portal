import React, { useState, useEffect } from 'react';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import './ExcelTemplateBuilder.css';

const ExcelTemplateBuilder = ({ template, onSave, onCancel }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'global_admin' || user?.role === 'admin';
  const templateType = template?.templateType || 'invoice';
  
  // Get template code (from existing template or generate from name)
  const getTemplateCode = () => {
    if (template?.code) {
      return template.code;
    }
    if (template?.name) {
      return template.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    }
    return null;
  };
  
  const templateCode = getTemplateCode();
  
  // Required fields - these are the ONLY fields needed
  const REQUIRED_FIELDS = [
    { fieldName: 'account_no', label: 'Account No', mapsTo: 'accountNumber', required: true },
    { fieldName: 'invoice_number', label: 'Invoice No', mapsTo: 'invoiceNumber', required: true },
    { fieldName: 'document_type', label: 'Document Type', mapsTo: 'documentType', required: true },
    { fieldName: 'invoice_total', label: 'Invoice Total', mapsTo: 'amount', required: true },
    { fieldName: 'vat_amount', label: 'VAT Amount', mapsTo: 'vatAmount', required: true }
  ];
  
  // Get field ID with template code prefix
  const getFieldId = (fieldName) => {
    if (!templateCode) {
      return fieldName; // Will be fixed when template is saved
    }
    return `${templateCode}_${fieldName}`;
  };
  
  // Initialize cells from template or create empty
  const initializeCells = () => {
    const requiredFields = REQUIRED_FIELDS.map(field => {
      const fieldId = getFieldId(field.fieldName);
      let cellRef = '';
      let column = null;
      let row = null;
      let endColumn = null;
      let endRow = null;
      
      if (template?.excelCells && templateCode) {
        const mapping = template.excelCells[fieldId];
        if (mapping && mapping.column && mapping.row) {
          cellRef = `${mapping.column}${mapping.row}`;
          if (mapping.endColumn && mapping.endRow) {
            cellRef = `${cellRef}:${mapping.endColumn}${mapping.endRow}`;
          }
          column = mapping.column;
          row = mapping.row;
          endColumn = mapping.endColumn || null;
          endRow = mapping.endRow || null;
        }
      }
      
      return {
        ...field,
        fieldId,
        cellReference: cellRef,
        column,
        row,
        endColumn,
        endRow
      };
    });
    
    // Extract custom fields from template.customFields (new structure)
    const customFields = [];
    if (template?.customFields && typeof template.customFields === 'object') {
      Object.entries(template.customFields).forEach(([fieldName, config]) => {
        const fieldId = getFieldId(fieldName);
        let cellRef = '';
        let column = null;
        let row = null;
        let endColumn = null;
        let endRow = null;
        
        // Check if this custom field has excelCells mapping
        if (template?.excelCells && template.excelCells[fieldId]) {
          const mapping = template.excelCells[fieldId];
          if (mapping.column && mapping.row) {
            cellRef = `${mapping.column}${mapping.row}`;
            if (mapping.endColumn && mapping.endRow) {
              cellRef = `${cellRef}:${mapping.endColumn}${mapping.endRow}`;
            }
            column = mapping.column;
            row = mapping.row;
            endColumn = mapping.endColumn || null;
            endRow = mapping.endRow || null;
          }
        }
        
        customFields.push({
          fieldName,
          label: config.displayName || fieldName,
          mapsTo: fieldName,
          required: false,
          fieldId,
          cellReference: cellRef,
          column,
          row,
          endColumn,
          endRow,
          isCustom: true,
          dataType: config.dataType || 'text',
          showInTable: config.showInTable || false,
          showInFilter: config.showInFilter || false
        });
      });
    }
    
    return [...requiredFields, ...customFields];
  };
  
  const [templateData, setTemplateData] = useState({
    name: template?.name || '',
    templateType: templateType,
    fileType: 'excel',
    cells: initializeCells()
  });
  
  const [testFile, setTestFile] = useState(null);
  const [testResults, setTestResults] = useState(null);
  const [testing, setTesting] = useState(false);
  const [showAddFieldModal, setShowAddFieldModal] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldDataType, setNewFieldDataType] = useState('text');
  const [newFieldShowInTable, setNewFieldShowInTable] = useState(false);
  const [newFieldShowInFilter, setNewFieldShowInFilter] = useState(false);
  
  // Parse cell reference (e.g., "F2" or "A1:B5")
  const parseCellReference = (ref) => {
    if (!ref || !ref.trim()) return null;
    
    const parts = ref.trim().split(':');
    const start = parts[0].match(/^([A-Z]+)(\d+)$/);
    
    if (!start) return null;
    
    const result = {
      column: start[1],
      row: parseInt(start[2])
    };
    
    if (parts.length > 1) {
      const end = parts[1].match(/^([A-Z]+)(\d+)$/);
      if (end) {
        result.endColumn = end[1];
        result.endRow = parseInt(end[2]);
      }
    }
    
    return result;
  };
  
  // Validate unique cell references
  const validateUniqueCells = (cells) => {
    const cellMap = new Map();
    const duplicates = [];
    
    cells.forEach(cell => {
      if (cell.cellReference && cell.cellReference.trim()) {
        const parsed = parseCellReference(cell.cellReference);
        if (parsed) {
          const cellKey = `${parsed.column}${parsed.row}`;
          if (cellMap.has(cellKey)) {
            duplicates.push({
              field: cell.label,
              conflictingField: cellMap.get(cellKey),
              cell: cellKey
            });
          } else {
            cellMap.set(cellKey, cell.label);
          }
        }
      }
    });
    
    return duplicates;
  };
  
  // Handle cell reference change
  const handleCellReferenceChange = (fieldName, value) => {
    setTemplateData(prev => {
      const updatedCells = prev.cells.map(cell => {
        if (cell.fieldName === fieldName) {
          return { ...cell, cellReference: value };
        }
        return cell;
      });
      
      // Validate unique cells
      const duplicates = validateUniqueCells(updatedCells);
      if (duplicates.length > 0) {
        const dup = duplicates[0];
        toast.error(`Cell ${dup.cell} is already used by "${dup.conflictingField}". Each field must use a unique cell.`);
        return prev; // Don't update if duplicate
      }
      
      return {
        ...prev,
        cells: updatedCells
      };
    });
  };
  
  // Convert label to field name (e.g., "Goods Total" -> "goods_total")
  const labelToFieldName = (label) => {
    return label.trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // Remove special characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores
  };
  
  // Add custom field
  const handleAddCustomField = () => {
    if (!newFieldName || !newFieldName.trim()) {
      toast.error('Please enter a field name');
      return;
    }
    
    if (!newFieldLabel || !newFieldLabel.trim()) {
      toast.error('Please enter a display name');
      return;
    }
    
    // Validate camelCase
    if (!/^[a-z][a-zA-Z0-9]*$/.test(newFieldName)) {
      toast.error('Field name must be camelCase (start with lowercase, no spaces or special characters)');
      return;
    }
    
    // Check if field already exists
    const exists = templateData.cells.some(c => c.fieldName === newFieldName);
    if (exists) {
      toast.error('A field with this name already exists.');
      setNewFieldName('');
      setNewFieldLabel('');
      setShowAddFieldModal(false);
      return;
    }
    
    const saveTemplateCode = templateCode || templateData.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'template';
    const fieldId = `${saveTemplateCode}_${newFieldName}`;
    
    setTemplateData(prev => ({
      ...prev,
      cells: [
        ...prev.cells,
        {
          fieldName: newFieldName,
          label: newFieldLabel.trim(),
          mapsTo: newFieldName,
          required: false,
          fieldId,
          cellReference: '',
          isCustom: true,
          dataType: newFieldDataType,
          showInTable: newFieldShowInTable,
          showInFilter: newFieldShowInFilter
        }
      ]
    }));
    
    // Reset and close modal
    setNewFieldLabel('');
    setNewFieldName('');
    setNewFieldDataType('text');
    setNewFieldShowInTable(false);
    setNewFieldShowInFilter(false);
    setShowAddFieldModal(false);
    toast.success(`Custom field "${newFieldLabel.trim()}" added`);
  };
  
  // Remove custom field
  const handleRemoveCustomField = (fieldName) => {
    if (!window.confirm(`Are you sure you want to remove the custom field "${fieldName}"?`)) {
      return;
    }
    
    setTemplateData(prev => ({
      ...prev,
      cells: prev.cells.filter(cell => cell.fieldName !== fieldName)
    }));
  };
  
  // Test extraction
  const handleTestExtraction = async () => {
    if (!testFile) {
      toast.error('Please upload an Excel file to test');
      return;
    }
    
    // Generate template code from name (for new templates)
    const testTemplateCode = templateCode || (templateData.name ? templateData.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') : 'test_template');
    
    // Validate all required fields are mapped (only check required fields)
    const unmapped = templateData.cells.filter(c => c.required && (!c.cellReference || !c.cellReference.trim()));
    if (unmapped.length > 0) {
      toast.error(`Please map all required fields: ${unmapped.map(f => f.label).join(', ')}`);
      return;
    }
    
    // Validate unique cells
    const duplicates = validateUniqueCells(templateData.cells);
    if (duplicates.length > 0) {
      toast.error('Each field must use a unique cell reference');
      return;
    }
    
    setTesting(true);
    setTestResults(null);
    
    try {
      // Build excelCells object with template code prefix (include all mapped fields, required and optional)
      const excelCells = {};
      templateData.cells.forEach(cell => {
        if (cell.cellReference && cell.cellReference.trim()) {
          const parsed = parseCellReference(cell.cellReference);
          if (parsed) {
            // Generate fieldId with template code prefix
            const fieldId = `${testTemplateCode}_${cell.fieldName}`;
            excelCells[fieldId] = {
              column: parsed.column,
              row: parsed.row,
              endColumn: parsed.endColumn || null,
              endRow: parsed.endRow || null,
              sheet: 0,
              required: cell.required || false
            };
          }
        }
      });
      
      // Create test template
      const testTemplate = {
        excelCells,
        fileType: 'excel'
      };
      
      // Upload file and test
      const formData = new FormData();
      formData.append('file', testFile);
      formData.append('template', JSON.stringify(testTemplate));
      
      const response = await api.post('/api/parsing/test-parse', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      const results = response.data.results || response.data;
      setTestResults({
        confidenceScore: results.confidence || 95,
        parserUsed: results.processingMethod || 'excel_template',
        extractedFields: results.extractedFields || results.parsedData || {},
        fullText: results.fullText || ''
      });
      toast.success('Extraction test completed');
    } catch (error) {
      console.error('Error testing extraction:', error);
      toast.error('Error testing extraction: ' + (error.response?.data?.message || error.message));
    } finally {
      setTesting(false);
    }
  };
  
  // Save template
  const handleSave = async () => {
    // Validate template name
    if (!templateData.name || !templateData.name.trim()) {
      toast.error('Template name is required');
      return;
    }
    
    // Generate template code from name (for new templates)
    const saveTemplateCode = templateCode || templateData.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    
    // Validate all required fields are mapped (only check required fields)
    const unmapped = templateData.cells.filter(c => c.required && (!c.cellReference || !c.cellReference.trim()));
    if (unmapped.length > 0) {
      toast.error(`Please map all required fields: ${unmapped.map(f => f.label).join(', ')}`);
      return;
    }
    
    // Validate unique cells
    const duplicates = validateUniqueCells(templateData.cells);
    if (duplicates.length > 0) {
      toast.error('Each field must use a unique cell reference');
      return;
    }
    
    // Build excelCells object with template code prefix (include all mapped fields, required and optional)
    const excelCells = {};
    templateData.cells.forEach(cell => {
      if (cell.cellReference && cell.cellReference.trim()) {
        const parsed = parseCellReference(cell.cellReference);
        if (parsed) {
          // Generate fieldId with template code prefix (use saveTemplateCode to ensure it's set)
          const fieldId = `${saveTemplateCode}_${cell.fieldName}`;
          excelCells[fieldId] = {
            column: parsed.column,
            row: parsed.row,
            endColumn: parsed.endColumn || null,
            endRow: parsed.endRow || null,
            sheet: 0,
            required: cell.required || false
          };
        }
      }
    });
    
    // Build customFields object from custom cells
    const customFieldsObj = {};
    templateData.cells
      .filter(cell => cell.isCustom)
      .forEach(cell => {
        if (cell.fieldName && cell.label) {
          customFieldsObj[cell.fieldName] = {
            displayName: cell.label,
            dataType: cell.dataType || 'text',
            showInTable: cell.showInTable || false,
            showInFilter: cell.showInFilter || false
          };
        }
      });

    const formData = new FormData();
    formData.append('name', templateData.name);
    formData.append('templateType', templateData.templateType);
    formData.append('fileType', 'excel');
    formData.append('excelCells', JSON.stringify(excelCells));
    formData.append('customFields', JSON.stringify(customFieldsObj));
    
    try {
      console.log('Saving template with excelCells:', excelCells);
      console.log('Template code:', saveTemplateCode);
      console.log('Template name:', templateData.name);
      
      if (template?.id) {
        const response = await api.put(`/api/templates/${template.id}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        toast.success('Template updated successfully');
      } else {
        const response = await api.post('/api/templates', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        toast.success('Template created successfully');
      }
      onSave();
    } catch (error) {
      console.error('Error saving template:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
      console.error('Error details:', error.response?.data);
      toast.error('Error saving template: ' + errorMessage);
    }
  };
  
  return (
    <div className="excel-template-builder">
      <div className="row mb-4">
        <div className="col-12">
          <div className="card">
            <div className="card-body">
              <div className="row align-items-end">
                <div className="col-md-3">
                  <label className="form-label">Template Name</label>
                  <input
                    type="text"
                    className="form-control"
                    value={templateData.name}
                    onChange={(e) => setTemplateData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Invoice Template 2025"
                    disabled={!!template?.id}
                    title={template?.id ? "Template name cannot be changed after creation" : ""}
                  />
                  {template?.id && (
                    <small className="text-muted d-block mt-1">
                      Template name cannot be changed after creation
                    </small>
                  )}
                </div>
                <div className="col-md-3">
                  <label className="form-label">Upload Excel/CSV File (for testing)</label>
                  <input
                    type="file"
                    className="form-control"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => setTestFile(e.target.files[0])}
                  />
                </div>
                <div className="col-md-3 text-end">
                  <button
                    className="btn btn-secondary me-2"
                    onClick={onCancel}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleSave}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="row">
        <div className="col-md-4">
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Field Mapper</h3>
            </div>
            <div className="card-body">
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Maps To</th>
                      <th>Cell Reference</th>
                      {templateData.cells.some(c => c.isCustom) && (
                        <>
                          <th>Add Column</th>
                          <th>Filter Data</th>
                        </>
                      )}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templateData.cells
                      .sort((a, b) => {
                        // Sort required fields first, then optional
                        if (a.required && !b.required) return -1;
                        if (!a.required && b.required) return 1;
                        return a.label.localeCompare(b.label);
                      })
                      .map((cell) => (
                        <tr key={cell.fieldName} className={!cell.cellReference && cell.required ? 'table-warning' : ''}>
                          <td>
                            <strong>{cell.label}</strong>
                            {cell.required && (
                              <span className="badge bg-danger-lt ms-2">Required</span>
                            )}
                            {!cell.required && !cell.isCustom && (
                              <span className="badge bg-secondary-lt ms-2">Optional</span>
                            )}
                            {cell.isCustom && (
                              <span className="badge bg-info-lt ms-2">Custom</span>
                            )}
                          </td>
                          <td>
                            <small className="text-muted">{cell.mapsTo || cell.fieldName}</small>
                          </td>
                          <td>
                            <div className="d-flex gap-2">
                              <input
                                type="text"
                                className="form-control form-control-sm"
                                placeholder="e.g., F2 or A1:B5"
                                value={cell.cellReference || ''}
                                onChange={(e) => handleCellReferenceChange(cell.fieldName, e.target.value)}
                              />
                            </div>
                          </td>
                          {templateData.cells.some(c => c.isCustom) && (
                            <>
                              <td>
                                {cell.isCustom ? (
                                  <input
                                    type="checkbox"
                                    className="form-check-input"
                                    checked={cell.showInTable || false}
                                    onChange={(e) => {
                                      setTemplateData(prev => ({
                                        ...prev,
                                        cells: prev.cells.map(c =>
                                          c.fieldName === cell.fieldName
                                            ? { ...c, showInTable: e.target.checked }
                                            : c
                                        )
                                      }));
                                    }}
                                  />
                                ) : (
                                  <span className="text-muted">-</span>
                                )}
                              </td>
                              <td>
                                {cell.isCustom ? (
                                  <input
                                    type="checkbox"
                                    className="form-check-input"
                                    checked={cell.showInFilter || false}
                                    onChange={(e) => {
                                      setTemplateData(prev => ({
                                        ...prev,
                                        cells: prev.cells.map(c =>
                                          c.fieldName === cell.fieldName
                                            ? { ...c, showInFilter: e.target.checked }
                                            : c
                                        )
                                      }));
                                    }}
                                  />
                                ) : (
                                  <span className="text-muted">-</span>
                                )}
                              </td>
                            </>
                          )}
                          <td>
                            {cell.isCustom && (
                              <button
                                className="btn btn-sm btn-outline-danger"
                                onClick={() => handleRemoveCustomField(cell.fieldName)}
                                title="Remove custom field"
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              
              <div className="mt-3">
                <button
                  className="btn btn-outline-primary btn-sm w-100 mb-2"
                  onClick={() => setShowAddFieldModal(true)}
                >
                  + Add Custom Field
                </button>
                <button
                  className="btn btn-success w-100"
                  onClick={handleTestExtraction}
                  disabled={!testFile || testing}
                >
                  {testing ? 'Testing...' : 'Test Parse/Extraction'}
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <div className="col-md-8">
          <div className="card" style={{ position: 'sticky', top: '20px' }}>
            <div className="card-header">
              <h3 className="card-title">Test Results</h3>
            </div>
            <div className="card-body">
              {!testResults && !testing && (
                <p className="text-muted">Upload an Excel file and click "Test Parse/Extraction" to see results here.</p>
              )}
              {testing && (
                <div className="text-center p-4">
                  <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">Testing...</span>
                  </div>
                  <p className="mt-2 text-muted">Parsing Excel file...</p>
                </div>
              )}
              {testResults && (
                <div>
                  <div className="mb-3">
                    <strong>Confidence Score:</strong> {testResults.confidenceScore}%
                    <br />
                    <strong>Parser Used:</strong> {testResults.parserUsed}
                  </div>
                  <div className="table-responsive">
                    <table className="table table-sm table-bordered">
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(testResults.extractedFields || {}).map(([key, value]) => (
                          <tr key={key}>
                            <td><strong>{key}</strong></td>
                            <td>
                              {value === null || value === '' ? (
                                <span className="text-muted">(empty)</span>
                              ) : (
                                <code>{String(value)}</code>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <details className="mt-3">
                    <summary className="cursor-pointer">View Raw JSON</summary>
                    <pre style={{ fontSize: '12px', maxHeight: '300px', overflow: 'auto', marginTop: '10px', whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                      {JSON.stringify(testResults.extractedFields, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Add Custom Field Modal */}
      {showAddFieldModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Add Custom Field</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowAddFieldModal(false);
                    setNewFieldLabel('');
                  }}
                ></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label">Field Name (camelCase) <span className="text-danger">*</span></label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g., goodsTotal, customerReference"
                    value={newFieldName}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Validate camelCase
                      if (value === '' || /^[a-z][a-zA-Z0-9]*$/.test(value)) {
                        setNewFieldName(value);
                      }
                    }}
                    autoFocus
                  />
                  <small className="text-muted">
                    Must be camelCase (start with lowercase, no spaces or special characters)
                  </small>
                </div>
                <div className="mb-3">
                  <label className="form-label">Display Name <span className="text-danger">*</span></label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g., Goods Total, Customer Reference"
                    value={newFieldLabel}
                    onChange={(e) => setNewFieldLabel(e.target.value)}
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">Data Type</label>
                  <select
                    className="form-select"
                    value={newFieldDataType}
                    onChange={(e) => setNewFieldDataType(e.target.value)}
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="currency">Currency</option>
                  </select>
                </div>
                <div className="mb-3">
                  <div className="form-check">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      checked={newFieldShowInTable}
                      onChange={(e) => setNewFieldShowInTable(e.target.checked)}
                    />
                    <label className="form-check-label">Add Column (show in table)</label>
                  </div>
                </div>
                <div className="mb-3">
                  <div className="form-check">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      checked={newFieldShowInFilter}
                      onChange={(e) => setNewFieldShowInFilter(e.target.checked)}
                    />
                    <label className="form-check-label">Filter Data (enable filtering)</label>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    setShowAddFieldModal(false);
                    setNewFieldLabel('');
                    setNewFieldName('');
                    setNewFieldDataType('text');
                    setNewFieldShowInTable(false);
                    setNewFieldShowInFilter(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleAddCustomField}
                  disabled={!newFieldName || !newFieldLabel || !newFieldLabel.trim()}
                >
                  Add Field
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExcelTemplateBuilder;
