import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { useDebounce } from '../hooks/useDebounce';
import HierarchicalCompanyFilter from '../components/HierarchicalCompanyFilter';

const ActivityLogs = () => {
  const { user } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    pages: 0
  });
  
  // Helper functions for date ranges
  const getDateRange = (days) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    return {
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0]
    };
  };
  
  const getDefaultStartDate = () => {
    return getDateRange(7).start;
  };
  
  const getDefaultEndDate = () => {
    return getDateRange(7).end;
  };
  
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [selectedCompanyIds, setSelectedCompanyIds] = useState([]);
  const [showCompanyFilterModal, setShowCompanyFilterModal] = useState(false);
  const [roleFilter, setRoleFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dateRangePreset, setDateRangePreset] = useState('7'); // Default to 7 days
  const [startDate, setStartDate] = useState(getDefaultStartDate());
  const [endDate, setEndDate] = useState(getDefaultEndDate());
  
  // Handle date range preset change
  const handleDateRangePresetChange = (preset) => {
    setDateRangePreset(preset);
    if (preset === 'custom') {
      // Keep current dates when switching to custom
      return;
    }
    const days = parseInt(preset);
    const range = getDateRange(days);
    setStartDate(range.start);
    setEndDate(range.end);
  };
  
  // When dates are manually changed, switch to custom
  const handleDateChange = (type, value) => {
    if (dateRangePreset !== 'custom') {
      setDateRangePreset('custom');
    }
    if (type === 'start') {
      setStartDate(value);
    } else {
      setEndDate(value);
    }
  };
  
  // Available options for filters
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [activityTypes, setActivityTypes] = useState([]);
  
  // Clear logs modal
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearReason, setClearReason] = useState('');
  
  // View log modal
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);
  
  // Delete log modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteLogId, setDeleteLogId] = useState(null);
  const [deleteReason, setDeleteReason] = useState('');
  
  // Purge all logs modal (Global Admin only - deletes EVERYTHING including protected logs)
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [purgeReason, setPurgeReason] = useState('');
  const [purgeConfirmation, setPurgeConfirmation] = useState('');
  
  const debouncedSearch = useDebounce(searchQuery, 500);
  
  // Fetch activity logs
  const fetchLogs = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: pagination.limit.toString()
      });
      
      if (debouncedSearch) params.append('search', debouncedSearch);
      if (userFilter) params.append('userId', userFilter);
      if (selectedCompanyIds.length > 0) params.append('companyIds', selectedCompanyIds.join(','));
      if (roleFilter) params.append('role', roleFilter);
      if (typeFilter) params.append('type', typeFilter);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      
      const response = await api.get(`/api/activity-logs?${params.toString()}`);
      setLogs(response.data.logs || []);
      setPagination(prev => response.data.pagination || prev);
    } catch (error) {
      console.error('Error fetching activity logs:', error);
      toast.error('Failed to fetch activity logs: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, userFilter, selectedCompanyIds, roleFilter, typeFilter, startDate, endDate, pagination.limit]);
  
  // Fetch filter options
  const fetchFilterOptions = async () => {
    try {
      // Fetch users (handle both paginated and non-paginated response)
      const usersResponse = await api.get('/api/users', { params: { limit: 1000 } });
      const usersData = Array.isArray(usersResponse.data) ? usersResponse.data : (usersResponse.data.users || []);
      setUsers(usersData);
      
      // Fetch companies
      const companiesResponse = await api.get('/api/companies');
      setCompanies(companiesResponse.data || []);
      
      // Fetch activity types
      const typesResponse = await api.get('/api/activity-logs/types');
      setActivityTypes(typesResponse.data.types || []);
    } catch (error) {
      console.error('Error fetching filter options:', error);
    }
  };
  
  useEffect(() => {
    if (user && ['global_admin', 'administrator'].includes(user.role)) {
      fetchFilterOptions();
      fetchLogs(1);
    }
  }, [user, fetchLogs]);
  
  useEffect(() => {
    if (user && ['global_admin', 'administrator'].includes(user.role)) {
      fetchLogs(1);
    }
  }, [user, fetchLogs]);
  
  // Clear all logs
  const handleClearLogs = async () => {
    if (!clearReason.trim()) {
      toast.error('Please provide a reason for clearing logs (auditing requirement)');
      return;
    }
    
    try {
      await api.delete('/api/activity-logs', { data: { reason: clearReason.trim() } });
      toast.success('All activity logs have been cleared');
      setShowClearModal(false);
      setClearReason('');
      fetchLogs(1);
    } catch (error) {
      console.error('Error clearing logs:', error);
      toast.error('Failed to clear logs: ' + (error.response?.data?.message || error.message));
    }
  };
  
  // View log details
  const handleViewLog = (log) => {
    setSelectedLog(log);
    setShowViewModal(true);
  };
  
  // Delete single log
  const handleDeleteLog = async () => {
    if (!deleteReason.trim()) {
      toast.error('Please provide a reason for deleting this log (auditing requirement)');
      return;
    }
    
    try {
      await api.delete(`/api/activity-logs/${deleteLogId}`, { data: { reason: deleteReason.trim() } });
      toast.success('Activity log deleted successfully');
      setShowDeleteModal(false);
      setDeleteLogId(null);
      setDeleteReason('');
      fetchLogs(pagination.page); // Refresh current page
    } catch (error) {
      console.error('Error deleting log:', error);
      toast.error('Failed to delete log: ' + (error.response?.data?.message || error.message));
    }
  };
  
  // Purge ALL logs (including protected ones) - Global Admin only
  const handlePurgeLogs = async () => {
    if (!purgeReason.trim()) {
      toast.error('Please provide a reason for purging logs (auditing requirement)');
      return;
    }
    
    if (purgeConfirmation !== 'PURGE ALL LOGS') {
      toast.error('Please type "PURGE ALL LOGS" to confirm');
      return;
    }
    
    try {
      await api.delete('/api/activity-logs/purge-all', { 
        data: { 
          reason: purgeReason.trim(),
          confirmPurge: purgeConfirmation
        } 
      });
      toast.success('All activity logs have been permanently purged');
      setShowPurgeModal(false);
      setPurgeReason('');
      setPurgeConfirmation('');
      fetchLogs(1);
    } catch (error) {
      console.error('Error purging logs:', error);
      toast.error('Failed to purge logs: ' + (error.response?.data?.message || error.message));
    }
  };
  
  // Check if log can be deleted (only Global Admin can delete logs, but NOT clear log entries)
  const canDeleteLog = (log) => {
    // Only Global Administrators can delete logs
    if (user?.role !== 'global_admin') {
      return false;
    }
    // CRITICAL: Clear log entries CANNOT be deleted by anyone (including Global Admin)
    // This is a permanent audit record for security and compliance
    const isClearLog = log.details?.isClearLog || log.type === 'logs_cleared';
    if (isClearLog) {
      return false; // Never allow deletion of clear log entries
    }
    return true;
  };
  
  // Format timestamp
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };
  
  // Format details object into readable plain text
  const formatDetails = (details) => {
    if (!details || typeof details !== 'object') return 'No details available';
    
    const fieldLabels = {
      invoiceId: 'Invoice ID',
      invoiceNumber: 'Invoice Number',
      creditNoteId: 'Credit Note ID',
      creditNoteNumber: 'Credit Note Number',
      statementId: 'Statement ID',
      statementNumber: 'Statement Number',
      fileId: 'File ID',
      fileName: 'File Name',
      documentId: 'Document ID',
      documentType: 'Document Type',
      companyId: 'Company ID',
      companyName: 'Company Name',
      reason: 'Reason',
      bulkDelete: 'Bulk Delete',
      totalDeleted: 'Total Deleted',
      targetUserId: 'Target User ID',
      targetUserName: 'Target User Name',
      targetUserEmail: 'Target User Email',
      createdUserId: 'Created User ID',
      createdUserName: 'Created User Name',
      createdUserEmail: 'Created User Email',
      deletedUserId: 'Deleted User ID',
      deletedUserName: 'Deleted User Name',
      deletedUserEmail: 'Deleted User Email',
      deletedUserRole: 'Deleted User Role',
      updatedUserId: 'Updated User ID',
      updatedUserName: 'Updated User Name',
      updatedUserEmail: 'Updated User Email',
      templateId: 'Template ID',
      templateName: 'Template Name',
      templateType: 'Template Type',
      fileType: 'File Type',
      isDefault: 'Is Default',
      importId: 'Import ID',
      fileCount: 'File Count',
      uploadMethod: 'Upload Method',
      isDuplicate: 'Is Duplicate',
      status: 'Status',
      error: 'Error',
      changes: 'Changes',
      accountNumber: 'Account Number',
      processingTime: 'Processing Time',
      ipAddress: 'IP Address',
      userAgent: 'User Agent'
    };
    
    const formatValue = (value) => {
      if (value === null || value === undefined) return 'N/A';
      if (typeof value === 'boolean') return value ? 'Yes' : 'No';
      if (typeof value === 'object') {
        if (Array.isArray(value)) {
          return value.length > 0 ? value.join(', ') : 'None';
        }
        // Handle nested objects
        return Object.entries(value)
          .map(([k, v]) => {
            const label = fieldLabels[k] || k.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
            return `${label}: ${formatValue(v)}`;
          })
          .join('\n');
      }
      return String(value);
    };
    
    const lines = [];
    Object.entries(details).forEach(([key, value]) => {
      const label = fieldLabels[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
      
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Handle nested objects (like changes, accountNumber with from/to)
        if (value.from !== undefined || value.to !== undefined) {
          lines.push(`${label}: ${value.from !== undefined ? `From: ${formatValue(value.from)}` : ''}${value.from !== undefined && value.to !== undefined ? ' → ' : ''}${value.to !== undefined ? `To: ${formatValue(value.to)}` : ''}`);
        } else {
          // Other nested objects
          lines.push(`${label}:`);
          Object.entries(value).forEach(([subKey, subValue]) => {
            const subLabel = fieldLabels[subKey] || subKey.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
            lines.push(`  • ${subLabel}: ${formatValue(subValue)}`);
          });
        }
      } else {
        lines.push(`${label}: ${formatValue(value)}`);
      }
    });
    
    return lines.join('\n');
  };
  
  // Get activity type badge color
  const getTypeBadgeColor = (type) => {
    if (type?.includes('login')) return 'bg-success-lt';
    if (type?.includes('failed') || type?.includes('delete')) return 'bg-danger-lt';
    if (type?.includes('email')) return 'bg-info-lt';
    if (type?.includes('import')) return 'bg-primary-lt';
    if (type?.includes('view') || type?.includes('download')) return 'bg-warning-lt';
    return 'bg-secondary-lt';
  };
  
  // Reset filters (reset to default 7 days)
  const resetFilters = () => {
    setSearchQuery('');
    setUserFilter('');
    setCompanyFilter('');
    setRoleFilter('');
    setTypeFilter('');
    setDateRangePreset('7');
    const defaultRange = getDateRange(7);
    setStartDate(defaultRange.start);
    setEndDate(defaultRange.end);
  };
  
  if (!user || !['global_admin', 'administrator'].includes(user.role)) {
    return (
      <div className="page-header d-print-none">
        <div className="container-fluid">
          <div className="row g-2 align-items-center">
            <div className="col">
              <div className="page-pretitle">Access Denied</div>
              <h2 className="page-title">Activity Logs</h2>
            </div>
          </div>
        </div>
        <div className="page-body">
          <div className="container-fluid">
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
                  <p className="empty-text">Only Global Administrators and Administrators can view activity logs.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="page-header d-print-none">
      <div className="container-fluid">
        <div className="row g-2 align-items-center">
          <div className="col">
            <div className="page-pretitle">System</div>
            <h2 className="page-title">Activity Logs</h2>
          </div>
          <div className="col-auto ms-auto d-print-none">
            <div className="btn-list">
              <button
                className="btn btn-outline-danger"
                onClick={() => setShowClearModal(true)}
                disabled={pagination.total === 0}
              >
                Clear Logs
              </button>
              {user?.role === 'global_admin' && (
                <button
                  className="btn btn-danger"
                  onClick={() => setShowPurgeModal(true)}
                  disabled={pagination.total === 0}
                  title="Permanently delete ALL logs including protected entries"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-tabler icon-tabler-trash-x me-1" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                    <path d="M4 7h16" />
                    <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
                    <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
                    <path d="M10 12l4 4m0 -4l-4 4" />
                  </svg>
                  Purge ALL Logs
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      
      <div className="page-body">
        <div className="container-fluid">
          {/* Filters Toolbar */}
          <div className="card mb-3">
            <div className="card-body">
              <div className="row g-3">
                <div className="col-md-3">
                  <label className="form-label">Search</label>
                  <div className="input-group">
                    <span className="input-group-text">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"></circle>
                        <path d="m21 21-4.35-4.35"></path>
                      </svg>
                    </span>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Search actions, emails..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                </div>
                
                <div className="col-md-2">
                  <label className="form-label">User</label>
                  <select
                    className="form-select"
                    value={userFilter}
                    onChange={(e) => setUserFilter(e.target.value)}
                  >
                    <option value="">All Users</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name || u.email}</option>
                    ))}
                  </select>
                </div>
                
                <div className="col-md-2">
                  <label className="form-label">Company</label>
                  <button
                    type="button"
                    className={`btn w-100 ${selectedCompanyIds.length > 0 ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setShowCompanyFilterModal(true)}
                  >
                    {selectedCompanyIds.length === 0 
                      ? 'All Companies' 
                      : `${selectedCompanyIds.length} Selected`}
                  </button>
                </div>
                
                <div className="col-md-2">
                  <label className="form-label">Role</label>
                  <select
                    className="form-select"
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                  >
                    <option value="">All Roles</option>
                    <option value="global_admin">Global Admin</option>
                    <option value="administrator">Administrator</option>
                    <option value="manager">Manager</option>
                    <option value="external_user">External User</option>
                  </select>
                </div>
                
                <div className="col-md-2">
                  <label className="form-label">Activity Type</label>
                  <select
                    className="form-select"
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                  >
                    <option value="">All Types</option>
                    {activityTypes.map(type => (
                      <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                
                <div className="col-md-1">
                  <label className="form-label">&nbsp;</label>
                  <button
                    className="btn btn-secondary w-100"
                    onClick={resetFilters}
                    title="Reset Filters"
                  >
                    Reset
                  </button>
                </div>
              </div>
              
              <div className="row g-3 mt-2">
                <div className="col-md-2">
                  <label className="form-label">Date Range</label>
                  <select
                    className="form-select"
                    value={dateRangePreset}
                    onChange={(e) => handleDateRangePresetChange(e.target.value)}
                  >
                    <option value="7">Last 7 Days</option>
                    <option value="14">Last 14 Days</option>
                    <option value="30">Last 30 Days</option>
                    <option value="custom">Custom Range</option>
                  </select>
                </div>
                
                <div className="col-md-3">
                  <label className="form-label">Start Date</label>
                  <input
                    type="date"
                    className="form-control"
                    value={startDate}
                    onChange={(e) => handleDateChange('start', e.target.value)}
                  />
                </div>
                
                <div className="col-md-3">
                  <label className="form-label">End Date</label>
                  <input
                    type="date"
                    className="form-control"
                    value={endDate}
                    onChange={(e) => handleDateChange('end', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
          
          {/* Logs Table */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                Activity Logs
                {pagination.total > 0 && (
                  <span className="badge bg-primary-lt ms-2">{pagination.total}</span>
                )}
              </h3>
            </div>
            <div className="table-responsive">
              {loading ? (
                <div className="text-center p-5">
                  <div className="spinner-border" role="status">
                    <span className="visually-hidden">Loading...</span>
                  </div>
                </div>
              ) : logs.length === 0 ? (
                <div className="empty p-5">
                  <p className="empty-title">No activity logs found</p>
                  <p className="empty-text">Activity logs will appear here as users interact with the system.</p>
                </div>
              ) : (
                <table className="table table-vcenter table-selectable">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Type</th>
                      <th>User</th>
                      <th>Role</th>
                      <th>Action</th>
                      <th>Company</th>
                      <th>IP Address</th>
                      <th className="w-1">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => {
                      const isClearLog = log.details?.isClearLog;
                      const canDelete = canDeleteLog(log);
                      
                      return (
                        <tr key={log.id}>
                          <td>
                            <div className="text-nowrap">{formatTimestamp(log.timestamp)}</div>
                          </td>
                          <td>
                            <span className={`badge ${getTypeBadgeColor(log.type)}`}>
                              {log.type?.replace(/_/g, ' ').toUpperCase() || 'N/A'}
                            </span>
                          </td>
                          <td>
                            <div>
                              {(() => {
                                const logUser = users.find(u => u.id === log.userId);
                                const userName = logUser?.name || log.userEmail || 'System';
                                return (
                                  <>
                                    <div className="fw-semibold">{userName}</div>
                                    {log.userEmail && log.userEmail !== userName && (
                                      <small className="text-muted d-block">{log.userEmail}</small>
                                    )}
                                    {log.userId && (
                                      <small className="text-muted d-block">ID: {log.userId.substring(0, 8)}...</small>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </td>
                          <td>
                            <span className="badge bg-secondary-lt">
                              {log.userRole?.replace(/_/g, ' ').toUpperCase() || 'N/A'}
                            </span>
                          </td>
                          <td>
                            <div className="fw-semibold">{log.action || 'N/A'}</div>
                            {isClearLog && log.details?.reason && (
                              <small className="text-muted d-block mt-1">
                                <strong>Reason:</strong> {log.details.reason}
                              </small>
                            )}
                          </td>
                          <td>{log.companyName || 'N/A'}</td>
                          <td>
                            <small className="text-muted">{log.ipAddress || 'N/A'}</small>
                          </td>
                          <td>
                            <div className="btn-list">
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => handleViewLog(log)}
                                title="View Details"
                              >
                                View
                              </button>
                              {canDelete && !isClearLog && (
                                <button
                                  className="btn btn-sm btn-danger"
                                  onClick={() => {
                                    setDeleteLogId(log.id);
                                    setShowDeleteModal(true);
                                  }}
                                  title="Delete Log"
                                >
                                  Delete
                                </button>
                              )}
                              {isClearLog && (
                                <span className="badge bg-warning-lt" title="This log entry is permanently protected and cannot be deleted by anyone. It is a critical audit record for security and compliance.">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-xs me-1" width="16" height="16" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                    <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
                                    <path d="M12 8v4" />
                                    <path d="M12 16h.01" />
                                  </svg>
                                  Protected
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            
            {/* Pagination */}
            {pagination.pages > 1 && (
              <div className="card-footer">
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} logs
                  </div>
                  <div className="btn-group">
                    <button
                      className="btn btn-sm btn-outline-primary"
                      onClick={() => fetchLogs(pagination.page - 1)}
                      disabled={pagination.page === 1}
                    >
                      Previous
                    </button>
                    <button className="btn btn-sm btn-outline-primary" disabled>
                      Page {pagination.page} of {pagination.pages}
                    </button>
                    <button
                      className="btn btn-sm btn-outline-primary"
                      onClick={() => fetchLogs(pagination.page + 1)}
                      disabled={pagination.page >= pagination.pages}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Clear Logs Modal */}
      {showClearModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Clear All Activity Logs</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowClearModal(false);
                    setClearReason('');
                  }}
                ></button>
              </div>
              <div className="modal-body">
                <p>Are you sure you want to clear all activity logs? This action cannot be undone.</p>
                <p className="text-danger">
                  <strong>Warning:</strong> This will permanently delete all {pagination.total} activity log entries.
                </p>
                <div className="mb-3">
                  <label className="form-label">
                    Reason for Clearing Logs <span className="text-danger">*</span>
                  </label>
                  <textarea
                    className="form-control"
                    rows="3"
                    placeholder="Please provide a reason for clearing all activity logs (required for auditing)..."
                    value={clearReason}
                    onChange={(e) => setClearReason(e.target.value)}
                    required
                  />
                  <small className="text-muted">This action will be logged and cannot be deleted except by Global Administrators.</small>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    setShowClearModal(false);
                    setClearReason('');
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleClearLogs}
                  disabled={!clearReason.trim()}
                >
                  Clear All Logs
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* View Log Details Modal */}
      {showViewModal && selectedLog && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered modal-xl">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Activity Log Details</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowViewModal(false);
                    setSelectedLog(null);
                  }}
                ></button>
              </div>
              <div className="modal-body">
                <div className="list-group list-group-flush">
                  <div className="list-group-item px-0">
                    <div className="row">
                      <div className="col-4"><strong>Timestamp:</strong></div>
                      <div className="col-8">{formatTimestamp(selectedLog.timestamp)}</div>
                    </div>
                  </div>
                  <div className="list-group-item px-0">
                    <div className="row">
                      <div className="col-4"><strong>Type:</strong></div>
                      <div className="col-8">
                        <span className={`badge ${getTypeBadgeColor(selectedLog.type)}`}>
                          {selectedLog.type?.replace(/_/g, ' ').toUpperCase() || 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="list-group-item px-0">
                    <div className="row">
                      <div className="col-4"><strong>User:</strong></div>
                      <div className="col-8">
                        {(() => {
                          const logUser = users.find(u => u.id === selectedLog.userId);
                          const userName = logUser?.name || selectedLog.userEmail || 'System';
                          return (
                            <>
                              <div className="fw-semibold">{userName}</div>
                              {selectedLog.userEmail && selectedLog.userEmail !== userName && (
                                <small className="text-muted d-block">{selectedLog.userEmail}</small>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                  {selectedLog.userId && (
                    <div className="list-group-item px-0">
                      <div className="row">
                        <div className="col-4"><strong>User ID:</strong></div>
                        <div className="col-8"><code>{selectedLog.userId}</code></div>
                      </div>
                    </div>
                  )}
                  <div className="list-group-item px-0">
                    <div className="row">
                      <div className="col-4"><strong>Role:</strong></div>
                      <div className="col-8">
                        <span className="badge bg-secondary-lt">
                          {selectedLog.userRole?.replace(/_/g, ' ').toUpperCase() || 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="list-group-item px-0">
                    <div className="row">
                      <div className="col-4"><strong>Action:</strong></div>
                      <div className="col-8">{selectedLog.action || 'N/A'}</div>
                    </div>
                  </div>
                  {selectedLog.companyName && (
                    <div className="list-group-item px-0">
                      <div className="row">
                        <div className="col-4"><strong>Company:</strong></div>
                        <div className="col-8">{selectedLog.companyName}</div>
                      </div>
                    </div>
                  )}
                  {selectedLog.companyId && (
                    <div className="list-group-item px-0">
                      <div className="row">
                        <div className="col-4"><strong>Company ID:</strong></div>
                        <div className="col-8"><code>{selectedLog.companyId}</code></div>
                      </div>
                    </div>
                  )}
                  {selectedLog.ipAddress && (
                    <div className="list-group-item px-0">
                      <div className="row">
                        <div className="col-4"><strong>IP Address:</strong></div>
                        <div className="col-8"><code>{selectedLog.ipAddress}</code></div>
                      </div>
                    </div>
                  )}
                  {selectedLog.userAgent && (
                    <div className="list-group-item px-0">
                      <div className="row">
                        <div className="col-4"><strong>User Agent:</strong></div>
                        <div className="col-8"><small className="text-muted">{selectedLog.userAgent}</small></div>
                      </div>
                    </div>
                  )}
                  {selectedLog.details && Object.keys(selectedLog.details).length > 0 && (
                    <div className="list-group-item px-0">
                      <div className="row">
                        <div className="col-12">
                          <strong>Details:</strong>
                          <pre className="mt-2 p-3 bg-light rounded text-dark" style={{ fontSize: '0.875rem', maxHeight: '300px', overflow: 'auto', color: '#212529', whiteSpace: 'pre-wrap', wordWrap: 'break-word' }}>
                            {formatDetails(selectedLog.details)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowViewModal(false);
                    setSelectedLog(null);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Delete Log Modal */}
      {showDeleteModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Delete Activity Log</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setDeleteLogId(null);
                    setDeleteReason('');
                  }}
                ></button>
              </div>
              <div className="modal-body">
                <p>Are you sure you want to delete this activity log? This action cannot be undone.</p>
                <div className="mb-3">
                  <label className="form-label">
                    Reason for Deletion <span className="text-danger">*</span>
                  </label>
                  <textarea
                    className="form-control"
                    rows="3"
                    placeholder="Please provide a reason for deleting this log (required for auditing)..."
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                    required
                  />
                  <small className="text-muted">This deletion will be logged for auditing purposes.</small>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setDeleteLogId(null);
                    setDeleteReason('');
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleDeleteLog}
                  disabled={!deleteReason.trim()}
                >
                  Delete Log
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Purge ALL Logs Modal (Global Admin only) */}
      {showPurgeModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content border-danger">
              <div className="modal-header bg-danger text-white">
                <h5 className="modal-title">
                  <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-tabler icon-tabler-alert-triangle me-2" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                    <path d="M12 9v4" />
                    <path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z" />
                    <path d="M12 16h.01" />
                  </svg>
                  PURGE ALL LOGS
                </h5>
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  onClick={() => {
                    setShowPurgeModal(false);
                    setPurgeReason('');
                    setPurgeConfirmation('');
                  }}
                ></button>
              </div>
              <div className="modal-body">
                <div className="alert alert-danger">
                  <h4 className="alert-title">⚠️ DANGEROUS ACTION</h4>
                  <p className="mb-0">
                    This will <strong>permanently delete ALL {pagination.total} activity logs</strong>, 
                    including protected "logs cleared" entries. 
                    <strong> NO AUDIT TRAIL WILL REMAIN.</strong>
                  </p>
                </div>
                
                <div className="mb-3">
                  <label className="form-label">
                    Reason for Purging <span className="text-danger">*</span>
                  </label>
                  <textarea
                    className="form-control"
                    rows="3"
                    placeholder="Please provide a detailed reason for purging all logs..."
                    value={purgeReason}
                    onChange={(e) => setPurgeReason(e.target.value)}
                    required
                  />
                </div>
                
                <div className="mb-3">
                  <label className="form-label">
                    Type <code>PURGE ALL LOGS</code> to confirm <span className="text-danger">*</span>
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="PURGE ALL LOGS"
                    value={purgeConfirmation}
                    onChange={(e) => setPurgeConfirmation(e.target.value)}
                    required
                  />
                </div>
                
                <small className="text-muted">
                  This action will be logged to the server file system only. No database record will remain.
                </small>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowPurgeModal(false);
                    setPurgeReason('');
                    setPurgeConfirmation('');
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handlePurgeLogs}
                  disabled={!purgeReason.trim() || purgeConfirmation !== 'PURGE ALL LOGS'}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-tabler icon-tabler-trash-x me-1" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                    <path d="M4 7h16" />
                    <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
                    <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
                    <path d="M10 12l4 4m0 -4l-4 4" />
                  </svg>
                  PURGE ALL LOGS PERMANENTLY
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
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

export default ActivityLogs;



