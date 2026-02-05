import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';
import PageTitle from '../components/PageTitle';

const TwoFactorMethodSelect = () => {
  const { settings } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState(null);
  
  // Get data from location state (passed from login)
  const sessionToken = location.state?.sessionToken;
  const allowedMethods = location.state?.allowedMethods || ['authenticator', 'email'];
  const userData = location.state?.user || {};
  const from = location.state?.from;

  // Redirect if missing required data
  React.useEffect(() => {
    if (!sessionToken) {
      toast.error('Session expired. Please login again.');
      navigate('/login');
    }
  }, [sessionToken, navigate]);

  const handleSelectAuthenticator = () => {
    // Navigate to authenticator setup
    navigate('/2fa-setup', {
      state: {
        sessionToken,
        user: userData,
        from,
        fromMethodSelect: true
      }
    });
  };

  const handleSelectEmail = async () => {
    setLoading(true);
    setSelectedMethod('email');
    
    try {
      // Call setup-email endpoint to set method and send code
      const response = await api.post('/api/two-factor/setup-email', {
        sessionToken
      });
      
      toast.success(response.data.message || 'Verification code sent!');
      
      // Navigate to verify page
      navigate('/2fa-verify', {
        state: {
          sessionToken,
          user: userData,
          twoFactorMethod: 'email',
          maskedEmail: response.data.email,
          from,
          isSetup: true
        }
      });
    } catch (error) {
      const message = error.response?.data?.message || 'Failed to send verification code';
      toast.error(message);
      setSelectedMethod(null);
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
      <PageTitle title="Choose 2FA Method" />
      <div className="container py-4" style={{ maxWidth: '550px' }}>
        <div className="card">
          <div className="card-body">
            <div className="text-center mb-4">
              {settings?.logoLight && (
                <img 
                  src={`${API_BASE_URL}${settings.logoLight}`} 
                  alt={settings.companyName || settings.siteName || 'Logo'} 
                  style={{ maxHeight: '50px', marginBottom: '0.5rem' }}
                />
              )}
              <h2 className="mb-1">Two-Factor Authentication</h2>
              <p className="text-secondary small mb-0">
                Choose how you want to verify your identity
              </p>
            </div>

            <div className="mb-4">
              {/* Authenticator App Option */}
              {allowedMethods.includes('authenticator') && (
                <div 
                  className={`card mb-3 cursor-pointer ${selectedMethod === 'authenticator' ? 'border-primary' : ''}`}
                  onClick={handleSelectAuthenticator}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="card-body d-flex align-items-center">
                    <div className="me-3">
                      <span className="avatar avatar-lg bg-primary-lt">
                        <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-lg" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                          <path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3" />
                          <path d="M12 11m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
                          <path d="M12 12l0 2.5" />
                        </svg>
                      </span>
                    </div>
                    <div className="flex-fill">
                      <h4 className="mb-1">Authenticator App</h4>
                      <p className="text-secondary small mb-0">
                        Use an app like Google Authenticator or Microsoft Authenticator to generate codes
                      </p>
                    </div>
                    <div className="ms-3">
                      <svg xmlns="http://www.w3.org/2000/svg" className="icon text-muted" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                        <path d="M9 6l6 6l-6 6" />
                      </svg>
                    </div>
                  </div>
                </div>
              )}

              {/* Email Option */}
              {allowedMethods.includes('email') && (
                <div 
                  className={`card ${selectedMethod === 'email' ? 'border-primary' : ''}`}
                  onClick={!loading ? handleSelectEmail : undefined}
                  style={{ cursor: loading ? 'wait' : 'pointer' }}
                >
                  <div className="card-body d-flex align-items-center">
                    <div className="me-3">
                      <span className="avatar avatar-lg bg-azure-lt">
                        <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-lg" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                          <path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10z" />
                          <path d="M3 7l9 6l9 -6" />
                        </svg>
                      </span>
                    </div>
                    <div className="flex-fill">
                      <h4 className="mb-1">Email</h4>
                      <p className="text-secondary small mb-0">
                        Receive a verification code to your email address each time you log in
                      </p>
                    </div>
                    <div className="ms-3">
                      {loading && selectedMethod === 'email' ? (
                        <div className="spinner-border spinner-border-sm text-primary" role="status">
                          <span className="visually-hidden">Loading...</span>
                        </div>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="icon text-muted" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                          <path d="M9 6l6 6l-6 6" />
                        </svg>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="text-center text-secondary small">
              <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-sm me-1" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                <path d="M12 9v4" />
                <path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z" />
                <path d="M12 16h.01" />
              </svg>
              Two-factor authentication is required for your account
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TwoFactorMethodSelect;
