import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';

const ParsingLog = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [viewFile, setViewFile] = useState(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showClearModal, setShowClearModal] = useState(false);
  const [stats, setStats] = useState(null);
  const [pagination, setPagination] = useState(null);
  
  // Filters
  const [filters, setFilters] = useState({
    page: 1,
    limit: 50,
    status: 'all',
    fileType: 'all',
    processingMethod: 'all',
    dateFrom: '',
    dateTo: '',
    search: '',
    customerId: 'all',
    assigned: 'all'
  });

  useEffect(() => {
    if (user?.role === 'global_admin') {
      fetchFiles();
      fetchStats();
    }
  }, [user, filters]);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.keys(filters).forEach(key => {
        if (filters[key] && filters[key] !== 'all') {
          params.append(key, filters[key]);
        }
      });

      const response = await api.get(`/api/files?${params.toString()}`);
      setFiles(response.data.files || []);
      setPagination(response.data.pagination || null);
    } catch (error) {
      console.error('Error fetching files:', error);
      toast.error('Error fetching parsing log: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await api.get('/api/files/stats/summary');
      setStats(response.data.stats);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      page: 1 // Reset to first page on filter change
    }));
  };

  const handleViewFile = async (fileId) => {
    try {
      const response = await api.get(`/api/files/${fileId}`);
      setViewFile(response.data);
      setShowViewModal(true);
    } catch (error) {
      console.error('Error fetching file details:', error);
      toast.error('Error fetching file details: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleSelectFile = (fileId) => {
    setSelectedFiles(prev => 
      prev.includes(fileId) 
        ? prev.filter(id => id !== fileId)
        : [...prev, fileId]
    );
  };

  const handleSelectAll = () => {
    if (selectedFiles.length === files.length) {
      setSelectedFiles([]);
    } else {
      setSelectedFiles(files.map(file => file.id));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedFiles.length === 0) {
      toast.error('Please select files to delete');
      return;
    }

    try {
      await api.delete('/api/files/bulk', { data: { fileIds: selectedFiles } });
      toast.success(`Successfully deleted ${selectedFiles.length} file(s)`);
      setSelectedFiles([]);
      setShowDeleteModal(false);
      fetchFiles();
      fetchStats();
    } catch (error) {
      console.error('Error deleting files:', error);
      toast.error('Error deleting files: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleClearLogs = async () => {
    try {
      await api.delete('/api/files/logs/clear', { data: { confirm: 'DELETE_ALL_LOGS' } });
      toast.success('All logs cleared successfully');
      setShowClearModal(false);
      fetchFiles();
      fetchStats();
    } catch (error) {
      console.error('Error clearing logs:', error);
      toast.error('Error clearing logs: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleDeleteFile = async (fileId) => {
    try {
      await api.delete(`/api/files/${fileId}`);
      toast.success('File deleted successfully');
      fetchFiles();
      fetchStats();
    } catch (error) {
      console.error('Error deleting file:', error);
      toast.error('Error deleting file: ' + (error.response?.data?.message || error.message));
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      pending: 'badge bg-yellow-lt',
      processing: 'badge bg-blue-lt',
      parsed: 'badge bg-green-lt',
      failed: 'badge bg-red-lt',
      duplicate: 'badge bg-secondary-lt'
    };
    return badges[status] || 'badge bg-secondary-lt';
  };

  const getFileTypeLabel = (type) => {
    const labels = {
      invoice: 'Invoice',
      credit_note: 'Credit Note',
      statement: 'Statement',
      unknown: 'Unknown'
    };
    return labels[type] || type;
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  };

  if (!user || user.role !== 'global_admin') {
    return (
      <div className="card">
        <div className="card-body">
          <div className="empty">
            <div className="empty-icon">
              <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
              </svg>
            </div>
            <p className="empty-title">Access Denied</p>
            <p className="empty-text">Global Admin privileges required.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header d-print-none">
        <div className="container-xl">
          <div className="row g-2 align-items-center">
            <div className="col">
              <h2 className="page-title">Parsing Log</h2>
            </div>
            <div className="col-auto ms-auto">
              <div className="btn-list">
                {selectedFiles.length > 0 && (
                  <button
                    className="btn btn-danger"
                    onClick={() => setShowDeleteModal(true)}
                  >
                    Delete Selected ({selectedFiles.length})
                  </button>
                )}
                <button
                  className="btn btn-outline-danger"
                  onClick={() => setShowClearModal(true)}
                >
                  Clear All Logs
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="container-xl">
          {/* Statistics Cards */}
          {stats && (
            <div className="row row-cards mb-3">
              <div className="col-sm-6 col-lg-3">
                <div className="card">
                  <div className="card-body">
                    <div className="d-flex align-items-center">
                      <div className="subheader">Total</div>
                    </div>
                    <div className="h1 mb-3">{stats.total || 0}</div>
                  </div>
                </div>
              </div>
              <div className="col-sm-6 col-lg-3">
                <div className="card">
                  <div className="card-body">
                    <div className="d-flex align-items-center">
                      <div className="subheader">Parsed</div>
                    </div>
                    <div className="h1 mb-3 text-green">{stats.parsed || 0}</div>
                  </div>
                </div>
              </div>
              <div className="col-sm-6 col-lg-3">
                <div className="card">
                  <div className="card-body">
                    <div className="d-flex align-items-center">
                      <div className="subheader">Failed</div>
                    </div>
                    <div className="h1 mb-3 text-red">{stats.failed || 0}</div>
                  </div>
                </div>
              </div>
              <div className="col-sm-6 col-lg-3">
                <div className="card">
                  <div className="card-body">
                    <div className="d-flex align-items-center">
                      <div className="subheader">Processing</div>
                    </div>
                    <div className="h1 mb-3 text-blue">{stats.processing || 0}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="card mb-3">
            <div className="card-body">
              <div className="row g-3">
                <div className="col-md-3">
                  <label className="form-label">Search</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Filename, invoice #, account #"
                    value={filters.search}
                    onChange={(e) => handleFilterChange('search', e.target.value)}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label">Status</label>
                  <select
                    className="form-select"
                    value={filters.status}
                    onChange={(e) => handleFilterChange('status', e.target.value)}
                  >
                    <option value="all">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="processing">Processing</option>
                    <option value="parsed">Parsed</option>
                    <option value="failed">Failed</option>
                    <option value="duplicate">Duplicate</option>
                  </select>
                </div>
                <div className="col-md-2">
                  <label className="form-label">File Type</label>
                  <select
                    className="form-select"
                    value={filters.fileType}
                    onChange={(e) => handleFilterChange('fileType', e.target.value)}
                  >
                    <option value="all">All Types</option>
                    <option value="invoice">Invoice</option>
                    <option value="credit_note">Credit Note</option>
                    <option value="statement">Statement</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>
                <div className="col-md-2">
                  <label className="form-label">Parser</label>
                  <select
                    className="form-select"
                    value={filters.processingMethod}
                    onChange={(e) => handleFilterChange('processingMethod', e.target.value)}
                  >
                    <option value="all">All Parsers</option>
                    <option value="documentai">Document AI</option>
                    <option value="local">Local</option>
                    <option value="manual">Manual</option>
                  </select>
                </div>
                <div className="col-md-1">
                  <label className="form-label">Assigned</label>
                  <select
                    className="form-select"
                    value={filters.assigned}
                    onChange={(e) => handleFilterChange('assigned', e.target.value)}
                  >
                    <option value="all">All</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </div>
                <div className="col-md-2">
                  <label className="form-label">Date From</label>
                  <input
                    type="date"
                    className="form-control"
                    value={filters.dateFrom}
                    onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label">Date To</label>
                  <input
                    type="date"
                    className="form-control"
                    value={filters.dateTo}
                    onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Files Table */}
          <div className="card">
            <div className="card-body">
              {loading ? (
                <div className="text-center py-4">
                  <div className="spinner-border" role="status">
                    <span className="visually-hidden">Loading...</span>
                  </div>
                </div>
              ) : files.length === 0 ? (
                <div className="empty">
                  <p className="empty-title">No files found</p>
                  <p className="empty-text">No files match your current filters.</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-vcenter card-table">
                    <thead>
                      <tr>
                        <th>
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={selectedFiles.length === files.length && files.length > 0}
                            onChange={handleSelectAll}
                          />
                        </th>
                        <th>File Name</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Parser</th>
                        <th>Customer</th>
                        <th>Uploaded</th>
                        <th>Processed</th>
                        <th className="w-1">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.map((file) => (
                        <tr key={file.id}>
                          <td>
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={selectedFiles.includes(file.id)}
                              onChange={() => handleSelectFile(file.id)}
                            />
                          </td>
                          <td>
                            <div className="text-truncate" style={{ maxWidth: '200px' }} title={file.fileName}>
                              {file.fileName}
                            </div>
                            {file.parsedData?.invoiceNumber && (
                              <small className="text-muted d-block">Inv: {file.parsedData.invoiceNumber}</small>
                            )}
                          </td>
                          <td>
                            <span className="badge bg-secondary-lt">{getFileTypeLabel(file.fileType)}</span>
                          </td>
                          <td>
                            <span className={getStatusBadge(file.status)}>
                              {file.status.charAt(0).toUpperCase() + file.status.slice(1)}
                            </span>
                          </td>
                          <td>
                            {file.processingMethod ? (
                              <span className="badge bg-info-lt">
                                {file.processingMethod === 'documentai' ? 'Document AI' : 
                                 file.processingMethod.startsWith('local') ? 'Local' : 
                                 'Manual'}
                              </span>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td>
                            {file.customer ? (
                              <span className="badge bg-success-lt">{file.customer.name}</span>
                            ) : (
                              <span className="text-muted">Unassigned</span>
                            )}
                          </td>
                          <td>
                            <small>{formatDate(file.uploadedAt)}</small>
                          </td>
                          <td>
                            <small>{formatDate(file.processedAt)}</small>
                          </td>
                          <td>
                            <div className="btn-list">
                              <button
                                className="btn btn-sm btn-outline-primary"
                                onClick={() => handleViewFile(file.id)}
                              >
                                View
                              </button>
                              <button
                                className="btn btn-sm btn-outline-danger"
                                onClick={() => handleDeleteFile(file.id)}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              
              {/* Pagination */}
              {pagination && pagination.pages > 1 && (
                <div className="card-footer d-flex align-items-center">
                  <div className="pagination ms-auto">
                    <button
                      className="page-item page-link"
                      disabled={pagination.page === 1}
                      onClick={() => handleFilterChange('page', pagination.page - 1)}
                    >
                      Previous
                    </button>
                    <span className="page-item page-link">
                      Page {pagination.page} of {pagination.pages} ({pagination.total} total)
                    </span>
                    <button
                      className="page-item page-link"
                      disabled={pagination.page === pagination.pages}
                      onClick={() => handleFilterChange('page', pagination.page + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* View File Modal */}
      {showViewModal && viewFile && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-xl modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">File Details</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowViewModal(false);
                    setViewFile(null);
                  }}
                ></button>
              </div>
              <div className="modal-body">
                <div className="row mb-3">
                  <div className="col-md-6">
                    <strong>File Name:</strong>
                    <p>{viewFile.fileName}</p>
                  </div>
                  <div className="col-md-6">
                    <strong>File Type:</strong>
                    <p><span className="badge bg-secondary-lt">{getFileTypeLabel(viewFile.fileType)}</span></p>
                  </div>
                </div>
                <div className="row mb-3">
                  <div className="col-md-6">
                    <strong>Status:</strong>
                    <p><span className={getStatusBadge(viewFile.status)}>
                      {viewFile.status.charAt(0).toUpperCase() + viewFile.status.slice(1)}
                    </span></p>
                  </div>
                  <div className="col-md-6">
                    <strong>Processing Method:</strong>
                    <p>
                      {viewFile.processingMethod ? (
                        <span className="badge bg-info-lt">
                          {viewFile.processingMethod === 'documentai' ? 'Document AI' : 
                           viewFile.processingMethod.startsWith('local') ? 'Local' : 
                           'Manual'}
                        </span>
                      ) : (
                        <span className="text-muted">Not processed</span>
                      )}
                    </p>
                  </div>
                </div>
                {viewFile.parsedData && (
                  <div className="mb-3">
                    <strong>Parsed Data:</strong>
                    <div className="card mt-2">
                      <div className="card-body">
                        <div className="row">
                          <div className="col-md-6">
                            <strong>Invoice Number:</strong>
                            <p>{viewFile.parsedData.invoiceNumber || 'N/A'}</p>
                          </div>
                          <div className="col-md-6">
                            <strong>Account Number:</strong>
                            <p>{viewFile.parsedData.accountNumber || 'N/A'}</p>
                          </div>
                          <div className="col-md-6">
                            <strong>Date:</strong>
                            <p>{viewFile.parsedData.date || 'N/A'}</p>
                          </div>
                          <div className="col-md-6">
                            <strong>Amount:</strong>
                            <p>{viewFile.parsedData.amount ? `$${viewFile.parsedData.amount}` : 'N/A'}</p>
                          </div>
                          <div className="col-md-12">
                            <strong>Customer Name:</strong>
                            <p>{viewFile.parsedData.customerName || 'N/A'}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {viewFile.errorMessage && (
                  <div className="mb-3">
                    <strong>Error Message:</strong>
                    <div className="alert alert-danger mt-2">{viewFile.errorMessage}</div>
                  </div>
                )}
                <div className="row mb-3">
                  <div className="col-md-6">
                    <strong>File Size:</strong>
                    <p>{formatFileSize(viewFile.fileSize)}</p>
                  </div>
                  <div className="col-md-6">
                    <strong>Uploaded:</strong>
                    <p>{formatDate(viewFile.uploadedAt)}</p>
                  </div>
                  {viewFile.processedAt && (
                    <div className="col-md-6">
                      <strong>Processed:</strong>
                      <p>{formatDate(viewFile.processedAt)}</p>
                    </div>
                  )}
                  {viewFile.customer && (
                    <div className="col-md-6">
                      <strong>Assigned Customer:</strong>
                      <p><span className="badge bg-success-lt">{viewFile.customer.name}</span></p>
                    </div>
                  )}
                </div>
                {viewFile.metadata && Object.keys(viewFile.metadata).length > 0 && (
                  <div className="mb-3">
                    <strong>Metadata:</strong>
                    <pre className="bg-light p-2 rounded" style={{ maxHeight: '200px', overflow: 'auto' }}>
                      {JSON.stringify(viewFile.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowViewModal(false);
                    setViewFile(null);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Modal */}
      {showDeleteModal && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Confirm Delete</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowDeleteModal(false)}
                ></button>
              </div>
              <div className="modal-body">
                <p>Are you sure you want to delete {selectedFiles.length} selected file(s)? This action cannot be undone.</p>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setShowDeleteModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleBulkDelete}
                >
                  Delete {selectedFiles.length} File(s)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clear All Logs Modal */}
      {showClearModal && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Clear All Logs</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowClearModal(false)}
                ></button>
              </div>
              <div className="modal-body">
                <p className="text-danger"><strong>Warning:</strong> This will delete all parsing log entries. This action cannot be undone.</p>
                <p>Are you absolutely sure you want to proceed?</p>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setShowClearModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleClearLogs}
                >
                  Clear All Logs
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ParsingLog;

