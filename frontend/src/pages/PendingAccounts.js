import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import PageTitle from '../components/PageTitle';
import HierarchicalCompanyFilter from '../components/HierarchicalCompanyFilter';
import { getRoleLabel } from '../utils/roleLabels';

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
  const [formData, setFormData] = useState({
    allCompanies: false,
    companyIds: [],
    sendInvoiceEmail: false,
    sendInvoiceAttachment: false,
    sendStatementEmail: false,
    sendStatementAttachment: false,
    sendEmailAsSummary: false,
    sendImportSummaryReport: false
  });
  const [showCompanyAssignmentModal, setShowCompanyAssignmentModal] = useState(false);
  const [userAssignedCompanyObjects, setUserAssignedCompanyObjects] = useState([]);
  const [rejectionReason, setRejectionReason] = useState('');
  
  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingRegistration, setEditingRegistration] = useState(null);
  const [editFormData, setEditFormData] = useState({
    firstName: '',
    lastName: '',
    companyName: '',
    accountNumber: '',
    email: '',
    intendedRole: 'external_user'
  });
  const [saving, setSaving] = useState(false);
  const [manageableRoles, setManageableRoles] = useState([]);
  
  useEffect(() => {
    if (user?.role !== 'global_admin' && user?.role !== 'administrator') {
      navigate('/');
      return;
    }
    
    fetchManageableRoles();
    
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
      const companies = response.data?.data || response.data?.companies || response.data || [];
      setUserAssignedCompanyObjects(Array.isArray(companies) ? companies : []);
    } catch (error) {
      console.error('Error fetching companies:', error);
    }
  };
  
  const fetchManageableRoles = async () => {
    try {
      const response = await api.get('/api/users/roles/manageable');
      setManageableRoles(response.data.roles || []);
    } catch (error) {
      console.error('Error fetching manageable roles:', error);
    }
  };
  
  const handleOpenEditModal = (registration) => {
    setEditingRegistration(registration);
    setEditFormData({
      firstName: registration.firstName || '',
      lastName: registration.lastName || '',
      companyName: registration.companyName || '',
      accountNumber: registration.accountNumber || '',
      email: registration.email || '',
      intendedRole: registration.customFields?.intendedRole || 'external_user'
    });
    setShowEditModal(true);
  };
  
  const handleCloseEditModal = () => {
    setShowEditModal(false);
    setEditingRegistration(null);
    setEditFormData({
      firstName: '',
      lastName: '',
      companyName: '',
      accountNumber: '',
      email: '',
      intendedRole: 'external_user'
    });
  };
  
  const handleEditFormChange = (e) => {
    const { name, value } = e.target;
    setEditFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };
  
  const handleSaveEdit = async () => {
    if (!editingRegistration) return;
    
    // Validate required fields
    if (!editFormData.firstName.trim()) {
      toast.error('First name is required');
      return;
    }
    if (!editFormData.companyName.trim()) {
      toast.error('Company name is required');
      return;
    }
    if (!editFormData.email.trim()) {
      toast.error('Email is required');
      return;
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(editFormData.email)) {
      toast.error('Please enter a valid email address');
      return;
    }
    
    setSaving(true);
    try {
      await api.put(`/api/pending-registrations/${editingRegistration.id}`, editFormData);
      toast.success('Registration updated successfully');
      handleCloseEditModal();
      
      // Refresh data
      if (id) {
        fetchRegistration(id);
      } else {
        fetchRegistrations();
      }
    } catch (error) {
      console.error('Error updating registration:', error);
      toast.error(error.response?.data?.message || 'Failed to update registration');
    } finally {
      setSaving(false);
    }
  };
  
  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    
    // Handle conditional checkboxes
    if (name === 'sendInvoiceEmail' && !checked) {
      setFormData(prev => {
        const updated = { 
          ...prev, 
          [name]: checked,
          sendInvoiceAttachment: false 
        };
        if (!prev.sendStatementEmail) {
          updated.sendEmailAsSummary = false;
        }
        return updated;
      });
      return;
    }
    if (name === 'sendStatementEmail' && !checked) {
      setFormData(prev => {
        const updated = { 
          ...prev, 
          [name]: checked,
          sendStatementAttachment: false 
        };
        if (!prev.sendInvoiceEmail) {
          updated.sendEmailAsSummary = false;
        }
        return updated;
      });
      return;
    }
    
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleAllCompaniesToggle = (e) => {
    const isEnabled = e.target.checked;
    setFormData(prev => ({
      ...prev,
      allCompanies: isEnabled,
      companyIds: isEnabled ? [] : prev.companyIds
    }));
  };

  const handleCompanyAssignmentChange = (selectedIds) => {
    setFormData(prev => ({
      ...prev,
      companyIds: selectedIds
    }));
  };

  const handleApprove = async () => {
    if (!selectedRegistration) return;
    
    setApproving(true);
    try {
      // Use the intended role from customFields, or default to external_user
      const role = selectedRegistration.customFields?.intendedRole || 'external_user';
      
      await api.post(`/api/pending-registrations/${selectedRegistration.id}/approve`, {
        role: role,
        allCompanies: formData.allCompanies,
        companyIds: formData.allCompanies ? [] : formData.companyIds,
        sendInvoiceEmail: formData.sendInvoiceEmail,
        sendInvoiceAttachment: formData.sendInvoiceAttachment,
        sendStatementEmail: formData.sendStatementEmail,
        sendStatementAttachment: formData.sendStatementAttachment,
        sendEmailAsSummary: formData.sendEmailAsSummary,
        sendImportSummaryReport: formData.sendImportSummaryReport
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
      <>
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
                    {selectedRegistration.status === 'pending' && (
                      <div className="card-actions">
                        <button
                          className="btn btn-sm btn-outline-primary"
                          onClick={() => handleOpenEditModal(selectedRegistration)}
                        >
                          Edit
                        </button>
                      </div>
                    )}
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
                      {selectedRegistration.customFields?.intendedRole && (
                        <div className="list-group-item px-0 py-2">
                          <div className="d-flex justify-content-between">
                            <strong>Intended Role:</strong>
                            <span className="badge bg-primary-lt">
                              {getRoleLabel(selectedRegistration.customFields.intendedRole)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                    
                  </div>
                </div>
              </div>
              
              <div className="col-lg-4">
                {selectedRegistration.status === 'pending' && (
                  <div className="card">
                    <div className="card-header">
                      <h3 className="card-title">Account Setup</h3>
                    </div>
                    <div className="card-body">
                      <div className="row">
                        <div className="col-12">
                          <div className="mb-3">
                            <label className="form-label">User Role</label>
                            <input
                              type="text"
                              className="form-control"
                              value={getRoleLabel(selectedRegistration.customFields?.intendedRole || 'external_user')}
                              disabled
                            />
                            <small className="form-hint">Click "Edit" above to change the role before approval</small>
                          </div>
                        </div>
                      </div>
                      
                      <div className="row">
                        <div className="col-12 d-flex flex-column">
                          {/* Email Notifications - Compact Grid Layout */}
                          <div className="mb-4">
                            <label className="form-label">Email Notifications</label>
                            <div className="row g-2">
                              <div className="col-6">
                                <label className="row g-0 p-2 border" style={{ cursor: 'pointer' }}>
                                  <span className="col small">Upload Email</span>
                                  <span className="col-auto">
                                    <label className="form-check form-check-single form-switch mb-0">
                                      <input
                                        type="checkbox"
                                        className="form-check-input"
                                        name="sendInvoiceEmail"
                                        checked={formData.sendInvoiceEmail || false}
                                        onChange={handleInputChange}
                                      />
                                    </label>
                                  </span>
                                </label>
                              </div>
                              <div className="col-6">
                                <label 
                                  className="row g-0 p-2 border" 
                                  style={{ cursor: formData.sendInvoiceEmail ? 'pointer' : 'default', opacity: formData.sendInvoiceEmail ? 1 : 0.5 }}
                                >
                                  <span className="col small">With Attachment</span>
                                  <span className="col-auto">
                                    <label className="form-check form-check-single form-switch mb-0">
                                      <input
                                        type="checkbox"
                                        className="form-check-input"
                                        name="sendInvoiceAttachment"
                                        checked={formData.sendInvoiceAttachment || false}
                                        onChange={handleInputChange}
                                        disabled={!formData.sendInvoiceEmail}
                                      />
                                    </label>
                                  </span>
                                </label>
                              </div>
                              <div className="col-6">
                                <label className="row g-0 p-2 border" style={{ cursor: 'pointer' }}>
                                  <span className="col small">Statement Email</span>
                                  <span className="col-auto">
                                    <label className="form-check form-check-single form-switch mb-0">
                                      <input
                                        type="checkbox"
                                        className="form-check-input"
                                        name="sendStatementEmail"
                                        checked={formData.sendStatementEmail || false}
                                        onChange={handleInputChange}
                                      />
                                    </label>
                                  </span>
                                </label>
                              </div>
                              <div className="col-6">
                                <label 
                                  className="row g-0 p-2 border" 
                                  style={{ cursor: formData.sendStatementEmail ? 'pointer' : 'default', opacity: formData.sendStatementEmail ? 1 : 0.5 }}
                                >
                                  <span className="col small">With Attachment</span>
                                  <span className="col-auto">
                                    <label className="form-check form-check-single form-switch mb-0">
                                      <input
                                        type="checkbox"
                                        className="form-check-input"
                                        name="sendStatementAttachment"
                                        checked={formData.sendStatementAttachment || false}
                                        onChange={handleInputChange}
                                        disabled={!formData.sendStatementEmail}
                                      />
                                    </label>
                                  </span>
                                </label>
                              </div>
                              <div className="col-12">
                                <label 
                                  className="row g-0 p-2 border" 
                                  style={{ cursor: (formData.sendInvoiceEmail || formData.sendStatementEmail) ? 'pointer' : 'default', opacity: (formData.sendInvoiceEmail || formData.sendStatementEmail) ? 1 : 0.5 }}
                                >
                                  <span className="col small">Send as Summary</span>
                                  <span className="col-auto">
                                    <label className="form-check form-check-single form-switch mb-0">
                                      <input
                                        type="checkbox"
                                        className="form-check-input"
                                        name="sendEmailAsSummary"
                                        checked={formData.sendEmailAsSummary || false}
                                        onChange={handleInputChange}
                                        disabled={!formData.sendInvoiceEmail && !formData.sendStatementEmail}
                                      />
                                    </label>
                                  </span>
                                </label>
                              </div>
                            </div>
                            <small className="form-hint mt-1">Receive one summary email per import instead of individual emails</small>
                          </div>
                          
                          {/* Company Assignment */}
                          <h4 className="mb-3">Company Assignment</h4>
                          
                          {/* All Companies Toggle */}
                          <div className="mb-3">
                            <label className="row">
                              <span className="col">All Companies</span>
                              <span className="col-auto">
                                <label className="form-check form-check-single form-switch">
                                  <input
                                    className="form-check-input"
                                    type="checkbox"
                                    name="allCompanies"
                                    checked={formData.allCompanies || false}
                                    onChange={handleAllCompaniesToggle}
                                  />
                                </label>
                              </span>
                            </label>
                            {formData.allCompanies && (
                              <small className="text-muted d-block mt-2">
                                When enabled, this user can view all invoices, credit notes, and statements from all companies in the database, including any new companies added in the future. Individual company assignments are disabled.
                              </small>
                            )}
                          </div>
                          
                          {!formData.allCompanies && (
                            <>
                              <button
                                type="button"
                                className={`btn w-100 mb-3 ${formData.companyIds?.length > 0 ? 'btn-primary' : 'btn-outline-secondary'}`}
                                onClick={() => setShowCompanyAssignmentModal(true)}
                              >
                                {formData.companyIds?.length > 0 
                                  ? `${formData.companyIds.length} Compan${formData.companyIds.length !== 1 ? 'ies' : 'y'} Selected` 
                                  : 'Select Companies...'}
                              </button>
                              
                              {/* Show selected company names */}
                              {formData.companyIds?.length > 0 && formData.companyIds.length <= 10 && userAssignedCompanyObjects.length > 0 && (
                                <div className="d-flex flex-wrap gap-1 mb-2">
                                  {userAssignedCompanyObjects
                                    .filter(c => formData.companyIds.includes(c.id))
                                    .map(company => (
                                      <span key={company.id} className="badge bg-primary-lt">
                                        {company.name} {company.referenceNo && `(${company.referenceNo})`}
                                      </span>
                                    ))}
                                </div>
                              )}
                              
                              {formData.companyIds?.length > 10 && (
                                <div className="mb-2">
                                  <small className="text-muted">
                                    {formData.companyIds.length} companies selected
                                  </small>
                                </div>
                              )}
                            </>
                          )}
                          
                          {formData.allCompanies && (
                            <div className="flex-grow-1 d-flex align-items-center justify-content-center" style={{ minHeight: '250px', maxHeight: '300px', border: '1px solid #dee2e6', borderRadius: '4px', padding: '20px' }}>
                              <div className="text-center text-muted">
                                <p className="mb-0">All companies are assigned to this user.</p>
                                <p className="mb-0 small mt-2">Disable "All Companies" to assign specific companies.</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <hr className="my-4" />
                      
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
      {/* Company Assignment Modal */}
      {showCompanyAssignmentModal && (
        <HierarchicalCompanyFilter
          selectedCompanyIds={formData.companyIds || []}
          onSelectionChange={handleCompanyAssignmentChange}
          onClose={() => setShowCompanyAssignmentModal(false)}
          onApply={() => setShowCompanyAssignmentModal(false)}
        />
      )}
      
      {/* Edit Registration Modal */}
      {showEditModal && editingRegistration && (
        <div className="modal modal-blur show d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered" role="document">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Edit Registration</h5>
                <button type="button" className="btn-close" onClick={handleCloseEditModal}></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label required">First Name</label>
                  <input
                    type="text"
                    className="form-control"
                    name="firstName"
                    value={editFormData.firstName}
                    onChange={handleEditFormChange}
                    placeholder="Enter first name"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">Last Name</label>
                  <input
                    type="text"
                    className="form-control"
                    name="lastName"
                    value={editFormData.lastName}
                    onChange={handleEditFormChange}
                    placeholder="Enter last name"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label required">Company Name</label>
                  <input
                    type="text"
                    className="form-control"
                    name="companyName"
                    value={editFormData.companyName}
                    onChange={handleEditFormChange}
                    placeholder="Enter company name"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">Account Number</label>
                  <input
                    type="text"
                    className="form-control"
                    name="accountNumber"
                    value={editFormData.accountNumber}
                    onChange={handleEditFormChange}
                    placeholder="Enter account number"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label required">Email</label>
                  <input
                    type="email"
                    className="form-control"
                    name="email"
                    value={editFormData.email}
                    onChange={handleEditFormChange}
                    placeholder="Enter email address"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">User Role</label>
                  <select
                    className="form-select"
                    name="intendedRole"
                    value={editFormData.intendedRole}
                    onChange={handleEditFormChange}
                  >
                    {manageableRoles.map(role => (
                      <option key={role} value={role}>
                        {getRoleLabel(role)}
                      </option>
                    ))}
                  </select>
                  <small className="form-hint">Select the role this user will be assigned upon approval</small>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={handleCloseEditModal}>
                  Cancel
                </button>
                <button 
                  type="button" 
                  className="btn btn-primary" 
                  onClick={handleSaveEdit}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
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
                            <div className="btn-group">
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => navigate(`/users/pending-accounts/${reg.id}`)}
                              >
                                Review
                              </button>
                              {reg.status === 'pending' && (
                                <button
                                  className="btn btn-sm btn-outline-primary"
                                  onClick={() => handleOpenEditModal(reg)}
                                  title="Edit registration details"
                                >
                                  Edit
                                </button>
                              )}
                            </div>
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
      {/* Company Assignment Modal */}
      {showCompanyAssignmentModal && (
        <HierarchicalCompanyFilter
          selectedCompanyIds={formData.companyIds || []}
          onSelectionChange={handleCompanyAssignmentChange}
          onClose={() => setShowCompanyAssignmentModal(false)}
          onApply={() => setShowCompanyAssignmentModal(false)}
        />
      )}
      
      {/* Edit Registration Modal */}
      {showEditModal && editingRegistration && (
        <div className="modal modal-blur show d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered" role="document">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Edit Registration</h5>
                <button type="button" className="btn-close" onClick={handleCloseEditModal}></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label required">First Name</label>
                  <input
                    type="text"
                    className="form-control"
                    name="firstName"
                    value={editFormData.firstName}
                    onChange={handleEditFormChange}
                    placeholder="Enter first name"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">Last Name</label>
                  <input
                    type="text"
                    className="form-control"
                    name="lastName"
                    value={editFormData.lastName}
                    onChange={handleEditFormChange}
                    placeholder="Enter last name"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label required">Company Name</label>
                  <input
                    type="text"
                    className="form-control"
                    name="companyName"
                    value={editFormData.companyName}
                    onChange={handleEditFormChange}
                    placeholder="Enter company name"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">Account Number</label>
                  <input
                    type="text"
                    className="form-control"
                    name="accountNumber"
                    value={editFormData.accountNumber}
                    onChange={handleEditFormChange}
                    placeholder="Enter account number"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label required">Email</label>
                  <input
                    type="email"
                    className="form-control"
                    name="email"
                    value={editFormData.email}
                    onChange={handleEditFormChange}
                    placeholder="Enter email address"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">User Role</label>
                  <select
                    className="form-select"
                    name="intendedRole"
                    value={editFormData.intendedRole}
                    onChange={handleEditFormChange}
                  >
                    {manageableRoles.map(role => (
                      <option key={role} value={role}>
                        {getRoleLabel(role)}
                      </option>
                    ))}
                  </select>
                  <small className="form-hint">Select the role this user will be assigned upon approval</small>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={handleCloseEditModal}>
                  Cancel
                </button>
                <button 
                  type="button" 
                  className="btn btn-primary" 
                  onClick={handleSaveEdit}
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PendingAccounts;

