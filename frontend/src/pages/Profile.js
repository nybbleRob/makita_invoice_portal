import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { getRoleLabel } from '../utils/roleLabels';
import { getInitials, getAvatarColorClass } from '../utils/avatar';
import { useAuth } from '../context/AuthContext';

const Profile = () => {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('profile');
  const [, setAssignedCompanies] = useState([]);
  const [formData, setFormData] = useState({
    name: '',
    email: ''
  });
  const [emailChangeData, setEmailChangeData] = useState({
    newEmail: '',
    pendingEmail: null
  });
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [saving, setSaving] = useState(false);
  const [twoFactorData, setTwoFactorData] = useState({
    resetPassword: ''
  });
  const [resetting2FA, setResetting2FA] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const response = await api.get('/api/profile');
      setProfile(response.data);
      setFormData({
        name: response.data.name,
        email: response.data.email
      });
      setEmailChangeData({
        newEmail: '',
        pendingEmail: response.data.pendingEmail || null
      });
      // Set assigned companies if available
      if (response.data.companies) {
        setAssignedCompanies(response.data.companies);
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const response = await api.put('/api/profile', formData);
      setProfile(response.data);
      await refreshUser(); // Update auth context
      toast.success('Profile updated successfully!');
    } catch (error) {
      toast.error('Error updating profile: ' + (error.response?.data?.message || error.message));
    } finally {
      setSaving(false);
    }
  };

  const handleEmailChangeRequest = async (e) => {
    e.preventDefault();
    if (!emailChangeData.newEmail) {
      toast.error('Please enter a new email address');
      return;
    }
    
    if (emailChangeData.newEmail.toLowerCase() === formData.email.toLowerCase()) {
      toast.error('New email must be different from current email');
      return;
    }
    
    setSaving(true);
    try {
      const response = await api.post('/api/profile/request-email-change', {
        newEmail: emailChangeData.newEmail
      });
      toast.success(`Validation email sent to ${response.data.pendingEmail}. Please check your email and click the validation link.`);
      setEmailChangeData({
        newEmail: '',
        pendingEmail: response.data.pendingEmail
      });
      // Refresh profile to get updated pendingEmail
      await fetchProfile();
    } catch (error) {
      toast.error('Error requesting email change: ' + (error.response?.data?.message || error.message));
      // If there's a pending email in the error response, update state
      if (error.response?.data?.pendingEmail) {
        setEmailChangeData(prev => ({ ...prev, pendingEmail: error.response.data.pendingEmail }));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEmailChange = async () => {
    if (!window.confirm('Are you sure you want to cancel the pending email change?')) {
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/profile/cancel-email-change');
      toast.success('Pending email change cancelled successfully.');
      setEmailChangeData({
        newEmail: '',
        pendingEmail: null
      });
      await fetchProfile();
    } catch (error) {
      toast.error('Error cancelling email change: ' + (error.response?.data?.message || error.message));
    } finally {
      setSaving(false);
    }
  };

  const handleResendEmailChange = async () => {
    setSaving(true);
    try {
      await api.post('/api/profile/resend-email-change');
      toast.success('Validation email resent successfully. Please check your email.');
    } catch (error) {
      toast.error('Error resending email: ' + (error.response?.data?.message || error.message));
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('New passwords do not match!');
      return;
    }
    
    if (passwordData.newPassword.length < 6) {
      toast.error('Password must be at least 6 characters!');
      return;
    }
    
    setSaving(true);
    try {
      await api.put('/api/profile/password', {
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword
      });
      toast.success('Password changed successfully!');
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
    } catch (error) {
      toast.error('Error changing password: ' + (error.response?.data?.message || error.message));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading profile...</div>;
  }

  if (!profile) {
    return <div className="empty">Profile not found</div>;
  }

  return (
    <div>
      <div className="page-header d-print-none">
        <div className="container-fluid">
          <div className="row g-2 align-items-center">
            <div className="col">
              <h2 className="page-title">My Profile</h2>
              <div className="text-muted mt-1">Manage your account settings</div>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="container-xl">
          <div className="row">
            <div className="col-12">
              <div className="card">
                <div className="card-header">
                  <ul className="nav nav-tabs card-header-tabs">
                    <li className="nav-item">
                      <button
                        className={`nav-link ${activeTab === 'profile' ? 'active' : ''}`}
                        onClick={() => setActiveTab('profile')}
                      >
                        Profile
                      </button>
                    </li>
                    <li className="nav-item">
                      <button
                        className={`nav-link ${activeTab === 'password' ? 'active' : ''}`}
                        onClick={() => setActiveTab('password')}
                      >
                        Change Password
                      </button>
                    </li>
                    <li className="nav-item">
                      <button
                        className={`nav-link ${activeTab === 'twofactor' ? 'active' : ''}`}
                        onClick={() => setActiveTab('twofactor')}
                      >
                        Two-Factor Authentication
                      </button>
                    </li>
                  </ul>
                </div>
                <div className="card-body">
                  {activeTab === 'profile' && (
                    <div>
                      <h2 className="mb-4">My Account</h2>
                      <h3 className="card-title">Profile Details</h3>
                      <div className="row align-items-center mb-4">
                        <div className="col-auto">
                          <span className={`avatar avatar-xl ${getAvatarColorClass(profile.name)} text-white`}>
                            {getInitials(profile.name)}
                          </span>
                        </div>
                        <div className="col">
                          <h4 className="mb-1">{profile.name}</h4>
                          <p className="text-muted mb-0">{profile.email}</p>
                        </div>
                      </div>

                      <h3 className="card-title">Personal Information</h3>
                      <form onSubmit={handleProfileUpdate}>
                        <div className="row g-3">
                          <div className="col-md-6">
                            <div className="form-label">Name</div>
                            <input
                              type="text"
                              className="form-control"
                              value={formData.name}
                              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                              required
                            />
                          </div>
                          <div className="col-md-6">
                            <div className="form-label">Email</div>
                            {emailChangeData.pendingEmail ? (
                              <>
                                <input
                                  type="email"
                                  className="form-control"
                                  value={formData.email}
                                  disabled
                                />
                                <small className="form-hint text-warning d-block mb-2">
                                  Pending: {emailChangeData.pendingEmail} - Please check your email and click the validation link.
                                </small>
                                <div className="btn-group" role="group">
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline-primary"
                                    onClick={handleResendEmailChange}
                                    disabled={saving}
                                  >
                                    Resend Email
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline-danger"
                                    onClick={handleCancelEmailChange}
                                    disabled={saving}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <input
                                  type="email"
                                  className="form-control"
                                  value={formData.email}
                                  disabled
                                />
                                <small className="form-hint">To change your email, use the form below</small>
                              </>
                            )}
                          </div>
                        </div>
                        {!emailChangeData.pendingEmail && (
                          <div className="row g-3 mt-0">
                            <div className="col-md-12">
                              <div className="form-label">Change Email Address</div>
                              <div className="input-group">
                                <input
                                  type="email"
                                  className="form-control"
                                  placeholder="Enter new email address"
                                  value={emailChangeData.newEmail}
                                  onChange={(e) => setEmailChangeData({ ...emailChangeData, newEmail: e.target.value })}
                                />
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  onClick={handleEmailChangeRequest}
                                  disabled={saving || !emailChangeData.newEmail}
                                >
                                  Request Change
                                </button>
                              </div>
                              <small className="form-hint">A validation email will be sent to your new email address. The link expires in 30 minutes.</small>
                            </div>
                          </div>
                        )}
                        <div className="row g-3 mt-0">
                        </div>
                        <div className="row g-3 mt-0">
                          <div className="col-md-6">
                            <div className="form-label">Role</div>
                            <input
                              type="text"
                              className="form-control"
                              value={getRoleLabel(profile.role)}
                              disabled
                            />
                          </div>
                          <div className="col-md-6">
                            <div className="form-label">Account Created</div>
                            <input
                              type="text"
                              className="form-control"
                              value={new Date(profile.createdAt).toLocaleString()}
                              disabled
                            />
                          </div>
                        </div>
                        <div className="mt-3">
                          <div className="form-label">Last Login</div>
                          <input
                            type="text"
                            className="form-control"
                            value={profile.lastLogin ? new Date(profile.lastLogin).toLocaleString() : 'Never'}
                            disabled
                          />
                        </div>
                        <div className="form-footer mt-4">
                          <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? 'Saving...' : 'Save Changes'}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  {activeTab === 'password' && (
                    <div>
                      <form onSubmit={handlePasswordChange} autoComplete="off">
                        <div className="mb-3">
                          <label className="form-label">Current Password</label>
                          <input
                            type="password"
                            className="form-control"
                            value={passwordData.currentPassword}
                            onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                            autoComplete="current-password"
                            required
                          />
                        </div>
                        <div className="mb-3">
                          <label className="form-label">New Password</label>
                          <input
                            type="password"
                            className="form-control"
                            value={passwordData.newPassword}
                            onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                            autoComplete="new-password"
                            required
                            minLength="6"
                          />
                          <small className="form-hint">Minimum 6 characters</small>
                        </div>
                        <div className="mb-3">
                          <label className="form-label">Confirm New Password</label>
                          <input
                            type="password"
                            className="form-control"
                            value={passwordData.confirmPassword}
                            onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                            autoComplete="new-password"
                            required
                            minLength="6"
                          />
                        </div>
                        <div className="form-footer">
                          <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? 'Changing...' : 'Change Password'}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}

                  {activeTab === 'twofactor' && (
                    <div>
                      <h2 className="mb-4">Two-Factor Authentication</h2>
                      
                      <div className="mb-4">
                        <h3 className="card-title">Current Status</h3>
                        <div className="row g-3 align-items-center">
                          <div className="col-auto">
                            {profile.twoFactorEnabled ? (
                              <span className="badge bg-success-lt">Enabled</span>
                            ) : (
                              <span className="badge bg-secondary-lt">Disabled</span>
                            )}
                          </div>
                          <div className="col">
                            <p className="text-secondary mb-0">
                              {profile.twoFactorEnabled 
                                ? 'Two-factor authentication is currently enabled on your account.'
                                : 'Two-factor authentication is not enabled on your account.'}
                            </p>
                          </div>
                        </div>
                        
                        {/* Show current 2FA method */}
                        {profile.twoFactorEnabled && profile.twoFactorMethod && (
                          <div className="mt-3">
                            <span className="text-secondary">Method: </span>
                            <span className="fw-medium">
                              {profile.twoFactorMethod === 'email' ? (
                                <>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-sm me-1" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                    <path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10z" />
                                    <path d="M3 7l9 6l9 -6" />
                                  </svg>
                                  Email
                                </>
                              ) : (
                                <>
                                  <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-sm me-1" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                    <path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3" />
                                    <path d="M12 11m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
                                    <path d="M12 12l0 2.5" />
                                  </svg>
                                  Authenticator App
                                </>
                              )}
                            </span>
                          </div>
                        )}
                      </div>

                      {profile.twoFactorEnabled && (
                        <div className="mb-4">
                          <div className="alert alert-warning">
                            <h4 className="alert-title">Reset Two-Factor Authentication</h4>
                            <p className="text-secondary">
                              If you want to change your 2FA method or reset your current setup, 
                              you can disable it here. You'll need to enter your password to confirm.
                            </p>
                            <p className="text-secondary mb-0">
                              <strong>Note:</strong> If 2FA is required globally, you'll be able to choose a new method on your next login.
                            </p>
                          </div>
                          
                          <form onSubmit={async (e) => {
                            e.preventDefault();
                            if (!twoFactorData.resetPassword) {
                              toast.error('Please enter your password');
                              return;
                            }
                            
                            setResetting2FA(true);
                            try {
                              const response = await api.post('/api/profile/reset-2fa', {
                                password: twoFactorData.resetPassword
                              });
                              toast.success(response.data.message);
                              setProfile(response.data.user);
                              await refreshUser();
                              setTwoFactorData({ resetPassword: '' });
                            } catch (error) {
                              toast.error('Error resetting 2FA: ' + (error.response?.data?.message || error.message));
                            } finally {
                              setResetting2FA(false);
                            }
                          }}>
                            <div className="mb-3">
                              <label className="form-label">Enter your password to reset 2FA</label>
                              <input
                                type="password"
                                className="form-control"
                                value={twoFactorData.resetPassword}
                                onChange={(e) => setTwoFactorData({ resetPassword: e.target.value })}
                                placeholder="Enter your password"
                                required
                              />
                              <small className="form-hint">This confirms you want to reset your 2FA settings</small>
                            </div>
                            <div className="form-footer">
                              <button 
                                type="submit" 
                                className="btn btn-warning" 
                                disabled={resetting2FA || !twoFactorData.resetPassword}
                              >
                                {resetting2FA ? 'Resetting...' : 'Reset 2FA'}
                              </button>
                            </div>
                          </form>
                        </div>
                      )}

                      {!profile.twoFactorEnabled && (
                        <div className="alert alert-info mb-3">
                          <h4 className="alert-title">Enable Two-Factor Authentication</h4>
                          <p className="text-secondary mb-2">
                            Two-factor authentication helps secure your account. You can set it up now or wait until your next login.
                          </p>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => navigate('/two-factor-method-select', {
                              state: {
                                fromProfile: true,
                                user: { id: profile.id, email: profile.email, name: profile.name }
                              }
                            })}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="icon me-2" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                              <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                              <path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3" />
                              <path d="M12 11m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
                              <path d="M12 12l0 2.5" />
                            </svg>
                            Set Up 2FA Now
                          </button>
                        </div>
                      )}
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

export default Profile;
