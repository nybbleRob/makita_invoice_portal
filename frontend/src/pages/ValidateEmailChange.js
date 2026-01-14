import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';
import PageTitle from '../components/PageTitle';

const ValidateEmailChange = () => {
  const { settings } = useSettings();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [validating, setValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [validated, setValidated] = useState(false);

  useEffect(() => {
    // Validate token on mount
    if (!token) {
      setValidating(false);
      setTokenValid(false);
      setError('Invalid or missing validation token');
      return;
    }

    const validateToken = async () => {
      try {
        await api.get(`/api/auth/validate-email-change?token=${token}`);
        setTokenValid(true);
      } catch (err) {
        setTokenValid(false);
        setError(err.response?.data?.message || 'Invalid or expired validation token');
      } finally {
        setValidating(false);
      }
    };

    validateToken();
  }, [token]);

  const handleValidate = async (e) => {
    e.preventDefault();
    if (!token) {
      setError('Invalid or missing validation token');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await api.post('/api/profile/validate-email-change', { token });
      setValidated(true);
      toast.success('Email change validated successfully!');
      
      // Redirect to login after 3 seconds
      setTimeout(() => {
        navigate('/login', { 
          state: { 
            message: 'Email change validated successfully. Please login with your new email address.',
            newEmail: response.data.newEmail
          } 
        });
      }, 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to validate email change');
      toast.error(err.response?.data?.message || 'Failed to validate email change');
    } finally {
      setLoading(false);
    }
  };

  const loginStyle = settings?.primaryColor ? {
    minHeight: '100vh',
    height: '100%',
    '--tblr-primary': settings.primaryColor
  } : {
    minHeight: '100vh',
    height: '100%'
  };

  if (validating) {
    return (
      <div className="page page-center" style={loginStyle}>
        <PageTitle title="Validate Email Change" />
        <div className="container container-tight py-4">
          <div className="card card-md">
            <div className="card-body text-center">
              <div className="spinner-border" role="status">
                <span className="visually-hidden">Validating token...</span>
              </div>
              <p className="mt-3 text-muted">Validating email change token...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!tokenValid) {
    return (
      <div className="page page-center" style={loginStyle}>
        <PageTitle title="Validate Email Change" />
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
                <h1 className="mb-2">Makita EDI Portal</h1>
              </div>
              <div className="alert alert-danger login-alert" role="alert">
                {error || 'Invalid or expired validation token'}
              </div>
              <div className="text-center mt-3">
                <Link to="/profile" className="btn btn-primary">
                  Go to Profile
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

  if (validated) {
    return (
      <div className="page page-center" style={loginStyle}>
        <PageTitle title="Email Change Validated" />
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
                <h1 className="mb-2">Makita EDI Portal</h1>
              </div>
              <div className="alert alert-success login-alert" role="alert">
                Email change validated successfully! Please login with your new email address.
              </div>
              <div className="text-center mt-3">
                <p className="text-muted">Redirecting to login page...</p>
                <Link to="/login" className="btn btn-primary">
                  Go to Login
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page page-center" style={loginStyle}>
      <PageTitle title="Validate Email Change" />
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
              <h1 className="mb-2">Validate Email Change</h1>
              <p className="text-muted">Click the button below to confirm your email change</p>
            </div>

            {error && (
              <div className="alert alert-danger login-alert" role="alert">
                {error}
              </div>
            )}

            <form onSubmit={handleValidate}>
              <div className="mb-3">
                <button
                  type="submit"
                  className="btn btn-primary w-100"
                  disabled={loading}
                >
                  {loading ? 'Validating...' : 'Validate Email Change'}
                </button>
              </div>
            </form>

            <div className="text-center text-muted mt-3">
              <Link to="/login">Back to login</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ValidateEmailChange;
