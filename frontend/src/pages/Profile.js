import React, { useState, useEffect } from 'react';
import api, { API_URL } from '../services/api';
import toast from '../utils/toast';
import { getRoleLabel } from '../utils/roleLabels';
import { getInitials, getAvatarColorClass } from '../utils/avatar';
import { useAuth } from '../context/AuthContext';

const Profile = () => {
  const { refreshUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('profile');
  const [, setAssignedCompanies] = useState([]);
  const [formData, setFormData] = useState({
    name: '',
    email: ''
  });
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
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

  const handleAvatarUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadingAvatar(true);
    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const response = await api.post('/api/profile/avatar', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      setProfile(response.data.user);
      await refreshUser(); // Update auth context
      toast.success('Avatar uploaded successfully!');
    } catch (error) {
      toast.error('Error uploading avatar: ' + (error.response?.data?.message || error.message));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleAvatarDelete = async () => {
    // Simple confirmation - user can click again if they change their mind
    setUploadingAvatar(true);
    try {
      const response = await api.delete('/api/profile/avatar');
      setProfile(response.data.user);
      await refreshUser(); // Update auth context
      toast.success('Avatar deleted successfully!');
    } catch (error) {
      toast.error('Error deleting avatar: ' + (error.response?.data?.message || error.message));
    } finally {
      setUploadingAvatar(false);
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
                      <div className="row align-items-center">
                        <div className="col-auto">
                          {profile.avatar ? (
                            <span className="avatar avatar-xl" style={{ backgroundImage: `url(${API_URL}${profile.avatar})` }}></span>
                          ) : (
                            <span className={`avatar avatar-xl ${getAvatarColorClass(profile.name)} text-white`}>
                              {getInitials(profile.name)}
                            </span>
                          )}
                        </div>
                        <div className="col-auto">
                          <label className="btn btn-1">
                            {uploadingAvatar ? 'Uploading...' : 'Change avatar'}
                            <input
                              type="file"
                              className="d-none"
                              accept="image/*"
                              onChange={handleAvatarUpload}
                              disabled={uploadingAvatar}
                            />
                          </label>
                        </div>
                        {profile.avatar && (
                          <div className="col-auto">
                            <button
                              type="button"
                              className="btn btn-ghost-danger btn-3"
                              onClick={handleAvatarDelete}
                              disabled={uploadingAvatar}
                            >
                              Delete avatar
                            </button>
                          </div>
                        )}
                      </div>

                      <h3 className="card-title mt-4">Personal Information</h3>
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
                            <input
                              type="email"
                              className="form-control"
                              value={formData.email}
                              disabled
                            />
                            <small className="form-hint">Email cannot be changed</small>
                          </div>
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
                      </div>

                      {profile.twoFactorEnabled && (
                        <div className="mb-4">
                          <div className="alert alert-warning">
                            <h4 className="alert-title">Reset Two-Factor Authentication</h4>
                            <p className="text-secondary">
                              If you've lost access to your authenticator app or want to reset your 2FA, 
                              you can disable it here. You'll need to enter your password to confirm.
                            </p>
                            <p className="text-secondary mb-0">
                              <strong>Note:</strong> If 2FA is required globally, you'll need to set it up again on your next login.
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
                        <div className="alert alert-info">
                          <h4 className="alert-title">Enable Two-Factor Authentication</h4>
                          <p className="text-secondary mb-0">
                            Two-factor authentication helps secure your account. If 2FA is required by your administrator, 
                            you'll be prompted to set it up on your next login.
                          </p>
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
