import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../services/api';
import PageTitle from '../components/PageTitle';

const ChangePassword = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionToken, setSessionToken] = useState(null);
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    // Get session token and user from location state (first-time login)
    // Or check if user is authenticated (changing password from profile)
    if (location.state) {
      setSessionToken(location.state.sessionToken);
      setUser(location.state.user);
      setIsFirstTime(location.state.isFirstTime || false);
    } else {
      // If no state, user might be changing password from profile
      // In that case, we'd need to get session token differently
      // For now, redirect to login if no state
      navigate('/login');
    }
  }, [location, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validation
    if (!formData.newPassword) {
      setError('New password is required');
      return;
    }

    if (formData.newPassword.length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // For first-time login, current password is not required
    // For regular password change, current password is required
    if (!isFirstTime && !formData.currentPassword) {
      setError('Current password is required');
      return;
    }

    setLoading(true);

    try {
      const response = await api.post('/api/auth/change-password', {
        sessionToken: sessionToken,
        currentPassword: formData.currentPassword || undefined,
        newPassword: formData.newPassword
      });

      if (response.data.message) {
        // Password changed successfully
        if (isFirstTime) {
          // After first-time password change, user needs to login again
          alert('Password changed successfully! Please login with your new password.');
          navigate('/login');
        } else {
          // Regular password change - redirect to profile or dashboard
          alert('Password changed successfully!');
          navigate('/profile');
        }
      }
    } catch (err) {
      console.error('Change password error:', err);
      setError(err.response?.data?.message || 'Failed to change password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  return (
    <div className="page page-center">
      <PageTitle title={isFirstTime ? "Set Your Password" : "Change Password"} />
      <div className="container container-tight py-4">
        <div className="card card-md">
          <div className="card-body">
            <div className="text-center mb-4">
              <h1 className="mb-2">Password Change Required</h1>
              {isFirstTime ? (
                <p className="text-muted">
                  This is your first time logging in. Please set a new password to continue.
                </p>
              ) : (
                <p className="text-muted">
                  Please enter your current password and choose a new password.
                </p>
              )}
            </div>
            {error && (
              <div className="alert alert-danger" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} autoComplete="on">
              {!isFirstTime && (
                <div className="mb-3">
                  <label className="form-label">Current Password</label>
                  <input
                    type="password"
                    name="currentPassword"
                    className="form-control"
                    placeholder="Enter your current password"
                    value={formData.currentPassword}
                    onChange={handleInputChange}
                    autoComplete="current-password"
                    required={!isFirstTime}
                  />
                </div>
              )}
              <div className="mb-3">
                <label className="form-label">New Password</label>
                <input
                  type="password"
                  name="newPassword"
                  className="form-control"
                  placeholder="Enter your new password (min. 6 characters)"
                  value={formData.newPassword}
                  onChange={handleInputChange}
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
                <small className="form-hint">
                  Password must be at least 6 characters long.
                </small>
              </div>
              <div className="mb-3">
                <label className="form-label">Confirm New Password</label>
                <input
                  type="password"
                  name="confirmPassword"
                  className="form-control"
                  placeholder="Confirm your new password"
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
              </div>
              <div className="form-footer">
                <button
                  type="submit"
                  className="btn btn-primary w-100"
                  disabled={loading}
                >
                  {loading ? 'Changing Password...' : (isFirstTime ? 'Set Password' : 'Change Password')}
                </button>
              </div>
            </form>
            {!isFirstTime && (
              <div className="text-center text-muted mt-3">
                <button
                  type="button"
                  className="btn btn-link"
                  onClick={() => navigate('/profile')}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChangePassword;

