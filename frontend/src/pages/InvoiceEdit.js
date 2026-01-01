import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { getAvailableFields } from '../utils/fieldDiscovery';
import * as pdfjsLib from 'pdfjs-dist';

// Set worker path for PDF.js - use local worker file from public folder
pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ''}/pdf.worker.min.mjs`;

const InvoiceEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pdfPages, setPdfPages] = useState([]);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const canvasContainerRef = useRef(null);
  const isRenderingRef = useRef(false);
  const pdfFetchedRef = useRef(false);
  const [editReason, setEditReason] = useState('');
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [pendingChanges, setPendingChanges] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    invoiceNumber: '',
    issueDate: '',
    amount: '',
    taxAmount: '',
    documentStatus: 'ready',
    customFields: {} // Store custom field values
  });

  // Custom fields state
  const [availableFields, setAvailableFields] = useState([]);
  
  // Load available fields on mount
  useEffect(() => {
    const loadFields = async () => {
      try {
        const fields = await getAvailableFields('invoices');
        setAvailableFields(fields);
      } catch (error) {
        console.error('Error loading available fields:', error);
      }
    };
    loadFields();
  }, []);

  useEffect(() => {
    // Reset PDF state when id changes
    setPdfPages([]);
    setLoadingPdf(false);
    isRenderingRef.current = false;
    pdfFetchedRef.current = false;
    if (canvasContainerRef.current) {
      canvasContainerRef.current.innerHTML = '';
    }
    
    fetchInvoice();
    
    // Cleanup: reset PDF state when component unmounts
    return () => {
      setPdfPages([]);
      setLoadingPdf(false);
      isRenderingRef.current = false;
      pdfFetchedRef.current = false;
      if (canvasContainerRef.current) {
        canvasContainerRef.current.innerHTML = '';
      }
    };
  }, [id]);

  const fetchInvoice = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/api/invoices/${id}`);
      const inv = response.data;
      setInvoice(inv);
      
      // Populate form data
      const customFields = {};
      if (inv.metadata?.parsedData) {
        // Extract custom fields from parsedData
        const customFieldNames = Object.keys(inv.metadata.parsedData).filter(key => {
          // Exclude standard fields
          const standardFields = ['invoiceNumber', 'issueDate', 'amount', 'taxAmount', 'documentType', 'accountNumber', 'companyName', 'poNumber', 'customerPO', 'vatAmount', 'goodsAmount', 'totalAmount'];
          return !standardFields.includes(key);
        });
        customFieldNames.forEach(key => {
          customFields[key] = inv.metadata.parsedData[key];
        });
      }
      
      setFormData({
        invoiceNumber: inv.invoiceNumber || '',
        issueDate: inv.issueDate ? new Date(inv.issueDate).toISOString().split('T')[0] : '',
        amount: inv.amount || '',
        taxAmount: inv.taxAmount || '',
        documentStatus: inv.documentStatus || 'ready',
        customFields: customFields
      });
      
      // Fetch PDF for preview if file exists
      if (inv.fileUrl) {
        fetchPdfForPreview();
      }
    } catch (error) {
      console.error('Error fetching invoice:', error);
      toast.error('Error loading invoice: ' + (error.response?.data?.message || error.message));
      navigate('/invoices');
    } finally {
      setLoading(false);
    }
  };

  const fetchPdfForPreview = async () => {
    // Prevent fetching multiple times
    if (pdfFetchedRef.current || loadingPdf) {
      return;
    }
    
    try {
      pdfFetchedRef.current = true;
      setLoadingPdf(true);
      const token = localStorage.getItem('token');
      const baseUrl = API_BASE_URL;
      const url = `${baseUrl}/api/invoices/${id}/view-pdf`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to load PDF');
      }

      const arrayBuffer = await response.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages = [];
      
      // Render all pages
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        pages.push(page);
      }
      
      setPdfPages(pages);
      setLoadingPdf(false);
    } catch (error) {
      console.error('Error loading PDF for preview:', error);
      setLoadingPdf(false);
      pdfFetchedRef.current = false; // Reset on error so it can retry
    }
  };

  // Render PDF pages to canvas
  useEffect(() => {
    if (pdfPages.length === 0 || !canvasContainerRef.current || isRenderingRef.current) {
      return;
    }
    
    isRenderingRef.current = true;
    
    const renderPages = async () => {
      // Check if container still exists
      if (!canvasContainerRef.current) {
        isRenderingRef.current = false;
        return;
      }
      
      // Clear previous content
      canvasContainerRef.current.innerHTML = '';
      
      for (let i = 0; i < pdfPages.length; i++) {
        // Check if container still exists before each iteration
        if (!canvasContainerRef.current) {
          break; // Component unmounted
        }
        
        const page = pdfPages[i];
        const viewport = page.getViewport({ scale: 1.5 });
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        canvas.style.display = 'block';
        canvas.style.marginBottom = '20px';
        canvas.style.border = '1px solid #ddd';
        
        const renderContext = {
          canvasContext: context,
          viewport: viewport
        };
        
        await page.render(renderContext).promise;
        
        // Final check before appending
        if (canvasContainerRef.current) {
          canvasContainerRef.current.appendChild(canvas);
        } else {
          break; // Component unmounted during render
        }
      }
      
      isRenderingRef.current = false;
    };
    
    renderPages();
    
    // Cleanup function
    return () => {
      isRenderingRef.current = false;
      if (canvasContainerRef.current) {
        canvasContainerRef.current.innerHTML = '';
      }
    };
  }, [pdfPages]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = () => {
    // Check if there are actual changes
    // Check for custom field changes
    const customFieldsChanged = (() => {
      const currentCustomFields = invoice.metadata?.parsedData || {};
      const formCustomFields = formData.customFields || {};
      
      // Check if any custom field value changed
      const allCustomFieldNames = new Set([
        ...Object.keys(currentCustomFields),
        ...Object.keys(formCustomFields)
      ]);
      
      for (const fieldName of allCustomFieldNames) {
        // Skip standard fields
        const standardFields = ['invoiceNumber', 'issueDate', 'amount', 'taxAmount', 'documentType', 'accountNumber', 'companyName', 'poNumber', 'customerPO', 'vatAmount', 'goodsAmount', 'totalAmount'];
        if (standardFields.includes(fieldName)) continue;
        
        if (String(currentCustomFields[fieldName] || '') !== String(formCustomFields[fieldName] || '')) {
          return true;
        }
      }
      return false;
    })();

    const hasChanges = 
      formData.invoiceNumber !== invoice.invoiceNumber ||
      formData.issueDate !== (invoice.issueDate ? new Date(invoice.issueDate).toISOString().split('T')[0] : '') ||
      parseFloat(formData.amount) !== parseFloat(invoice.amount || 0) ||
      parseFloat(formData.taxAmount) !== parseFloat(invoice.taxAmount || 0) ||
      formData.documentStatus !== invoice.documentStatus ||
      customFieldsChanged;

    if (!hasChanges) {
      toast.info('No changes to save');
      return;
    }

    // Show reason modal
    setPendingChanges(formData);
    setShowReasonModal(true);
  };

  const confirmSave = async () => {
    if (!editReason || editReason.trim().length === 0) {
      toast.error('Please provide a reason for editing this invoice');
      return;
    }

    try {
      setSaving(true);
      setShowReasonModal(false);

      // Merge custom fields into metadata.parsedData
      const parsedData = invoice.metadata?.parsedData || {};
      const updatedParsedData = {
        ...parsedData,
        ...pendingChanges.customFields
      };

      const updateData = {
        ...pendingChanges,
        issueDate: pendingChanges.issueDate ? new Date(pendingChanges.issueDate).toISOString() : null,
        amount: parseFloat(pendingChanges.amount) || 0,
        taxAmount: parseFloat(pendingChanges.taxAmount) || 0,
        editReason: editReason.trim(),
        metadata: {
          ...invoice.metadata,
          parsedData: updatedParsedData
        }
      };
      
      // Remove customFields from updateData (it's now in metadata.parsedData)
      delete updateData.customFields;

      await api.put(`/api/invoices/${id}`, updateData);

      toast.success('Invoice updated successfully');
      navigate(`/invoices/${id}/view`);
    } catch (error) {
      console.error('Error saving invoice:', error);
      toast.error('Error saving invoice: ' + (error.response?.data?.message || error.message));
    } finally {
      setSaving(false);
      setEditReason('');
      setPendingChanges(null);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <div className="container-xl">
            <div className="row g-2 align-items-center">
              <div className="col">
                <h2 className="page-title">Edit Invoice</h2>
              </div>
            </div>
          </div>
        </div>
        <div className="page-body">
          <div className="container-xl">
            <div className="text-center py-5">
              <div className="spinner-border" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="page">
        <div className="page-header">
          <div className="container-xl">
            <div className="row g-2 align-items-center">
              <div className="col">
                <h2 className="page-title">Invoice Not Found</h2>
              </div>
            </div>
          </div>
        </div>
        <div className="page-body">
          <div className="container-xl">
            <div className="alert alert-warning">
              Invoice not found. <button className="btn btn-sm btn-link p-0" onClick={() => navigate('/invoices')}>Return to Invoices</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div className="container-xl">
          <div className="row g-2 align-items-center">
            <div className="col">
              <h2 className="page-title">Edit Invoice: {invoice.invoiceNumber}</h2>
            </div>
            <div className="col-auto">
              <button className="btn btn-secondary" onClick={() => navigate(`/invoices/${id}/view`)}>
                Back to View
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="container-xl">
          <div className="row">
            {/* PDF Preview - Left Column (67%) */}
            <div className="col-lg-8">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">PDF Preview</h3>
                </div>
                <div className="card-body">
                  {loadingPdf ? (
                    <div className="text-center py-5">
                      <div className="spinner-border" role="status">
                        <span className="visually-hidden">Loading PDF...</span>
                      </div>
                    </div>
                  ) : (
                    <div ref={canvasContainerRef} style={{ maxHeight: '80vh', overflowY: 'auto' }}></div>
                  )}
                </div>
              </div>
            </div>

            {/* Edit Form - Right Column (33%) */}
            <div className="col-lg-4">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Invoice Details</h3>
                </div>
                <div className="card-body">
                  <div className="mb-3">
                    <label className="form-label required">Invoice Number</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.invoiceNumber}
                      onChange={(e) => handleInputChange('invoiceNumber', e.target.value)}
                      placeholder="Enter invoice number"
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label required">Company</label>
                    <input
                      type="text"
                      className="form-control"
                      value={invoice.company?.name || '-'}
                      disabled
                      readOnly
                    />
                    <small className="form-hint">Company cannot be changed from this page</small>
                  </div>

                  <div className="mb-3">
                    <label className="form-label required">Invoice Date / Tax Point</label>
                    <input
                      type="date"
                      className="form-control"
                      value={formData.issueDate}
                      onChange={(e) => handleInputChange('issueDate', e.target.value)}
                    />
                  </div>

                  <div className="row">
                    <div className="col-12 mb-3">
                      <label className="form-label required">Invoice Total</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-control"
                        value={formData.amount}
                        onChange={(e) => handleInputChange('amount', e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="col-12 mb-3">
                      <label className="form-label">VAT Amount</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-control"
                        value={formData.taxAmount}
                        onChange={(e) => handleInputChange('taxAmount', e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  {(currentUser?.role === 'global_admin' || currentUser?.role === 'administrator') && (
                    <div className="mb-3">
                      <label className="form-label">Document Status</label>
                      <select
                        className="form-select"
                        value={formData.documentStatus}
                        onChange={(e) => handleInputChange('documentStatus', e.target.value)}
                      >
                        <option value="ready">Ready (New)</option>
                        <option value="review">Review</option>
                        <option value="viewed">Viewed</option>
                        <option value="downloaded">Downloaded</option>
                        <option value="queried">Queried</option>
                      </select>
                      <small className="form-hint">Only Global Administrators and Administrators can change document status</small>
                    </div>
                  )}

                  {/* Custom Fields Section */}
                  {availableFields.filter(f => f.isCustom).length > 0 && (
                    <div className="mb-3">
                      <div className="border-top pt-3 mt-3">
                        <h5 className="mb-3">Custom Fields</h5>
                        {availableFields
                          .filter(f => f.isCustom)
                          .map(field => {
                            const value = formData.customFields[field.fieldName] || '';
                            return (
                              <div key={field.fieldName} className="mb-3">
                                <label className="form-label">{field.displayName}</label>
                                {field.dataType === 'date' ? (
                                  <input
                                    type="date"
                                    className="form-control"
                                    value={value ? (typeof value === 'string' && value.includes('T') ? value.split('T')[0] : value) : ''}
                                    onChange={(e) => {
                                      setFormData(prev => ({
                                        ...prev,
                                        customFields: {
                                          ...prev.customFields,
                                          [field.fieldName]: e.target.value
                                        }
                                      }));
                                    }}
                                  />
                                ) : field.dataType === 'number' || field.dataType === 'currency' ? (
                                  <input
                                    type="number"
                                    step={field.dataType === 'currency' ? '0.01' : '1'}
                                    className="form-control"
                                    value={value}
                                    onChange={(e) => {
                                      setFormData(prev => ({
                                        ...prev,
                                        customFields: {
                                          ...prev.customFields,
                                          [field.fieldName]: e.target.value
                                        }
                                      }));
                                    }}
                                  />
                                ) : (
                                  <input
                                    type="text"
                                    className="form-control"
                                    value={value}
                                    onChange={(e) => {
                                      setFormData(prev => ({
                                        ...prev,
                                        customFields: {
                                          ...prev.customFields,
                                          [field.fieldName]: e.target.value
                                        }
                                      }));
                                    }}
                                  />
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  <div className="d-flex gap-2 mt-4">
                    <button
                      className="btn btn-primary"
                      onClick={handleSave}
                      disabled={saving}
                    >
                      {saving ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                          Saving...
                        </>
                      ) : (
                        'Save Changes'
                      )}
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => navigate(`/invoices/${id}/view`)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Reason Modal */}
      {showReasonModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Edit Reason Required</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowReasonModal(false);
                    setEditReason('');
                    setPendingChanges(null);
                  }}
                ></button>
              </div>
              <div className="modal-body">
                <p>Please provide a reason for editing this invoice. This will be logged for auditing purposes.</p>
                <div className="mb-3">
                  <label className="form-label required">Reason for Edit</label>
                  <textarea
                    className="form-control"
                    rows="3"
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    placeholder="Enter reason for editing this invoice..."
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    setShowReasonModal(false);
                    setEditReason('');
                    setPendingChanges(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={confirmSave}
                  disabled={!editReason || editReason.trim().length === 0}
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoiceEdit;

