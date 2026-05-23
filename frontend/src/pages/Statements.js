import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';
import { useSettings } from '../context/SettingsContext';
import { usePermissions } from '../context/PermissionContext';
import DocumentRetentionTimer from '../components/DocumentRetentionTimer';
import HierarchicalCompanyFilter from '../components/HierarchicalCompanyFilter';

const Statements = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { settings } = useSettings();
  const { hasPermission } = usePermissions();

  const [statements, setStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchQuery, setActiveSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedCompanyIds, setSelectedCompanyIds] = useState([]);
  const [showCompanyFilterModal, setShowCompanyFilterModal] = useState(false);
  const initialPage = (() => {
    const p = parseInt(searchParams.get('page'), 10);
    return (!isNaN(p) && p >= 1) ? p : 1;
  })();
  const [pagination, setPagination] = useState({ page: initialPage, limit: 50, total: 0, pages: 0 });
  const [sortBy, setSortBy] = useState('periodEnd');
  const [sortOrder, setSortOrder] = useState('DESC');
  const [retentionFilter, setRetentionFilter] = useState('all');
  const [selectedStatements, setSelectedStatements] = useState([]);

  const searchInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const selectAllCheckboxRef = useRef(null);
  const returnQueryRef = useRef(searchParams.toString());
  returnQueryRef.current = searchParams.toString();

  // Single delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [statementToDelete, setStatementToDelete] = useState(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Bulk delete modal state
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [bulkDeleteReason, setBulkDeleteReason] = useState('');
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [statementToEdit, setStatementToEdit] = useState(null);
  const [editForm, setEditForm] = useState({
    periodStart: '',
    periodEnd: '',
    openingBalance: '',
    closingBalance: '',
    totalDebits: '',
    totalCredits: '',
    status: 'draft',
    notes: '',
    editReason: ''
  });
  const [editSaving, setEditSaving] = useState(false);

  // Import state
  const [importFiles, setImportFiles] = useState([]);
  const [importStatus, setImportStatus] = useState(null);
  const [importResults, setImportResults] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPollingInterval, setImportPollingInterval] = useState(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (importPollingInterval) clearInterval(importPollingInterval);
    };
  }, [importPollingInterval]);

  useEffect(() => {
    try {
      sessionStorage.setItem('statementsReturnQuery', searchParams.toString());
    } catch (_) {}
  }, [searchParams]);

  // Hydrate state from URL
  useEffect(() => {
    const pageFromUrl = parseInt(searchParams.get('page'), 10);
    const page = (!isNaN(pageFromUrl) && pageFromUrl >= 1) ? pageFromUrl : 1;
    const companyIdsParam = searchParams.get('companyIds') || '';
    const companyIds = companyIdsParam ? companyIdsParam.split(',').filter(Boolean) : [];
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || 'all';
    const sortByParam = searchParams.get('sortBy') || 'periodEnd';
    const sortOrderParam = searchParams.get('sortOrder') || 'DESC';
    const retention = searchParams.get('retentionFilter') || 'all';

    setPagination(prev => (prev.page !== page ? { ...prev, page } : prev));
    setSelectedCompanyIds(prev => (prev.length !== companyIds.length || companyIds.some((id, i) => id !== prev[i]) ? companyIds : prev));
    setSearchQuery(prev => (prev !== search ? search : prev));
    setActiveSearchQuery(prev => (prev !== search ? search : prev));
    setStatusFilter(prev => (prev !== status ? status : prev));
    setSortBy(prev => (prev !== sortByParam ? sortByParam : prev));
    setSortOrder(prev => (prev !== sortOrderParam ? sortOrderParam : prev));
    setRetentionFilter(prev => (prev !== retention ? retention : prev));
  }, [searchParams]);

  // Sync state to URL
  const syncMountRef = useRef(true);
  useEffect(() => {
    if (syncMountRef.current) { syncMountRef.current = false; return; }
    const next = new URLSearchParams();
    next.set('page', String(pagination.page));
    if (selectedCompanyIds.length > 0 && selectedCompanyIds.join(',').length <= 1500) {
      next.set('companyIds', selectedCompanyIds.join(','));
    }
    if (activeSearchQuery && activeSearchQuery.trim()) next.set('search', activeSearchQuery.trim());
    if (statusFilter !== 'all') next.set('status', statusFilter);
    if (sortBy !== 'periodEnd') next.set('sortBy', sortBy);
    if (sortOrder !== 'DESC') next.set('sortOrder', sortOrder);
    if (retentionFilter !== 'all') next.set('retentionFilter', retentionFilter);
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, activeSearchQuery, statusFilter, selectedCompanyIds, sortBy, sortOrder, retentionFilter]);

  const fetchStatements = useCallback(async () => {
    try {
      setLoading(true);

      let companyIdsParam = null;
      if (selectedCompanyIds.length > 0) {
        const joined = selectedCompanyIds.join(',');
        if (joined.length <= 1500) companyIdsParam = joined;
      }

      const searchToSend = (activeSearchQuery && activeSearchQuery.trim().length >= 3)
        ? activeSearchQuery.trim()
        : null;

      const params = {
        page: pagination.page,
        limit: pagination.limit,
        ...(searchToSend && { search: searchToSend }),
        ...(statusFilter !== 'all' && { status: statusFilter }),
        ...(companyIdsParam && { companyIds: companyIdsParam }),
        sortBy,
        sortOrder,
        ...(retentionFilter !== 'all' && { retentionFilter })
      };

      const response = await api.get('/api/statements', { params });

      if (response.data && response.data.data) {
        setStatements(response.data.data || []);
        const totalPages = response.data.pagination?.pages || 0;
        setPagination(prev => {
          const nextPag = {
            ...prev,
            total: response.data.pagination?.total || 0,
            pages: totalPages
          };
          if (totalPages > 0 && prev.page > totalPages) nextPag.page = totalPages;
          return nextPag;
        });
      } else {
        setStatements(Array.isArray(response.data) ? response.data : []);
        setPagination(prev => ({ ...prev, total: 0, pages: 0 }));
      }
    } catch (error) {
      console.error('Error fetching statements:', error);
      setStatements([]);
      setPagination(prev => ({ ...prev, total: 0, pages: 0 }));
      toast.error('Error fetching statements: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, activeSearchQuery, statusFilter, selectedCompanyIds, sortBy, sortOrder, retentionFilter]);

  useEffect(() => {
    fetchStatements();
    setSelectedStatements([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.limit, activeSearchQuery, statusFilter, selectedCompanyIds, sortBy, sortOrder, retentionFilter]);

  // Ctrl+K focuses search
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (searchInputRef.current) searchInputRef.current.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount || 0);
  };

  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-GB');
  };

  const formatPeriod = (start, end) => {
    if (!start || !end) return formatDate(end);
    return `${formatDate(start)} - ${formatDate(end)}`;
  };

  const getStatusBadgeClass = (status) => {
    const classes = {
      draft: 'bg-secondary-lt',
      sent: 'bg-info-lt',
      acknowledged: 'bg-success-lt',
      disputed: 'bg-warning-lt'
    };
    return classes[status] || 'bg-secondary-lt';
  };

  const hasActiveFilters = activeSearchQuery || statusFilter !== 'all' || sortBy !== 'periodEnd' || sortOrder !== 'DESC' || selectedCompanyIds.length > 0 || retentionFilter !== 'all';

  const handleResetFilters = () => {
    setSearchQuery('');
    setActiveSearchQuery('');
    setStatusFilter('all');
    setSelectedCompanyIds([]);
    setRetentionFilter('all');
    setSortBy('periodEnd');
    setSortOrder('DESC');
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  // Selection handlers
  const handleSelectStatement = (id) => {
    setSelectedStatements(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const handleSelectAll = (e) => {
    if (e.target.checked) setSelectedStatements(statements.map(s => s.id));
    else setSelectedStatements([]);
  };
  const isAllSelected = statements.length > 0 && selectedStatements.length === statements.length;

  // Download handlers
  const openAuthenticatedFile = async (url, filenameHint) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}${url}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(errorData.message || 'Request failed');
      }
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = filenameHint;
      if (contentDisposition) {
        const m = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (m && m[1]) filename = m[1].replace(/['"]/g, '');
      }
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 30 * 1000);
    } catch (error) {
      console.error('Error during download:', error);
      toast.error(`Error: ${error.message}`);
    }
  };

  const handleDownloadStatement = async (statement) => {
    const hasPdf = !!(statement.pdfFileUrl || (statement.fileUrl && /\.pdf$/i.test(statement.fileUrl)));
    const format = hasPdf ? 'pdf' : 'xls';
    const ext = format === 'pdf' ? 'pdf' : 'xlsx';
    await openAuthenticatedFile(
      `/api/statements/${statement.id}/download?format=${format}`,
      `statement-${statement.statementNumber || statement.id}.${ext}`
    );
    fetchStatements();
  };

  // Edit handlers
  const openEditModal = (statement) => {
    const q = returnQueryRef.current || searchParams.toString();
    try { sessionStorage.setItem('statementsReturnQuery', q); } catch (_) {}
    navigate(`/statements/${statement.id}/edit?returnQuery=${encodeURIComponent(q)}`, { state: { returnQuery: q } });
  };

  const handleSaveEdit = async () => {
    if (!statementToEdit) return;
    if (!editForm.editReason || editForm.editReason.trim().length === 0) {
      toast.error('Please provide an edit reason for accountability');
      return;
    }
    try {
      setEditSaving(true);
      const payload = {
        periodStart: editForm.periodStart || null,
        periodEnd: editForm.periodEnd || null,
        openingBalance: editForm.openingBalance === '' ? null : Number(editForm.openingBalance),
        closingBalance: editForm.closingBalance === '' ? null : Number(editForm.closingBalance),
        totalDebits: editForm.totalDebits === '' ? null : Number(editForm.totalDebits),
        totalCredits: editForm.totalCredits === '' ? null : Number(editForm.totalCredits),
        status: editForm.status,
        notes: editForm.notes || null,
        editReason: editForm.editReason.trim()
      };
      await api.put(`/api/statements/${statementToEdit.id}`, payload);
      toast.success('Statement updated successfully');
      setShowEditModal(false);
      setStatementToEdit(null);
      fetchStatements();
    } catch (error) {
      console.error('Error updating statement:', error);
      toast.error('Error updating statement: ' + (error.response?.data?.message || error.message));
    } finally {
      setEditSaving(false);
    }
  };

  // Delete handlers
  const handleDeleteStatement = async () => {
    if (!statementToDelete) return;
    if (!deleteReason || deleteReason.trim().length === 0) {
      toast.error('Please provide a reason for deletion');
      return;
    }
    try {
      setDeleting(true);
      await api.delete(`/api/statements/${statementToDelete.id}`, {
        data: { reason: deleteReason.trim() }
      });
      toast.success('Statement deleted successfully');
      setShowDeleteModal(false);
      setStatementToDelete(null);
      setDeleteReason('');
      fetchStatements();
    } catch (error) {
      console.error('Error deleting statement:', error);
      toast.error('Error deleting statement: ' + (error.response?.data?.message || error.message));
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedStatements.length === 0) {
      toast.info('Please select at least one statement to delete');
      return;
    }
    if (!bulkDeleteReason || bulkDeleteReason.trim().length === 0) {
      toast.error('Please provide a reason for deletion');
      return;
    }
    try {
      setBulkDeleting(true);
      const response = await api.post('/api/statements/bulk-delete', {
        statementIds: selectedStatements,
        reason: bulkDeleteReason.trim()
      });
      const { deleted, failed } = response.data;
      const deletedCount = Array.isArray(deleted) ? deleted.length : (deleted || 0);
      const failedCount = Array.isArray(failed) ? failed.length : (failed || 0);
      if (failedCount > 0) {
        toast.warning(`Deleted ${deletedCount} statement(s), ${failedCount} failed`);
      } else {
        toast.success(`Successfully deleted ${deletedCount} statement(s)`);
      }
      setShowBulkDeleteModal(false);
      setBulkDeleteReason('');
      setSelectedStatements([]);
      fetchStatements();
    } catch (error) {
      console.error('Error bulk deleting statements:', error);
      toast.error('Error deleting statements: ' + (error.response?.data?.message || error.message));
    } finally {
      setBulkDeleting(false);
    }
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

  const handleImportStatements = async () => {
    if (importFiles.length === 0) {
      toast.error('Please select at least one file');
      return;
    }
    setShowImportModal(true);
    setImportStatus({ processedFiles: 0, totalFiles: importFiles.length, status: 'processing' });
    try {
      const formData = new FormData();
      importFiles.forEach(file => formData.append('files', file));
      const response = await api.post('/api/statements/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      pollImportStatus(response.data.importId);
    } catch (error) {
      console.error('Error starting statement import:', error);
      toast.error('Error starting import: ' + (error.response?.data?.message || error.message), 8000);
      setShowImportModal(false);
      setImportStatus(null);
    }
  };

  const pollImportStatus = async (id) => {
    let resultsRetries = 0;
    const MAX_RESULTS_RETRIES = 5;

    const pollOnce = async () => {
      try {
        const statusResponse = await api.get(`/api/statements/import/${id}`);
        const importSession = statusResponse.data.import;

        if (importSession.cancelled || importSession.status === 'cancelled') {
          setImportStatus(null);
          setShowImportModal(false);
          if (importPollingInterval) {
            clearInterval(importPollingInterval);
            setImportPollingInterval(null);
          }
          toast.info('Import was cancelled');
          return true;
        }
        if (importSession.status === 'failed') {
          setImportStatus(null);
          setShowImportModal(false);
          if (importPollingInterval) {
            clearInterval(importPollingInterval);
            setImportPollingInterval(null);
          }
          toast.error('Import failed. Please try again.', 8000);
          setImportFiles([]);
          return true;
        }
        setImportStatus(importSession);
        if (importSession.status === 'completed') {
          try {
            const resultsResponse = await api.get(`/api/statements/import/${id}/results`);
            const importData = resultsResponse.data.import;
            setImportResults(importData);
            setImportStatus({ ...importSession, ...importData });
            setShowImportModal(false);
            fetchStatements();
            setImportFiles([]);
            return true;
          } catch (err) {
            resultsRetries++;
            if (resultsRetries >= MAX_RESULTS_RETRIES) {
              setShowImportModal(false);
              setImportFiles([]);
              fetchStatements();
              toast.success(`Import completed! Processed ${importSession.processedFiles || importSession.totalFiles} file(s).`);
              return true;
            }
          }
        }
        return false;
      } catch (error) {
        console.error('Error polling import status:', error);
        setImportStatus(null);
        setShowImportModal(false);
        setImportPollingInterval(null);
        toast.error('Error checking import status', 8000);
        return true;
      }
    };

    const shouldStop = await pollOnce();
    if (shouldStop) return;
    const intervalId = setInterval(async () => {
      const stop = await pollOnce();
      if (stop) {
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
    if (fileInputRef.current) fileInputRef.current.value = '';
    toast.info('Import cancelled', 3000);
  };

  const handleFinishImport = () => {
    setImportStatus(null);
    setImportResults(null);
    setImportFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const canImport = hasPermission('STATEMENTS_IMPORT');
  const canEdit = hasPermission('STATEMENTS_EDIT');
  const canDelete = hasPermission('STATEMENTS_DELETE');
  const canDownload = hasPermission('STATEMENTS_DOWNLOAD');

  return (
    <div className="page">
      <div className="page-body">
        <div className="container-xl">
          <div className="card">
            <div className="card-header">
              <div className="row w-100 g-3">
                <div className="col-lg-3 col-md-4 col-12">
                  <h3 className="card-title mb-0">Statements</h3>
                  <p className="text-secondary m-0">View and manage supplier statements</p>
                </div>
                <div className="col-lg-9 col-md-8 col-12 pe-0">
                  <div className="d-flex flex-wrap btn-list gap-2 justify-content-md-end toolbar-actions">
                    <div className="input-group input-group-sm input-group-flat w-auto">
                      <input
                        ref={searchInputRef}
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="Search Statements"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            setActiveSearchQuery(searchQuery);
                            setPagination(prev => ({ ...prev, page: 1 }));
                          }
                        }}
                        autoComplete="off"
                      />
                      <span className="input-group-text"><kbd>ctrl + K</kbd></span>
                      <button
                        className="btn btn-sm btn-primary"
                        type="button"
                        onClick={() => {
                          setActiveSearchQuery(searchQuery);
                          setPagination(prev => ({ ...prev, page: 1 }));
                        }}
                      >
                        Search
                      </button>
                    </div>

                    <select
                      className="form-select form-select-sm w-auto"
                      value={statusFilter}
                      onChange={(e) => {
                        setStatusFilter(e.target.value);
                        setPagination(prev => ({ ...prev, page: 1 }));
                      }}
                    >
                      <option value="all">All Status</option>
                      <option value="draft">Draft</option>
                      <option value="sent">Sent</option>
                      <option value="acknowledged">Acknowledged</option>
                      <option value="disputed">Disputed</option>
                    </select>

                    <select
                      className="form-select form-select-sm w-auto"
                      value={`${sortBy}-${sortOrder}`}
                      onChange={(e) => {
                        const [newSortBy, newSortOrder] = e.target.value.split('-');
                        setSortBy(newSortBy);
                        setSortOrder(newSortOrder);
                        if (newSortBy === 'retentionExpiryDate') setRetentionFilter('expiring_soonest');
                        else setRetentionFilter('all');
                        setPagination(prev => ({ ...prev, page: 1 }));
                      }}
                    >
                      <option value="periodEnd-DESC">Period End (Newest)</option>
                      <option value="periodEnd-ASC">Period End (Oldest)</option>
                      <option value="createdAt-DESC">Newest Imported</option>
                      <option value="closingBalance-DESC">Balance (High to Low)</option>
                      <option value="closingBalance-ASC">Balance (Low to High)</option>
                      {settings?.documentRetentionPeriod && (
                        <option value="retentionExpiryDate-ASC">Retention Ending Soonest</option>
                      )}
                    </select>

                    <button
                      type="button"
                      className="btn btn-sm btn-info"
                      onClick={() => setShowCompanyFilterModal(true)}
                    >
                      {selectedCompanyIds.length === 0 ? 'Filter by Company' : `Companies (${selectedCompanyIds.length})`}
                    </button>

                    {hasActiveFilters && (
                      <button
                        className="btn btn-sm btn-warning"
                        onClick={handleResetFilters}
                        title="Reset all filters and sorting"
                      >
                        Reset
                      </button>
                    )}

                    {canImport && (
                      <>
                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept=".pdf,.xlsx,.xls"
                          onChange={handleFileSelect}
                          style={{ display: 'none' }}
                        />
                        <button
                          className="btn btn-sm btn-success"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          Upload
                        </button>
                        {importFiles.length > 0 && (
                          <button
                            className="btn btn-sm btn-success"
                            onClick={handleImportStatements}
                          >
                            Import {importFiles.length} File{importFiles.length !== 1 ? 's' : ''}
                          </button>
                        )}
                      </>
                    )}

                    {canDelete && selectedStatements.length > 0 && (
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => {
                          setShowBulkDeleteModal(true);
                          setBulkDeleteReason('');
                        }}
                        disabled={bulkDeleting}
                      >
                        Delete ({selectedStatements.length})
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
                    {canDelete && (
                      <th className="w-1">
                        <input
                          ref={selectAllCheckboxRef}
                          className="form-check-input m-0 align-middle"
                          type="checkbox"
                          aria-label="Select all statements"
                          checked={isAllSelected}
                          onChange={handleSelectAll}
                        />
                      </th>
                    )}
                    <th>Company</th>
                    <th>Account No.</th>
                    <th>Period</th>
                    <th>Opening</th>
                    <th>Closing</th>
                    <th>Files</th>
                    <th>Status</th>
                    {settings?.documentRetentionPeriod && <th>Retention</th>}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody className={loading ? 'placeholder-glow' : ''}>
                  {loading ? (
                    [...Array(8)].map((_, i) => (
                      <tr key={`skeleton-${i}`}>
                        {canDelete && <td><span className="placeholder" style={{ width: '16px', height: '16px', borderRadius: '3px' }}></span></td>}
                        <td><span className="placeholder col-10"></span></td>
                        <td><span className="placeholder col-5"></span></td>
                        <td><span className="placeholder col-9"></span></td>
                        <td><span className="placeholder col-6"></span></td>
                        <td><span className="placeholder col-6"></span></td>
                        <td><span className="placeholder col-5"></span></td>
                        <td><span className="placeholder col-6"></span></td>
                        {settings?.documentRetentionPeriod && <td><span className="placeholder col-6"></span></td>}
                        <td><span className="placeholder col-6"></span></td>
                      </tr>
                    ))
                  ) : statements.length === 0 ? (
                    <tr>
                      <td colSpan={(canDelete ? 1 : 0) + 8 + (settings?.documentRetentionPeriod ? 1 : 0)} className="text-center py-3 text-muted">
                        No statements found
                      </td>
                    </tr>
                  ) : (
                    statements.map((statement) => {
                      const accountNumber = statement.company?.referenceNo || '-';
                      const hasPdf = !!(statement.pdfFileUrl ||
                        (statement.fileUrl && /\.pdf$/i.test(statement.fileUrl)));
                      const hasXls = !!(statement.xlsFileUrl ||
                        (statement.fileUrl && /\.(xls|xlsx)$/i.test(statement.fileUrl)));
                      return (
                        <tr key={statement.id}>
                          {canDelete && (
                            <td>
                              <input
                                className="form-check-input m-0 align-middle table-selectable-check"
                                type="checkbox"
                                aria-label="Select statement"
                                checked={selectedStatements.includes(statement.id)}
                                onChange={() => handleSelectStatement(statement.id)}
                              />
                            </td>
                          )}
                          <td>{statement.company?.name || '-'}</td>
                          <td>{accountNumber}</td>
                          <td>{formatPeriod(statement.periodStart, statement.periodEnd)}</td>
                          <td>{formatCurrency(statement.openingBalance)}</td>
                          <td>{formatCurrency(statement.closingBalance)}</td>
                          <td>
                            <div className="d-flex gap-1">
                              {hasPdf && <span className="badge bg-red-lt" title="PDF available">PDF</span>}
                              {hasXls && <span className="badge bg-green-lt" title="XLS available">XLS</span>}
                              {!hasPdf && !hasXls && <span className="text-muted">-</span>}
                            </div>
                          </td>
                          <td>
                            <span className={`badge ${getStatusBadgeClass(statement.status)}`}>
                              {statement.status}
                            </span>
                          </td>
                          {settings?.documentRetentionPeriod && (
                            <td>
                              <DocumentRetentionTimer
                                expiryDate={statement.retentionExpiryDate}
                                startDate={statement.retentionStartDate}
                                retentionPeriod={settings?.documentRetentionPeriod}
                              />
                            </td>
                          )}
                          <td>
                            <div className="btn-list flex-nowrap">
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => {
                                  const q = returnQueryRef.current || searchParams.toString();
                                  try { sessionStorage.setItem('statementsReturnQuery', q); } catch (_) {}
                                  navigate(`/statements/${statement.id}/view?returnQuery=${encodeURIComponent(q)}`, { state: { returnQuery: q } });
                                }}
                                title="View"
                              >
                                View
                              </button>
                              {canDownload && (hasPdf || hasXls) && (
                                <button
                                  className="btn btn-sm btn-success"
                                  onClick={() => handleDownloadStatement(statement)}
                                  title="Download"
                                >
                                  Download
                                </button>
                              )}
                              {canEdit && (
                                <button
                                  className="btn btn-sm btn-info"
                                  onClick={() => openEditModal(statement)}
                                  title="Edit"
                                >
                                  Edit
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  className="btn btn-sm btn-danger"
                                  onClick={() => {
                                    setStatementToDelete(statement);
                                    setShowDeleteModal(true);
                                    setDeleteReason('');
                                  }}
                                  title="Delete"
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

            {pagination.total > pagination.limit && (
              <div className="card-footer">
                <div className="d-flex justify-content-between align-items-center">
                  <div className="text-muted">
                    Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} Statements
                  </div>
                  <ul className="pagination m-0">
                    <li className={`page-item ${pagination.page === 1 || loading ? 'disabled' : ''}`}>
                      <button type="button" className="page-link" onClick={() => {
                        if (pagination.page > 1 && !loading) setPagination(prev => ({ ...prev, page: 1 }));
                      }}>«</button>
                    </li>
                    <li className={`page-item ${pagination.page === 1 || loading ? 'disabled' : ''}`}>
                      <button type="button" className="page-link" onClick={() => {
                        if (pagination.page > 1 && !loading) setPagination(prev => ({ ...prev, page: prev.page - 1 }));
                      }}>‹</button>
                    </li>
                    <li className="page-item active">
                      <span className="page-link">{pagination.page} of {pagination.pages}</span>
                    </li>
                    <li className={`page-item ${pagination.page >= pagination.pages || loading ? 'disabled' : ''}`}>
                      <button type="button" className="page-link" onClick={() => {
                        if (pagination.page < pagination.pages && !loading) setPagination(prev => ({ ...prev, page: prev.page + 1 }));
                      }}>›</button>
                    </li>
                    <li className={`page-item ${pagination.page >= pagination.pages || loading ? 'disabled' : ''}`}>
                      <button type="button" className="page-link" onClick={() => {
                        if (pagination.page < pagination.pages && !loading) setPagination(prev => ({ ...prev, page: pagination.pages }));
                      }}>»</button>
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

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

      {/* Import Processing Modal */}
      {showImportModal && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Importing Statements</h5>
                <button type="button" className="btn-close" onClick={handleCancelImport}></button>
              </div>
              <div className="modal-body text-center py-4">
                <div className="alert alert-info mb-3">
                  <strong>Note:</strong> Statements are matched to corporate (CORP) accounts only. PDF + XLS files for the same statement are paired into one record.
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
                <button type="button" className="btn btn-danger" onClick={handleCancelImport}>Cancel</button>
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
                <h5 className="modal-title">Statement Import Complete</h5>
                <button type="button" className="btn-close" onClick={handleFinishImport}></button>
              </div>
              <div className="modal-body">
                <div className="row mb-4">
                  <div className="col-md-3">
                    <div className="card card-sm"><div className="card-body">
                      <div className="font-weight-medium">{importResults.summary?.successful || 0}</div>
                      <div className="text-muted">Successful</div>
                    </div></div>
                  </div>
                  <div className="col-md-3">
                    <div className="card card-sm"><div className="card-body">
                      <div className="font-weight-medium text-success">{importResults.summary?.matched || 0}</div>
                      <div className="text-muted">Matched to Company</div>
                    </div></div>
                  </div>
                  <div className="col-md-3">
                    <div className="card card-sm"><div className="card-body">
                      <div className="font-weight-medium text-warning">{importResults.summary?.unallocated || 0}</div>
                      <div className="text-muted">Unallocated</div>
                    </div></div>
                  </div>
                  <div className="col-md-3">
                    <div className="card card-sm"><div className="card-body">
                      <div className="font-weight-medium text-info">{importResults.summary?.duplicates || 0}</div>
                      <div className="text-muted">Duplicates</div>
                    </div></div>
                  </div>
                </div>

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
                          <th>Statement #</th>
                          <th>Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(importResults.results || []).map((result, idx) => (
                          <tr key={idx} className={result.success ? '' : 'table-danger'}>
                            <td><div className="text-truncate" style={{ maxWidth: '250px' }} title={result.fileName}>{result.fileName}</div></td>
                            <td>{result.success ? <span className="badge bg-success-lt">Success</span> : <span className="badge bg-danger-lt">Failed</span>}</td>
                            <td>
                              {result.companyId
                                ? <span className="badge bg-success-lt">Matched</span>
                                : (result.success
                                  ? (result.isDuplicate
                                    ? <span className="badge bg-info-lt">Duplicate</span>
                                    : <span className="badge bg-warning-lt">Unallocated</span>)
                                  : <span className="text-muted">-</span>)}
                            </td>
                            <td>{result.statementNumber || result.invoiceNumber || <span className="text-muted">-</span>}</td>
                            <td>{result.error ? <span className="text-danger small" title={result.errorDetails || result.error}>{result.error.length > 40 ? `${result.error.substring(0, 40)}...` : result.error}</span> : <span className="text-muted">-</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-primary" onClick={handleFinishImport}>Done</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {showBulkDeleteModal && selectedStatements.length > 0 && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Delete Multiple Statements</h5>
                <button type="button" className="btn-close" onClick={() => { setShowBulkDeleteModal(false); setBulkDeleteReason(''); }} disabled={bulkDeleting}></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <p className="text-danger">
                    <strong>Warning:</strong> This action cannot be undone. {selectedStatements.length} statement(s) and their associated files will be permanently deleted.
                  </p>
                  <ul className="list-unstyled">
                    {statements.filter(s => selectedStatements.includes(s.id)).slice(0, 10).map(s => (
                      <li key={s.id} className="text-muted">• {s.statementNumber || s.id} - {s.company?.name || 'Unknown'}</li>
                    ))}
                    {selectedStatements.length > 10 && <li className="text-muted">... and {selectedStatements.length - 10} more</li>}
                  </ul>
                </div>
                <div className="mb-3">
                  <label className="form-label required">Reason for Deletion</label>
                  <textarea
                    className="form-control"
                    rows="4"
                    placeholder="Please provide a reason for deleting these statements..."
                    value={bulkDeleteReason}
                    onChange={(e) => setBulkDeleteReason(e.target.value)}
                    disabled={bulkDeleting}
                    required
                  />
                  <small className="form-hint">This reason will be recorded for accountability.</small>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => { setShowBulkDeleteModal(false); setBulkDeleteReason(''); }} disabled={bulkDeleting}>Cancel</button>
                <button type="button" className="btn btn-danger" onClick={handleBulkDelete} disabled={bulkDeleting || !bulkDeleteReason.trim()}>
                  {bulkDeleting ? 'Deleting...' : `Delete ${selectedStatements.length} Statement(s)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Single Delete Modal */}
      {showDeleteModal && statementToDelete && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Delete Statement</h5>
                <button type="button" className="btn-close" onClick={() => { setShowDeleteModal(false); setStatementToDelete(null); setDeleteReason(''); }} disabled={deleting}></button>
              </div>
              <div className="modal-body">
                <p className="text-danger">
                  <strong>Warning:</strong> This action cannot be undone. The statement and its associated PDF/XLS files will be permanently deleted.
                </p>
                <p>
                  You are about to delete statement <strong>{statementToDelete.statementNumber || statementToDelete.id}</strong> for <strong>{statementToDelete.company?.name || 'Unknown'}</strong>.
                </p>
                <div className="mb-3">
                  <label className="form-label required">Reason for Deletion</label>
                  <textarea
                    className="form-control"
                    rows="4"
                    placeholder="Please provide a reason for deletion..."
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                    disabled={deleting}
                    required
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => { setShowDeleteModal(false); setStatementToDelete(null); setDeleteReason(''); }} disabled={deleting}>Cancel</button>
                <button type="button" className="btn btn-danger" onClick={handleDeleteStatement} disabled={deleting || !deleteReason.trim()}>
                  {deleting ? 'Deleting...' : 'Delete Statement'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && statementToEdit && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-lg modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Edit Statement {statementToEdit.statementNumber || statementToEdit.id}</h5>
                <button type="button" className="btn-close" onClick={() => setShowEditModal(false)} disabled={editSaving}></button>
              </div>
              <div className="modal-body">
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label">Period Start</label>
                    <input
                      type="date"
                      className="form-control"
                      value={editForm.periodStart}
                      onChange={(e) => setEditForm(p => ({ ...p, periodStart: e.target.value }))}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Period End</label>
                    <input
                      type="date"
                      className="form-control"
                      value={editForm.periodEnd}
                      onChange={(e) => setEditForm(p => ({ ...p, periodEnd: e.target.value }))}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Opening Balance</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-control"
                      value={editForm.openingBalance}
                      onChange={(e) => setEditForm(p => ({ ...p, openingBalance: e.target.value }))}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Closing Balance</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-control"
                      value={editForm.closingBalance}
                      onChange={(e) => setEditForm(p => ({ ...p, closingBalance: e.target.value }))}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Total Debits</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-control"
                      value={editForm.totalDebits}
                      onChange={(e) => setEditForm(p => ({ ...p, totalDebits: e.target.value }))}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Total Credits</label>
                    <input
                      type="number"
                      step="0.01"
                      className="form-control"
                      value={editForm.totalCredits}
                      onChange={(e) => setEditForm(p => ({ ...p, totalCredits: e.target.value }))}
                    />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Status</label>
                    <select
                      className="form-select"
                      value={editForm.status}
                      onChange={(e) => setEditForm(p => ({ ...p, status: e.target.value }))}
                    >
                      <option value="draft">Draft</option>
                      <option value="sent">Sent</option>
                      <option value="acknowledged">Acknowledged</option>
                      <option value="disputed">Disputed</option>
                    </select>
                  </div>
                  <div className="col-12">
                    <label className="form-label">Notes</label>
                    <textarea
                      className="form-control"
                      rows="3"
                      value={editForm.notes}
                      onChange={(e) => setEditForm(p => ({ ...p, notes: e.target.value }))}
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label required">Edit Reason</label>
                    <textarea
                      className="form-control"
                      rows="2"
                      placeholder="Why are you editing this statement? (required for audit trail)"
                      value={editForm.editReason}
                      onChange={(e) => setEditForm(p => ({ ...p, editReason: e.target.value }))}
                      required
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditModal(false)} disabled={editSaving}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={handleSaveEdit} disabled={editSaving || !editForm.editReason.trim()}>
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Statements;
