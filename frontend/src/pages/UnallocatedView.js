import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import * as pdfjsLib from 'pdfjs-dist';

// Set worker path for PDF.js - use local worker file from public folder
pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ''}/pdf.worker.js`;

const UnallocatedView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const listPage = location.state?.listPage ?? 1;
  const { user: currentUser } = useAuth();
  const [unallocatedDocument, setUnallocatedDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pdfPages, setPdfPages] = useState([]);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const canvasContainerRef = useRef(null);
  const isRenderingRef = useRef(false);
  const pdfFetchedRef = useRef(false);
  const [editingData, setEditingData] = useState({});
  const [activeDataTab, setActiveDataTab] = useState('extracted'); // 'extracted' or 'json'
  const [attemptingAllocation, setAttemptingAllocation] = useState(false);

  useEffect(() => {
    // Reset PDF state when id changes
    setPdfPages([]);
    setLoadingPdf(false);
    isRenderingRef.current = false;
    pdfFetchedRef.current = false;
    if (canvasContainerRef.current) {
      canvasContainerRef.current.innerHTML = '';
    }
    
    fetchDocument();
    
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

  const fetchDocument = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/api/unallocated/${id}`);
      const doc = response.data;
      setUnallocatedDocument(doc);
      
      // Map parsed data to editing data
      const parsed = doc.parsedData || {};
      // Check all possible field name variations from template - match template field order
      setEditingData({
        ...parsed,
        documentType: parsed.documentType || parsed.document_type || '',
        accountNumber: parsed.accountNumber || parsed.customerNumber || parsed.account_no || parsed.accountNo || '',
        invoiceDate: parsed.invoiceDate || parsed.date || parsed.taxPoint || parsed.tax_point || '',
        invoiceNumber: parsed.invoiceNumber || parsed.documentNumber || parsed.invoice_number || parsed.invoiceNo || parsed.creditNumber || parsed.credit_number || '',
        customerPO: parsed.customerPO || parsed.poNumber || parsed.purchaseOrder || parsed.customer_po || parsed.po_number || '',
        totalAmount: parsed.totalAmount || parsed.amount || parsed.invoiceTotal || parsed.total || '',
        vatAmount: parsed.vatAmount || parsed.vatTotal || parsed.vat_amount || '',
        deliveryAddress: parsed.deliveryAddress || parsed.delivery_address || parsed.ship_to || parsed.shipping_address || '',
        goodsAmount: parsed.goodsAmount || parsed.goods_amount || parsed.subtotal || parsed.net_amount || '',
        invoiceTo: parsed.invoiceTo || parsed.invoice_to || parsed.bill_to || '',
        // Keep legacy field names for backward compatibility
        amount: parsed.totalAmount || parsed.amount || parsed.invoiceTotal || parsed.total || '',
        date: parsed.invoiceDate || parsed.date || parsed.taxPoint || parsed.tax_point || ''
      });
      setActiveDataTab('extracted'); // Reset to default tab
      
      // Fetch PDF for preview if file exists
      if (doc.filePath) {
        fetchPdfForPreview();
      }
    } catch (error) {
      console.error('Error fetching document:', error);
      toast.error('Error loading document: ' + (error.response?.data?.message || error.message));
      navigate(`/unallocated?page=${listPage}`);
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
      const url = `${baseUrl}/api/unallocated/${id}/view-pdf`;
      
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

  const handleSave = async () => {
    if (!unallocatedDocument) return;

    try {
      setSaving(true);
      await api.put(`/api/unallocated/${unallocatedDocument.id}`, {
        parsedData: editingData,
        accountNumber: editingData.accountNumber
      });

      toast.success('Document updated and queued for reprocessing');
      navigate(`/unallocated?page=${listPage}`);
    } catch (error) {
      console.error('Error saving document:', error);
      toast.error('Error saving document: ' + (error.response?.data?.message || error.message));
    } finally {
      setSaving(false);
    }
  };

  const handleAttemptAllocation = async () => {
    if (!unallocatedDocument) return;

    // First save any edits
    try {
      setAttemptingAllocation(true);
      
      // Save the current edits first
      await api.put(`/api/unallocated/${unallocatedDocument.id}`, {
        parsedData: editingData,
        accountNumber: editingData.accountNumber
      });

      // Then attempt allocation
      const response = await api.post(`/api/unallocated/${unallocatedDocument.id}/attempt-allocation`);
      
      if (response.data.success) {
        toast.success(`Successfully allocated to ${response.data.company.name}! Created ${response.data.document.type === 'invoice' ? 'Invoice' : 'Credit Note'} ${response.data.document.number}`);
        
        // Navigate to the created document
        if (response.data.document.type === 'invoice') {
          navigate(`/invoices/${response.data.document.id}/view`);
        } else {
          navigate(`/credit-notes/${response.data.document.id}/view`);
        }
      } else {
        toast.error(response.data.message || 'Allocation failed');
      }
    } catch (error) {
      console.error('Error attempting allocation:', error);
      const errorMsg = error.response?.data?.message || error.message;
      toast.error('Allocation failed: ' + errorMsg);
    } finally {
      setAttemptingAllocation(false);
    }
  };

  const formatSpecificReason = (reason) => {
    if (!reason) return '';
    
    const reasonMap = {
      'company_not_found': 'Company not found - Account number was extracted but no matching company exists',
      'missing_account_number': 'Account number missing - Could not extract account number from document',
      'missing_invoice_total': 'Invoice total missing - Could not extract total amount',
      'missing_invoice_number': 'Invoice number missing - Could not extract invoice number',
      'missing_vat_amount': 'VAT amount missing - Could not extract VAT amount',
      'missing_po_number': 'PO number missing - Could not extract PO number',
      'invalid_date_format': 'Invalid date format - Date could not be parsed correctly',
      'duplicate': 'Duplicate file - This file already exists in the system'
    };
    
    return reasonMap[reason] || reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getReasonBadge = (reason, status, metadata) => {
    const specificReason = metadata?.specificFailureReason;
    
    if (status === 'unallocated' || reason === 'unallocated') {
      return (
        <div>
          <span className="badge bg-warning-lt">Unallocated</span>
          {specificReason && (
            <small className="text-muted d-block mt-1">
              {formatSpecificReason(specificReason)}
            </small>
          )}
        </div>
      );
    }
    
    const classes = {
      parsing_error: 'bg-danger-lt',
      validation_error: 'bg-info-lt',
      duplicate: 'bg-secondary-lt',
      other: 'bg-dark-lt'
    };
    const label = reason ? reason.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Unknown';
    return (
      <div>
        <span className={`badge ${classes[reason] || 'bg-secondary-lt'}`}>{label}</span>
        {specificReason && (
          <small className="text-muted d-block mt-1">
            {formatSpecificReason(specificReason)}
          </small>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <div className="container-xl">
            <div className="row g-2 align-items-center">
              <div className="col">
                <h2 className="page-title">Unallocated Document</h2>
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

  if (!unallocatedDocument) {
    return (
      <div className="page">
        <div className="page-header">
          <div className="container-xl">
            <div className="row g-2 align-items-center">
              <div className="col">
                <h2 className="page-title">Document Not Found</h2>
              </div>
            </div>
          </div>
        </div>
        <div className="page-body">
          <div className="container-xl">
            <div className="alert alert-warning">
              Document not found. <button className="btn btn-sm btn-link p-0" onClick={() => navigate(`/unallocated?page=${listPage}`)}>Return to Unallocated</button>
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
              <h2 className="page-title">Unallocated Document: {unallocatedDocument.fileName}</h2>
            </div>
            <div className="col-auto">
              <button className="btn btn-secondary" onClick={() => navigate(`/unallocated?page=${listPage}`)}>
                Back to Unallocated
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

            {/* Extracted Data - Right Column (33%) */}
            <div className="col-lg-4">
              <div className="card">
                <div className="card-header">
                  <ul className="nav nav-tabs card-header-tabs">
                    <li className="nav-item">
                      <button
                        className={`nav-link ${activeDataTab === 'extracted' ? 'active' : ''}`}
                        onClick={() => setActiveDataTab('extracted')}
                      >
                        Extracted Data
                      </button>
                    </li>
                    {currentUser?.role === 'global_admin' && unallocatedDocument?.parsedData && (
                      <li className="nav-item">
                        <button
                          className={`nav-link ${activeDataTab === 'json' ? 'active' : ''}`}
                          onClick={() => setActiveDataTab('json')}
                        >
                          JSON
                        </button>
                      </li>
                    )}
                  </ul>
                </div>
                <div className="card-body">
                  <div className="tab-content">
                    {/* Extracted Data Tab */}
                    <div className={`tab-pane ${activeDataTab === 'extracted' ? 'active show' : ''}`} id="extracted-tab">
                  {unallocatedDocument.failureReason && (
                    <div className="mb-3">
                      <label className="form-label">Failure Reason <span className="text-muted">(Read-only)</span></label>
                      <div>
                        {getReasonBadge(unallocatedDocument.failureReason, unallocatedDocument.status, unallocatedDocument.metadata)}
                      </div>
                      {unallocatedDocument.metadata?.specificFailureReason && (
                        <small className="text-muted d-block mt-2">
                          <strong>What to fix:</strong> {formatSpecificReason(unallocatedDocument.metadata.specificFailureReason)}
                        </small>
                      )}
                      {unallocatedDocument.metadata?.missingFields && unallocatedDocument.metadata.missingFields.length > 0 && (
                        <small className="text-muted d-block mt-1">
                          <strong>Missing fields:</strong> {unallocatedDocument.metadata.missingFields.join(', ')}
                        </small>
                      )}
                    </div>
                  )}

                  <div className="mb-3">
                    <label className="form-label">Document Type</label>
                    <input
                      type="text"
                      className="form-control"
                      value={editingData.documentType || ''}
                      onChange={(e) => setEditingData(prev => ({ ...prev, documentType: e.target.value }))}
                      placeholder="invoice, credit_note, statement"
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label required">Account Number / Customer Number</label>
                    <input
                      type="text"
                      className="form-control"
                      value={editingData.accountNumber || ''}
                      onChange={(e) => setEditingData(prev => ({ ...prev, accountNumber: e.target.value }))}
                      placeholder="Enter account number"
                    />
                    <small className="form-hint">This must match a company's Account / Company Number</small>
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Date / Tax Point</label>
                    <input
                      type="date"
                      className="form-control"
                      value={(() => {
                        const dateValue = editingData.invoiceDate || editingData.date || editingData.taxPoint;
                        if (!dateValue) return '';
                        
                        try {
                          // Helper function to parse UK format dates (dd/mm/yy or dd/mm/yyyy)
                          const parseUKDate = (dateStr) => {
                            if (!dateStr) return null;
                            
                            const str = dateStr.toString().trim();
                            
                            // Try UK format first: dd/mm/yy or dd/mm/yyyy
                            const ukMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
                            if (ukMatch) {
                              let day = parseInt(ukMatch[1], 10);
                              let month = parseInt(ukMatch[2], 10);
                              let year = parseInt(ukMatch[3], 10);
                              
                              // Convert 2-digit year to 4-digit
                              if (year < 100) {
                                year = year < 50 ? 2000 + year : 1900 + year;
                              }
                              
                              // Validate and create date
                              if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                                const date = new Date(year, month - 1, day);
                                if (date.getFullYear() === year && 
                                    date.getMonth() === month - 1 && 
                                    date.getDate() === day) {
                                  return date;
                                }
                              }
                            }
                            
                            // Try ISO format: yyyy-mm-dd
                            const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
                            if (isoMatch) {
                              const year = parseInt(isoMatch[1], 10);
                              const month = parseInt(isoMatch[2], 10);
                              const day = parseInt(isoMatch[3], 10);
                              return new Date(year, month - 1, day);
                            }
                            
                            // Try standard Date parsing as fallback
                            const date = new Date(str);
                            if (!isNaN(date.getTime()) && date.getFullYear() > 1900) {
                              return date;
                            }
                            
                            return null;
                          };
                          
                          const parsedDate = parseUKDate(dateValue);
                          if (parsedDate && !isNaN(parsedDate.getTime())) {
                            // Format as YYYY-MM-DD for date input
                            const year = parsedDate.getFullYear();
                            const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
                            const day = String(parsedDate.getDate()).padStart(2, '0');
                            return `${year}-${month}-${day}`;
                          }
                          
                          return '';
                        } catch {
                          return '';
                        }
                      })()}
                      onChange={(e) => {
                        const value = e.target.value ? new Date(e.target.value + 'T00:00:00').toISOString() : null;
                        setEditingData(prev => ({ 
                          ...prev, 
                          invoiceDate: value,
                          date: value,
                          taxPoint: value
                        }));
                      }}
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Invoice Number</label>
                    <input
                      type="text"
                      className="form-control"
                      value={editingData.invoiceNumber || editingData.documentNumber || ''}
                      onChange={(e) => setEditingData(prev => ({ 
                        ...prev, 
                        invoiceNumber: e.target.value,
                        documentNumber: e.target.value 
                      }))}
                      placeholder="Enter invoice number"
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label">PO Number</label>
                    <input
                      type="text"
                      className="form-control"
                      value={editingData.customerPO || editingData.poNumber || ''}
                      onChange={(e) => setEditingData(prev => ({ 
                        ...prev, 
                        customerPO: e.target.value,
                        poNumber: e.target.value 
                      }))}
                      placeholder="Enter PO number"
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Total</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-control"
                      value={editingData.totalAmount || editingData.amount || ''}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value) || null;
                        setEditingData(prev => ({ 
                          ...prev, 
                          totalAmount: value,
                          amount: value 
                        }));
                      }}
                      placeholder="0.00"
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label">VAT Amount</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-control"
                      value={editingData.vatAmount || editingData.vatTotal || ''}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value) || null;
                        setEditingData(prev => ({ 
                          ...prev, 
                          vatAmount: value,
                          vatTotal: value 
                        }));
                      }}
                      placeholder="0.00"
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Delivery Address</label>
                    <textarea
                      className="form-control"
                      rows="3"
                      value={editingData.deliveryAddress || ''}
                      onChange={(e) => setEditingData(prev => ({ ...prev, deliveryAddress: e.target.value }))}
                      placeholder="Enter delivery address"
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Goods Amount</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-control"
                      value={editingData.goodsAmount || ''}
                      onChange={(e) => {
                        const value = parseFloat(e.target.value) || null;
                        setEditingData(prev => ({ ...prev, goodsAmount: value }));
                      }}
                      placeholder="0.00"
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Invoice To</label>
                    <input
                      type="text"
                      className="form-control"
                      value={editingData.invoiceTo || ''}
                      onChange={(e) => setEditingData(prev => ({ ...prev, invoiceTo: e.target.value }))}
                      placeholder="Enter invoice to address or name"
                    />
                  </div>

                      <div className="d-flex gap-2 mt-4">
                        <button
                          className="btn btn-primary"
                          onClick={handleSave}
                          disabled={saving || attemptingAllocation}
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
                          className="btn btn-success"
                          onClick={handleAttemptAllocation}
                          disabled={saving || attemptingAllocation || !editingData.accountNumber}
                          title={!editingData.accountNumber ? 'Account number is required for allocation' : 'Attempt to allocate this document to a company'}
                        >
                          {attemptingAllocation ? (
                            <>
                              <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                              Allocating...
                            </>
                          ) : (
                            <>
                              <svg xmlns="http://www.w3.org/2000/svg" className="icon me-1" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                <path d="M5 12l5 5l10 -10"/>
                              </svg>
                              Attempt Allocation
                            </>
                          )}
                        </button>
                        <button
                          className="btn btn-secondary"
                          onClick={() => navigate(`/unallocated?page=${listPage}`)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>

                    {/* JSON Tab - Only for Global Admins */}
                    {currentUser?.role === 'global_admin' && unallocatedDocument?.parsedData && (
                      <div className={`tab-pane ${activeDataTab === 'json' ? 'active show' : ''}`} id="json-tab">
                        <div className="mb-3">
                          <label className="form-label">
                            <strong>Parsed JSON from Template</strong> <span className="text-muted">(Global Admin Only)</span>
                          </label>
                          <div className="card">
                            <div className="card-body p-0">
                              <pre className="mb-0" style={{ 
                                maxHeight: '500px', 
                                overflow: 'auto', 
                                fontSize: '12px',
                                backgroundColor: '#000000',
                                color: '#ffffff',
                                padding: '1rem',
                                borderRadius: '4px',
                                margin: 0
                              }}>
                                {JSON.stringify(unallocatedDocument.parsedData, null, 2)}
                              </pre>
                            </div>
                          </div>
                          <small className="form-hint text-muted d-block mt-2">
                            This shows the raw JSON data extracted from the template. Use this to verify what fields were parsed and their values.
                          </small>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnallocatedView;

