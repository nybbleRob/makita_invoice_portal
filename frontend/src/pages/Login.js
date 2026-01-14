import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import PageTitle from '../components/PageTitle';
import { API_BASE_URL } from '../services/api';

const Login = () => {
  const { settings } = useSettings();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [accountLocked, setAccountLocked] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(null);
  const [remainingMinutes, setRemainingMinutes] = useState(null);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const recaptchaSiteKey = process.env.REACT_APP_RECAPTCHA_SITE_KEY || '';
  const recaptchaLoaded = useRef(false);
  
  // Validate redirect path to prevent open redirect attacks
  const isValidRedirectPath = (path) => {
    if (!path || typeof path !== 'string') {
      return false;
    }
    
    // Must start with / (relative path only)
    if (!path.startsWith('/')) {
      return false;
    }
    
    // Reject external URLs (http://, https://, //)
    if (/^https?:\/\//i.test(path) || path.startsWith('//')) {
      return false;
    }
    
    // Reject javascript: and data: URLs
    if (/^(javascript|data):/i.test(path)) {
      return false;
    }
    
    // Reject paths that try to escape (../)
    if (path.includes('../')) {
      return false;
    }
    
    // Must not be an auth page (to prevent redirect loops)
    const authPages = ['/login', '/forgot-password', '/reset-password', '/register', '/two-factor'];
    if (authPages.some(page => path.startsWith(page))) {
      return false;
    }
    
    return true;
  };

  // Load reCAPTCHA script
  useEffect(() => {
    if (!recaptchaSiteKey || recaptchaSiteKey === '') {
      return; // Skip if site key not set
    }

    if (recaptchaLoaded.current || window.grecaptcha) {
      return; // Already loaded
    }

    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${recaptchaSiteKey}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      recaptchaLoaded.current = true;
      if (window.grecaptcha) {
        window.grecaptcha.ready(() => {
          console.log('✅ reCAPTCHA v3 loaded');
        });
      }
    };
    document.body.appendChild(script);

    return () => {
      // Cleanup if needed
    };
  }, [recaptchaSiteKey]);

  // Execute reCAPTCHA and get token
  const executeRecaptcha = async () => {
    if (!recaptchaSiteKey || recaptchaSiteKey === '') {
      return null; // Skip if site key not set
    }

    if (!window.grecaptcha || !window.grecaptcha.ready) {
      console.warn('reCAPTCHA not loaded yet');
      return null;
    }

    try {
      const token = await window.grecaptcha.execute(recaptchaSiteKey, { action: 'login' });
      return token;
    } catch (error) {
      console.error('reCAPTCHA execution error:', error);
      return null;
    }
  };

  // Get redirect destination from query param or location state
  const getRedirectPath = () => {
    // Check query parameter first (from 401 interceptor)
    const redirectParam = searchParams.get('redirect');
    if (redirectParam && isValidRedirectPath(redirectParam)) {
      return redirectParam;
    }
    
    // Check location state (from ProtectedRoute)
    const from = location.state?.from?.pathname;
    if (from && isValidRedirectPath(from)) {
      // Also validate and include search params if present
      const search = location.state.from.search || '';
      const fullPath = from + search;
      if (isValidRedirectPath(fullPath)) {
        return fullPath;
      }
      // If search params make it invalid, just use pathname
      return from;
    }
    
    // Default to home
    return '/';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setAccountLocked(false);
    setLockedUntil(null);
    setRemainingMinutes(null);

    try {
      // Execute reCAPTCHA and get token
      const recaptchaToken = await executeRecaptcha();
      
      // Call login with reCAPTCHA token
      const result = await login(email, password, recaptchaToken);
      
      if (result.success) {
        setError('');
        const redirectPath = getRedirectPath();
        navigate(redirectPath);
      } else if (result.requires2FASetup) {
        setError('');
        console.log('Redirecting to 2FA setup with sessionToken:', result.sessionToken ? 'Present' : 'MISSING');
        navigate('/two-factor-setup', {
          state: {
            user: result.user,
            sessionToken: result.sessionToken,
            password: password,
            from: getRedirectPath() // Preserve redirect destination
          }
        });
      } else if (result.requires2FA) {
        setError('');
        console.log('Redirecting to 2FA verify with sessionToken:', result.sessionToken ? 'Present' : 'MISSING');
        navigate('/two-factor-verify', {
          state: {
            user: result.user,
            sessionToken: result.sessionToken,
            password: password,
            from: getRedirectPath() // Preserve redirect destination
          }
        });
      } else if (result.mustChangePassword) {
        setError('');
        console.log('Redirecting to password change with sessionToken:', result.sessionToken ? 'Present' : 'MISSING');
        navigate('/change-password', {
          state: {
            user: result.user,
            sessionToken: result.sessionToken,
            isFirstTime: true,
            from: getRedirectPath() // Preserve redirect destination
          }
        });
      } else {
        // Check for account lockout error (423 status)
        if (result.accountLocked) {
          setAccountLocked(true);
          setLockedUntil(result.lockedUntil);
          setRemainingMinutes(result.remainingMinutes);
          setError(result.message || 'Account is locked. Please try again later or contact an administrator.');
        } else {
          setError(result.message || 'Login failed. Please check your credentials.');
        }
      }
    } catch (err) {
      console.error('Login error:', err);
      // Check for 423 status (Locked)
      if (err.response?.status === 423) {
        setAccountLocked(true);
        setLockedUntil(err.response?.data?.lockedUntil);
        setRemainingMinutes(err.response?.data?.remainingMinutes);
        setError(err.response?.data?.message || 'Account is locked. Please try again later or contact an administrator.');
      } else if (err.response?.status === 400 && err.response?.data?.recaptchaRequired) {
        setError('reCAPTCHA verification required. Please refresh the page and try again.');
      } else if (err.response?.status === 400 && err.response?.data?.recaptchaFailed) {
        setError('reCAPTCHA verification failed. Please refresh the page and try again.');
      } else {
        setError(err.response?.data?.message || 'An error occurred during login. Please try again.');
      }
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
      <PageTitle title="Login" />
      <div className="container container-tight py-4">
        <div className="card card-md">
          <div className="card-body">
            <div className="text-center mb-4">
              {settings?.logoLight && (
                <img 
                  src={`${API_BASE_URL}${settings.logoLight}`} 
                  alt="Makita EDI Portal" 
                  style={{ maxHeight: '60px', marginBottom: '1rem' }}
                />
              )}
              <h1 className="mb-2">Makita EDI Portal</h1>
            </div>
            <h2 className="card-title text-center mb-4">Login to your account</h2>
            {error && (
              <div key={error} className={`alert ${accountLocked ? 'alert-warning' : 'alert-danger'} login-alert`} role="alert">
                {error}
                {accountLocked && remainingMinutes !== null && (
                  <div className="mt-2">
                    <small className="text-muted">
                      Account will be unlocked in approximately {remainingMinutes} minute(s).
                    </small>
                  </div>
                )}
                {accountLocked && (
                  <div className="mt-2">
                    <small>
                      Need immediate access? <Link to="/contact">Contact an administrator</Link>
                    </small>
                  </div>
                )}
              </div>
            )}
            <form onSubmit={handleSubmit} autoComplete="on">
              <div className="mb-3">
                <label className="form-label">Email address</label>
                <div className="input-icon">
                  <span className="input-icon-addon">
                    <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                      <path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10z" />
                      <path d="M3 7l9 6l9 -6" />
                    </svg>
                  </span>
                  <input
                    type="email"
                    className="form-control"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </div>
              </div>
              <div className="mb-3">
                <label className="form-label">Password</label>
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
                    className="form-control"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
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
              </div>
              
              <div className="form-footer">
                <button
                  type="submit"
                  className="btn btn-primary w-100"
                  disabled={loading}
                >
                  {loading ? 'Signing in...' : 'Sign in'}
                </button>
              </div>
            </form>
            <div className="text-center text-muted mt-3">
              <Link to="/forgot-password">Forgot password?</Link>
            </div>
            <div className="text-center text-muted mt-2">
              <Link to="/register">Register for New Account</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
