import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';
import PageTitle from '../components/PageTitle';

const TwoFactorVerify = () => {
  const { settings } = useSettings();
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  
  // Get data from location state (passed from login or method select)
  const userData = location.state?.user || {};
  const twoFactorMethod = location.state?.twoFactorMethod || 'authenticator';
  const maskedEmail = location.state?.maskedEmail || userData.email;
  const sessionToken = location.state?.sessionToken;
  const isSetup = location.state?.isSetup || false; // True if coming from method selection (first-time setup)
  const from = location.state?.from;

  // Cooldown timer for resend button
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const handleVerify = async (e) => {
    e.preventDefault();
    
    if (!verificationCode || verificationCode.length !== 6) {
      setError('Please enter a valid 6-digit code');
      toast.error('Please enter a valid 6-digit code');
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      if (isSetup) {
        // First-time setup flow - use verify-setup endpoint
        const response = await api.post('/api/two-factor/verify-setup', {
          token: verificationCode,
          sessionToken: sessionToken,
          method: twoFactorMethod
        });

        if (response.data.token && response.data.user) {
          // Store token and user
          localStorage.setItem('token', response.data.token);
          localStorage.setItem('user', JSON.stringify(response.data.user));
          
          // Refresh auth context
          await refreshUser();
          
          toast.success('2FA enabled successfully!');
          
          // Redirect to intended destination or home
          const redirectPath = from || '/';
          const isValidPath = redirectPath && 
            typeof redirectPath === 'string' &&
            redirectPath.startsWith('/') &&
            !/^https?:\/\//i.test(redirectPath) &&
            !redirectPath.startsWith('//') &&
            !/^(javascript|data):/i.test(redirectPath) &&
            !redirectPath.includes('../');
          
          navigate(isValidPath ? redirectPath : '/');
        }
      } else {
        // Login flow - complete login with 2FA code
        if (!userData.email || !location.state?.password) {
          toast.error('Session expired. Please login again.');
          navigate('/login');
          return;
        }

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
          
          // Redirect to intended destination or home
          const redirectPath = from || '/';
          const isValidPath = redirectPath && 
            typeof redirectPath === 'string' &&
            redirectPath.startsWith('/') &&
            !/^https?:\/\//i.test(redirectPath) &&
            !redirectPath.startsWith('//') &&
            !/^(javascript|data):/i.test(redirectPath) &&
            !redirectPath.includes('../');
          
          window.location.href = isValidPath ? redirectPath : '/'; // Force full reload to update auth context
        }
      }
    } catch (err) {
      const errorMessage = err.response?.data?.message || 'Invalid verification code. Please try again.';
      setError(errorMessage);
      toast.error(errorMessage);
      setVerificationCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (cooldown > 0 || resending) return;
    
    setResending(true);
    try {
      const response = await api.post('/api/two-factor/send-email-code', {
        email: userData.email,
        sessionToken: sessionToken
      });
      
      toast.success(response.data.message || 'Verification code sent!');
      setCooldown(60); // 60 second cooldown
    } catch (err) {
      const waitSeconds = err.response?.data?.waitSeconds;
      if (waitSeconds) {
        setCooldown(waitSeconds);
        toast.error(`Please wait ${waitSeconds} seconds before requesting another code.`);
      } else {
        toast.error(err.response?.data?.message || 'Failed to resend code');
      }
    } finally {
      setResending(false);
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

  const isEmailMethod = twoFactorMethod === 'email';

  return (
    <div className="page page-center" style={loginStyle}>
      <PageTitle title="Two-Factor Authentication" />
      <div className="container py-4" style={{ maxWidth: '500px' }}>
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
              <h2 className="mb-1">Enter Verification Code</h2>
              <p className="text-secondary small mb-0">
                {isEmailMethod 
                  ? `Enter the 6-digit code sent to ${maskedEmail}`
                  : 'Enter the 6-digit code from your authenticator app'
                }
              </p>
            </div>

            {error && (
              <div key={error} className="alert alert-danger" role="alert">
                {error}
              </div>
            )}

            <form onSubmit={handleVerify}>
              <div className="mb-3">
                <label className="form-label">Verification Code</label>
                <input
                  type="text"
                  className={`form-control text-center font-monospace ${error ? 'is-invalid' : ''}`}
                  placeholder="000000"
                  value={verificationCode}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setVerificationCode(value);
                    if (error) setError('');
                  }}
                  maxLength="6"
                  required
                  style={{ fontSize: '1.5rem', letterSpacing: '0.5rem' }}
                  autoFocus
                />
                <small className="form-hint">
                  {isEmailMethod 
                    ? 'Code expires in 10 minutes'
                    : 'Code changes every 30 seconds'
                  }
                </small>
              </div>

              <div className="form-footer">
                <button
                  type="submit"
                  className="btn btn-primary w-100"
                  disabled={loading || verificationCode.length !== 6}
                >
                  {loading ? 'Verifying...' : (isSetup ? 'Verify & Enable 2FA' : 'Verify & Login')}
                </button>
              </div>
            </form>

            {/* Resend button for email method */}
            {isEmailMethod && (
              <div className="text-center mt-3">
                <button
                  type="button"
                  className="btn btn-link text-secondary p-0"
                  onClick={handleResendCode}
                  disabled={cooldown > 0 || resending}
                >
                  {resending ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                      Sending...
                    </>
                  ) : cooldown > 0 ? (
                    `Resend code in ${cooldown}s`
                  ) : (
                    "Didn't receive a code? Resend"
                  )}
                </button>
              </div>
            )}

            <div className="text-center mt-3">
              <Link to="/login" className="text-secondary">Back to login</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TwoFactorVerify;
