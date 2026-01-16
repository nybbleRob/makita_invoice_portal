import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { usePermissions } from '../context/PermissionContext';
import { useDebounce } from '../hooks/useDebounce';
import DocumentRetentionTimer from '../components/DocumentRetentionTimer';
import HierarchicalCompanyFilter from '../components/HierarchicalCompanyFilter';

const Invoices = () => {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { settings } = useSettings();
  const { hasPermission } = usePermissions();
  const queriesEnabled = settings?.queriesEnabled !== false; // Default to true if not set
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedCompanyIds, setSelectedCompanyIds] = useState([]);
  const [selectedCompanyFilters, setSelectedCompanyFilters] = useState([]); // Array of {id, name, referenceNo}
  const [tempSelectedCompanies, setTempSelectedCompanies] = useState([]);
  const [filterCompanies, setFilterCompanies] = useState([]);
  const [filterCompanySearch, setFilterCompanySearch] = useState('');
  const [filterCompanyPage, setFilterCompanyPage] = useState(1);
  const [filterCompanyTotal, setFilterCompanyTotal] = useState(0);
  const [filterCompanyPages, setFilterCompanyPages] = useState(0);
  const [filterCompanyLoading, setFilterCompanyLoading] = useState(false);
  const [showCompanyFilterModal, setShowCompanyFilterModal] = useState(false);
  const debouncedFilterCompanySearch = useDebounce(filterCompanySearch, 300);
  const [companies, setCompanies] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('DESC');
  const [retentionFilter, setRetentionFilter] = useState('all');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [selectedInvoices, setSelectedInvoices] = useState([]);
  const selectAllCheckboxRef = useRef(null);
  const searchInputRef = useRef(null);
  
  // Delete modal states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleting, setDeleting] = useState(false);
  
  // Bulk delete modal states
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [bulkDeleteReason, setBulkDeleteReason] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  
  
  // Invoice import states
  const [importFiles, setImportFiles] = useState([]);
  const [importStatus, setImportStatus] = useState(null);
  const [importResults, setImportResults] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPollingInterval, setImportPollingInterval] = useState(null);
  const fileInputRef = useRef(null);
  
  
  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (importPollingInterval) {
        clearInterval(importPollingInterval);
      }
    };
  }, [importPollingInterval]);

  const fetchInvoices = useCallback(async () => {
    try {
      setLoading(true);
      
      // Check if companyIds would make URL too long (browsers typically limit to ~2000 chars)
      // If too many companies selected, don't send filter (treat as "all companies")
      let companyIdsParam = null;
      if (selectedCompanyIds.length > 0) {
        const joined = selectedCompanyIds.join(',');
        // Only include if it won't make URL too long (1500 char limit for safety)
        if (joined.length <= 1500) {
          companyIdsParam = joined;
        }
      }
      
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        search: debouncedSearch,
        ...(statusFilter !== 'all' && { status: statusFilter }),
        ...(companyIdsParam && { companyIds: companyIdsParam }),
        sortBy,
        sortOrder,
        ...(retentionFilter !== 'all' && { retentionFilter })
      };
      
      const response = await api.get('/api/invoices', { params });
      
      // Handle response structure
      if (response.data && response.data.data) {
        setInvoices(response.data.data || []);
        setPagination(prev => ({
          ...prev,
          total: response.data.pagination?.total || 0,
          pages: response.data.pagination?.pages || 0
        }));
      } else {
        // Fallback if response structure is different
        setInvoices(Array.isArray(response.data) ? response.data : []);
        setPagination(prev => ({
          ...prev,
          total: 0,
          pages: 0
        }));
      }
    } catch (error) {
      console.error('Error fetching invoices:', error);
      console.error('Error response:', error.response?.data);
      setInvoices([]);
      setPagination(prev => ({
        ...prev,
        total: 0,
        pages: 0
      }));
      toast.error('Error fetching invoices: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, debouncedSearch, statusFilter, selectedCompanyIds, sortBy, sortOrder, retentionFilter]);

  const fetchCompanies = useCallback(async () => {
    try {
      // Fetch all companies (no pagination limit to get all)
      const response = await api.get('/api/companies', { params: { limit: 10000 } });
      // Handle both paginated and non-paginated responses
      const companiesData = Array.isArray(response.data) 
        ? response.data 
        : response.data?.data || [];
      // Flatten the structure - companies API includes parent/children but we need flat list with parentId
      const flattenedCompanies = companiesData.map(company => ({
        id: company.id,
        name: company.name,
        referenceNo: company.referenceNo,
        code: company.code,
        type: company.type,
        parentId: company.parentId || (company.parent ? company.parent.id : null),
        isActive: company.isActive
      }));
      setCompanies(flattenedCompanies);
    } catch (error) {
      console.error('Error fetching companies:', error);
    }
  }, []);

  useEffect(() => {
    fetchInvoices();
    fetchCompanies();
    setSelectedInvoices([]); // Clear selections on filter change
  }, [fetchInvoices, fetchCompanies]);

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

  // Company filter modal functions
  const fetchFilterCompanies = async (search = '', page = 1) => {
    try {
      setFilterCompanyLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20'
      });
      if (search.trim()) {
        params.append('search', search.trim());
      }
      const response = await api.get(`/api/companies?${params.toString()}`);
      const companiesData = response.data.data || response.data.companies || response.data || [];
      const total = response.data.total || companiesData.length;
      const pages = response.data.pages || Math.ceil(total / 20);
      
      setFilterCompanies(Array.isArray(companiesData) ? companiesData : []);
      setFilterCompanyTotal(total);
      setFilterCompanyPages(pages);
      setFilterCompanyPage(page);
    } catch (error) {
      console.error('Error fetching companies for filter:', error);
    } finally {
      setFilterCompanyLoading(false);
    }
  };

  // Fetch companies when search or page changes in modal
  useEffect(() => {
    if (showCompanyFilterModal) {
      fetchFilterCompanies(debouncedFilterCompanySearch, 1);
    }
  }, [debouncedFilterCompanySearch, showCompanyFilterModal]);

  const openCompanyFilterModal = () => {
    setTempSelectedCompanies([...selectedCompanyFilters]);
    setFilterCompanySearch('');
    setShowCompanyFilterModal(true);
    fetchFilterCompanies('', 1);
  };

  const handleCompanyFilterToggle = (company) => {
    setTempSelectedCompanies(prev => {
      const exists = prev.find(c => c.id === company.id);
      if (exists) {
        return prev.filter(c => c.id !== company.id);
      } else {
        return [...prev, { id: company.id, name: company.name, referenceNo: company.referenceNo }];
      }
    });
  };

  const removeTempSelectedCompany = (companyId) => {
    setTempSelectedCompanies(prev => prev.filter(c => c.id !== companyId));
  };

  const applyCompanyFilter = () => {
    const companyIds = tempSelectedCompanies.map(c => c.id);
    setSelectedCompanyIds(companyIds);
    setSelectedCompanyFilters([...tempSelectedCompanies]);
    setShowCompanyFilterModal(false);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const clearCompanyFilters = () => {
    setTempSelectedCompanies([]);
  };

  const closeCompanyFilterModal = () => {
    setShowCompanyFilterModal(false);
  };

  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-GB');
  };

  // Reset all filters and sorting
  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setSelectedCompanyIds([]);
    setSelectedCompanyFilters([]);
    setRetentionFilter('all');
    setSortBy('createdAt');
    setSortOrder('DESC');
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  // Helper component for truncated cells with Tabler tooltip
  // Only used for Company Name, Invoice To, and Delivery Address
  // Always shows tooltip with full value, even if not truncated
  const TruncatedCellWithTooltip = ({ value, maxWidth = '200px', maxLength = 30, id }) => {
    const cellRef = useRef(null);
    const displayValue = value && value !== '-' ? String(value) : '-';
    const needsTruncation = displayValue.length > maxLength;
    const truncatedValue = needsTruncation ? displayValue.substring(0, maxLength) + '...' : displayValue;
    const hasValue = displayValue !== '-';
    
    useEffect(() => {
      // Initialize Tabler tooltip for dynamically added elements
      if (cellRef.current && hasValue && window.bootstrap?.Tooltip) {
        // Dispose existing tooltip if any
        const existingTooltip = window.bootstrap.Tooltip.getInstance(cellRef.current);
        if (existingTooltip) {
          existingTooltip.dispose();
        }
        // Initialize tooltip using Tabler's approach (reads from data attributes)
        new window.bootstrap.Tooltip(cellRef.current);
      }
      
      return () => {
        // Cleanup on unmount
        if (cellRef.current && window.bootstrap?.Tooltip) {
          const tooltip = window.bootstrap.Tooltip.getInstance(cellRef.current);
          if (tooltip) {
            tooltip.dispose();
          }
        }
      };
    }, [displayValue, hasValue]);
    
    return (
      <td 
        ref={cellRef}
        id={id}
        style={{ 
          maxWidth, 
          overflow: 'hidden', 
          textOverflow: 'ellipsis', 
          whiteSpace: 'nowrap',
          cursor: hasValue ? 'help' : 'default'
        }}
        data-bs-toggle={hasValue ? 'tooltip' : undefined}
        data-bs-placement="top"
        title={hasValue ? displayValue : undefined}
      >
        {truncatedValue}
      </td>
    );
  };

  // Document status helpers
  const getDocumentStatus = (invoice) => {
    if (!invoice) return 'new';
    // Check documentStatus first
    if (invoice.documentStatus === 'downloaded') return 'downloaded';
    if (invoice.documentStatus === 'viewed') return 'viewed';
    if (invoice.documentStatus === 'queried') return 'queried';
    if (invoice.documentStatus === 'review') return 'review';
    // If documentStatus is 'ready' and hasn't been viewed, it's "Ready (New)"
    if (invoice.documentStatus === 'ready' && !invoice.viewedAt) return 'ready_new';
    // Fallback to timestamp-based status
    if (invoice.downloadedAt) return 'downloaded';
    if (invoice.viewedAt) return 'viewed';
    return 'ready_new'; // Default for new invoices
  };

  const getDocumentStatusBadgeClass = (status) => {
    const classes = {
      ready_new: 'bg-success-lt',
      new: 'bg-success-lt',
      ready: 'bg-success-lt',
      viewed: 'bg-orange-lt',
      downloaded: 'bg-primary-lt',
      review: 'bg-warning-lt',
      queried: 'bg-info-lt'
    };
    return classes[status] || 'bg-success-lt';
  };

  const getDocumentStatusLabel = (status) => {
    const labels = {
      ready_new: 'Ready (New)',
      new: 'Ready (New)',
      ready: 'Ready (New)',
      viewed: 'Viewed',
      downloaded: 'Downloaded',
      review: 'Review',
      queried: 'Queried'
    };
    return labels[status] || 'Ready (New)';
  };

  // Selection handlers
  const handleSelectInvoice = (invoiceId) => {
    setSelectedInvoices(prev =>
      prev.includes(invoiceId) 
        ? prev.filter(id => id !== invoiceId)
        : [...prev, invoiceId]
    );
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedInvoices(invoices.map(inv => inv.id));
    } else {
      setSelectedInvoices([]);
    }
  };

  const isAllSelected = invoices.length > 0 && selectedInvoices.length === invoices.length;

  // Download handlers
  const handleDownloadInvoice = async (invoiceId) => {
    try {
      // Mark as viewed first (fire and forget)
      api.post(`/api/invoices/${invoiceId}/view`).catch(err => console.warn('Failed to mark as viewed:', err));
      
      // Get the download URL
      const baseUrl = API_BASE_URL;
      const token = localStorage.getItem('token');
      const url = `${baseUrl}/api/invoices/${invoiceId}/download`;
      
      // Use fetch to download with auth header
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Download failed' }));
        throw new Error(errorData.message || 'Download failed');
      }

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      
      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `invoice-${invoiceId}.pdf`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, '');
        }
      }
      
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
      
      // Refresh to update status
      setTimeout(() => fetchInvoices(), 500);
      toast.success('Invoice downloaded');
    } catch (error) {
      console.error('Error downloading invoice:', error);
      toast.error('Error downloading invoice: ' + (error.message || 'Unknown error'));
    }
  };

  const handleBulkDownload = async () => {
    if (selectedInvoices.length === 0) {
      toast.info('Please select at least one invoice to download');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const url = `${API_BASE_URL}/api/invoices/bulk-download`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ invoiceIds: selectedInvoices })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Download failed' }));
        throw new Error(errorData.message || 'Download failed');
      }

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `invoices-${Date.now()}.zip`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);

      toast.success(`Downloaded ${selectedInvoices.length} invoice(s)`);
      setSelectedInvoices([]);
      fetchInvoices();
    } catch (error) {
      console.error('Error downloading invoices:', error);
      toast.error('Error downloading invoices: ' + (error.message || 'Unknown error'));
    }
  };

  const getPONumber = (invoice) => {
    return invoice.metadata?.parsedData?.customerPO || invoice.metadata?.parsedData?.poNumber || '-';
  };


  // Delete handlers
  const handleDeleteInvoice = async () => {
    if (!invoiceToDelete) return;
    
    if (!deleteReason || deleteReason.trim().length === 0) {
      toast.error('Please provide a reason for deletion');
      return;
    }

    try {
      setDeleting(true);
      await api.delete(`/api/invoices/${invoiceToDelete.id}`, {
        data: { reason: deleteReason.trim() }
      });
      
      toast.success('Invoice deleted successfully');
      setShowDeleteModal(false);
      setInvoiceToDelete(null);
      setDeleteReason('');
      fetchInvoices();
    } catch (error) {
      console.error('Error deleting invoice:', error);
      toast.error('Error deleting invoice: ' + (error.response?.data?.message || error.message));
    } finally {
      setDeleting(false);
    }
  };

  // Bulk delete handler
  const handleBulkDelete = async () => {
    if (selectedInvoices.length === 0) {
      toast.info('Please select at least one invoice to delete');
      return;
    }

    if (!bulkDeleteReason || bulkDeleteReason.trim().length === 0) {
      toast.error('Please provide a reason for deletion');
      return;
    }

    try {
      setBulkDeleting(true);
      const response = await api.post('/api/invoices/bulk-delete', {
        invoiceIds: selectedInvoices,
        reason: bulkDeleteReason.trim()
      });
      
      const { deleted, failed } = response.data;
      if (failed > 0) {
        toast.warning(`Deleted ${deleted} invoice(s), ${failed} failed`);
      } else {
        toast.success(`Successfully deleted ${deleted} invoice(s)`);
      }
      
      setShowBulkDeleteModal(false);
      setBulkDeleteReason('');
      setSelectedInvoices([]);
      fetchInvoices();
    } catch (error) {
      console.error('Error deleting invoices:', error);
      toast.error('Error deleting invoices: ' + (error.response?.data?.message || error.message));
    } finally {
      setBulkDeleting(false);
    }
  };

  // Invoice import functions
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 500) {
      toast.error('Maximum 500 files allowed');
      return;
    }
    setImportFiles(files);
  };

  const handleImportInvoices = async () => {
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

      const response = await api.post('/api/invoices/import', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      // Start polling for status
      pollImportStatus(response.data.importId);
    } catch (error) {
      console.error('Error starting invoice import:', error);
      const errorMessage = error.response?.data?.message || error.message;
      toast.error('Error starting import: ' + errorMessage, 8000);
      setShowImportModal(false);
      setImportStatus(null);
    }
  };

  const pollImportStatus = async (id) => {
    const pollOnce = async () => {
      try {
        const statusResponse = await api.get(`/api/invoices/import/${id}`);
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
        
        // Update importStatus - the UI will automatically switch from download to processing view
        // when downloads complete (downloadedFiles >= totalFiles)
        setImportStatus(importSession);
        
        // If processing is complete, fetch full results with summary
        // Note: Check importSession (the fresh data), not importStatus (stale closure)
        if (importSession.status === 'completed') {
          try {
            const resultsResponse = await api.get(`/api/invoices/import/${id}/results`);
            const importData = resultsResponse.data.import;
            setImportResults(importData);
            setImportStatus({ ...importSession, ...importData });
            
            // Auto-close processing modal and show results modal
            setShowImportModal(false);
            
            // Refresh invoices list
            fetchInvoices();
            
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
    
    // Then poll every 1 second for faster updates during download/processing
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

  return (
    <div className="page">
      <div className="page-body">
        <div className="container-xl">
          <div className="card">
            <div className="card-header">
              <div className="row w-100 g-3">
                {/* Title and description */}
                <div className="col-lg-3 col-md-4 col-12">
                  <h3 className="card-title mb-0">Invoices</h3>
                  <p className="text-secondary m-0">View and manage invoice documents</p>
                </div>
                {/* Controls */}
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
                      />
                      <span className="input-group-text">
                        <kbd>Ctrl+K</kbd>
                      </span>
                    </div>
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
                      <option value="ready_new">Ready (New)</option>
                      <option value="viewed">Viewed</option>
                      <option value="downloaded">Downloaded</option>
                    </select>
                    {/* Sort dropdown */}
                    <select
                      className="form-select w-auto"
                      value={`${sortBy}-${sortOrder}`}
                      onChange={(e) => {
                        const [newSortBy, newSortOrder] = e.target.value.split('-');
                        setSortBy(newSortBy);
                        setSortOrder(newSortOrder);
                        if (newSortBy === 'retentionExpiryDate') {
                          setRetentionFilter('expiring_soonest');
                        } else {
                          setRetentionFilter('all');
                        }
                        setPagination(prev => ({ ...prev, page: 1 }));
                      }}
                    >
                      <option value="createdAt-DESC">Newest First</option>
                      <option value="issueDate-ASC">Tax Point (Oldest)</option>
                      <option value="issueDate-DESC">Tax Point (Newest)</option>
                      <option value="amount-ASC">Amount (Low to High)</option>
                      <option value="amount-DESC">Amount (High to Low)</option>
                      {settings?.documentRetentionPeriod && (
                        <option value="retentionExpiryDate-ASC">Retention Ending Soonest</option>
                      )}
                    </select>
                    {/* Company filter */}
                    <button
                      type="button"
                      className={`btn ${selectedCompanyFilters.length > 0 ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={openCompanyFilterModal}
                    >
                      {selectedCompanyFilters.length === 0 
                        ? 'Filter by Company' 
                        : `Companies (${selectedCompanyFilters.length})`}
                    </button>
                    {/* Reset filters */}
                    <button 
                      className="btn btn-outline-secondary" 
                      onClick={handleResetFilters}
                      title="Reset all filters and sorting"
                    >
                      Reset
                    </button>
                    {/* Upload/Import buttons */}
                    {(currentUser?.role === 'global_admin' || 
                      currentUser?.role === 'administrator' || 
                      currentUser?.role === 'manager' || 
                      currentUser?.role === 'staff') && (
                      <>
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept=".pdf"
                          onChange={handleFileSelect}
                          style={{ display: 'none' }}
                        />
                        <button 
                          className="btn btn-primary"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          Upload
                        </button>
                        {importFiles.length > 0 && (
                          <button 
                            className="btn btn-success"
                            onClick={handleImportInvoices}
                          >
                            Import {importFiles.length} File{importFiles.length !== 1 ? 's' : ''}
                          </button>
                        )}
                      </>
                    )}
                    {/* Bulk Actions */}
                    {(currentUser?.role === 'global_admin' || currentUser?.role === 'administrator') && selectedInvoices.length > 0 && (
                      <>
                        <button 
                          className="btn btn-primary" 
                          onClick={handleBulkDownload}
                          disabled={bulkDeleting}
                        >
                          Download ({selectedInvoices.length})
                        </button>
                        <button 
                          className="btn btn-danger" 
                          onClick={() => {
                            setShowBulkDeleteModal(true);
                            setBulkDeleteReason('');
                          }}
                          disabled={bulkDeleting}
                        >
                          Delete ({selectedInvoices.length})
                        </button>
                      </>
                    )}
                    {selectedInvoices.length > 0 && (currentUser?.role !== 'global_admin' && currentUser?.role !== 'administrator') && (
                      <button 
                        className="btn btn-primary" 
                        onClick={handleBulkDownload}
                      >
                        Download ({selectedInvoices.length})
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
                        ref={selectAllCheckboxRef}
                        className="form-check-input m-0 align-middle"
                        type="checkbox"
                        aria-label="Select all invoices"
                        checked={isAllSelected}
                        onChange={handleSelectAll}
                      />
                    </th>
                    <th>Invoice No.</th>
                    <th>Date/Tax Point</th>
                    <th>Account No.</th>
                    <th>Company Name</th>
                    <th>Invoice To</th>
                    <th>Delivery Address</th>
                    <th>PO Number</th>
                    <th>Amount</th>
                    <th>Status</th>
                    {queriesEnabled && <th>Queried</th>}
                    {settings?.documentRetentionPeriod && <th>Retention</th>}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody className={loading ? 'placeholder-glow' : ''}>
                  {loading ? (
                    [...Array(10)].map((_, i) => (
                      <tr key={`skeleton-${i}`}>
                        <td><span className="placeholder" style={{ width: '16px', height: '16px', borderRadius: '3px' }}></span></td>
                        <td><span className="placeholder col-8"></span></td>
                        <td><span className="placeholder col-7"></span></td>
                        <td><span className="placeholder col-6"></span></td>
                        <td><span className="placeholder col-10"></span></td>
                        <td><span className="placeholder col-8"></span></td>
                        <td><span className="placeholder col-9"></span></td>
                        <td><span className="placeholder col-5"></span></td>
                        <td><span className="placeholder col-4"></span></td>
                        <td><span className="placeholder col-6" style={{ borderRadius: '4px' }}></span></td>
                        {queriesEnabled && <td><span className="placeholder col-5"></span></td>}
                        {settings?.documentRetentionPeriod && <td><span className="placeholder col-6"></span></td>}
                        <td>
                          <div className="btn-list">
                            <span className="placeholder btn btn-sm disabled" style={{ width: '50px' }}></span>
                            <span className="placeholder btn btn-sm disabled" style={{ width: '60px' }}></span>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : invoices.length === 0 ? (
                    <tr>
                      <td colSpan={10 + (queriesEnabled ? 1 : 0) + (settings?.documentRetentionPeriod ? 1 : 0) + 1} className="text-center py-3 text-muted">
                        No invoices found
                      </td>
                    </tr>
                  ) : (
                    invoices.map((invoice, index) => {
                      const docStatus = getDocumentStatus(invoice);
                      const amount = invoice.amount ? parseFloat(invoice.amount) : 0;
                      const accountNumber = invoice.company?.referenceNo || invoice.company?.code || '-';
                      const invoiceNumber = invoice.invoiceNumber || '-';
                      const dateValue = formatDate(invoice.issueDate);
                      const companyName = invoice.company?.name || '-';
                      const invoiceTo = invoice.metadata?.parsedData?.invoiceTo || '-';
                      const deliveryAddress = invoice.metadata?.parsedData?.deliveryAddress || '-';
                      const poNumber = getPONumber(invoice);
                      const amountValue = `£${amount.toFixed(2)}`;
                      
                      return (
                        <tr key={invoice.id}>
                          <td>
                            <input
                              className="form-check-input m-0 align-middle table-selectable-check"
                              type="checkbox"
                              aria-label="Select invoice"
                              checked={selectedInvoices.includes(invoice.id)}
                              onChange={() => handleSelectInvoice(invoice.id)}
                            />
                          </td>
                          <td><strong>{invoiceNumber}</strong></td>
                          <td>{dateValue}</td>
                          <td>{accountNumber}</td>
                          <TruncatedCellWithTooltip value={companyName} maxWidth="200px" maxLength={30} id={`invoice-company-${invoice.id}-${index}`} />
                          <TruncatedCellWithTooltip value={invoiceTo} maxWidth="200px" maxLength={30} id={`invoice-to-${invoice.id}-${index}`} />
                          <TruncatedCellWithTooltip value={deliveryAddress} maxWidth="200px" maxLength={40} id={`invoice-delivery-${invoice.id}-${index}`} />
                          <td>{poNumber}</td>
                          <td>{amountValue}</td>
                          <td>
                            <span className={`badge ${getDocumentStatusBadgeClass(docStatus)}`}>
                              {getDocumentStatusLabel(docStatus)}
                            </span>
                          </td>
                          {queriesEnabled && (
                          <td>
                            {(() => {
                              const queryInfo = invoice.queryInfo;
                              if (!queryInfo || !queryInfo.hasQuery) {
                                return (
                                  <span className="text-danger" title="No query">
                                    ✗
                                  </span>
                                );
                              }
                              
                              // Determine status based on who sent the last message
                              const isCurrentUserLastSender = queryInfo.lastMessageBy === currentUser?.id;
                              const statusText = isCurrentUserLastSender 
                                ? 'Awaiting Reply' 
                                : 'Message Received';
                              
                              return (
                                <span 
                                  className="text-success" 
                                  title={`Queried - ${statusText}`}
                                  style={{ cursor: 'help' }}
                                >
                                  ✓ {statusText}
                                </span>
                              );
                            })()}
                          </td>
                          )}
                          {settings?.documentRetentionPeriod && (
                            <td>
                              <DocumentRetentionTimer
                                expiryDate={invoice.retentionExpiryDate}
                                startDate={invoice.retentionStartDate}
                                retentionPeriod={settings?.documentRetentionPeriod}
                              />
                            </td>
                          )}
                          <td>
                            <div className="btn-list flex-nowrap">
                              <button 
                                className="btn btn-sm btn-primary"
                                onClick={() => navigate(`/invoices/${invoice.id}/view`)}
                                title="View"
                              >
                                View
                              </button>
                              {hasPermission('INVOICES_EDIT') && (
                                <button 
                                  className="btn btn-sm btn-info" 
                                  title="Edit"
                                  onClick={() => navigate(`/invoices/${invoice.id}/edit`)}
                                >
                                  Edit
                                </button>
                              )}
                              {hasPermission('INVOICES_DOWNLOAD') && (
                                <button 
                                  className="btn btn-sm btn-success"
                                  onClick={() => handleDownloadInvoice(invoice.id)}
                                  title="Download"
                                >
                                  Download
                                </button>
                              )}
                              {hasPermission('INVOICES_DELETE') && (
                                <button 
                                  className="btn btn-sm btn-danger" 
                                  title="Delete"
                                  onClick={() => {
                                    setInvoiceToDelete(invoice);
                                    setShowDeleteModal(true);
                                    setDeleteReason('');
                                  }}
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
            <div className="card-footer d-flex align-items-center">
              <div className="text-muted">
                Showing {invoices.length > 0 ? ((pagination.page - 1) * pagination.limit + 1) : 0} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} invoices
              </div>
              {pagination.pages > 1 && (
                <div className="d-flex gap-2">
                  <button
                    className="btn btn-sm btn-outline-primary"
                    disabled={pagination.page === 1}
                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                  >
                    Previous
                  </button>
                  <div className="d-flex align-items-center gap-2">
                    <span className="text-muted">Page</span>
                    <input
                      type="number"
                      className="form-control form-control-sm"
                      style={{ width: '70px' }}
                      min="1"
                      max={pagination.pages}
                      value={pagination.page}
                      autoComplete="off"
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
                  <button
                    className="btn btn-sm btn-outline-primary"
                    disabled={pagination.page >= pagination.pages}
                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Import Processing Modal */}
      {showImportModal && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Importing Documents</h5>
                <button type="button" className="btn-close" onClick={handleCancelImport}></button>
              </div>
              <div className="modal-body text-center py-4">
                <div className="alert alert-info mb-3">
                  <strong>Note:</strong> The system will automatically detect whether each document is an Invoice or Credit Note and route it to the appropriate screen.
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
                            <div className="font-weight-medium">{importResults.summary.successful || 0}</div>
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
                                <path d="M12 3c0 1 0 2.5 .5 3" />
                                <path d="M12 21c0 -1 0 -2.5 .5 -3" />
                              </svg>
                            </span>
                          </div>
                          <div className="col">
                            <div className="font-weight-medium text-success">{importResults.summary.matched || 0}</div>
                            <div className="text-muted">Matched to Company</div>
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
                            <div className="font-weight-medium text-warning">{importResults.summary.unallocated || 0}</div>
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
                            <div className="font-weight-medium text-danger">{importResults.summary.failed || 0}</div>
                            <div className="text-muted">Failed</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Overall Status Alert */}
                {importResults.summary.failed === 0 && importResults.summary.unallocated === 0 ? (
                  <div className="alert alert-success d-flex align-items-center mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="icon me-2" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                      <path d="M5 12l5 5l10 -10" />
                    </svg>
                    <div>
                      <strong>Perfect!</strong> All {importResults.summary.successful} document(s) were successfully imported and matched to companies.
                    </div>
                  </div>
                ) : importResults.summary.failed > 0 ? (
                  <div className="alert alert-danger d-flex align-items-center mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="icon me-2" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                      <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
                      <path d="M10 10l4 4m0 -4l-4 4" />
                    </svg>
                    <div>
                      <strong>Some documents failed to import.</strong> {importResults.summary.failed} document(s) encountered errors. Check the details below.
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
                      <strong>Import completed with warnings.</strong> {importResults.summary.unallocated} document(s) were imported but could not be matched to a company. Review them in the Unallocated screen.
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
                  <div className="table-responsive" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                    <table className="table table-vcenter table-hover table-sm">
                      <thead className="sticky-top bg-light">
                        <tr>
                          <th>File Name</th>
                          <th>Status</th>
                          <th>Company</th>
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
                                <div className="text-truncate" style={{ maxWidth: '250px' }} title={result.fileName}>
                                  {result.fileName}
                                </div>
                              </td>
                              <td>
                                {result.success ? (
                                  <span className="badge bg-success-lt">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-xs me-1" width="16" height="16" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                      <path d="M5 12l5 5l10 -10" />
                                    </svg>
                                    Success
                                  </span>
                                ) : (
                                  <span className="badge bg-danger-lt">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-xs me-1" width="16" height="16" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                      <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
                                      <path d="M10 10l4 4m0 -4l-4 4" />
                                    </svg>
                                    Failed
                                  </span>
                                )}
                              </td>
                              <td>
                                {result.companyId ? (
                                  <span className="badge bg-success-lt">Matched</span>
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
                                  <span className="text-danger small" title={result.errorDetails || result.error}>
                                    <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-xs me-1" width="16" height="16" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                      <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
                                      <path d="M12 8v4" />
                                      <path d="M12 16h.01" />
                                    </svg>
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
                  <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-xs me-1" width="16" height="16" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                    <path d="M5 12l5 5l10 -10" />
                  </svg>
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {showBulkDeleteModal && selectedInvoices.length > 0 && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Delete Multiple Invoices</h5>
                <button 
                  type="button" 
                  className="btn-close" 
                  onClick={() => {
                    setShowBulkDeleteModal(false);
                    setBulkDeleteReason('');
                  }}
                  disabled={bulkDeleting}
                ></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <p className="text-danger">
                    <strong>Warning:</strong> This action cannot be undone. {selectedInvoices.length} invoice(s) and their associated files will be permanently deleted.
                  </p>
                  <p>
                    You are about to delete the following invoices:
                  </p>
                  <ul className="list-unstyled">
                    {invoices
                      .filter(inv => selectedInvoices.includes(inv.id))
                      .slice(0, 10)
                      .map(inv => (
                        <li key={inv.id} className="text-muted">
                          • {inv.invoiceNumber} - {inv.company?.name || 'Unknown Company'}
                        </li>
                      ))}
                    {selectedInvoices.length > 10 && (
                      <li className="text-muted">... and {selectedInvoices.length - 10} more</li>
                    )}
                  </ul>
                </div>
                <div className="mb-3">
                  <label className="form-label required">Reason for Deletion</label>
                  <textarea
                    className="form-control"
                    rows="4"
                    placeholder="Please provide a reason for deleting these invoices (required for accountability)..."
                    value={bulkDeleteReason}
                    onChange={(e) => setBulkDeleteReason(e.target.value)}
                    disabled={bulkDeleting}
                    required
                  />
                  <small className="form-hint">
                    This reason will be recorded in the system for each deleted invoice for accountability purposes.
                  </small>
                </div>
              </div>
              <div className="modal-footer">
                <button 
                  type="button" 
                  className="btn btn-danger" 
                  onClick={() => {
                    setShowBulkDeleteModal(false);
                    setBulkDeleteReason('');
                  }}
                  disabled={bulkDeleting}
                >
                  Cancel
                </button>
                <button 
                  type="button" 
                  className="btn btn-danger" 
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting || !bulkDeleteReason.trim()}
                >
                  {bulkDeleting ? 'Deleting...' : `Delete ${selectedInvoices.length} Invoice(s)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && invoiceToDelete && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Delete Invoice</h5>
                <button 
                  type="button" 
                  className="btn-close" 
                  onClick={() => {
                    setShowDeleteModal(false);
                    setInvoiceToDelete(null);
                    setDeleteReason('');
                  }}
                  disabled={deleting}
                ></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <p className="text-danger">
                    <strong>Warning:</strong> This action cannot be undone. The invoice and its associated file will be permanently deleted.
                  </p>
                  <p>
                    You are about to delete invoice <strong>{invoiceToDelete.invoiceNumber}</strong> for <strong>{invoiceToDelete.company?.name || 'Unknown Company'}</strong>.
                  </p>
                </div>
                <div className="mb-3">
                  <label className="form-label required">Reason for Deletion</label>
                  <textarea
                    className="form-control"
                    rows="4"
                    placeholder="Please provide a reason for deleting this invoice (required for accountability)..."
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
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
                    setShowDeleteModal(false);
                    setInvoiceToDelete(null);
                    setDeleteReason('');
                  }}
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button 
                  type="button" 
                  className="btn btn-danger" 
                  onClick={handleDeleteInvoice}
                  disabled={deleting || !deleteReason.trim()}
                >
                  {deleting ? 'Deleting...' : 'Delete Invoice'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Column Customizer Modal */}

      {/* Company Filter Modal */}
      {showCompanyFilterModal && (
        <HierarchicalCompanyFilter
          selectedCompanyIds={selectedCompanyIds}
          onSelectionChange={(ids) => {
            setSelectedCompanyIds(ids);
            setPagination(prev => ({ ...prev, page: 1 }));
          }}
          onClose={() => setShowCompanyFilterModal(false)}
          onApply={() => setShowCompanyFilterModal(false)}
        />
      )}
    </div>
  );
};

export default Invoices;

