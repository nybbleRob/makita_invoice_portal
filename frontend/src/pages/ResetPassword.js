import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';
import PageTitle from '../components/PageTitle';

const ResetPassword = () => {
  const { settings } = useSettings();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
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
    const errors = {};

    if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
      setFieldErrors(errors);
      setError('Passwords do not match');
      toast.error('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters';
      setFieldErrors(errors);
      setError('Password must be at least 6 characters');
      toast.error('Password must be at least 6 characters');
      return;
    }

    setFieldErrors({});
    setLoading(true);

    try {
      await api.post('/api/auth/reset-password', { token, password });
      setError('');
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
    backgroundImage: `url(${API_BASE_URL}${settings.loginBackgroundImage})`,
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
                    src={`${API_BASE_URL}${settings.logoLight}`} 
                    alt={settings.companyName || settings.siteName || 'Logo'} 
                    style={{ maxHeight: '60px', marginBottom: '1rem' }}
                  />
                )}
                <h1 className="mb-2">{settings?.companyName || settings?.siteName || 'Makita Invoice Portal'}</h1>
              </div>
              <div className="alert alert-danger login-alert" role="alert">
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
                  src={`${API_BASE_URL}${settings.logoLight}`} 
                  alt={settings.companyName || settings.siteName || 'Logo'} 
                  style={{ maxHeight: '60px', marginBottom: '1rem' }}
                />
              )}
              <h1 className="mb-2">{settings?.companyName || settings?.siteName || 'Makita Invoice Portal'}</h1>
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
                  <div key={error} className="alert alert-danger login-alert" role="alert">
                    {error}
                  </div>
                )}
                <form onSubmit={handleSubmit} autoComplete="on">
                  <div className="mb-3">
                    <label className="form-label">New Password</label>
                    <div className="input-icon">
                      <span className="input-icon-addon">
                        <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                          <path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z" />
                          <path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" />
                          <path d="M8 11v-4a4 4 0 1 1 8 0v4" />
                        </svg>
                      </span>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        className={`form-control ${fieldErrors.password ? 'is-invalid' : ''}`}
                        placeholder="Enter new password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        required
                        minLength={6}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="input-icon-addon"
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex={-1}
                        style={{ cursor: 'pointer', border: 'none', background: 'transparent' }}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? (
                          <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                            <path d="M10.585 10.587a2 2 0 0 0 2.829 2.828" />
                            <path d="M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87" />
                            <path d="M3 3l18 18" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                            <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
                            <path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <small className="form-hint">Password must be at least 6 characters</small>
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Confirm Password</label>
                    <div className="input-icon">
                      <span className="input-icon-addon">
                        <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                          <path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z" />
                          <path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" />
                          <path d="M8 11v-4a4 4 0 1 1 8 0v4" />
                        </svg>
                      </span>
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        className={`form-control ${fieldErrors.confirmPassword ? 'is-invalid' : ''}`}
                        placeholder="Confirm new password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        autoComplete="new-password"
                        required
                        minLength={6}
                      />
                      <button
                        type="button"
                        className="input-icon-addon"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        tabIndex={-1}
                        style={{ cursor: 'pointer', border: 'none', background: 'transparent' }}
                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                      >
                        {showConfirmPassword ? (
                          <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                            <path d="M10.585 10.587a2 2 0 0 0 2.829 2.828" />
                            <path d="M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87" />
                            <path d="M3 3l18 18" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                            <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
                            <path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" />
                          </svg>
                        )}
                      </button>
                    </div>
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
