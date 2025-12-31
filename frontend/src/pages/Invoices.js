import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useDebounce } from '../hooks/useDebounce';
import DocumentRetentionTimer from '../components/DocumentRetentionTimer';
import CompanyHierarchyFilter from '../components/CompanyHierarchyFilter';

const Invoices = () => {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { settings } = useSettings();
  const queriesEnabled = settings?.queriesEnabled !== false; // Default to true if not set
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedCompanyIds, setSelectedCompanyIds] = useState([]);
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
  
  // SFTP import states
  const [showSftpModal, setShowSftpModal] = useState(false);
  const [testingSftp, setTestingSftp] = useState(false);
  const [sftpFiles, setSftpFiles] = useState([]);
  const [sftpConnectionStatus, setSftpConnectionStatus] = useState(null);
  // Only PDF for invoices/credit notes - Excel is only for statements
  const [sftpStage, setSftpStage] = useState('connect'); // 'connect', 'download', 'processing'
  const [sftpImportId, setSftpImportId] = useState(null);

  
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

  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-GB');
  };

  // Helper function for sortable column headers
  const handleSort = (column) => {
    if (sortBy === column) {
      // Toggle sort order if clicking same column
      setSortOrder(prev => prev === 'ASC' ? 'DESC' : 'ASC');
    } else {
      // Set new column and default to DESC
      setSortBy(column);
      setSortOrder('DESC');
    }
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const getSortIcon = (column) => {
    const isActive = sortBy === column;
    const activeOpacity = 1;
    const inactiveOpacity = 0.6;
    
    return (
      <span className="d-inline-flex align-items-center ms-1" style={{ gap: '2px' }}>
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          width="16" 
          height="16" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          className="icon icon-sm icon-tabler icon-tabler-sort-ascending"
          style={{ 
            opacity: isActive && sortOrder === 'ASC' ? activeOpacity : inactiveOpacity,
            cursor: 'pointer'
          }}
          title="Sort by Ascending"
          onClick={(e) => {
            e.stopPropagation();
            if (isActive && sortOrder === 'ASC') {
              // Already ascending, do nothing or toggle to descending
              handleSort(column);
            } else {
              setSortBy(column);
              setSortOrder('ASC');
              setPagination(prev => ({ ...prev, page: 1 }));
            }
          }}
        >
          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
          <path d="M4 6l7 0" />
          <path d="M4 12l7 0" />
          <path d="M4 18l9 0" />
          <path d="M15 9l3 -3l3 3" />
          <path d="M18 6l0 12" />
        </svg>
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          width="16" 
          height="16" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2" 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          className="icon icon-sm icon-tabler icon-tabler-sort-descending"
          style={{ 
            opacity: isActive && sortOrder === 'DESC' ? activeOpacity : inactiveOpacity,
            cursor: 'pointer'
          }}
          title="Sort by Descending"
          onClick={(e) => {
            e.stopPropagation();
            if (isActive && sortOrder === 'DESC') {
              // Already descending, do nothing or toggle to ascending
              handleSort(column);
            } else {
              setSortBy(column);
              setSortOrder('DESC');
              setPagination(prev => ({ ...prev, page: 1 }));
            }
          }}
        >
          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
          <path d="M4 6l9 0" />
          <path d="M4 12l7 0" />
          <path d="M4 18l7 0" />
          <path d="M15 15l3 3l3 -3" />
          <path d="M18 6l0 12" />
        </svg>
      </span>
    );
  };

  // Reset all filters and sorting
  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setSelectedCompanyIds([]);
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
          console.log('🛑 Import was cancelled');
          setTestingSftp(false);
          setImportStatus(null);
          if (importPollingInterval) {
            clearInterval(importPollingInterval);
            setImportPollingInterval(null);
          }
          toast.info('Import was cancelled');
          handleCancelSftp();
          return true; // Stop polling
        }
        
        // Update importStatus - the UI will automatically switch from download to processing view
        // when downloads complete (downloadedFiles >= totalFiles)
        setImportStatus(importSession);
        
        // If processing is complete, fetch full results with summary
        if (importSession.status === 'completed' && !importStatus?.summary) {
          try {
            const resultsResponse = await api.get(`/api/invoices/import/${id}/results`);
            const importData = resultsResponse.data.import;
            setImportResults(importData);
            setImportStatus({ ...importSession, ...importData });
            
            // Auto-close processing modal and show results modal
            setShowImportModal(false);
            
            // Refresh invoices list
            fetchInvoices();
            
            return true; // Stop polling
          } catch (error) {
            console.error('Error fetching import results:', error);
            // Continue polling to retry
          }
        }
        
        // If we're in processing stage and processing is complete
        if ((sftpStage === 'processing' || sftpStage === 'download') && importSession.status === 'completed') {
          // Fetch full results
          const resultsResponse = await api.get(`/api/invoices/import/${id}/results`);
          const importData = resultsResponse.data.import;
          setImportResults(importData);
          
          // Update status to show success
          setImportStatus({ ...importSession, ...importData });
          
          // Auto-close processing modal and show results modal
          setShowImportModal(false);
          
          // Refresh invoices list
          fetchInvoices();
          
          return true; // Signal to stop polling
        }
        return false; // Continue polling
      } catch (error) {
        console.error('Error polling import status:', error);
        setTestingSftp(false);
        setImportStatus(null);
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

  // SFTP Import handlers - Auto connect on modal open
  useEffect(() => {
    if (showSftpModal && sftpStage === 'connect' && !sftpConnectionStatus && !testingSftp) {
      handleTestSftpConnection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSftpModal, sftpStage]);

  const handleTestSftpConnection = async () => {
    try {
      setTestingSftp(true);
      setSftpConnectionStatus(null);
      setSftpFiles([]);

      const response = await api.post('/api/invoices/sftp/test-connection', {
        fileType: 'pdf' // Only PDF for invoices
      });
      
      if (response.data.success) {
        setSftpConnectionStatus({
          success: true,
          message: response.data.message,
          fileCount: response.data.fileCount
        });
        setSftpFiles(response.data.files || []);
      } else {
        setSftpConnectionStatus({
          success: false,
          message: response.data.message
        });
      }
    } catch (error) {
      console.error('Error testing FTP/SFTP connection:', error);
      setSftpConnectionStatus({
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to test FTP/SFTP connection'
      });
    } finally {
      setTestingSftp(false);
    }
  };

  const handleNext = async () => {
    if (sftpStage === 'connect' && sftpConnectionStatus?.success && getFilteredFiles().length > 0) {
      // Move to download stage
      setSftpStage('download');
      // Start download
      handleStartDownload();
    }
  };

  const handleStartDownload = async () => {
    try {
      setTestingSftp(true);
      
      // Get filtered files based on selection
      const filteredFiles = getFilteredFiles();
      
      if (filteredFiles.length === 0) {
        toast.error('No files match the selected file type filter.');
        return;
      }
      
      // Send file type filter to backend (only PDF for invoices)
      const response = await api.post('/api/invoices/sftp/import', {
        fileType: 'pdf'
      });
      
      if (response.data.success) {
        setSftpImportId(response.data.importId);
        // Initialize import status with the response data
        setImportStatus({
          importId: response.data.importId,
          totalFiles: response.data.totalFiles || getFilteredFiles().length,
          downloadedFiles: 0,
          processedFiles: 0,
          status: 'downloading'
        });
        // Start polling for download progress immediately
        pollImportStatus(response.data.importId);
      } else {
        toast.error(response.data.message || 'Failed to import from FTP/SFTP');
        setTestingSftp(false);
      }
    } catch (error) {
      console.error('Error importing from FTP/SFTP:', error);
      toast.error('Error importing from FTP/SFTP: ' + (error.response?.data?.message || error.message));
      setTestingSftp(false);
    }
  };

  const handleCancelSftp = async () => {
    // If there's an active import, cancel it on the backend
    if (sftpImportId) {
      try {
        await api.post(`/api/invoices/import/${sftpImportId}/cancel`);
        console.log('✅ Import cancelled on backend');
        toast.info('Import cancelled successfully');
      } catch (error) {
        console.error('Error cancelling import:', error);
        toast.error('Error cancelling import: ' + (error.response?.data?.message || error.message));
        // Continue with cleanup even if cancel request fails
      }
    }
    
    // Stop polling
    if (importPollingInterval) {
      clearInterval(importPollingInterval);
      setImportPollingInterval(null);
    }
    
    // Reset state
    setShowSftpModal(false);
    setSftpConnectionStatus(null);
    setSftpFiles([]);
    setSftpStage('connect');
    setSftpImportId(null);
    setImportStatus(null);
    setTestingSftp(false);
  };

  const handleOpenSftpModal = () => {
    setShowSftpModal(true);
    setSftpStage('connect');
    setSftpConnectionStatus(null);
    setSftpFiles([]);
    setSftpImportId(null);
  };

  // Filter files - only PDF for invoices
  const getFilteredFiles = () => {
    return sftpFiles.filter(file => {
      const name = file.name.toLowerCase();
      return name.endsWith('.pdf');
    });
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="container-xl">
          <div className="row g-2 align-items-center">
            <div className="col">
              <h2 className="page-title">Invoices</h2>
            </div>
            <div className="col-auto ms-auto">
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
                    <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                      <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
                      <path d="M12 11v6" />
                      <path d="M9 14l3 -3l3 3" />
                    </svg>
                    Upload Documents
                  </button>
                  <button 
                    className="btn btn-info ms-2"
                    onClick={handleOpenSftpModal}
                    title="Import invoices and credit notes from FTP/SFTP server - system will automatically detect document type"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                      <path d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
                      <path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
                      <path d="M7 12a5 5 0 1 0 10 0" />
                    </svg>
                    Import via FTP/SFTP
                  </button>
                  {importFiles.length > 0 && (
                    <button 
                      className="btn btn-success ms-2"
                      onClick={handleImportInvoices}
                    >
                      Import {importFiles.length} File{importFiles.length !== 1 ? 's' : ''}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="container-xl">
          <div className="card">
            <div className="card-header">
              <div className="row w-full">
                <div className="col">
                  <div className="input-group input-group-flat" style={{ minWidth: '50%', maxWidth: '400px' }}>
                    <span className="input-group-text">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"></path>
                        <path d="M21 21l-6 -6"></path>
                      </svg>
                    </span>
                    <input
                      ref={searchInputRef}
                      type="text"
                      className="form-control"
                      placeholder="Search invoices..."
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setPagination(prev => ({ ...prev, page: 1 }));
                      }}
                    />
                    <span className="input-group-text">
                      <kbd>ctrl + K</kbd>
                    </span>
                  </div>
                </div>
                <div className="col-md-auto col-sm-12">
                  <div className="ms-auto d-flex flex-wrap btn-list gap-2">
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
                      <option value="queried">Queried</option>
                    </select>
                    <CompanyHierarchyFilter
                      companies={companies}
                      selectedCompanyIds={selectedCompanyIds}
                      onSelectionChange={(ids) => {
                        setSelectedCompanyIds(ids);
                        setPagination(prev => ({ ...prev, page: 1 }));
                      }}
                    />
                    {settings?.documentRetentionPeriod && (
                      <select
                        className="form-select w-auto"
                        value={retentionFilter}
                        onChange={(e) => {
                          setRetentionFilter(e.target.value);
                          setPagination(prev => ({ ...prev, page: 1 }));
                        }}
                      >
                        <option value="all">All Retention</option>
                        <option value="expiring_soonest">Expiring Soonest</option>
                      </select>
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
                  <button 
                    className="btn btn-outline-secondary" 
                    onClick={handleResetFilters}
                    title="Reset all filters and sorting"
                  >
                    Reset Filters
                  </button>
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
                    <th 
                      className="sortable"
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                      title="Click icons to sort"
                    >
                      <span className="d-inline-flex align-items-center">
                        Date/Tax Point
                        {getSortIcon('issueDate')}
                      </span>
                    </th>
                    <th>Account No.</th>
                    <th>Company Name</th>
                    <th>Invoice To</th>
                    <th>Delivery Address</th>
                    <th>PO Number</th>
                    <th 
                      className="sortable"
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                      title="Click icons to sort"
                    >
                      <span className="d-inline-flex align-items-center">
                        Amount
                        {getSortIcon('amount')}
                      </span>
                    </th>
                    <th>Status</th>
                    {queriesEnabled && <th>Queried</th>}
                    {settings?.documentRetentionPeriod && (
                      <th 
                        className="sortable"
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => {
                          if (retentionFilter === 'expiring_soonest') {
                            setRetentionFilter('all');
                            setSortBy('issueDate');
                            setSortOrder('DESC');
                          } else {
                            setRetentionFilter('expiring_soonest');
                            setSortBy('retentionExpiryDate');
                            setSortOrder('ASC');
                          }
                          setPagination(prev => ({ ...prev, page: 1 }));
                        }}
                        title="Click to sort by retention"
                      >
                        <span className="d-inline-flex align-items-center">
                          Retention
                          {retentionFilter === 'expiring_soonest' && getSortIcon('retentionExpiryDate')}
                        </span>
                      </th>
                    )}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={9 + (queriesEnabled ? 1 : 0) + (settings?.documentRetentionPeriod ? 1 : 0) + 1} className="text-center py-3">
                        <div className="spinner-border spinner-border-sm" role="status">
                          <span className="visually-hidden">Loading...</span>
                        </div>
                      </td>
                    </tr>
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
                            <div className="btn-list">
                              <button 
                                className="btn btn-sm btn-primary"
                                onClick={() => navigate(`/invoices/${invoice.id}/view`)}
                                title="View"
                              >
                                View
                              </button>
                              {(currentUser?.role === 'global_admin' || 
                                currentUser?.role === 'administrator' || 
                                currentUser?.role === 'manager' || 
                                currentUser?.role === 'staff') && (
                                <button 
                                  className="btn btn-sm btn-info" 
                                  title="Edit"
                                  onClick={() => navigate(`/invoices/${invoice.id}/edit`)}
                                >
                                  Edit
                                </button>
                              )}
                              <button 
                                className="btn btn-sm btn-success"
                                onClick={() => handleDownloadInvoice(invoice.id)}
                                title="Download"
                              >
                                Download
                              </button>
                              {(currentUser?.role === 'global_admin' || 
                                currentUser?.role === 'administrator') && (
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
                <div className="pagination m-0 ms-auto">
                  <button
                    className="btn btn-sm"
                    disabled={pagination.page === 1}
                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                  >
                    Previous
                  </button>
                  <span className="mx-2">
                    Page {pagination.page} of {pagination.pages}
                  </span>
                  <button
                    className="btn btn-sm"
                    disabled={pagination.page === pagination.pages}
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
                {importStatus?.status === 'downloading' ? (
                  <>
                    <h3>Downloading Files...</h3>
                    <p className="text-muted mb-3">
                      Download {importStatus.downloadedFiles || 0} of {importStatus.totalFiles || 0} file{importStatus.totalFiles !== 1 ? 's' : ''}
                    </p>
                    {importStatus.currentFile && (
                      <p className="text-muted small">
                        Current: {importStatus.currentFile}
                      </p>
                    )}
                    {importStatus && importStatus.totalFiles > 0 && (
                      <div className="progress mt-3">
                        <div 
                          className="progress-bar progress-bar-striped progress-bar-animated" 
                          role="progressbar" 
                          style={{ width: `${((importStatus.downloadedFiles || 0) / importStatus.totalFiles) * 100}%` }}
                        >
                          {Math.round(((importStatus.downloadedFiles || 0) / importStatus.totalFiles) * 100)}%
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <h3>Processing {importStatus?.totalFiles || 0} file(s)...</h3>
                    <p className="text-muted">
                      Processing {importStatus?.processedFiles || 0} of {importStatus?.totalFiles || 0} files
                    </p>
                    {importStatus && importStatus.totalFiles > 0 && (
                      <div className="progress">
                        <div 
                          className="progress-bar" 
                          role="progressbar" 
                          style={{ width: `${(importStatus.processedFiles / importStatus.totalFiles) * 100}%` }}
                        >
                          {Math.round((importStatus.processedFiles / importStatus.totalFiles) * 100)}%
                        </div>
                      </div>
                    )}
                  </>
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

      {/* FTP/SFTP Import Modal - Multi-Step */}
      {showSftpModal && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered modal-xl">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Import Documents via FTP/SFTP</h5>
                <button type="button" className="btn-close" onClick={handleCancelSftp}></button>
              </div>
              <div className="modal-body">
                {/* Connect Stage */}
                {sftpStage === 'connect' && (
                  <div className="text-center py-4">
                    {!sftpConnectionStatus && (
                      <>
                        <div className="spinner-border text-primary mb-3" role="status">
                          <span className="visually-hidden">Connecting...</span>
                        </div>
                        <h4>Connecting to FTP/SFTP Server...</h4>
                        <p className="text-muted">Please wait while we establish a connection.</p>
                      </>
                    )}
                    {sftpConnectionStatus && sftpConnectionStatus.success && (
                      <>
                        <div className="mb-3">
                          <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-lg text-success" width="48" height="48" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                            <path d="M5 12l5 5l10 -10" />
                          </svg>
                        </div>
                        <div className="alert alert-success mb-3">
                          <strong>✓ Connection Established</strong>
                        </div>
                        <p className="mb-4">
                          Found <strong>{getFilteredFiles().length}</strong> PDF file{getFilteredFiles().length !== 1 ? 's' : ''} ready for import
                        </p>
                        <div className="alert alert-info mt-3">
                          <small><strong>Note:</strong> The system will automatically detect whether each document is an Invoice or Credit Note and route it to the appropriate screen.</small>
                        </div>
                      </>
                    )}
                    {sftpConnectionStatus && !sftpConnectionStatus.success && (
                      <>
                        <div className="alert alert-danger mb-3">
                          <strong>Connection Failed!</strong><br />
                          {sftpConnectionStatus.message}
                        </div>
                        <button
                          className="btn btn-primary"
                          onClick={handleTestSftpConnection}
                          disabled={testingSftp}
                        >
                          {testingSftp ? (
                            <>
                              <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                              Retrying...
                            </>
                          ) : (
                            'Retry Connection'
                          )}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* Download/Processing/Complete Stage - Single view that transitions */}
                {(sftpStage === 'download' || sftpStage === 'processing') && (
                  <div className="text-center py-4">
                    {(() => {
                      // Check if import is completed
                      const isCompleted = importStatus?.status === 'completed';
                      
                      if (isCompleted) {
                        // Show success view
                        const summary = importStatus?.summary || {};
                        return (
                          <>
                            <div className="mb-3">
                              <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-lg text-success" width="48" height="48" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                <path d="M5 12l5 5l10 -10" />
                              </svg>
                            </div>
                            <h4 className="text-success mb-3">Import Completed Successfully!</h4>
                            <div className="text-muted mb-3">
                              <p className="mb-1">
                                <strong>Processed:</strong> {importStatus?.processedFiles || 0} of {importStatus?.totalFiles || 0} files
                              </p>
                              <p className="mb-1">
                                <strong>Matched to Companies:</strong> {summary.matched || 0}
                              </p>
                              <p className="mb-1">
                                <strong>Unallocated:</strong> {summary.unallocated || 0}
                              </p>
                              {summary.failed > 0 && (
                                <p className="mb-1 text-warning">
                                  <strong>Failed:</strong> {summary.failed || 0}
                                </p>
                              )}
                            </div>
                          </>
                        );
                      }
                      
                      // Check if downloads are complete
                      const downloadsComplete = (importStatus?.downloadedFiles || 0) >= (importStatus?.totalFiles || 0) && (importStatus?.totalFiles || 0) > 0;
                      const isProcessing = downloadsComplete || importStatus?.status === 'queuing' || importStatus?.status === 'processing';
                      
                      if (isProcessing) {
                        // Show processing view
                        return (
                          <>
                            <div className="spinner-border text-primary mb-3" role="status">
                              <span className="visually-hidden">Processing...</span>
                            </div>
                            <h4>Processing Files...</h4>
                            <p className="text-muted mb-3">
                              Processing {importStatus?.processedFiles || 0} of {importStatus?.totalFiles || 0} files
                            </p>
                            {importStatus && importStatus.totalFiles > 0 && (
                              <div className="progress mb-3">
                                <div 
                                  className="progress-bar" 
                                  role="progressbar" 
                                  style={{ width: `${((importStatus.processedFiles || 0) / importStatus.totalFiles) * 100}%` }}
                                >
                                  {Math.round(((importStatus.processedFiles || 0) / importStatus.totalFiles) * 100)}%
                                </div>
                              </div>
                            )}
                          </>
                        );
                      } else {
                        // Show download view
                        return (
                          <>
                            <div className="spinner-border text-primary mb-3" role="status">
                              <span className="visually-hidden">Downloading...</span>
                            </div>
                            <h4>Downloading Files...</h4>
                            {importStatus?.currentFile && (
                              <p className="text-muted mb-2" style={{ fontSize: '0.875rem' }}>
                                Current: {importStatus.currentFile}
                              </p>
                            )}
                            <p className="text-muted mb-3">
                              Download {importStatus?.downloadedFiles || 0} of {importStatus?.totalFiles || 0} file{importStatus?.totalFiles !== 1 ? 's' : ''}
                            </p>
                            {importStatus && importStatus.totalFiles > 0 && (
                              <div className="progress mb-3">
                                <div 
                                  className="progress-bar progress-bar-striped progress-bar-animated" 
                                  role="progressbar" 
                                  style={{ width: `${((importStatus.downloadedFiles || 0) / importStatus.totalFiles) * 100}%` }}
                                >
                                  {Math.round(((importStatus.downloadedFiles || 0) / importStatus.totalFiles) * 100)}%
                                </div>
                              </div>
                            )}
                          </>
                        );
                      }
                    })()}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                {sftpStage === 'connect' && sftpConnectionStatus?.success && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleNext}
                    disabled={getFilteredFiles().length === 0}
                  >
                    Next
                  </button>
                )}
                {importStatus?.status === 'completed' ? (
                  <button type="button" className="btn btn-primary" onClick={handleCancelSftp}>
                    OK
                  </button>
                ) : (
                  <button type="button" className="btn btn-danger" onClick={handleCancelSftp}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Column Customizer Modal */}
    </div>
  );
};

export default Invoices;

