import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import PageTitle from '../components/PageTitle';

const ImportData = () => {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importStep, setImportStep] = useState('upload'); // 'upload', 'preview', 'importing', 'complete'
  const [importPreview, setImportPreview] = useState(null);
  const [importResults, setImportResults] = useState(null);
  const [importTransactionId, setImportTransactionId] = useState(null);
  const [undoing, setUndoing] = useState(false);
  const [previewFilter, setPreviewFilter] = useState('all'); // 'all', 'valid', 'warning', 'error', 'create', 'update'
  const [lastImport, setLastImport] = useState(null);

  // Check if user is administrator
  const isAdministrator = () => {
    return currentUser?.role === 'global_admin' || currentUser?.role === 'administrator';
  };

  // Fetch last import transaction on component mount
  useEffect(() => {
    const fetchLastImport = async () => {
      if (!isAdministrator()) {
        return;
      }

      try {
        const response = await api.get('/api/companies/import/last');
        // Response will be null if no import found (200 status)
        setLastImport(response.data);
      } catch (error) {
        console.error('Error fetching last import:', error);
        setLastImport(null);
      }
    };

    fetchLastImport();
  }, []);

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setImportFile(file);
    setImportStep('preview');
    
    try {
      setImporting(true);
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.post('/api/companies/import/preview', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      setImportPreview(response.data);
      setImportStep('preview');
    } catch (error) {
      toast.error('Error previewing import: ' + (error.response?.data?.message || error.message));
      setImportFile(null);
      setImportStep('upload');
    } finally {
      setImporting(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!importFile) {
      toast.error('Please select a file');
      return;
    }

    try {
      setImportStep('importing');
      setImporting(true);
      const formData = new FormData();
      formData.append('file', importFile);

      const response = await api.post('/api/companies/import', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      const { created, updated, errors, totalRows, transactionId } = response.data;
      
      setImportResults({
        created,
        updated,
        errors: errors || [],
        totalRows
      });
      setImportTransactionId(transactionId);
      setImportStep('complete');
      
      let message = `Import completed! Created: ${created}, Updated: ${updated} out of ${totalRows} rows.`;
      if (errors && errors.length > 0) {
        message += `\n\nErrors (${errors.length}):\n${errors.slice(0, 10).join('\n')}`;
        if (errors.length > 10) {
          message += `\n... and ${errors.length - 10} more errors.`;
        }
        toast.warning(message, { duration: 10000 });
      } else {
        toast.success(message);
      }

      // Fetch last import to show undo banner
      try {
        const lastImportResponse = await api.get('/api/companies/import/last');
        // Response will be null if no import found (200 status)
        setLastImport(lastImportResponse.data);
      } catch (error) {
        console.error('Error fetching last import:', error);
      }
    } catch (error) {
      toast.error('Error importing companies: ' + (error.response?.data?.message || error.message));
      setImportStep('preview');
    } finally {
      setImporting(false);
    }
  };

  const handleUndoImport = async (transactionId = null) => {
    const txId = transactionId || importTransactionId;
    if (!txId) {
      toast.error('No transaction ID available for undo');
      return;
    }

    if (!window.confirm('Are you sure you want to undo this import? This will delete all created companies and restore all updated companies to their previous state.')) {
      return;
    }

    try {
      setUndoing(true);
      const response = await api.post(`/api/companies/import/${txId}/undo`);

      const { deleted, restored, errors } = response.data;
      
      toast.success(`Import undone! Deleted: ${deleted}, Restored: ${restored}`);
      
      if (errors && errors.length > 0) {
        toast.warning(`Some errors occurred: ${errors.slice(0, 5).join(', ')}`);
      }

      setImportFile(null);
      setImportStep('upload');
      setImportPreview(null);
      setImportResults(null);
      setImportTransactionId(null);
      setLastImport(null); // Clear last import after undo
      
      // Refresh last import after undo (in case there's an older one)
      try {
        const response = await api.get('/api/companies/import/last');
        // Response will be null if no import found (200 status)
        setLastImport(response.data);
      } catch (error) {
        console.error('Error fetching last import:', error);
        setLastImport(null);
      }
    } catch (error) {
      toast.error('Error undoing import: ' + (error.response?.data?.message || error.message));
    } finally {
      setUndoing(false);
    }
  };

  const resetImport = () => {
    setImportFile(null);
    setImportStep('upload');
    setImportPreview(null);
    setImportResults(null);
    setImportTransactionId(null);
    setImporting(false);
    setUndoing(false);
    setPreviewFilter('all');
  };

  // Redirect if not administrator
  if (!isAdministrator()) {
    return (
      <div className="page page-center">
        <div className="container container-tight py-4">
          <div className="text-center">
            <h2>Access Denied</h2>
            <p className="text-muted">You do not have permission to access this page.</p>
            <button className="btn btn-primary" onClick={() => navigate('/')}>
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageTitle title="Import Data" />
      
      <div className="page-header d-print-none">
        <div className="container-fluid">
          <div className="row g-2 align-items-center">
            <div className="col">
              <h2 className="page-title">Import Data</h2>
              <div className="text-muted mt-1">Import company data from CSV, XLS, XLSX, or JSON files</div>
            </div>
            <div className="col-auto ms-auto">
              <div className="btn-list">
                <button
                  className="btn btn-secondary"
                  onClick={() => navigate('/companies')}
                >
                  Back to Companies
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Undo Last Import Banner */}
      {lastImport && (
        <div className="page-body">
          <div className="container-xl">
            <div className="alert alert-warning alert-dismissible" role="alert">
              <div className="d-flex align-items-center justify-content-between">
                <div>
                  <h4 className="alert-title">Last Import Available for Undo</h4>
                  <div className="text-muted">
                    Imported on {new Date(lastImport.createdAt).toLocaleString()} by {lastImport.user?.name || lastImport.user?.email || 'Unknown'}
                    {lastImport.importData?.fileName && ` • File: ${lastImport.importData.fileName}`}
                    {lastImport.createdCompanies?.length > 0 && ` • Created: ${lastImport.createdCompanies.length} companies`}
                    {lastImport.updatedCompanies?.length > 0 && ` • Updated: ${lastImport.updatedCompanies.length} companies`}
                  </div>
                </div>
                <div className="ms-3">
                  <button
                    className="btn btn-warning"
                    onClick={() => handleUndoImport(lastImport.id)}
                    disabled={undoing}
                  >
                    {undoing ? 'Undoing...' : 'Undo Last Import'}
                  </button>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => setLastImport(null)}
                    aria-label="Close"
                  ></button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="page-body">
        <div className="container-xl">
          <div className="card">
            <div className="card-body">
              {/* Step 1: File Upload */}
              {importStep === 'upload' && (
                <>
                  <div className="mb-3">
                    <label className="form-label">Select File (CSV, XLS, XLSX, or JSON)</label>
                    <input
                      type="file"
                      className="form-control"
                      accept=".csv,.xls,.xlsx,.json"
                      onChange={handleFileSelect}
                    />
                    <small className="form-hint">
                      Supported formats: CSV, XLS, XLSX, JSON. File size limit: 10MB
                    </small>
                  </div>
                  <div className="alert alert-info">
                    <h4>File Format Requirements:</h4>
                    <p className="mb-2"><strong>Required columns:</strong></p>
                    <ul className="mb-2">
                      <li><strong>account_no</strong> - Account Number (unique identifier for matching)</li>
                      <li><strong>parent_account_no</strong> - Parent's account number (empty for top-level CORP)</li>
                      <li><strong>company_name</strong> - Company Name (required)</li>
                      <li><strong>type</strong> - Company type: CORP, SUB, or BRANCH (required)</li>
                      <li><strong>active</strong> - Active status: TRUE or FALSE</li>
                      <li><strong>edi</strong> - EDI enabled: TRUE or FALSE (if TRUE, email notifications disabled)</li>
                      <li><strong>primary_email</strong> - Primary contact email (optional, creates notification contact)</li>
                    </ul>
                    <p className="mb-2"><strong>Note:</strong> Companies are matched by account_no. Existing companies will be updated.</p>
                    <p className="mb-0 text-muted small">Legacy column names (CUSTOMER, PARENT, CNME, TYPE) are also supported for backward compatibility.</p>
                  </div>
                </>
              )}

              {/* Step 2: Preview & Validation */}
              {importStep === 'preview' && importPreview && (() => {
                // Filter preview data based on selected filter
                const filteredPreview = importPreview.preview.filter(item => {
                  if (previewFilter === 'all') return true;
                  if (previewFilter === 'error') return item.status === 'error';
                  if (previewFilter === 'warning') return item.status === 'warning';
                  if (previewFilter === 'valid') return item.status === 'valid';
                  if (previewFilter === 'create') return item.action === 'create';
                  if (previewFilter === 'update') return item.action === 'update';
                  return true;
                });

                return (
                  <>
                    <div className="mb-3">
                      <h6>Import Preview</h6>
                      
                      <div className="row mb-3 g-2">
                        <div className="col-md-2">
                          <div className="card">
                            <div className="card-body text-center py-2">
                              <div className="h4 mb-0">{importPreview.summary.total}</div>
                              <div className="text-muted small">Total Rows</div>
                            </div>
                          </div>
                        </div>
                        <div className="col-md-2">
                          <div className="card">
                            <div className="card-body text-center py-2">
                              <div className="h4 mb-0 text-success">{importPreview.summary.toCreate}</div>
                              <div className="text-muted small">New Companies</div>
                            </div>
                          </div>
                        </div>
                        <div className="col-md-2">
                          <div className="card">
                            <div className="card-body text-center py-2">
                              <div className="h4 mb-0 text-info">{importPreview.summary.toUpdate}</div>
                              <div className="text-muted small">Updates</div>
                            </div>
                          </div>
                        </div>
                        <div className="col-md-2">
                          <div className="card">
                            <div className="card-body text-center py-2">
                              <div className="h4 mb-0 text-primary">{importPreview.summary.usersToCreate || 0}</div>
                              <div className="text-muted small">New Contacts</div>
                            </div>
                          </div>
                        </div>
                        <div className="col-md-2">
                          <div className="card">
                            <div className="card-body text-center py-2">
                              <div className="h4 mb-0 text-warning">{importPreview.summary.ediEnabled || 0}</div>
                              <div className="text-muted small">EDI Enabled</div>
                            </div>
                          </div>
                        </div>
                        <div className="col-md-2">
                          <div className="card">
                            <div className="card-body text-center py-2">
                              <div className="h4 mb-0 text-danger">{importPreview.summary.errors}</div>
                              <div className="text-muted small">Errors</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Filter Controls and Export */}
                      <div className="mb-3 d-flex justify-content-between align-items-center flex-wrap gap-2">
                        <div className="d-flex align-items-center gap-2 flex-wrap">
                          <label className="form-label mb-0">Filter:</label>
                          <select
                            className="form-select form-select-sm"
                            style={{ width: 'auto' }}
                            value={previewFilter}
                            onChange={(e) => setPreviewFilter(e.target.value)}
                          >
                            <option value="all">All ({importPreview.preview.length})</option>
                            <option value="valid">Valid ({importPreview.preview.filter(i => i.status === 'valid').length})</option>
                            <option value="warning">Warnings ({importPreview.preview.filter(i => i.status === 'warning').length})</option>
                            <option value="error">Errors ({importPreview.preview.filter(i => i.status === 'error').length})</option>
                            <option value="create">New Companies ({importPreview.preview.filter(i => i.action === 'create').length})</option>
                            <option value="update">Updates ({importPreview.preview.filter(i => i.action === 'update').length})</option>
                          </select>
                        </div>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => {
                            // Export preview data as CSV
                            const headers = ['Row', 'Type', 'Status', 'Action', 'Company Name', 'Account Number', 'Parent', 'Errors', 'Warnings'];
                            const rows = importPreview.preview.map(item => [
                              item.rowNum,
                              item.data.type || '',
                              item.status,
                              item.action,
                              item.data.name || '',
                              item.data.referenceNo || '',
                              item.parentName && item.parentRefNum 
                                ? `${item.parentName} (${item.parentRefNum})`
                                : item.parentRefNum === null && item.data.type === 'CORP'
                                ? 'Top Level'
                                : 'N/A',
                              item.errors.join('; ') || '',
                              item.warnings.join('; ') || ''
                            ]);
                            
                            const csvContent = [
                              headers.join(','),
                              ...rows.map(row => row.map(cell => {
                                // Escape commas and quotes in CSV
                                const cellStr = String(cell || '');
                                if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
                                  return `"${cellStr.replace(/"/g, '""')}"`;
                                }
                                return cellStr;
                              }).join(','))
                            ].join('\n');
                            
                            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                            const link = document.createElement('a');
                            const url = URL.createObjectURL(blob);
                            link.setAttribute('href', url);
                            link.setAttribute('download', `import-preview-${new Date().toISOString().split('T')[0]}.csv`);
                            link.style.visibility = 'hidden';
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                          }}
                        >
                          Export Preview
                        </button>
                      </div>

                      <div className="table-responsive" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                        <table className="table table-vcenter table-sm">
                          <thead>
                            <tr>
                              <th>Row</th>
                              <th>Type</th>
                              <th>Status</th>
                              <th>Action</th>
                              <th>Company Name</th>
                              <th>Account No</th>
                              <th>Parent</th>
                              <th>Primary Email</th>
                              <th>EDI</th>
                              <th>Issues</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredPreview.length === 0 ? (
                              <tr>
                                <td colSpan="10" className="text-center text-muted py-4">
                                  No rows match the selected filter
                                </td>
                              </tr>
                            ) : (
                              filteredPreview.map((item) => (
                              <tr key={item.rowNum}>
                                <td>{item.rowNum}</td>
                                <td>
                                  <span className={`badge ${item.data.type === 'CORP' ? 'bg-primary-lt' : item.data.type === 'SUB' ? 'bg-info-lt' : 'bg-success-lt'}`}>
                                    {item.data.type}
                                  </span>
                                </td>
                                <td>
                                  {item.status === 'error' && <span className="badge bg-danger-lt">Error</span>}
                                  {item.status === 'warning' && <span className="badge bg-warning-lt">Warning</span>}
                                  {item.status === 'valid' && <span className="badge bg-success-lt">Valid</span>}
                                </td>
                                <td>
                                  {item.action === 'create' && <span className="badge bg-success-lt">Create</span>}
                                  {item.action === 'update' && <span className="badge bg-info-lt">Update</span>}
                                </td>
                                <td><strong>{item.data.name}</strong></td>
                                <td>{item.data.referenceNo || 'N/A'}</td>
                                <td>
                                  {item.parentName && item.parentRefNum ? (
                                    <span className="small">{item.parentName} ({item.parentRefNum})</span>
                                  ) : item.parentRefNum === null && item.data.type === 'CORP' ? (
                                    <span className="text-muted small">Top Level</span>
                                  ) : (
                                    <span className="text-muted small">N/A</span>
                                  )}
                                </td>
                                <td>
                                  {item.primaryEmail ? (
                                    <div>
                                      <span className="small">{item.primaryEmail}</span>
                                      {item.userAction === 'create' && (
                                        <span className="badge bg-success-lt ms-1" style={{ fontSize: '10px' }}>New</span>
                                      )}
                                      {item.userAction === 'existing' && (
                                        <span className="badge bg-secondary-lt ms-1" style={{ fontSize: '10px' }}>Exists</span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-muted small">-</span>
                                  )}
                                </td>
                                <td>
                                  {item.data.edi ? (
                                    <span className="badge bg-warning-lt">Yes</span>
                                  ) : (
                                    <span className="text-muted small">No</span>
                                  )}
                                </td>
                                <td>
                                  {item.errors.length > 0 && (
                                    <div className="text-danger small">
                                      {item.errors.map((err, idx) => <div key={idx}>{err}</div>)}
                                    </div>
                                  )}
                                  {item.warnings.length > 0 && (
                                    <div className="text-warning small">
                                      {item.warnings.map((warn, idx) => <div key={idx}>{warn}</div>)}
                                    </div>
                                  )}
                                  {item.errors.length === 0 && item.warnings.length === 0 && <span className="text-success">✓</span>}
                                </td>
                              </tr>
                            ))
                            )}
                          </tbody>
                        </table>
                      </div>

                      <div className="mt-3 d-flex justify-content-between">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setImportStep('upload');
                            setImportFile(null);
                            setImportPreview(null);
                          }}
                          disabled={importing}
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={handleConfirmImport}
                          disabled={importing || importPreview.summary.errors > 0}
                        >
                          {importing ? 'Processing...' : 'Confirm Import'}
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* Step 3: Importing */}
              {importStep === 'importing' && (
                <div className="text-center py-5">
                  <div className="spinner-border text-primary mb-3" role="status">
                    <span className="visually-hidden">Loading...</span>
                  </div>
                  <div>Importing companies...</div>
                </div>
              )}

              {/* Step 4: Complete */}
              {importStep === 'complete' && importResults && (
                <>
                  <div className="alert alert-success">
                    <h5>Import Completed Successfully!</h5>
                    <p className="mb-0">
                      Companies Created: <strong>{importResults.created}</strong> | 
                      Updated: <strong>{importResults.updated}</strong> | 
                      {importResults.usersCreated > 0 && (
                        <>Contacts Created: <strong>{importResults.usersCreated}</strong> | </>
                      )}
                      Total Rows: <strong>{importResults.totalRows}</strong>
                    </p>
                  </div>
                  {importResults.errors.length > 0 && (
                    <div className="alert alert-warning">
                      <h6>Errors ({importResults.errors.length}):</h6>
                      <ul className="mb-0">
                        {importResults.errors.slice(0, 10).map((error, idx) => (
                          <li key={idx}>{error}</li>
                        ))}
                        {importResults.errors.length > 10 && (
                          <li>... and {importResults.errors.length - 10} more errors</li>
                        )}
                      </ul>
                    </div>
                  )}
                  <div className="mt-3 d-flex justify-content-end gap-2">
                    {importTransactionId && (
                      <button
                        type="button"
                        className="btn btn-warning"
                        onClick={handleUndoImport}
                        disabled={undoing}
                      >
                        {undoing ? 'Undoing...' : 'UNDO Import'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={resetImport}
                      disabled={undoing}
                    >
                      Import Another File
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => navigate('/companies')}
                      disabled={undoing}
                    >
                      Go to Companies
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImportData;

