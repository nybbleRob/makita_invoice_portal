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
  
  // Upload states
  const [uploadFiles, setUploadFiles] = useState([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState(null);
  
  const suppliersEnabled = settings?.suppliersEnabled !== false;
  const isStaff = currentUser?.role && ['global_admin', 'administrator', 'manager', 'credit_senior', 'credit_controller', 'staff'].includes(currentUser.role);
  
  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        search: debouncedSearch,
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
  
  // Upload handlers
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 500) {
      toast.error('Maximum 500 files allowed');
      return;
    }
    setUploadFiles(files);
    if (files.length > 0) {
      setShowUploadModal(true);
    }
  };
  
  const handleUploadDocuments = async () => {
    if (uploadFiles.length === 0) {
      toast.error('Please select at least one file');
      return;
    }
    
    setUploading(true);
    setUploadResults(null);
    
    try {
      const formData = new FormData();
      uploadFiles.forEach(file => {
        formData.append('files', file);
      });
      formData.append('documentType', 'invoice');
      // No supplierId - let system auto-detect
      
      const response = await api.post('/api/supplier-documents/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      setUploadResults(response.data.results);
      toast.success(`${response.data.results.queued} files queued for processing`);
      
      setTimeout(() => {
        resetUploadModal();
        fetchDocuments();
      }, 2000);
    } catch (error) {
      console.error('Error uploading documents:', error);
      toast.error(error.response?.data?.message || 'Error uploading documents');
    } finally {
      setUploading(false);
    }
  };
  
  const resetUploadModal = () => {
    setShowUploadModal(false);
    setUploadFiles([]);
    setUploadResults(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
                    <div className="input-group input-group-flat" style={{ maxWidth: '250px' }}>
                      <span className="input-group-text">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon">
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
                      />
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
                          Upload Invoices
                        </button>
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
      
      {/* Upload Modal */}
      {showUploadModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Upload Supplier Invoices</h5>
                <button type="button" className="btn-close" onClick={resetUploadModal} disabled={uploading}></button>
              </div>
              <div className="modal-body">
                {uploadResults ? (
                  <div className="text-center py-3">
                    <div className="mb-3">
                      <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-lg text-success" width="48" height="48" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none">
                        <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                        <path d="M5 12l5 5l10 -10"></path>
                      </svg>
                    </div>
                    <h3>Upload Complete</h3>
                    <p className="text-muted">
                      {uploadResults.queued} file(s) queued for processing
                      {uploadResults.duplicates > 0 && `, ${uploadResults.duplicates} duplicate(s) skipped`}
                    </p>
                    <p className="text-info small">
                      The system will automatically detect which supplier each invoice belongs to.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="alert alert-info">
                      <strong>Auto-Detection:</strong> The system will automatically identify the supplier from each invoice using the Supplier Code or Name.
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Selected Files</label>
                      <div className="card">
                        <div className="card-body" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                          {uploadFiles.length === 0 ? (
                            <p className="text-muted mb-0">No files selected</p>
                          ) : (
                            <ul className="list-unstyled mb-0">
                              {uploadFiles.map((file, i) => (
                                <li key={i} className="py-1">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="icon me-2 text-primary" width="20" height="20" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none">
                                    <path stroke="none" d="M0 0h24v24H0z" fill="none"></path>
                                    <path d="M14 3v4a1 1 0 0 0 1 1h4"></path>
                                    <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"></path>
                                  </svg>
                                  {file.name} <small className="text-muted">({(file.size / 1024).toFixed(1)} KB)</small>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm mt-2"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                      >
                        {uploadFiles.length > 0 ? 'Change Files' : 'Select Files'}
                      </button>
                    </div>
                  </>
                )}
              </div>
              {!uploadResults && (
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={resetUploadModal} disabled={uploading}>Cancel</button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleUploadDocuments}
                    disabled={uploading || uploadFiles.length === 0}
                  >
                    {uploading ? 'Uploading...' : `Upload ${uploadFiles.length} File${uploadFiles.length !== 1 ? 's' : ''}`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupplierInvoices;
