import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { getRoleLabel, getRoleBadgeClass } from '../utils/roleLabels';

const UserView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assignedCompanies, setAssignedCompanies] = useState([]);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordData, setPasswordData] = useState({
    password: '',
    confirmPassword: ''
  });
  const [passwordRequirements, setPasswordRequirements] = useState({
    minLength: false,
    hasUpperCase: false,
    hasLowerCase: false,
    hasNumber: false,
    hasSymbol: false
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    fetchUserDetails();
  }, [id]);

  const fetchUserDetails = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/api/users/${id}`);
      setUser(response.data);
      
      // Fetch assigned companies
      if (response.data.companies) {
        setAssignedCompanies(response.data.companies);
      } else {
        const companiesResponse = await api.get(`/api/users/${id}/companies`);
        setAssignedCompanies(companiesResponse.data.companies || []);
      }
    } catch (error) {
      console.error('Error fetching user details:', error);
      toast.error('Failed to load user details');
      navigate('/users');
    } finally {
      setLoading(false);
    }
  };


  const handleEdit = () => {
    navigate('/users', { state: { editUserId: id } });
  };

  // Password management functions
  const validatePassword = (password) => {
    setPasswordRequirements({
      minLength: password.length >= 8,
      hasUpperCase: /[A-Z]/.test(password),
      hasLowerCase: /[a-z]/.test(password),
      hasNumber: /[0-9]/.test(password),
      hasSymbol: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
    });
  };

  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setPasswordData(prev => ({ ...prev, [name]: value }));
    if (name === 'password') {
      validatePassword(value);
    }
  };

  const isPasswordValid = () => {
    return Object.values(passwordRequirements).every(req => req === true) && 
           passwordData.password === passwordData.confirmPassword &&
           passwordData.password.length > 0;
  };

  const generatePassword = () => {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const allChars = uppercase + lowercase + numbers + symbols;
    
    // Ensure at least one of each required character type
    let password = '';
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += symbols[Math.floor(Math.random() * symbols.length)];
    
    // Fill the rest to make it 12 characters
    for (let i = password.length; i < 12; i++) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }
    
    // Shuffle the password
    password = password.split('').sort(() => Math.random() - 0.5).join('');
    
    setPasswordData(prev => ({ ...prev, password, confirmPassword: password }));
    validatePassword(password);
  };

  const copyPassword = () => {
    if (passwordData.password) {
      navigator.clipboard.writeText(passwordData.password);
      toast.success('Password copied to clipboard!');
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!isPasswordValid()) {
      toast.error('Please ensure all password requirements are met');
      return;
    }

    try {
      await api.put(`/api/users/${id}/password`, {
        password: passwordData.password
      });
      toast.success('Password reset successfully!');
      setShowPasswordModal(false);
      setPasswordData({ password: '', confirmPassword: '' });
      setPasswordRequirements({
        minLength: false,
        hasUpperCase: false,
        hasLowerCase: false,
        hasNumber: false,
        hasSymbol: false
      });
      setShowPassword(false);
      setShowConfirmPassword(false);
    } catch (error) {
      toast.error('Error resetting password: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleResetWithTempPassword = async () => {
    if (!window.confirm('Reset password with temporary password? An email will be sent to the user.')) return;
    
    try {
      await api.post(`/api/users/${id}/reset-password`);
      toast.success('Temporary password generated and email sent to user!', 5000);
      fetchUserDetails();
    } catch (error) {
      toast.error('Error resetting password: ' + (error.response?.data?.message || error.message));
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

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <div className="container-xl">
            <div className="row g-2 align-items-center">
              <div className="col">
                <div className="page-pretitle">Loading...</div>
                <h2 className="page-title">User Details</h2>
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

  if (!user) {
    return (
      <div className="page">
        <div className="page-header">
          <div className="container-xl">
            <div className="row g-2 align-items-center">
              <div className="col">
                <h2 className="page-title">User Not Found</h2>
              </div>
            </div>
          </div>
        </div>
        <div className="page-body">
          <div className="container-xl">
            <div className="card">
              <div className="card-body text-center py-5">
                <p className="text-muted">The user you're looking for doesn't exist.</p>
                <button className="btn btn-primary" onClick={() => navigate('/users')}>
                  Back to Users
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
              <div className="page-pretitle">User Management</div>
              <h2 className="page-title">{user.name}</h2>
            </div>
            <div className="col-auto">
              <div className="btn-list">
                <button
                  className="btn btn-secondary"
                  onClick={() => navigate('/users')}
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
            {/* Left Column - User Details (67%) */}
            <div className="col-lg-8">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">User Details</h3>
                </div>
                <div className="card-body">
                  <div className="row mb-3">
                    <div className="col-md-4">
                      <strong>Name:</strong>
                    </div>
                    <div className="col-md-8">
                      {user.name}
                    </div>
                  </div>

                  <div className="row mb-3">
                    <div className="col-md-4">
                      <strong>Email:</strong>
                    </div>
                    <div className="col-md-8">
                      <a href={`mailto:${user.email}`}>{user.email}</a>
                    </div>
                  </div>

                  <div className="row mb-3">
                    <div className="col-md-4">
                      <strong>Role:</strong>
                    </div>
                    <div className="col-md-8">
                      <span className={`badge ${getRoleBadgeClass(user.role)}`}>
                        {getRoleLabel(user.role)}
                      </span>
                    </div>
                  </div>

                  <div className="row mb-3">
                    <div className="col-md-4">
                      <strong>Status:</strong>
                    </div>
                    <div className="col-md-8">
                      {user.isActive ? (
                        <span className="badge bg-success-lt">Active</span>
                      ) : (
                        <span className="badge bg-danger-lt">Inactive</span>
                      )}
                    </div>
                  </div>

                  <div className="row mb-3">
                    <div className="col-md-4">
                      <strong>2FA Enabled:</strong>
                    </div>
                    <div className="col-md-8">
                      {user.twoFactorEnabled ? (
                        <span className="badge bg-success-lt">Enabled</span>
                      ) : (
                        <span className="badge bg-secondary-lt">Disabled</span>
                      )}
                    </div>
                  </div>

                  <div className="row mb-3">
                    <div className="col-md-4">
                      <strong>Date Added:</strong>
                    </div>
                    <div className="col-md-8">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </div>
                  </div>

                  <div className="row mb-3">
                    <div className="col-md-4">
                      <strong>Last Login:</strong>
                    </div>
                    <div className="col-md-8">
                      {user.lastLogin
                        ? new Date(user.lastLogin).toLocaleDateString()
                        : 'Never'}
                    </div>
                  </div>

                  {user.addedByUser && (
                    <div className="row mb-3">
                      <div className="col-md-4">
                        <strong>Added By:</strong>
                      </div>
                      <div className="col-md-8">
                        {user.addedByUser.name} ({user.addedByUser.email})
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* Right Column - Assigned Companies (33%) */}
            <div className="col-lg-4">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Assigned Companies</h3>
                </div>
                <div className="card-body">
                  {user.allCompanies ? (
                    <div className="text-center py-4">
                      <span className="badge bg-info-lt">All Companies</span>
                    </div>
                  ) : assignedCompanies.length === 0 ? (
                    <div className="text-center text-muted py-4">
                      <p className="mb-0">No companies assigned</p>
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-sm">
                        <thead>
                          <tr>
                            <th>Company</th>
                            <th>Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {assignedCompanies.map((company) => (
                            <tr key={company.id}>
                              <td>
                                <div className="fw-medium">{company.name}</div>
                                {company.referenceNo && (
                                  <small className="text-muted">#{company.referenceNo}</small>
                                )}
                              </td>
                              <td>
                                <span className={`badge ${getTypeBadgeClass(company.type)}`}>
                                  {getTypeLabel(company.type)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Password Management Modal */}
      {showPasswordModal && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Manage Password for {user.name}</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowPasswordModal(false);
                    setPasswordData({ password: '', confirmPassword: '' });
                    setPasswordRequirements({
                      minLength: false,
                      hasUpperCase: false,
                      hasLowerCase: false,
                      hasNumber: false,
                      hasSymbol: false
                    });
                    setShowPassword(false);
                    setShowConfirmPassword(false);
                  }}
                ></button>
              </div>
              <form onSubmit={handleResetPassword}>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label">New Password</label>
                    <div className="input-group">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        className="form-control"
                        name="password"
                        value={passwordData.password}
                        onChange={handlePasswordChange}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        className="btn btn-outline-secondary"
                        onClick={() => setShowPassword(!showPassword)}
                        title={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                            <line x1="1" y1="1" x2="23" y2="23"></line>
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                          </svg>
                        )}
                      </button>
                      {passwordData.password && (
                        <button
                          type="button"
                          className="btn btn-outline-secondary"
                          onClick={copyPassword}
                          title="Copy password"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>
                        </button>
                      )}
                    </div>
                    <div className="mt-2">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-info mb-2"
                        onClick={generatePassword}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="me-1">
                          <path d="M21 12v1a10 10 0 1 1-9-10"></path>
                          <path d="M12 3v9"></path>
                          <path d="M21 12h-9"></path>
                        </svg>
                        Generate Password
                      </button>
                      {passwordData.password && (
                        <div className="d-flex flex-wrap gap-2">
                          <div className={`badge ${passwordRequirements.minLength ? 'bg-success-lt' : 'bg-secondary-lt'}`}>
                            {passwordRequirements.minLength ? '✓' : '✗'} 8+ Characters
                          </div>
                          <div className={`badge ${passwordRequirements.hasUpperCase ? 'bg-success-lt' : 'bg-secondary-lt'}`}>
                            {passwordRequirements.hasUpperCase ? '✓' : '✗'} Uppercase
                          </div>
                          <div className={`badge ${passwordRequirements.hasLowerCase ? 'bg-success-lt' : 'bg-secondary-lt'}`}>
                            {passwordRequirements.hasLowerCase ? '✓' : '✗'} Lowercase
                          </div>
                          <div className={`badge ${passwordRequirements.hasNumber ? 'bg-success-lt' : 'bg-secondary-lt'}`}>
                            {passwordRequirements.hasNumber ? '✓' : '✗'} Number
                          </div>
                          <div className={`badge ${passwordRequirements.hasSymbol ? 'bg-success-lt' : 'bg-secondary-lt'}`}>
                            {passwordRequirements.hasSymbol ? '✓' : '✗'} Symbol
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Confirm Password</label>
                    <div className="input-group">
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        className="form-control"
                        name="confirmPassword"
                        value={passwordData.confirmPassword}
                        onChange={handlePasswordChange}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        className="btn btn-outline-secondary"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        title={showConfirmPassword ? 'Hide password' : 'Show password'}
                      >
                        {showConfirmPassword ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                            <line x1="1" y1="1" x2="23" y2="23"></line>
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                          </svg>
                        )}
                      </button>
                    </div>
                    {passwordData.confirmPassword && passwordData.password !== passwordData.confirmPassword && (
                      <small className="text-danger">Passwords do not match</small>
                    )}
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      setShowPasswordModal(false);
                      setPasswordData({ password: '', confirmPassword: '' });
                      setPasswordRequirements({
                        minLength: false,
                        hasUpperCase: false,
                        hasLowerCase: false,
                        hasNumber: false,
                        hasSymbol: false
                      });
                      setShowPassword(false);
                      setShowConfirmPassword(false);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-info"
                    onClick={handleResetWithTempPassword}
                  >
                    Reset With Temporary Password
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={!isPasswordValid()}
                  >
                    Reset Password
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserView;

