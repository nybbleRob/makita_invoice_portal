import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';
import PageTitle from '../components/PageTitle';

const ForgotPassword = () => {
  const { settings } = useSettings();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const recaptchaSiteKey = process.env.REACT_APP_RECAPTCHA_SITE_KEY || '';
  const recaptchaLoaded = useRef(false);
  // Navigate available if needed: const navigate = useNavigate();

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
      const token = await window.grecaptcha.execute(recaptchaSiteKey, { action: 'forgot_password' });
      return token;
    } catch (error) {
      console.error('reCAPTCHA execution error:', error);
      return null;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Execute reCAPTCHA and get token
      const recaptchaToken = await executeRecaptcha();
      
      await api.post('/api/auth/forgot-password', { 
        email,
        recaptchaToken: recaptchaToken
      });
      setError('');
      setSuccess(true);
      toast.success('Password reset email sent! Please check your inbox.');
    } catch (err) {
      console.error('Forgot password error:', err);
      let errorMessage = err.response?.data?.message || 'An error occurred. Please try again.';
      if (err.response?.status === 400 && err.response?.data?.recaptchaRequired) {
        errorMessage = 'reCAPTCHA verification required. Please refresh the page and try again.';
      } else if (err.response?.status === 400 && err.response?.data?.recaptchaFailed) {
        errorMessage = 'reCAPTCHA verification failed. Please refresh the page and try again.';
      }
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

  return (
    <div className="page page-center" style={loginStyle}>
      <PageTitle title="Forgot Password" />
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
              <h1 className="mb-2">Makita Invoice Portal</h1>
            </div>
            <h2 className="card-title text-center mb-4">Forgot password</h2>
            <p className="text-muted text-center mb-4">
              Enter your email address and your password will be reset and emailed to you.
            </p>
            
            {success ? (
              <div className="text-center">
                <div className="mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-lg text-green mb-3" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                    <path d="M5 12l5 5l10 -10" />
                  </svg>
                </div>
                <h3 className="mb-2">Email sent</h3>
                <p className="text-muted mb-4">
                  If an account with that email exists, we've sent you a password reset link.
                </p>
                <Link to="/login" className="btn btn-primary">
                  Back to login
                </Link>
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
                        className={`form-control ${error && !email ? 'is-invalid' : ''}`}
                        placeholder="your@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="username"
                        required
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="form-footer">
                    <button
                      type="submit"
                      className="btn btn-primary w-100"
                      disabled={loading}
                    >
                      {loading ? 'Sending...' : 'Send password reset email'}
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

export default ForgotPassword;
