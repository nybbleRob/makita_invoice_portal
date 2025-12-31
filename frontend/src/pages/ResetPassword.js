import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import api, { API_URL } from '../services/api';
import toast from '../utils/toast';
import PageTitle from '../components/PageTitle';

const ResetPassword = () => {
  const { settings } = useSettings();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [validating, setValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);

  useEffect(() => {
    // Validate token on mount
    if (!token) {
      setValidating(false);
      setTokenValid(false);
      setError('Invalid or missing reset token');
      return;
    }

    const validateToken = async () => {
      try {
        await api.get(`/api/auth/validate-reset-token?token=${token}`);
        setTokenValid(true);
      } catch (err) {
        setTokenValid(false);
        setError(err.response?.data?.message || 'Invalid or expired reset token');
      } finally {
        setValidating(false);
      }
    };

    validateToken();
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      toast.error('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      toast.error('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      await api.post('/api/auth/reset-password', { token, password });
      setSuccess(true);
      toast.success('Password reset successfully! Redirecting to login...');
      setTimeout(() => {
        navigate('/login');
      }, 2000);
    } catch (err) {
      console.error('Reset password error:', err);
      const errorMessage = err.response?.data?.message || 'An error occurred. Please try again.';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const loginStyle = settings?.loginBackgroundImage ? {
    backgroundImage: `url(${API_URL}${settings.loginBackgroundImage})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    minHeight: '100vh',
    height: '100%'
  } : {
    minHeight: '100vh',
    height: '100%'
  };

  if (validating) {
    return (
      <div className="page page-center" style={loginStyle}>
        <PageTitle title="Reset Password" />
        <div className="container container-tight py-4">
          <div className="card card-md">
            <div className="card-body text-center">
              <div className="spinner-border" role="status">
                <span className="visually-hidden">Validating token...</span>
              </div>
              <p className="mt-3 text-muted">Validating reset token...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!tokenValid) {
    return (
      <div className="page page-center" style={loginStyle}>
        <PageTitle title="Reset Password" />
        <div className="container container-tight py-4">
          <div className="card card-md">
            <div className="card-body">
              <div className="text-center mb-4">
                {settings?.logoLight && (
                  <img 
                    src={`${API_URL}${settings.logoLight}`} 
                    alt={settings.companyName || settings.siteName || 'Logo'} 
                    style={{ maxHeight: '60px', marginBottom: '1rem' }}
                  />
                )}
                <h1 className="mb-2">{settings?.companyName || settings?.siteName || 'eInvoice Portal'}</h1>
              </div>
              <div className="alert alert-danger" role="alert">
                {error || 'Invalid or expired reset token'}
              </div>
              <div className="text-center mt-3">
                <Link to="/forgot-password" className="btn btn-primary">
                  Request new reset link
                </Link>
                <div className="mt-2">
                  <Link to="/login">Back to login</Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page page-center" style={loginStyle}>
      <PageTitle title="Reset Password" />
      <div className="container container-tight py-4">
        <div className="card card-md">
          <div className="card-body">
            <div className="text-center mb-4">
              {settings?.logoLight && (
                <img 
                  src={`${API_URL}${settings.logoLight}`} 
                  alt={settings.companyName || settings.siteName || 'Logo'} 
                  style={{ maxHeight: '60px', marginBottom: '1rem' }}
                />
              )}
              <h1 className="mb-2">{settings?.companyName || settings?.siteName || 'eInvoice Portal'}</h1>
              <p className="text-muted">Admin Dashboard</p>
            </div>
            <h2 className="card-title text-center mb-4">Reset password</h2>
            <p className="text-muted text-center mb-4">
              Enter your new password below.
            </p>
            
            {success ? (
              <div className="text-center">
                <div className="mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-lg text-green mb-3" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                    <path d="M5 12l5 5l10 -10" />
                  </svg>
                </div>
                <h3 className="mb-2">Password reset successful</h3>
                <p className="text-muted mb-4">
                  Your password has been reset. Redirecting to login...
                </p>
              </div>
            ) : (
              <>
                {error && (
                  <div className="alert alert-danger" role="alert">
                    {error}
                  </div>
                )}
                <form onSubmit={handleSubmit} autoComplete="on">
                  <div className="mb-3">
                    <label className="form-label">New Password</label>
                    <input
                      type="password"
                      className="form-control"
                      placeholder="Enter new password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                      minLength={6}
                      autoFocus
                    />
                    <small className="form-hint">Password must be at least 6 characters</small>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Confirm Password</label>
                    <input
                      type="password"
                      className="form-control"
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
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
                      {loading ? 'Resetting password...' : 'Reset password'}
                    </button>
                  </div>
                </form>
                <div className="text-center text-muted mt-3">
                  <Link to="/login">Back to login</Link>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;

