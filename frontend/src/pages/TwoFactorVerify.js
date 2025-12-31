import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
// useAuth available from '../context/AuthContext' if needed
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';
import PageTitle from '../components/PageTitle';

const TwoFactorVerify = () => {
  const { settings } = useSettings();
  // useAuth available if needed
  const navigate = useNavigate();
  const location = useLocation();
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Get user data from location state (passed from login)
  const userData = location.state?.user || {};

  const handleVerify = async (e) => {
    e.preventDefault();
    
    if (!verificationCode || verificationCode.length !== 6) {
      toast.error('Please enter a valid 6-digit code');
      return;
    }

    // SECURITY: Password is only used for final login, session token would be preferred
    // but we need password for the final authentication step
    if (!userData.email || !location.state?.password) {
      toast.error('Session expired. Please login again.');
      navigate('/login');
      return;
    }

    setLoading(true);
    try {
      // Complete login with 2FA code
      // Note: Password is only used here for final authentication
      const response = await api.post('/api/auth/login', {
        email: userData.email,
        password: location.state.password,
        twoFactorCode: verificationCode
      });

      if (response.data.token) {
        // Store token and user
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.user));
        
        toast.success('Login successful!');
        window.location.href = '/'; // Force full reload to update auth context
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Invalid verification code. Please try again.');
      setVerificationCode('');
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

  return (
    <div className="page page-center" style={loginStyle}>
      <PageTitle title="Two-Factor Authentication" />
      <div className="container py-4" style={{ maxWidth: '600px' }}>
        <div className="card">
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
              <p className="text-muted">Two-Factor Authentication</p>
            </div>

            <h2 className="card-title text-center mb-4">Enter Verification Code</h2>
            <p className="text-secondary text-center mb-4">
              Open your authenticator app and enter the 6-digit code:
            </p>

            <form onSubmit={handleVerify}>
              <div className="mb-3">
                <label className="form-label">Verification Code</label>
                <input
                  type="text"
                  className="form-control text-center font-monospace"
                  placeholder="000000"
                  value={verificationCode}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setVerificationCode(value);
                  }}
                  maxLength="6"
                  required
                  style={{ fontSize: '1.5rem', letterSpacing: '0.5rem' }}
                  autoFocus
                />
                <small className="form-hint">Enter the 6-digit code from your authenticator app</small>
              </div>
              <div className="form-footer">
                <button
                  type="submit"
                  className="btn btn-primary w-100"
                  disabled={loading || verificationCode.length !== 6}
                >
                  {loading ? 'Verifying...' : 'Verify & Login'}
                </button>
              </div>
            </form>

            <div className="text-center mt-3">
              <a href="/login" className="text-secondary">Back to login</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TwoFactorVerify;

