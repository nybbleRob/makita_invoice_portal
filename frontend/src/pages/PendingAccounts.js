import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import PageTitle from '../components/PageTitle';

const PendingAccounts = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams();
  const [registrations, setRegistrations] = useState([]);
  const [selectedRegistration, setSelectedRegistration] = useState(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  
  // Approval form state
  const [role, setRole] = useState('external_user');
  const [companyIds, setCompanyIds] = useState([]);
  const [availableCompanies, setAvailableCompanies] = useState([]);
  const [rejectionReason, setRejectionReason] = useState('');
  
  useEffect(() => {
    if (user?.role !== 'global_admin' && user?.role !== 'administrator') {
      navigate('/');
      return;
    }
    
    if (id) {
      fetchRegistration(id);
    } else {
      fetchRegistrations();
      fetchCompanies();
    }
  }, [user, id, statusFilter, page]);
  
  const fetchRegistrations = async () => {
    try {
      setLoading(true);
      const response = await api.get('/api/pending-registrations', {
        params: { status: statusFilter, page, limit: 50 }
      });
      setRegistrations(response.data.registrations || []);
      setTotalPages(response.data.totalPages || 1);
    } catch (error) {
      console.error('Error fetching registrations:', error);
      toast.error('Failed to load pending registrations');
    } finally {
      setLoading(false);
    }
  };
  
  const fetchRegistration = async (registrationId) => {
    try {
      setLoading(true);
      const response = await api.get(`/api/pending-registrations/${registrationId}`);
      setSelectedRegistration(response.data);
      fetchCompanies();
    } catch (error) {
      console.error('Error fetching registration:', error);
      toast.error('Failed to load registration details');
      navigate('/users/pending-accounts');
    } finally {
      setLoading(false);
    }
  };
  
  const fetchCompanies = async () => {
    try {
      const response = await api.get('/api/companies');
      setAvailableCompanies(response.data || []);
    } catch (error) {
      console.error('Error fetching companies:', error);
    }
  };
  
  const handleApprove = async () => {
    if (!selectedRegistration) return;
    
    if (!role) {
      toast.error('Please select a role');
      return;
    }
    
    setApproving(true);
    try {
      await api.post(`/api/pending-registrations/${selectedRegistration.id}/approve`, {
        role,
        companyIds
      });
      
      toast.success('Registration approved and user created successfully');
      navigate('/users/pending-accounts');
      fetchRegistrations();
    } catch (error) {
      console.error('Error approving registration:', error);
      toast.error(error.response?.data?.message || 'Failed to approve registration');
    } finally {
      setApproving(false);
    }
  };
  
  const handleReject = async () => {
    if (!selectedRegistration) return;
    
    if (!rejectionReason.trim()) {
      toast.error('Please provide a reason for rejection');
      return;
    }
    
    setRejecting(true);
    try {
      await api.post(`/api/pending-registrations/${selectedRegistration.id}/reject`, {
        rejectionReason: rejectionReason.trim()
      });
      
      toast.success('Registration rejected successfully');
      navigate('/users/pending-accounts');
      fetchRegistrations();
    } catch (error) {
      console.error('Error rejecting registration:', error);
      toast.error(error.response?.data?.message || 'Failed to reject registration');
    } finally {
      setRejecting(false);
    }
  };
  
  const getStatusBadge = (status) => {
    const badges = {
      pending: <span className="badge bg-warning-lt">Pending</span>,
      approved: <span className="badge bg-success-lt">Approved</span>,
      rejected: <span className="badge bg-danger-lt">Rejected</span>
    };
    return badges[status] || badges.pending;
  };
  
  if (id && selectedRegistration) {
    // Detail view
    
    return (
      <div className="page">
        <PageTitle title="Review Registration" />
        <div className="page-header">
          <div className="container-xl">
            <div className="row g-2 align-items-center">
              <div className="col">
                <h2 className="page-title">Review Registration Request</h2>
              </div>
              <div className="col-auto">
                <button
                  className="btn btn-secondary"
                  onClick={() => navigate('/users/pending-accounts')}
                >
                  Back to List
                </button>
              </div>
            </div>
          </div>
        </div>
        
        <div className="page-body">
          <div className="container-xl">
            <div className="row">
              <div className="col-lg-8">
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title">Registration Details</h3>
                  </div>
                  <div className="card-body">
                    <div className="list-group list-group-flush">
                      <div className="list-group-item px-0 py-2">
                        <div className="d-flex justify-content-between">
                          <strong>First Name:</strong>
                          <span>{selectedRegistration.firstName}</span>
                        </div>
                      </div>
                      <div className="list-group-item px-0 py-2">
                        <div className="d-flex justify-content-between">
                          <strong>Last Name:</strong>
                          <span>{selectedRegistration.lastName || 'N/A'}</span>
                        </div>
                      </div>
                      <div className="list-group-item px-0 py-2">
                        <div className="d-flex justify-content-between">
                          <strong>Company Name:</strong>
                          <span>{selectedRegistration.companyName}</span>
                        </div>
                      </div>
                      <div className="list-group-item px-0 py-2">
                        <div className="d-flex justify-content-between">
                          <strong>Account Number:</strong>
                          <span>{selectedRegistration.accountNumber || 'N/A'}</span>
                        </div>
                      </div>
                      <div className="list-group-item px-0 py-2">
                        <div className="d-flex justify-content-between">
                          <strong>Email:</strong>
                          <span>{selectedRegistration.email}</span>
                        </div>
                      </div>
                      <div className="list-group-item px-0 py-2">
                        <div className="d-flex justify-content-between">
                          <strong>Status:</strong>
                          {getStatusBadge(selectedRegistration.status)}
                        </div>
                      </div>
                      <div className="list-group-item px-0 py-2">
                        <div className="d-flex justify-content-between">
                          <strong>Submitted:</strong>
                          <span>{new Date(selectedRegistration.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                    
                  </div>
                </div>
              </div>
              
              <div className="col-lg-4">
                {selectedRegistration.status === 'pending' && (
                  <div className="card">
                    <div className="card-header">
                      <h3 className="card-title">Actions</h3>
                    </div>
                    <div className="card-body">
                      <div className="mb-3">
                        <label className="form-label">User Role</label>
                        <select
                          className="form-select"
                          value={role}
                          onChange={(e) => setRole(e.target.value)}
                        >
                          <option value="external_user">External User</option>
                          <option value="staff">Staff</option>
                          <option value="manager">Manager</option>
                        </select>
                      </div>
                      
                      <div className="mb-3">
                        <label className="form-label">Assign to Companies</label>
                        <select
                          className="form-select"
                          multiple
                          value={companyIds}
                          onChange={(e) => {
                            const selected = Array.from(e.target.selectedOptions, option => option.value);
                            setCompanyIds(selected);
                          }}
                          size={5}
                        >
                          {availableCompanies.map(company => (
                            <option key={company.id} value={company.id}>
                              {company.name} {company.referenceNo ? `(${company.referenceNo})` : ''}
                            </option>
                          ))}
                        </select>
                        <small className="form-hint">Hold Ctrl/Cmd to select multiple companies</small>
                      </div>
                      
                      <div className="d-flex gap-2">
                        <button
                          className="btn btn-success"
                          onClick={handleApprove}
                          disabled={approving}
                          style={{ flex: 1 }}
                        >
                          {approving ? 'Approving...' : 'Approve'}
                        </button>
                        <button
                          className="btn btn-danger"
                          onClick={() => {
                            const reason = prompt('Please provide a reason for rejection:');
                            if (reason) {
                              setRejectionReason(reason);
                              handleReject();
                            }
                          }}
                          disabled={rejecting}
                          style={{ flex: 1 }}
                        >
                          {rejecting ? 'Rejecting...' : 'Reject'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  // List view
  return (
    <div className="page">
      <PageTitle title="Pending Accounts" />
      <div className="page-header">
        <div className="container-xl">
          <div className="row g-2 align-items-center">
            <div className="col">
              <h2 className="page-title">Pending Account Registrations</h2>
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
                  <h3 className="card-title">Registrations</h3>
                </div>
                <div className="col-auto">
                  <select
                    className="form-select form-select-sm"
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
              </div>
            </div>
            
            {loading ? (
              <div className="card-body text-center py-5">
                <div className="spinner-border" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
              </div>
            ) : registrations.length === 0 ? (
              <div className="card-body text-center py-5">
                <p className="text-muted">No registrations found</p>
              </div>
            ) : (
              <>
                <div className="table-responsive">
                  <table className="table table-vcenter">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Company</th>
                        <th>Account Number</th>
                        <th>Status</th>
                        <th>Submitted</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {registrations.map(reg => (
                        <tr key={reg.id}>
                          <td>{`${reg.firstName} ${reg.lastName || ''}`.trim()}</td>
                          <td>{reg.email}</td>
                          <td>{reg.companyName}</td>
                          <td>{reg.accountNumber || 'N/A'}</td>
                          <td>{getStatusBadge(reg.status)}</td>
                          <td>{new Date(reg.createdAt).toLocaleString()}</td>
                          <td>
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => navigate(`/users/pending-accounts/${reg.id}`)}
                            >
                              Review
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {totalPages > 1 && (
                  <div className="card-footer">
                    <div className="d-flex justify-content-between align-items-center">
                      <div>
                        <span className="text-muted">
                          Page {page} of {totalPages}
                        </span>
                      </div>
                      <div className="btn-group">
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => setPage(p => Math.max(1, p - 1))}
                          disabled={page === 1}
                        >
                          Previous
                        </button>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                          disabled={page === totalPages}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PendingAccounts;

