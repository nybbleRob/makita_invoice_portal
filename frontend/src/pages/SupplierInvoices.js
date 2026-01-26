import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useDebounce } from '../hooks/useDebounce';

const SupplierInvoices = () => {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { settings } = useSettings();
  const [documents, setDocuments] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
  const [sortBy, setSortBy] = useState('documentDate');
  const [sortOrder, setSortOrder] = useState('DESC');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const searchInputRef = useRef(null);
  const fileInputRef = useRef(null);
  
  // Import states
  const [importFiles, setImportFiles] = useState([]);
  const [importStatus, setImportStatus] = useState(null);
  const [importResults, setImportResults] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPollingInterval, setImportPollingInterval] = useState(null);
  
  const suppliersEnabled = settings?.suppliersEnabled !== false;
  const isStaff = currentUser?.role && ['global_admin', 'administrator', 'manager', 'credit_senior', 'credit_controller', 'staff'].includes(currentUser.role);
  
  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (importPollingInterval) {
        clearInterval(importPollingInterval);
      }
    };
  }, [importPollingInterval]);
  
  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        ...(debouncedSearch && debouncedSearch.trim().length >= 3 && { search: debouncedSearch }),
        documentType: 'invoice',
        sortBy,
        sortOrder,
        ...(statusFilter !== 'all' && { status: statusFilter }),
        ...(supplierFilter && { supplierId: supplierFilter })
      };
      
      const response = await api.get('/api/supplier-documents', { params });
      setDocuments(response.data.documents || []);
      setPagination(prev => ({
        ...prev,
        total: response.data.pagination?.total || 0,
        pages: response.data.pagination?.totalPages || 0
      }));
    } catch (error) {
      console.error('Error fetching supplier invoices:', error);
      toast.error('Error fetching supplier invoices');
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, debouncedSearch, statusFilter, supplierFilter, sortBy, sortOrder]);
  
  const fetchSuppliers = useCallback(async () => {
    try {
      const response = await api.get('/api/suppliers', { params: { limit: 1000, isActive: true } });
      setSuppliers(response.data.suppliers || []);
    } catch (error) {
      console.error('Error fetching suppliers:', error);
    }
  }, []);
  
  useEffect(() => {
    if (!suppliersEnabled) {
      navigate('/dashboard');
      return;
    }
    fetchDocuments();
  }, [fetchDocuments, suppliersEnabled, navigate]);
  
  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);
  
  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setSupplierFilter('');
    setPagination(prev => ({ ...prev, page: 1 }));
  };
  
  // Import handlers
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 500) {
      toast.error('Maximum 500 files allowed');
      return;
    }
    setImportFiles(files);
  };
  
  const handleImportDocuments = async () => {
    if (importFiles.length === 0) {
      toast.error('Please select at least one file');
      return;
    }
    
    if (importFiles.length > 500) {
      toast.error('Maximum 500 files allowed');
      return;
    }
    
    setShowImportModal(true);
    setImportStatus({ processedFiles: 0, totalFiles: importFiles.length, status: 'processing' });
    
    try {
      const formData = new FormData();
      importFiles.forEach(file => {
        formData.append('files', file);
      });
      formData.append('documentType', 'invoice');
      
      const response = await api.post('/api/supplier-documents/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      // Start polling for status
      pollImportStatus(response.data.importId);
    } catch (error) {
      console.error('Error starting supplier document import:', error);
      const errorMessage = error.response?.data?.message || error.message;
      toast.error('Error starting import: ' + errorMessage, 8000);
      setShowImportModal(false);
      setImportStatus(null);
    }
  };
  
  const pollImportStatus = async (id) => {
    const pollOnce = async () => {
      try {
        const statusResponse = await api.get(`/api/supplier-documents/import/${id}`);
        const importSession = statusResponse.data.import;
        
        // Check if cancelled
        if (importSession.cancelled || importSession.status === 'cancelled') {
          console.log('Import was cancelled');
          setImportStatus(null);
          setShowImportModal(false);
          if (importPollingInterval) {
            clearInterval(importPollingInterval);
            setImportPollingInterval(null);
          }
          toast.info('Import was cancelled');
          return true; // Stop polling
        }
        
        // Update importStatus
        setImportStatus(importSession);
        
        // If processing is complete, fetch full results
        if (importSession.status === 'completed') {
          try {
            const resultsResponse = await api.get(`/api/supplier-documents/import/${id}/results`);
            const importData = resultsResponse.data.import;
            setImportResults(importData);
            setImportStatus({ ...importSession, ...importData });
            
            // Auto-close processing modal and show results modal
            setShowImportModal(false);
            
            // Refresh documents list
            fetchDocuments();
            
            // Clear files for next upload
            setImportFiles([]);
            
            return true; // Stop polling
          } catch (error) {
            console.error('Error fetching import results:', error);
            // Continue polling to retry
          }
        }
        
        return false; // Continue polling
      } catch (error) {
        console.error('Error polling import status:', error);
        setImportStatus(null);
        setShowImportModal(false);
        setImportPollingInterval(null);
        toast.error('Error checking import status', 8000);
        return true; // Stop polling on error
      }
    };
    
    // Poll immediately
    const shouldStop = await pollOnce();
    if (shouldStop) return;
    
    // Then poll every 1 second
    const intervalId = setInterval(async () => {
      const shouldStop = await pollOnce();
      if (shouldStop) {
        clearInterval(intervalId);
        setImportPollingInterval(null);
      }
    }, 1000);
    
    setImportPollingInterval(intervalId);
  };
  
  const handleCancelImport = () => {
    if (importPollingInterval) {
      clearInterval(importPollingInterval);
      setImportPollingInterval(null);
    }
    
    setShowImportModal(false);
    setImportStatus(null);
    setImportResults(null);
    setImportFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    toast.info('Import cancelled', 3000);
  };
  
  const handleFinishImport = () => {
    setImportStatus(null);
    setImportResults(null);
    setImportFiles([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  
  if (!suppliersEnabled) return null;
  
  return (
    <div className="page">
      <div className="page-body">
        <div className="container-xl">
          <div className="card">
            <div className="card-header">
              <div className="row w-100 g-3">
                <div className="col-lg-3 col-md-4 col-12">
                  <h3 className="card-title mb-0">Supplier Invoices</h3>
                  <p className="text-secondary m-0">View and manage supplier invoice documents</p>
                </div>
                <div className="col-lg-9 col-md-8 col-12">
                  <div className="d-flex flex-wrap btn-list gap-2 justify-content-md-end">
                    {/* Search */}
                    <div className="input-group input-group-flat" style={{ maxWidth: '280px' }}>
                      <span className="input-group-text">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon">
                          <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"></path>
                          <path d="M21 21l-6 -6"></path>
                        </svg>
                      </span>
                      <input
                        ref={searchInputRef}
                        type="text"
                        className="form-control"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setPagination(prev => ({ ...prev, page: 1 }));
                        }}
                        autocomplete="off"
                      />
                      <span className="input-group-text">
                        <kbd>Ctrl+K</kbd>
                      </span>
                    </div>
                    {/* Supplier filter */}
                    <select
                      className="form-select w-auto"
                      value={supplierFilter}
                      onChange={(e) => {
                        setSupplierFilter(e.target.value);
                        setPagination(prev => ({ ...prev, page: 1 }));
                      }}
                    >
                      <option value="">All Suppliers</option>
                      {suppliers.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    {/* Status filter */}
                    <select
                      className="form-select w-auto"
                      value={statusFilter}
                      onChange={(e) => {
                        setStatusFilter(e.target.value);
                        setPagination(prev => ({ ...prev, page: 1 }));
                      }}
                    >
                      <option value="all">All Status</option>
                      <option value="ready">Ready</option>
                      <option value="processing">Processing</option>
                      <option value="failed">Failed</option>
                    </select>
                    {/* Reset */}
                    <button className="btn btn-outline-secondary" onClick={handleResetFilters}>Reset</button>
                    {/* Upload */}
                    {isStaff && (
                      <>
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept=".pdf"
                          onChange={handleFileSelect}
                          style={{ display: 'none' }}
                        />
                        <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
                          Upload
                        </button>
                        {importFiles.length > 0 && (
                          <button className="btn btn-success" onClick={handleImportDocuments}>
                            Import {importFiles.length} File{importFiles.length !== 1 ? 's' : ''}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="table-responsive">
              <table className="table table-vcenter table-hover">
                <thead>
                  <tr>
                    <th>Invoice No.</th>
                    <th>Date</th>
                    <th>Supplier</th>
                    <th>PO Number</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan="7" className="text-center py-4"><div className="spinner-border spinner-border-sm"></div></td></tr>
                  ) : documents.length === 0 ? (
                    <tr><td colSpan="7" className="text-center text-muted py-4">No supplier invoices found</td></tr>
                  ) : (
                    documents.map(doc => (
                      <tr key={doc.id}>
                        <td><strong>{doc.invoiceNumber || '-'}</strong></td>
                        <td>{doc.documentDate ? new Date(doc.documentDate).toLocaleDateString() : '-'}</td>
                        <td>
                          <div>{doc.supplier?.name || 'Unknown'}</div>
                          {doc.supplier?.code && <small className="text-muted">{doc.supplier.code}</small>}
                        </td>
                        <td>{doc.poNumber || '-'}</td>
                        <td>{doc.amount ? `£${parseFloat(doc.amount).toFixed(2)}` : '-'}</td>
                        <td>
                          <span className={`badge ${
                            doc.status === 'ready' ? 'bg-success' :
                            doc.status === 'processing' ? 'bg-warning' :
                            doc.status === 'failed' ? 'bg-danger' : 'bg-secondary'
                          }`}>
                            {doc.status}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => navigate(`/supplier-documents/${doc.id}`)}
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {pagination.total > 0 && (
              <div className="card-footer d-flex justify-content-between align-items-center">
                <div className="text-muted">
                  Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
                </div>
                <div className="btn-group">
                  <button
                    className="btn btn-sm btn-outline-primary"
                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                    disabled={pagination.page === 1}
                  >
                    Previous
                  </button>
                  <button
                    className="btn btn-sm btn-outline-primary"
                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                    disabled={pagination.page >= pagination.pages}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Import Processing Modal */}
      {showImportModal && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Importing Supplier Invoices</h5>
                <button type="button" className="btn-close" onClick={handleCancelImport}></button>
              </div>
              <div className="modal-body text-center py-4">
                <div className="alert alert-info mb-3">
                  <strong>Note:</strong> The system will automatically detect which supplier each document belongs to using Supplier Code or Name.
                </div>
                <div className="spinner-border text-primary mb-3" role="status">
                  <span className="visually-hidden">Processing...</span>
                </div>
                <h3>Processing {importStatus?.totalFiles || 0} file(s)...</h3>
                <p className="text-muted">
                  Processed {importStatus?.processedFiles || 0} of {importStatus?.totalFiles || 0} files
                </p>
                {importStatus && importStatus.totalFiles > 0 && (
                  <div className="progress">
                    <div 
                      className="progress-bar progress-bar-striped progress-bar-animated" 
                      role="progressbar" 
                      style={{ width: `${((importStatus?.processedFiles || 0) / importStatus.totalFiles) * 100}%` }}
                    >
                      {Math.round(((importStatus?.processedFiles || 0) / importStatus.totalFiles) * 100)}%
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-danger" onClick={handleCancelImport}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Import Results Modal */}
      {importResults && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-xl">
            <div className="modal-content">
              <div className="modal-header bg-success-lt">
                <h5 className="modal-title">
                  <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-md me-2" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                    <path d="M5 12l5 5l10 -10" />
                  </svg>
                  Import Complete
                </h5>
                <button type="button" className="btn-close" onClick={handleFinishImport}></button>
              </div>
              <div className="modal-body">
                {/* Summary Cards */}
                <div className="row mb-4">
                  <div className="col-md-3">
                    <div className="card card-sm">
                      <div className="card-body">
                        <div className="row align-items-center">
                          <div className="col-auto">
                            <span className="bg-primary text-white avatar">
                              <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                <path d="M5 12l5 5l10 -10" />
                              </svg>
                            </span>
                          </div>
                          <div className="col">
                            <div className="font-weight-medium">{importResults.summary?.successful || 0}</div>
                            <div className="text-muted">Successful</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-3">
                    <div className="card card-sm">
                      <div className="card-body">
                        <div className="row align-items-center">
                          <div className="col-auto">
                            <span className="bg-success text-white avatar">
                              <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                <path d="M9 12l2 2l4 -4" />
                                <path d="M21 12c-1 0 -2.5 -.5 -3 -1" />
                                <path d="M3 12c1 0 2.5 -.5 3 -1" />
                              </svg>
                            </span>
                          </div>
                          <div className="col">
                            <div className="font-weight-medium text-success">{importResults.summary?.matched || 0}</div>
                            <div className="text-muted">Matched to Supplier</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-3">
                    <div className="card card-sm">
                      <div className="card-body">
                        <div className="row align-items-center">
                          <div className="col-auto">
                            <span className="bg-warning text-white avatar">
                              <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
                                <path d="M12 8v4" />
                                <path d="M12 16h.01" />
                              </svg>
                            </span>
                          </div>
                          <div className="col">
                            <div className="font-weight-medium text-warning">{importResults.summary?.unallocated || 0}</div>
                            <div className="text-muted">Unallocated</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-3">
                    <div className="card card-sm">
                      <div className="card-body">
                        <div className="row align-items-center">
                          <div className="col-auto">
                            <span className="bg-danger text-white avatar">
                              <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
                                <path d="M10 10l4 4m0 -4l-4 4" />
                              </svg>
                            </span>
                          </div>
                          <div className="col">
                            <div className="font-weight-medium text-danger">{importResults.summary?.failed || 0}</div>
                            <div className="text-muted">Failed</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Overall Status Alert */}
                {importResults.summary?.failed === 0 && importResults.summary?.unallocated === 0 ? (
                  <div className="alert alert-success d-flex align-items-center mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="icon me-2" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                      <path d="M5 12l5 5l10 -10" />
                    </svg>
                    <div>
                      <strong>Perfect!</strong> All {importResults.summary?.successful || 0} document(s) were successfully imported and matched to suppliers.
                    </div>
                  </div>
                ) : importResults.summary?.failed > 0 ? (
                  <div className="alert alert-danger d-flex align-items-center mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="icon me-2" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                      <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
                      <path d="M10 10l4 4m0 -4l-4 4" />
                    </svg>
                    <div>
                      <strong>Some documents failed to import.</strong> {importResults.summary?.failed || 0} document(s) encountered errors. Check the details below.
                    </div>
                  </div>
                ) : (
                  <div className="alert alert-warning d-flex align-items-center mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="icon me-2" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                      <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
                      <path d="M12 8v4" />
                      <path d="M12 16h.01" />
                    </svg>
                    <div>
                      <strong>Import completed with warnings.</strong> {importResults.summary?.unallocated || 0} document(s) could not be matched to a supplier.
                    </div>
                  </div>
                )}
                
                {/* Detailed Results Table */}
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title">Import Details</h3>
                    <div className="card-actions">
                      <span className="badge bg-secondary-lt">{importResults.results?.length || 0} file(s)</span>
                    </div>
                  </div>
                  <div className="table-responsive" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    <table className="table table-vcenter table-hover table-sm">
                      <thead className="sticky-top bg-light">
                        <tr>
                          <th>File Name</th>
                          <th>Status</th>
                          <th>Supplier</th>
                          <th>Invoice #</th>
                          <th>Amount</th>
                          <th>Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResults.results && importResults.results.length > 0 ? (
                          importResults.results.map((result, idx) => (
                            <tr key={idx} className={result.success ? '' : 'table-danger'}>
                              <td>
                                <div className="text-truncate" style={{ maxWidth: '200px' }} title={result.fileName}>
                                  {result.fileName}
                                </div>
                              </td>
                              <td>
                                {result.success ? (
                                  <span className="badge bg-success-lt">Success</span>
                                ) : (
                                  <span className="badge bg-danger-lt">Failed</span>
                                )}
                              </td>
                              <td>
                                {result.supplierId ? (
                                  <span className="badge bg-success-lt">{result.supplierName || 'Matched'}</span>
                                ) : result.success ? (
                                  <span className="badge bg-warning-lt">Unallocated</span>
                                ) : (
                                  <span className="text-muted">-</span>
                                )}
                              </td>
                              <td>
                                {result.invoiceNumber ? (
                                  <span className="font-weight-medium">{result.invoiceNumber}</span>
                                ) : (
                                  <span className="text-muted">-</span>
                                )}
                              </td>
                              <td>
                                {result.amount ? (
                                  <span className="font-weight-medium">£{Number(result.amount).toFixed(2)}</span>
                                ) : (
                                  <span className="text-muted">-</span>
                                )}
                              </td>
                              <td>
                                {result.error ? (
                                  <span className="text-danger small" title={result.error}>
                                    {result.error.length > 40 ? `${result.error.substring(0, 40)}...` : result.error}
                                  </span>
                                ) : (
                                  <span className="text-muted">-</span>
                                )}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="6" className="text-center text-muted py-4">
                              No results available
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-primary" onClick={handleFinishImport}>
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupplierInvoices;
