import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
const CompanyView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [company, setCompany] = useState(null);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ancestors, setAncestors] = useState([]);
  const [assignedUsers, setAssignedUsers] = useState([]);

  useEffect(() => {
    fetchCompanyDetails();
  }, [id]);

  const fetchCompanyDetails = async () => {
    try {
      setLoading(true);
      // Fetch company with relationships
      const response = await api.get(`/api/companies/${id}/relationships`);
      setCompany(response.data.company);
      setChildren(response.data.descendants || []);
      setAncestors(response.data.ancestors || []);
      
      // Fetch users assigned to this company
      try {
        const usersResponse = await api.get('/api/users', { params: { companyIds: id } });
        setAssignedUsers(usersResponse.data.users || usersResponse.data || []);
      } catch (userError) {
        console.error('Error fetching assigned users:', userError);
        setAssignedUsers([]);
      }
    } catch (error) {
      console.error('Error fetching company details:', error);
      toast.error('Failed to load company details');
      navigate('/companies');
    } finally {
      setLoading(false);
    }
  };
  
  const getRoleBadgeClass = (role) => {
    const classes = {
      global_admin: 'bg-red-lt',
      administrator: 'bg-purple-lt',
      manager: 'bg-blue-lt',
      staff: 'bg-green-lt',
      external_user: 'bg-yellow-lt',
      notification_contact: 'bg-cyan-lt'
    };
    return classes[role] || 'bg-secondary-lt';
  };
  
  const getRoleLabel = (role) => {
    const labels = {
      global_admin: 'Global Admin',
      administrator: 'Administrator',
      manager: 'Manager',
      staff: 'Staff',
      external_user: 'External User',
      notification_contact: 'Notification Contact'
    };
    return labels[role] || role || 'Unknown';
  };

  const [settingPrimary, setSettingPrimary] = useState(null);

  const handleSetPrimaryContact = async (userId) => {
    try {
      setSettingPrimary(userId);
      await api.put(`/api/companies/${id}`, { primaryContactId: userId });
      toast.success('Primary contact updated successfully');
      // Refresh company data
      fetchCompanyDetails();
    } catch (error) {
      console.error('Error setting primary contact:', error);
      toast.error(error.response?.data?.message || 'Failed to set primary contact');
    } finally {
      setSettingPrimary(null);
    }
  };

  const getTypeBadgeClass = (type) => {
    const classes = {
      'CORP': 'bg-primary-lt',
      'SUB': 'bg-info-lt',
      'BRANCH': 'bg-success-lt'
    };
    return classes[type] || 'bg-secondary-lt';
  };

  const getTypeLabel = (type) => {
    const labels = {
      'CORP': 'Corporate',
      'SUB': 'Subsidiary',
      'BRANCH': 'Branch'
    };
    return labels[type] || type || 'N/A';
  };

  const handleEdit = () => {
    // Navigate back to companies page and trigger edit modal
    navigate('/companies', { state: { editCompanyId: id } });
  };

  const renderChildrenList = (childrenList, level = 0) => {
    if (!childrenList || childrenList.length === 0) {
      return (
        <div className="text-center text-muted py-4">
          <p className="mb-0">No child companies</p>
        </div>
      );
    }
    
    return (
      <ul style={{ listStyle: 'none', paddingLeft: level > 0 ? '20px' : '0', margin: 0 }}>
        {childrenList.map((child) => (
          <li key={child.id} style={{ marginBottom: '12px' }}>
            <div className="card" style={{ marginBottom: '8px' }}>
              <div className="card-body py-2">
                <div className="d-flex align-items-center justify-content-between">
                  <div className="d-flex align-items-center gap-2">
                    <span className={`badge ${getTypeBadgeClass(child.type)}`}>
                      {getTypeLabel(child.type)}
                    </span>
                    <strong>{child.name}</strong>
                    {child.referenceNo && (
                      <span className="text-muted">({child.referenceNo})</span>
                    )}
                  </div>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => navigate(`/companies/${child.id}/view`)}
                  >
                    View
                  </button>
                </div>
              </div>
            </div>
            {child.children && child.children.length > 0 && (
              <div style={{ marginLeft: '20px', marginTop: '8px' }}>
                {renderChildrenList(child.children, level + 1)}
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  };

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <div className="container-xl">
            <div className="row g-2 align-items-center">
              <div className="col">
                <div className="page-pretitle">Loading...</div>
                <h2 className="page-title">Company Details</h2>
              </div>
            </div>
          </div>
        </div>
        <div className="page-body">
          <div className="container-xl">
            <div className="text-center py-5">
              <div className="spinner-border" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="page">
        <div className="page-header">
          <div className="container-xl">
            <div className="row g-2 align-items-center">
              <div className="col">
                <h2 className="page-title">Company Not Found</h2>
              </div>
            </div>
          </div>
        </div>
        <div className="page-body">
          <div className="container-xl">
            <div className="card">
              <div className="card-body text-center py-5">
                <p className="text-muted">The company you're looking for doesn't exist.</p>
                <button className="btn btn-primary" onClick={() => navigate('/companies')}>
                  Back to Companies
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div className="container-xl">
          <div className="row g-2 align-items-center">
            <div className="col">
              <div className="page-pretitle">Company Management</div>
              <h2 className="page-title">{company.name}</h2>
            </div>
            <div className="col-auto">
              <div className="btn-list">
                <button
                  className="btn btn-secondary"
                  onClick={() => navigate('/companies')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m12 19-7-7 7-7"></path>
                    <path d="M19 12H5"></path>
                  </svg>
                  Back
                </button>
                <button
                  className="btn btn-info"
                  onClick={handleEdit}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                  Edit
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="container-xl">
          <div className="row">
            {/* Left Column - Company Details (67%) */}
            <div className="col-lg-8">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Company Details</h3>
                </div>
                <div className="card-body">
                  <div className="row mb-3">
                    <div className="col-md-4">
                      <strong>Company Name:</strong>
                    </div>
                    <div className="col-md-8">
                      {company.name}
                    </div>
                  </div>

                  <div className="row mb-3">
                    <div className="col-md-4">
                      <strong>Type:</strong>
                    </div>
                    <div className="col-md-8">
                      <span className={`badge ${getTypeBadgeClass(company.type)}`}>
                        {getTypeLabel(company.type)}
                      </span>
                    </div>
                  </div>

                  {company.referenceNo && (
                    <div className="row mb-3">
                      <div className="col-md-4">
                        <strong>Account Number:</strong>
                      </div>
                      <div className="col-md-8">
                        {company.referenceNo}
                      </div>
                    </div>
                  )}

                  {company.code && (
                    <div className="row mb-3">
                      <div className="col-md-4">
                        <strong>Company Code:</strong>
                      </div>
                      <div className="col-md-8">
                        {company.code}
                      </div>
                    </div>
                  )}

                  {company.email && (
                    <div className="row mb-3">
                      <div className="col-md-4">
                        <strong>Email:</strong>
                      </div>
                      <div className="col-md-8">
                        <a href={`mailto:${company.email}`}>{company.email}</a>
                      </div>
                    </div>
                  )}

                  {company.globalSystemEmail && (
                    <div className="row mb-3">
                      <div className="col-md-4">
                        <strong>Global System Email:</strong>
                      </div>
                      <div className="col-md-8">
                        <a href={`mailto:${company.globalSystemEmail}`}>{company.globalSystemEmail}</a>
                      </div>
                    </div>
                  )}

                  {company.phone && (
                    <div className="row mb-3">
                      <div className="col-md-4">
                        <strong>Phone:</strong>
                      </div>
                      <div className="col-md-8">
                        <a href={`tel:${company.phone}`}>{company.phone}</a>
                      </div>
                    </div>
                  )}

                  {company.address && (
                    <div className="row mb-3">
                      <div className="col-md-4">
                        <strong>Address:</strong>
                      </div>
                      <div className="col-md-8">
                        {company.address.line1 && <div>{company.address.line1}</div>}
                        {company.address.line2 && <div>{company.address.line2}</div>}
                        <div>
                          {company.address.city && company.address.city}
                          {company.address.city && company.address.state && ', '}
                          {company.address.state && company.address.state}
                          {company.address.zip && ` ${company.address.zip}`}
                        </div>
                        {company.address.country && <div>{company.address.country}</div>}
                      </div>
                    </div>
                  )}

                  {company.taxId && (
                    <div className="row mb-3">
                      <div className="col-md-4">
                        <strong>Tax ID:</strong>
                      </div>
                      <div className="col-md-8">
                        {company.taxId}
                      </div>
                    </div>
                  )}

                  {company.vatNumber && (
                    <div className="row mb-3">
                      <div className="col-md-4">
                        <strong>VAT Number:</strong>
                      </div>
                      <div className="col-md-8">
                        {company.vatNumber}
                      </div>
                    </div>
                  )}

                  {company.website && (
                    <div className="row mb-3">
                      <div className="col-md-4">
                        <strong>Website:</strong>
                      </div>
                      <div className="col-md-8">
                        <a href={company.website} target="_blank" rel="noopener noreferrer">
                          {company.website}
                        </a>
                      </div>
                    </div>
                  )}

                  <div className="row mb-3">
                    <div className="col-md-4">
                      <strong>EDI Enabled:</strong>
                    </div>
                    <div className="col-md-8">
                      {company.edi ? (
                        <span className="badge bg-info-lt">Yes</span>
                      ) : (
                        <span className="badge bg-secondary-lt">No</span>
                      )}
                    </div>
                  </div>

                  <div className="row mb-3">
                    <div className="col-md-4">
                      <strong>Status:</strong>
                    </div>
                    <div className="col-md-8">
                      {company.isActive ? (
                        <span className="badge bg-success-lt">Active</span>
                      ) : (
                        <span className="badge bg-danger-lt">Inactive</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column - Company Hierarchy (33%) */}
            <div className="col-lg-4">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Company Hierarchy</h3>
                </div>
                <div className="card-body">
                  {/* Parent Companies */}
                  {ancestors.length > 0 && (
                    <div className="mb-4">
                      <h6 className="mb-2">Parent Companies</h6>
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {ancestors.map((ancestor, index) => (
                          <li key={ancestor.id} style={{ marginBottom: index < ancestors.length - 1 ? '12px' : '0' }}>
                            <div className="card" style={{ marginBottom: '8px' }}>
                              <div className="card-body py-2">
                                <div className="d-flex align-items-center justify-content-between">
                                  <div className="d-flex align-items-center gap-2">
                                    <span className={`badge ${getTypeBadgeClass(ancestor.type)}`}>
                                      {getTypeLabel(ancestor.type)}
                                    </span>
                                    <strong>{ancestor.name}</strong>
                                    {ancestor.referenceNo && (
                                      <span className="text-muted">({ancestor.referenceNo})</span>
                                    )}
                                  </div>
                                  <button
                                    className="btn btn-sm btn-outline-primary"
                                    onClick={() => navigate(`/companies/${ancestor.id}/view`)}
                                  >
                                    View
                                  </button>
                                </div>
                              </div>
                            </div>
                            {index < ancestors.length - 1 && (
                              <div className="text-center my-2">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="6 9 12 15 18 9"></polyline>
                                </svg>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {/* Current Company */}
                  <div className="mb-4">
                    <h6 className="mb-2">Current Company</h6>
                    <div className="card bg-primary-lt" style={{ marginBottom: '8px' }}>
                      <div className="card-body py-2">
                        <div className="d-flex align-items-center gap-2">
                          <span className={`badge ${getTypeBadgeClass(company.type)}`}>
                            {getTypeLabel(company.type)}
                          </span>
                          <strong>{company.name}</strong>
                          {company.referenceNo && (
                            <span className="text-muted">({company.referenceNo})</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Child Companies */}
                  {children.length > 0 && (
                    <div>
                      <h6 className="mb-2">Child Companies</h6>
                      {renderChildrenList(children)}
                    </div>
                  )}
                  
                  {/* No relationships */}
                  {ancestors.length === 0 && children.length === 0 && (
                    <div className="text-center text-muted py-4">
                      <p className="mb-0">No company relationships</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Assigned Users */}
              <div className="card mt-3">
                <div className="card-header">
                  <h3 className="card-title">Assigned Users</h3>
                  <div className="card-actions">
                    <span className="badge bg-secondary-lt">{assignedUsers.length} user(s)</span>
                  </div>
                </div>
                <div className="card-body">
                  {assignedUsers.length === 0 ? (
                    <div className="text-center text-muted py-4">
                      <p className="mb-0">No users assigned to this company</p>
                    </div>
                  ) : (
                    <div className="list-group list-group-flush">
                      {assignedUsers.map((user) => {
                        const isPrimaryContact = company.primaryContactId === user.id;
                        return (
                          <div key={user.id} className="list-group-item d-flex align-items-center justify-content-between py-2">
                            <div className="d-flex align-items-center gap-2">
                              <div className="avatar avatar-sm" style={{ backgroundColor: isPrimaryContact ? '#f59f00' : '#206bc4' }}>
                                {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
                              </div>
                              <div>
                                <div className="fw-bold">
                                  {user.name || 'Unknown'}
                                  {isPrimaryContact && (
                                    <span className="badge bg-warning-lt text-warning ms-2" style={{ fontSize: '10px' }}>
                                      Primary Contact
                                    </span>
                                  )}
                                </div>
                                <div className="text-muted small">{user.email}</div>
                              </div>
                            </div>
                            <div className="d-flex align-items-center gap-2">
                              <span className={`badge ${getRoleBadgeClass(user.role)}`}>
                                {getRoleLabel(user.role)}
                              </span>
                              {!isPrimaryContact && (
                                <button
                                  className="btn btn-sm btn-outline-warning"
                                  onClick={() => handleSetPrimaryContact(user.id)}
                                  disabled={settingPrimary === user.id}
                                  title="Set as Primary Contact"
                                >
                                  {settingPrimary === user.id ? (
                                    <span className="spinner-border spinner-border-sm" role="status"></span>
                                  ) : (
                                    'Make Primary'
                                  )}
                                </button>
                              )}
                              <button
                                className="btn btn-sm btn-outline-primary"
                                onClick={() => navigate(`/users/${user.id}/view`)}
                              >
                                View
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompanyView;

