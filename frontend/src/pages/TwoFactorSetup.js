import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import api, { API_URL } from '../services/api';
import toast from '../utils/toast';
import PageTitle from '../components/PageTitle';

const TwoFactorSetup = () => {
  const { settings } = useSettings();
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [qrCode, setQrCode] = useState('');
  const [manualKey, setManualKey] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  
  // User data available from location state (passed from login): location.state?.user

  useEffect(() => {
    // Check if we have required data
    if (!location.state?.sessionToken && !location.state?.user) {
      console.error('2FA Setup - Missing required data, redirecting to login');
      toast.error('Session expired. Please login again.');
      setTimeout(() => navigate('/login'), 2000);
      return;
    }
    
    generateQRCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generateQRCode = async () => {
    try {
      setLoading(true);
      setError(''); // Clear previous errors
      
      // SECURITY: Use session token instead of password
      const sessionToken = location.state?.sessionToken;
      console.log('2FA Setup - Session token:', sessionToken ? 'Present' : 'MISSING');
      console.log('2FA Setup - Location state:', location.state);
      
      if (!sessionToken) {
        throw new Error('Session token is missing. Please try logging in again.');
      }
      
      // First-time setup - use session token (secure, no password exposure)
      const response = await api.post('/api/two-factor/setup', { sessionToken });
      console.log('2FA Setup - Response received:', response.data ? 'Success' : 'Failed');
      
      if (!response.data.qrCode) {
        throw new Error('QR code not generated in response');
      }
      
      setQrCode(response.data.qrCode);
      setManualKey(response.data.manualEntryKey);
      setError(''); // Clear any previous errors
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error occurred';
      console.error('2FA setup error details:', {
        message: errorMessage,
        response: error.response?.data,
        status: error.response?.status,
        fullError: error
      });
      // Show error for longer so user can read it
      toast.error('Error generating QR code: ' + errorMessage, { autoClose: 10000 });
      // Also show error in UI (persistent)
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    
    if (!verificationCode || verificationCode.length !== 6) {
      toast.error('Please enter a valid 6-digit code');
      return;
    }

    setVerifying(true);
    try {
      // SECURITY: Use session token instead of password
      const sessionToken = location.state?.sessionToken;
      
      const response = await api.post('/api/two-factor/verify-setup', {
        token: verificationCode,
        sessionToken: sessionToken
      });
      
      toast.success('2FA enabled successfully!');
      
      // Backend now returns JWT token directly after 2FA setup
      if (response.data.token && response.data.user) {
        // Store token and user
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('user', JSON.stringify(response.data.user));
        
        // Refresh auth context to pick up the new token
        await refreshUser();
        
        // Redirect to dashboard
        navigate('/');
      } else {
        // Fallback: redirect to login if token not provided
        console.error('No token in response:', response.data);
        toast.error('2FA enabled but login failed. Please login again.');
        setTimeout(() => navigate('/login'), 2000);
      }
    } catch (error) {
      toast.error('Invalid verification code. Please try again.');
      setVerificationCode('');
    } finally {
      setVerifying(false);
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

  return (
    <div className="page page-center" style={loginStyle}>
      <PageTitle title="Setup Two-Factor Authentication" />
      <div className="container py-4" style={{ maxWidth: '800px' }}>
        <div className="card">
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
              <p className="text-muted">Two-Factor Authentication Setup</p>
            </div>

            <h2 className="card-title text-center mb-4">Secure Your Account</h2>
            <p className="text-secondary text-center mb-4">
              Two-factor authentication is required for your account. Please set it up using an authenticator app.
            </p>

            {error && (
              <div className="alert alert-danger mb-4" role="alert">
                <strong>Error:</strong> {error}
              </div>
            )}

            {loading ? (
              <div className="text-center py-4">
                <div className="spinner-border text-primary" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
                <p className="mt-3 text-muted">Generating QR code...</p>
              </div>
            ) : (
              <>
                <div className="text-center mb-4">
                  <h3 className="card-title mb-3">Step 1: Scan QR Code</h3>
                  <p className="text-secondary mb-3">
                    Open your authenticator app (Google Authenticator, Authy, Microsoft Authenticator, etc.) and scan this QR code:
                  </p>
                  {qrCode && (
                    <div className="mb-3">
                      <img src={qrCode} alt="QR Code" style={{ maxWidth: '250px', border: '1px solid #ddd', borderRadius: '8px', padding: '10px', backgroundColor: 'white' }} />
                    </div>
                  )}
                  
                  <div className="mt-4">
                    <h4 className="card-title mb-2">Can't scan? Enter manually:</h4>
                    <div className="input-group mb-3">
                      <input
                        type="text"
                        className="form-control text-center font-monospace"
                        value={manualKey}
                        readOnly
                        style={{ fontSize: '0.9rem' }}
                      />
                      <button
                        className="btn btn-outline-secondary"
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(manualKey);
                          toast.success('Key copied to clipboard!');
                        }}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <h3 className="card-title mb-3">Step 2: Verify Setup</h3>
                  <p className="text-secondary mb-3">
                    Enter the 6-digit code from your authenticator app to verify:
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
                        disabled={verifying || verificationCode.length !== 6}
                      >
                        {verifying ? 'Verifying...' : 'Verify & Enable 2FA'}
                      </button>
                    </div>
                  </form>
                </div>

                <div className="mt-4">
                  <div className="alert alert-info">
                    <h4 className="alert-title">Need help?</h4>
                    <div className="text-secondary">
                      <p className="mb-2">Popular authenticator apps:</p>
                      <ul className="list-unstyled mb-0">
                        <li>• Google Authenticator</li>
                        <li>• Microsoft Authenticator</li>
                        <li>• Authy</li>
                        <li>• 1Password</li>
                        <li>• LastPass Authenticator</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TwoFactorSetup;

