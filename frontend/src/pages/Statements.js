import React, { useState, useEffect } from 'react';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import DocumentRetentionTimer from '../components/DocumentRetentionTimer';
import { useDebounce } from '../hooks/useDebounce';

const Statements = () => {
  const { user: currentUser } = useAuth();
  const { settings } = useSettings();
  const [statements, setStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [companies, setCompanies] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
  const debouncedSearch = useDebounce(searchQuery, 300);

  useEffect(() => {
    fetchStatements();
    fetchCompanies();
  }, [pagination.page, debouncedSearch, statusFilter, companyFilter]);

  const fetchStatements = async () => {
    try {
      setLoading(true);
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        search: debouncedSearch,
        ...(statusFilter !== 'all' && { status: statusFilter }),
        ...(companyFilter !== 'all' && { companyId: companyFilter })
      };
      
      const response = await api.get('/api/statements', { params });
      
      // Handle response structure
      if (response.data && response.data.data) {
        setStatements(response.data.data || []);
        setPagination(prev => ({
          ...prev,
          total: response.data.pagination?.total || 0,
          pages: response.data.pagination?.pages || 0
        }));
      } else {
        // Fallback if response structure is different
        setStatements(Array.isArray(response.data) ? response.data : []);
        setPagination(prev => ({
          ...prev,
          total: 0,
          pages: 0
        }));
      }
    } catch (error) {
      console.error('Error fetching statements:', error);
      console.error('Error response:', error.response?.data);
      setStatements([]);
      setPagination(prev => ({
        ...prev,
        total: 0,
        pages: 0
      }));
      toast.error('Error fetching statements: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  const fetchCompanies = async () => {
    try {
      const response = await api.get('/api/companies', { params: { limit: 1000 } });
      setCompanies(response.data);
    } catch (error) {
      console.error('Error fetching companies:', error);
    }
  };

  const getStatusBadgeClass = (status) => {
    const classes = {
      draft: 'bg-secondary',
      sent: 'bg-info',
      acknowledged: 'bg-success',
      disputed: 'bg-warning'
    };
    return classes[status] || 'bg-secondary';
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP'
    }).format(amount || 0);
  };

  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-GB');
  };

  const formatPeriod = (start, end) => {
    if (!start || !end) return '-';
    return `${formatDate(start)} - ${formatDate(end)}`;
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="container-xl">
          <div className="row g-2 align-items-center">
            <div className="col">
              <h2 className="page-title">Statements</h2>
            </div>
            <div className="col-auto ms-auto">
              {(currentUser?.role === 'global_admin' || 
                currentUser?.role === 'administrator' || 
                currentUser?.role === 'manager' || 
                currentUser?.role === 'staff') && (
                <button className="btn btn-primary">
                  <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                    <path d="M12 5l0 14" />
                    <path d="M5 12l14 0" />
                  </svg>
                  Add Statement
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="container-xl">
          <div className="card">
            <div className="card-header">
              <div className="row align-items-center">
                <div className="col">
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search statements..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPagination(prev => ({ ...prev, page: 1 }));
                    }}
                  />
                </div>
                <div className="col-auto">
                  <select
                    className="form-select"
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
                </div>
                <div className="col-auto">
                  <select
                    className="form-select"
                    value={companyFilter}
                    onChange={(e) => {
                      setCompanyFilter(e.target.value);
                      setPagination(prev => ({ ...prev, page: 1 }));
                    }}
                  >
                    <option value="all">All Companies</option>
                    {companies.map(company => (
                      <option key={company.id} value={company.id}>{company.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="table-responsive">
              <table className="table table-vcenter card-table">
                <thead>
                  <tr>
                    <th>Statement Number</th>
                    <th>Company</th>
                    <th>Period</th>
                    <th>Opening Balance</th>
                    <th>Closing Balance</th>
                    <th>Status</th>
                    {settings?.documentRetentionPeriod && <th>Retention</th>}
                    <th className="w-1">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={settings?.documentRetentionPeriod ? "8" : "7"} className="text-center py-3">
                        <div className="spinner-border spinner-border-sm" role="status">
                          <span className="visually-hidden">Loading...</span>
                        </div>
                      </td>
                    </tr>
                  ) : statements.length === 0 ? (
                    <tr>
                      <td colSpan={settings?.documentRetentionPeriod ? "8" : "7"} className="text-center py-3 text-muted">
                        No statements found
                      </td>
                    </tr>
                  ) : (
                    statements.map((statement) => (
                      <tr key={statement.id}>
                        <td>
                          <strong>{statement.statementNumber}</strong>
                        </td>
                        <td>
                          {statement.company ? statement.company.name : '-'}
                        </td>
                        <td>{formatPeriod(statement.periodStart, statement.periodEnd)}</td>
                        <td>{formatCurrency(statement.openingBalance)}</td>
                        <td>{formatCurrency(statement.closingBalance)}</td>
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
                          <div className="btn-list">
                            <button className="btn btn-sm" title="View">
                              View
                            </button>
                            {(currentUser?.role === 'global_admin' || 
                              currentUser?.role === 'administrator' || 
                              currentUser?.role === 'manager' || 
                              currentUser?.role === 'staff') && (
                              <>
                                <button className="btn btn-sm" title="Edit">
                                  Edit
                                </button>
                                <button className="btn btn-sm btn-danger" title="Delete">
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {pagination.pages > 1 && (
              <div className="card-footer d-flex align-items-center">
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
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Statements;

