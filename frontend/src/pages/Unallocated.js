import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { useDebounce } from '../hooks/useDebounce';

const Unallocated = () => {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [reasonFilter, setReasonFilter] = useState('all');
  const searchInputRef = useRef(null);
  const [accountNumberFilter] = useState('');
  const [invoiceNumberFilter] = useState('');
  const [dateFilter] = useState('');
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [editingData, setEditingData] = useState({});
  const [saving, setSaving] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [showClearAllModal, setShowClearAllModal] = useState(false);
  const [clearAllReason, setClearAllReason] = useState('');
  const [clearingAll, setClearingAll] = useState(false);
  const [activeDataTab, setActiveDataTab] = useState('extracted'); // 'extracted' or 'json'
  const [documentToDelete, setDocumentToDelete] = useState(null);
  const [showSingleDeleteModal, setShowSingleDeleteModal] = useState(false);
  const [singleDeleteReason, setSingleDeleteReason] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const debouncedAccountNumber = useDebounce(accountNumberFilter, 300);
  const debouncedInvoiceNumber = useDebounce(invoiceNumberFilter, 300);
  const debouncedDate = useDebounce(dateFilter, 300);

  useEffect(() => {
    fetchDocuments();
    // Clear selections when page changes or filters change
    setSelectedFiles(new Set());
  }, [pagination.page, activeSearchQuery, reasonFilter, debouncedAccountNumber, debouncedInvoiceNumber, debouncedDate]);

  // Ctrl+K keyboard shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      
      // Check if search contains comma-separated document numbers
      let searchParam = null;
      let documentNumbersParam = null;
      
      if (activeSearchQuery && activeSearchQuery.trim()) {
        if (activeSearchQuery.includes(',')) {
          // Comma-separated document numbers - exact match
          const numbers = activeSearchQuery.split(',').map(n => n.trim()).filter(n => n);
          if (numbers.length > 0) {
            documentNumbersParam = numbers.join(',');
          }
        } else if (activeSearchQuery.trim().length >= 3) {
          // Regular search (requires 3+ chars)
          searchParam = activeSearchQuery;
        }
      }
      
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        ...(searchParam && { search: searchParam }),
        ...(documentNumbersParam && { documentNumbers: documentNumbersParam }),
        ...(reasonFilter !== 'all' && { failureReason: reasonFilter }),
        ...(debouncedAccountNumber && { accountNumber: debouncedAccountNumber }),
        ...(debouncedInvoiceNumber && { invoiceNumber: debouncedInvoiceNumber }),
        ...(debouncedDate && { date: debouncedDate })
      };
      
      const response = await api.get('/api/unallocated', { params });
      
      if (response.data && response.data.data) {
        setDocuments(response.data.data || []);
        setPagination(prev => ({
          ...prev,
          total: response.data.pagination?.total || 0,
          pages: response.data.pagination?.pages || 0
        }));
      } else {
        setDocuments([]);
      }
    } catch (error) {
      console.error('Error fetching unallocated documents:', error);
      toast.error('Error fetching documents: ' + (error.response?.data?.message || error.message));
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!selectedDocument) return;

    try {
      setSaving(true);
      await api.put(`/api/unallocated/${selectedDocument.id}`, {
        parsedData: editingData,
        accountNumber: editingData.accountNumber
      });

      toast.success('Document updated and queued for reprocessing');
      setShowViewModal(false);
      setSelectedDocument(null);
      fetchDocuments();
    } catch (error) {
      console.error('Error saving document:', error);
      toast.error('Error saving document: ' + (error.response?.data?.message || error.message));
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Helper component for truncated cells with tooltip
  const TruncatedCell = ({ value, maxWidth = '150px', maxLength = 30 }) => {
    const displayValue = value && value !== '-' ? String(value) : '-';
    const needsTruncation = displayValue.length > maxLength;
    const truncatedValue = needsTruncation ? displayValue.substring(0, maxLength) + '...' : displayValue;
    
    return (
      <td 
        style={{ 
          maxWidth, 
          overflow: 'hidden', 
          textOverflow: 'ellipsis', 
          whiteSpace: 'nowrap',
          cursor: needsTruncation ? 'help' : 'default',
          position: 'relative'
        }}
        title={needsTruncation ? displayValue : ''}
      >
        {truncatedValue}
      </td>
    );
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

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      // Select all documents on current page
      const currentPageIds = new Set(documents.map(doc => doc.id));
      setSelectedFiles(prev => new Set([...prev, ...currentPageIds]));
    } else {
      // Deselect all documents on current page
      const currentPageIds = new Set(documents.map(doc => doc.id));
      setSelectedFiles(prev => {
        const newSet = new Set(prev);
        currentPageIds.forEach(id => newSet.delete(id));
        return newSet;
      });
    }
  };

  const handleSelectFile = (fileId) => {
    const newSelected = new Set(selectedFiles);
    if (newSelected.has(fileId)) {
      newSelected.delete(fileId);
    } else {
      newSelected.add(fileId);
    }
    setSelectedFiles(newSelected);
  };

  const handleBulkDelete = async () => {
    if (selectedFiles.size === 0) {
      toast.error('Please select at least one file to delete');
      return;
    }

    if (!deleteReason || deleteReason.trim().length === 0) {
      toast.error('Please provide a reason for deletion');
      return;
    }

    try {
      setDeleting(true);
      const response = await api.delete('/api/unallocated/bulk', {
        data: { 
          fileIds: Array.from(selectedFiles),
          reason: deleteReason.trim()
        }
      });

      if (response.data.success) {
        toast.success(response.data.message);
        setSelectedFiles(new Set());
        setShowDeleteModal(false);
        setDeleteReason('');
        fetchDocuments();
      } else {
        toast.error(response.data.message || 'Error deleting files');
      }
    } catch (error) {
      console.error('Error bulk deleting files:', error);
      toast.error('Error deleting files: ' + (error.response?.data?.message || error.message));
    } finally {
      setDeleting(false);
    }
  };

  const handleClearAll = async () => {
    if (!clearAllReason || clearAllReason.trim().length === 0) {
      toast.error('Please provide a reason for clearing all documents');
      return;
    }

    try {
      setClearingAll(true);
      const response = await api.delete('/api/unallocated/clear-all', {
        data: { 
          reason: clearAllReason.trim()
        }
      });

      if (response.data.success) {
        toast.success(response.data.message);
        setShowClearAllModal(false);
        setClearAllReason('');
        setSelectedFiles(new Set());
        fetchDocuments();
      } else {
        toast.error(response.data.message || 'Error clearing all documents');
      }
    } catch (error) {
      console.error('Error clearing all documents:', error);
      toast.error('Error clearing all documents: ' + (error.response?.data?.message || error.message));
    } finally {
      setClearingAll(false);
    }
  };

  const handleDeleteDocument = (document) => {
    setDocumentToDelete(document);
    setShowSingleDeleteModal(true);
    setSingleDeleteReason('');
  };


  const confirmDeleteDocument = async () => {
    if (!documentToDelete || !singleDeleteReason || singleDeleteReason.trim().length === 0) {
      toast.error('Please provide a reason for deletion');
      return;
    }

    try {
      setDeleting(true);
      const response = await api.delete(`/api/unallocated/${documentToDelete.id}`, {
        data: { reason: singleDeleteReason.trim() }
      });

      if (response.data.success) {
        toast.success('Document deleted successfully');
        setShowSingleDeleteModal(false);
        setDocumentToDelete(null);
        setSingleDeleteReason('');
        fetchDocuments();
      } else {
        toast.error(response.data.message || 'Error deleting document');
      }
    } catch (error) {
      console.error('Error deleting document:', error);
      toast.error('Error deleting document: ' + (error.response?.data?.message || error.message));
    } finally {
      setDeleting(false);
    }
  };

  const getReasonBadge = (reason, status, metadata) => {
    // Get specific failure reason from metadata if available
    const specificReason = metadata?.specificFailureReason;
    
    // If status is unallocated, show as unallocated
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

  return (
    <div className="page">
      <div className="page-body">
        <div className="container-xl">
          <div className="card">
            <div className="card-header">
              <div className="row w-100 g-3">
                {/* Title and description */}
                <div className="col-lg-3 col-md-4 col-12">
                  <h3 className="card-title mb-0">Unallocated Documents</h3>
                  <p className="text-secondary m-0">Documents that could not be matched or failed processing</p>
                </div>
                {/* Controls */}
                <div className="col-lg-9 col-md-8 col-12">
                  <div className="d-flex flex-wrap btn-list gap-2 justify-content-md-end">
                    {/* Search */}
                    <div className="input-group input-group-flat" style={{ maxWidth: '280px' }}>
                      <span className="input-group-text">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon icon-1">
                          <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"></path>
                          <path d="M21 21l-6 -6"></path>
                        </svg>
                      </span>
                      <input
                        ref={searchInputRef}
                        type="text"
                        className="form-control"
                        placeholder="Search for Documents"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            setActiveSearchQuery(searchQuery);
                            setPagination(prev => ({ ...prev, page: 1 }));
                          }
                        }}
                        autoComplete="off"
                      />
                      <span className="input-group-text">
                        <kbd>ctrl + K</kbd>
                      </span>
                      <button 
                        className="btn btn-primary" 
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setActiveSearchQuery(searchQuery);
                          setPagination(prev => ({ ...prev, page: 1 }));
                        }}
                      >
                        Search
                      </button>
                    </div>
                    {/* Reason filter */}
                    <select
                      className="form-select w-auto"
                      value={reasonFilter}
                      onChange={(e) => {
                        setReasonFilter(e.target.value);
                        setPagination(prev => ({ ...prev, page: 1 }));
                      }}
                    >
                      <option value="all">All Reasons</option>
                      <option value="unallocated">Unallocated</option>
                      <option value="parsing_error">Parsing Error</option>
                      <option value="validation_error">Validation Error</option>
                      <option value="duplicate">Duplicate</option>
                      <option value="other">Other</option>
                    </select>
                    {/* Bulk actions */}
                    {selectedFiles.size > 0 && (
                      <button
                        className="btn btn-danger"
                        onClick={() => {
                          setShowDeleteModal(true);
                          setDeleteReason('');
                        }}
                        disabled={deleting}
                      >
                        Delete Selected ({selectedFiles.size})
                      </button>
                    )}
                    {currentUser?.role && ['global_admin', 'administrator'].includes(currentUser.role) && pagination.total > 0 && (
                      <button
                        className="btn btn-danger"
                        onClick={() => {
                          setShowClearAllModal(true);
                          setClearAllReason('');
                        }}
                        disabled={clearingAll}
                      >
                        Clear All ({pagination.total})
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="table-responsive">
              <table className="table table-vcenter table-selectable">
                <thead>
                  <tr>
                    <th className="w-1">
                      <input
                        type="checkbox"
                        className="form-check-input m-0 align-middle"
                        checked={documents.length > 0 && documents.every(doc => selectedFiles.has(doc.id))}
                        onChange={handleSelectAll}
                        disabled={loading || documents.length === 0}
                        title={documents.length > 0 && documents.some(doc => selectedFiles.has(doc.id)) && !documents.every(doc => selectedFiles.has(doc.id)) ? 'Some items selected' : 'Select all on this page'}
                      />
                    </th>
                    <th>Type</th>
                    <th>Invoice No.</th>
                    <th>Date/Tax Point</th>
                    <th>Account No.</th>
                    <th>Invoice To</th>
                    <th>Delivery Address</th>
                    <th>PO Number</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Retention</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody className={loading ? 'placeholder-glow' : ''}>
                  {loading ? (
                    [...Array(10)].map((_, i) => (
                      <tr key={`skeleton-${i}`}>
                        <td><span className="placeholder" style={{ width: '16px', height: '16px', borderRadius: '3px' }}></span></td>
                        <td><span className="placeholder col-7"></span></td>
                        <td><span className="placeholder col-8"></span></td>
                        <td><span className="placeholder col-6"></span></td>
                        <td><span className="placeholder col-6"></span></td>
                        <td><span className="placeholder col-8"></span></td>
                        <td><span className="placeholder col-9"></span></td>
                        <td><span className="placeholder col-5"></span></td>
                        <td><span className="placeholder col-4"></span></td>
                        <td><span className="placeholder col-6" style={{ borderRadius: '4px' }}></span></td>
                        <td><span className="placeholder col-5"></span></td>
                        <td>
                          <div className="btn-list">
                            <span className="placeholder btn btn-sm disabled" style={{ width: '50px' }}></span>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : documents.length === 0 ? (
                    <tr>
                      <td colSpan="13" className="text-center py-3 text-muted">
                        No unallocated documents found
                      </td>
                    </tr>
                  ) : (
                    documents.map((doc) => {
                      const parsed = doc.parsedData || {};
                      const metadataParsed = parsed.metadata?.parsedData || {};
                      const documentType = parsed.documentType || parsed.document_type || 'invoice';
                      const accountNumber = parsed.accountNumber || parsed.customerNumber || parsed.account_no || parsed.accountNo || '-';
                      const invoiceNumber = parsed.invoiceNumber || parsed.documentNumber || parsed.invoice_number || parsed.invoiceNo || parsed.creditNumber || parsed.credit_number || '-';
                      const invoiceTo = parsed.invoiceTo || parsed.invoice_to || parsed.bill_to || metadataParsed.invoiceTo || metadataParsed.invoice_to || '-';
                      const deliveryAddress = parsed.deliveryAddress || parsed.delivery_address || parsed.ship_to || parsed.shipping_address || metadataParsed.deliveryAddress || metadataParsed.delivery_address || '-';
                      const poNumber = parsed.customerPO || parsed.poNumber || parsed.purchaseOrder || parsed.customer_po || parsed.po_number || metadataParsed.customerPO || metadataParsed.poNumber || '-';
                      const amount = parsed.totalAmount || parsed.amount || parsed.invoiceTotal || parsed.total || metadataParsed.totalAmount || metadataParsed.amount || '-';
                      
                      // Extract date from multiple possible field names and formats
                      const invoiceDate = parsed.invoiceDate || parsed.date || parsed.taxPoint || parsed.tax_point || 
                                         parsed.taxPointDate || parsed.tax_point_date || parsed.invoice_date ||
                                         metadataParsed.invoiceDate || metadataParsed.date || metadataParsed.taxPoint || metadataParsed.tax_point ||
                                         metadataParsed.taxPointDate || metadataParsed.tax_point_date || metadataParsed.invoice_date || '';
                      
                      // Format date for display - handle UK format dates (dd/mm/yy or dd/mm/yyyy)
                      let formattedDate = '-';
                      if (invoiceDate) {
                        try {
                          let date = null;
                          const dateStr = String(invoiceDate).trim();
                          
                          // Try UK format first: dd/mm/yy or dd/mm/yyyy
                          const ukMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
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
                              date = new Date(year, month - 1, day);
                              if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
                                date = null; // Invalid date
                              }
                            }
                          }
                          
                          // If UK format didn't work, try standard Date parsing
                          if (!date || isNaN(date.getTime())) {
                            date = new Date(dateStr);
                          }
                          
                          if (date && !isNaN(date.getTime()) && date.getFullYear() > 1900) {
                            formattedDate = date.toLocaleDateString('en-GB', { 
                              day: '2-digit', 
                              month: 'short', 
                              year: 'numeric' 
                            });
                          }
                        } catch (e) {
                          // If parsing fails, try to display the raw value if it looks like a date
                          if (invoiceDate && invoiceDate.length > 0) {
                            formattedDate = String(invoiceDate);
                          }
                        }
                      }

                      // Format amount for display
                      let formattedAmount = '-';
                      if (amount && amount !== '-') {
                        try {
                          const amountNum = typeof amount === 'string' ? parseFloat(amount.toString().replace(/[£,]/g, '')) : amount;
                          if (!isNaN(amountNum) && amountNum > 0) {
                            formattedAmount = `£${amountNum.toFixed(2)}`;
                          }
                        } catch (e) {
                          formattedAmount = String(amount);
                        }
                      }

                      // Calculate retention date based on uploadedAt + retention period
                      let retentionInfo = '-';
                      if (doc.uploadedAt) {
                        try {
                          // For now, show uploaded date - retention calculation would need settings
                          const uploadedDate = new Date(doc.uploadedAt);
                          if (!isNaN(uploadedDate.getTime())) {
                            retentionInfo = uploadedDate.toLocaleDateString('en-GB', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric'
                            });
                          }
                        } catch (e) {
                          retentionInfo = '-';
                        }
                      }

                      return (
                        <tr key={doc.id}>
                          <td>
                            <input
                              type="checkbox"
                              className="form-check-input m-0 align-middle table-selectable-check"
                              checked={selectedFiles.has(doc.id)}
                              onChange={() => handleSelectFile(doc.id)}
                            />
                          </td>
                          <td>
                            <span className={`badge ${
                              documentType === 'credit_note' ? 'bg-info-lt' : 
                              documentType === 'statement' ? 'bg-secondary-lt' : 
                              'bg-primary-lt'
                            }`}>
                              {documentType === 'credit_note' ? 'Credit Note' : 
                               documentType === 'statement' ? 'Statement' : 
                               'Invoice'}
                            </span>
                          </td>
                          <td>
                            {invoiceNumber !== '-' ? <strong>{invoiceNumber}</strong> : '-'}
                          </td>
                          <td>{formattedDate}</td>
                          <td>
                            <strong>{accountNumber}</strong>
                          </td>
                          <TruncatedCell value={invoiceTo} maxWidth="200px" maxLength={30} />
                          <TruncatedCell value={deliveryAddress} maxWidth="200px" maxLength={40} />
                          <TruncatedCell value={poNumber} maxWidth="150px" maxLength={20} />
                          <td>{formattedAmount}</td>
                          <td>
                            <div>
                              {getReasonBadge(doc.failureReason, doc.status, doc.metadata)}
                            </div>
                          </td>
                          <td>{retentionInfo}</td>
                          <td>
                            <div className="btn-list flex-nowrap">
                              <button 
                                className="btn btn-sm btn-primary"
                                onClick={() => navigate(`/unallocated/${doc.id}/view`)}
                                title="View"
                              >
                                View
                              </button>
                              {(currentUser?.role === 'global_admin' || currentUser?.role === 'administrator') && (
                                <button 
                                  className="btn btn-sm btn-danger"
                                  onClick={() => handleDeleteDocument(doc)}
                                  title="Delete"
                                  disabled={deleting}
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
              
              {/* Pagination Controls */}
              {pagination.total > pagination.limit && (
                <div className="card-footer">
                  <div className="d-flex justify-content-between align-items-center">
                    <div className="text-muted">
                      Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} Unallocated Documents
                    </div>
                    {(() => {
                      // Calculate which page numbers to show
                      const currentPage = pagination.page;
                      const totalPages = pagination.pages;
                      const pagesToShow = [];
                      
                      if (totalPages <= 7) {
                        // Show all pages if 7 or fewer
                        for (let i = 1; i <= totalPages; i++) {
                          pagesToShow.push(i);
                        }
                      } else {
                        // Show first page
                        pagesToShow.push(1);
                        
                        if (currentPage <= 4) {
                          // Near the start: 1, 2, 3, 4, 5, ..., last
                          for (let i = 2; i <= 5; i++) {
                            pagesToShow.push(i);
                          }
                          pagesToShow.push('ellipsis');
                          pagesToShow.push(totalPages);
                        } else if (currentPage >= totalPages - 3) {
                          // Near the end: 1, ..., last-4, last-3, last-2, last-1, last
                          pagesToShow.push('ellipsis');
                          for (let i = totalPages - 4; i <= totalPages; i++) {
                            pagesToShow.push(i);
                          }
                        } else {
                          // In the middle: 1, ..., current-1, current, current+1, ..., last
                          pagesToShow.push('ellipsis');
                          for (let i = currentPage - 1; i <= currentPage + 1; i++) {
                            pagesToShow.push(i);
                          }
                          pagesToShow.push('ellipsis');
                          pagesToShow.push(totalPages);
                        }
                      }
                      
                      return (
                        <div className="d-flex align-items-center gap-2">
                          {/* Tabler-style pagination */}
                          <ul className="pagination m-0">
                            {/* First page button */}
                            <li className={`page-item ${pagination.page === 1 || loading ? 'disabled' : ''}`}>
                              <a 
                                className="page-link" 
                                href="#" 
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (pagination.page > 1 && !loading) {
                                    setPagination(prev => ({ ...prev, page: 1 }));
                                  }
                                }}
                                tabIndex={pagination.page === 1 || loading ? -1 : 0}
                                aria-disabled={pagination.page === 1 || loading}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="icon">
                                  <path d="M11 7l-5 5l5 5" />
                                  <path d="M17 7l-5 5l5 5" />
                                </svg>
                              </a>
                            </li>
                            {/* Previous page button */}
                            <li className={`page-item ${pagination.page === 1 || loading ? 'disabled' : ''}`}>
                              <a 
                                className="page-link" 
                                href="#" 
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (pagination.page > 1 && !loading) {
                                    setPagination(prev => ({ ...prev, page: prev.page - 1 }));
                                  }
                                }}
                                tabIndex={pagination.page === 1 || loading ? -1 : 0}
                                aria-disabled={pagination.page === 1 || loading}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="icon">
                                  <path d="M15 6l-6 6l6 6" />
                                </svg>
                              </a>
                            </li>
                            {/* Page numbers */}
                            {pagesToShow.map((page, index) => {
                              if (page === 'ellipsis') {
                                return (
                                  <li key={`ellipsis-${index}`} className="page-item disabled">
                                    <span className="page-link">...</span>
                                  </li>
                                );
                              }
                              return (
                                <li key={page} className={`page-item ${page === currentPage ? 'active' : ''}`}>
                                  <a 
                                    className="page-link" 
                                    href="#" 
                                    onClick={(e) => {
                                      e.preventDefault();
                                      if (page !== currentPage && !loading) {
                                        setPagination(prev => ({ ...prev, page }));
                                      }
                                    }}
                                  >
                                    {page}
                                  </a>
                                </li>
                              );
                            })}
                            {/* Next page button */}
                            <li className={`page-item ${pagination.page >= pagination.pages || loading ? 'disabled' : ''}`}>
                              <a 
                                className="page-link" 
                                href="#" 
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (pagination.page < pagination.pages && !loading) {
                                    setPagination(prev => ({ ...prev, page: prev.page + 1 }));
                                  }
                                }}
                                tabIndex={pagination.page >= pagination.pages || loading ? -1 : 0}
                                aria-disabled={pagination.page >= pagination.pages || loading}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="icon">
                                  <path d="M9 6l6 6l-6 6" />
                                </svg>
                              </a>
                            </li>
                            {/* Last page button */}
                            <li className={`page-item ${pagination.page >= pagination.pages || loading ? 'disabled' : ''}`}>
                              <a 
                                className="page-link" 
                                href="#" 
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (pagination.page < pagination.pages && !loading) {
                                    setPagination(prev => ({ ...prev, page: pagination.pages }));
                                  }
                                }}
                                tabIndex={pagination.page >= pagination.pages || loading ? -1 : 0}
                                aria-disabled={pagination.page >= pagination.pages || loading}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="icon">
                                  <path d="M7 7l5 5l-5 5" />
                                  <path d="M13 7l5 5l-5 5" />
                                </svg>
                              </a>
                            </li>
                          </ul>
                          {/* Number input box */}
                          <div className="d-flex align-items-center gap-2">
                            <span className="text-muted">Page</span>
                            <input
                              type="number"
                              className="form-control form-control-sm"
                              style={{ width: '70px' }}
                              min="1"
                              max={pagination.pages}
                              defaultValue={pagination.page}
                              key={pagination.page} // Reset input when page changes externally
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  const page = parseInt(e.target.value);
                                  if (page >= 1 && page <= pagination.pages) {
                                    setPagination(prev => ({ ...prev, page }));
                                  }
                                  e.target.blur();
                                }
                              }}
                              onBlur={(e) => {
                                const page = parseInt(e.target.value);
                                if (page >= 1 && page <= pagination.pages && page !== pagination.page) {
                                  setPagination(prev => ({ ...prev, page }));
                                }
                              }}
                            />
                            <span className="text-muted">of {pagination.pages}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
          </div>
        </div>
      </div>

      {/* View Modal */}
      {showViewModal && selectedDocument && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">View Document: {selectedDocument.fileName}</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowViewModal(false);
                    setSelectedDocument(null);
                  }}
                ></button>
              </div>
              <div className="modal-body">
                {/* Error and Failure Reason - Full Width */}
                {selectedDocument.errorMessage && (
                  <div className="alert alert-danger mb-3">
                    <strong>Error:</strong> {selectedDocument.errorMessage}
                  </div>
                )}

                {selectedDocument.failureReason && (
                  <div className="mb-3">
                    <label className="form-label">Failure Reason <span className="text-muted">(Read-only)</span></label>
                    <div>
                      {getReasonBadge(selectedDocument.failureReason, selectedDocument.status, selectedDocument.metadata)}
                    </div>
                    {selectedDocument.metadata?.specificFailureReason && (
                      <small className="text-muted d-block mt-2">
                        <strong>What to fix:</strong> {formatSpecificReason(selectedDocument.metadata.specificFailureReason)}
                      </small>
                    )}
                    {selectedDocument.metadata?.missingFields && selectedDocument.metadata.missingFields.length > 0 && (
                      <small className="text-muted d-block mt-1">
                        <strong>Missing fields:</strong> {selectedDocument.metadata.missingFields.join(', ')}
                      </small>
                    )}
                  </div>
                )}

                {/* Two Column Layout: PDF on Left, Extracted Data Tabs on Right */}
                <div className="row">
                  {/* Left Column: PDF Preview */}
                  <div className="col-lg-6 mb-3">
                    <div className="card">
                      <div className="card-header">
                        <h3 className="card-title">PDF Preview</h3>
                      </div>
                      <div className="card-body p-0" style={{ height: '600px', overflow: 'auto' }}>
                        <iframe
                          src={`/uploads/${selectedDocument.filePath.replace(/^.*[\\/]/, '')}`}
                          style={{
                            width: '100%',
                            height: '100%',
                            border: 'none'
                          }}
                          title="PDF Preview"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Tabbed Extracted Data */}
                  <div className="col-lg-6 mb-3">
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
                          {currentUser?.role === 'global_admin' && selectedDocument.parsedData && (
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
                                    const date = new Date(dateValue);
                                    if (isNaN(date.getTime())) return '';
                                    return date.toISOString().split('T')[0];
                                  } catch {
                                    return '';
                                  }
                                })()}
                                onChange={(e) => {
                                  const value = e.target.value ? new Date(e.target.value).toISOString() : null;
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

                            {selectedDocument.editLog && selectedDocument.editLog.length > 0 && (
                              <div className="mb-3">
                                <label className="form-label">Edit History</label>
                                <div className="card">
                                  <div className="card-body">
                                    {selectedDocument.editLog.map((log, idx) => (
                                      <div key={idx} className="mb-2 pb-2 border-bottom">
                                        <div className="text-muted small">
                                          <strong>{log.editedByName}</strong> - {formatDate(log.editedAt)}
                                        </div>
                                        {log.changes && Object.keys(log.changes).length > 0 && (
                                          <div className="small mt-1">
                                            {Object.entries(log.changes).map(([key, change]) => (
                                              <div key={key}>
                                                <strong>{key}:</strong> {JSON.stringify(change.from)} → {JSON.stringify(change.to)}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* JSON Tab - Only for Global Admins */}
                          {currentUser?.role === 'global_admin' && selectedDocument.parsedData && (
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
                                      {JSON.stringify(selectedDocument.parsedData, null, 2)}
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
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    setShowViewModal(false);
                    setSelectedDocument(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save & Requeue'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clear All Confirmation Modal */}
      {showClearAllModal && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered modal-xl">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="fas fa-exclamation-triangle text-danger me-2"></i>
                  Clear All Unallocated Documents
                </h5>
                <button 
                  type="button" 
                  className="btn-close" 
                  onClick={() => {
                    setShowClearAllModal(false);
                    setClearAllReason('');
                  }}
                  disabled={clearingAll}
                ></button>
              </div>
              <div className="modal-body">
                <div className="alert alert-danger">
                  <strong>Warning:</strong> This action cannot be undone. All unallocated documents and their associated database records will be permanently deleted.
                </div>
                <p>
                  You are about to delete <strong>ALL unallocated documents</strong> from the system. This will:
                </p>
                <ul>
                  <li>Delete all unallocated files from disk</li>
                  <li>Delete all database records (File records with status: unallocated, failed, duplicate)</li>
                  <li>Delete any associated Invoice or CreditNote records</li>
                </ul>
                <div className="mb-3 mt-3">
                  <label className="form-label required">
                    <strong>Reason for clearing all documents <span className="text-danger">*</span></strong>
                  </label>
                  <textarea
                    className="form-control"
                    rows="4"
                    placeholder="Please provide a reason for this action..."
                    value={clearAllReason}
                    onChange={(e) => setClearAllReason(e.target.value)}
                    disabled={clearingAll}
                    required
                  />
                  <small className="form-hint">
                    This reason will be recorded in the activity log for accountability purposes.
                  </small>
                </div>
              </div>
              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn btn-danger" 
                  onClick={() => {
                    setShowClearAllModal(false);
                    setClearAllReason('');
                  }}
                  disabled={clearingAll}
                >
                  Cancel
                </button>
                <button 
                  type="button" 
                  className="btn btn-primary" 
                  onClick={handleClearAll}
                  disabled={clearingAll || !clearAllReason || clearAllReason.trim().length === 0}
                >
                  {clearingAll ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                      Clearing...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-trash me-2"></i>
                      Clear All
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Single Delete Confirmation Modal */}
      {showSingleDeleteModal && documentToDelete && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered modal-xl">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Delete Document</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowSingleDeleteModal(false);
                    setDocumentToDelete(null);
                    setSingleDeleteReason('');
                  }}
                  disabled={deleting}
                ></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <p className="text-danger">
                    <strong>Warning:</strong> This action cannot be undone. The document <strong>{documentToDelete.fileName}</strong> and its associated physical file will be permanently deleted.
                  </p>
                </div>
                <div className="mb-3">
                  <label className="form-label required">Reason for Deletion</label>
                  <textarea
                    className="form-control"
                    rows="4"
                    placeholder="Please provide a reason for deleting this document (required for accountability)..."
                    value={singleDeleteReason}
                    onChange={(e) => setSingleDeleteReason(e.target.value)}
                    disabled={deleting}
                    required
                  />
                  <small className="form-hint">
                    This reason will be recorded in the system for accountability purposes.
                  </small>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    setShowSingleDeleteModal(false);
                    setDocumentToDelete(null);
                    setSingleDeleteReason('');
                  }}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={confirmDeleteDocument}
                  disabled={deleting || !singleDeleteReason.trim()}
                >
                  {deleting ? 'Deleting...' : 'Delete Document'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Delete Unallocated Files</h5>
                <button 
                  type="button" 
                  className="btn-close" 
                  onClick={() => {
                    setShowDeleteModal(false);
                    setDeleteReason('');
                  }}
                  disabled={deleting}
                ></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <p className="text-danger">
                    <strong>Warning:</strong> This action cannot be undone. The files and all associated database records will be permanently deleted.
                  </p>
                  <p>
                    You are about to delete <strong>{selectedFiles.size} file(s)</strong>. This will:
                  </p>
                  <ul>
                    <li>Delete the file(s) from disk</li>
                    <li>Delete all database records (File, Invoice, CreditNote)</li>
                  </ul>
                </div>
                <div className="mb-3">
                  <label className="form-label required">Reason for Deletion</label>
                  <textarea
                    className="form-control"
                    rows="4"
                    placeholder="Please provide a reason for deleting these files (required for accountability)..."
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                    disabled={deleting}
                    required
                  />
                  <small className="form-hint">
                    This reason will be recorded in the system for each deleted file for accountability purposes.
                  </small>
                </div>
              </div>
              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn btn-danger" 
                  onClick={() => {
                    setShowDeleteModal(false);
                    setDeleteReason('');
                  }}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button 
                  type="button" 
                  className="btn btn-danger" 
                  onClick={handleBulkDelete}
                  disabled={deleting || !deleteReason.trim()}
                >
                  {deleting ? 'Deleting...' : `Delete ${selectedFiles.size} File(s)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Unallocated;
