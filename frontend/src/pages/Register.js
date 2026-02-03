import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import api, { API_BASE_URL } from '../services/api';
import PageTitle from '../components/PageTitle';

const Register = () => {
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const recaptchaSiteKey = process.env.REACT_APP_RECAPTCHA_SITE_KEY || '';
  const recaptchaLoaded = useRef(false);
  
  // Form fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [email, setEmail] = useState('');
  
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
      const token = await window.grecaptcha.execute(recaptchaSiteKey, { action: 'register' });
      return token;
    } catch (error) {
      console.error('reCAPTCHA execution error:', error);
      return null;
    }
  };

  const validateForm = () => {
    const errors = {};
    
    if (!firstName.trim()) {
      errors.firstName = 'First Name is required';
    }
    if (!lastName.trim()) {
      errors.lastName = 'Last Name is required';
    }
    if (!companyName.trim()) {
      errors.companyName = 'Company Name is required';
    }
    if (!email.trim()) {
      errors.email = 'Email is required';
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        errors.email = 'Invalid email address';
      }
    }
    
    setFieldErrors(errors);
    
    if (Object.keys(errors).length > 0) {
      setError(Object.values(errors)[0]);
      return false;
    }
    return true;
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    
    if (!validateForm()) return;
    
    setLoading(true);
    
    try {
      // Execute reCAPTCHA and get token
      const recaptchaToken = await executeRecaptcha();
      
      await api.post('/api/registration/submit', {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        companyName: companyName.trim(),
        accountNumber: accountNumber.trim() || null,
        email: email.trim(),
        recaptchaToken: recaptchaToken
      });
      
      setSuccess(true);
    } catch (err) {
      let errorMessage = err.response?.data?.message || 'Failed to submit registration. Please try again.';
      if (err.response?.status === 400 && err.response?.data?.recaptchaRequired) {
        errorMessage = 'reCAPTCHA verification required. Please refresh the page and try again.';
      } else if (err.response?.status === 400 && err.response?.data?.recaptchaFailed) {
        errorMessage = 'reCAPTCHA verification failed. Please refresh the page and try again.';
      }
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };
  
  const registerStyle = settings?.loginBackgroundImage ? {
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

  if (success) {
    return (
      <div className="page page-center" style={registerStyle}>
        <PageTitle title="Registration Submitted" />
        <div className="container container-tight py-4">
          <div className="card card-md">
            <div className="card-body text-center">
              <div className="mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-lg text-green" width="48" height="48" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                  <path d="M5 12l5 5l10 -10" />
                </svg>
              </div>
              <h2 className="card-title">Registration Submitted Successfully</h2>
              <p className="text-muted">
                Thank you for your registration request. We have received your information and will review it shortly.
              </p>
              <p className="text-muted">
                You will receive an email notification once your account has been reviewed.
              </p>
              <div className="mt-4">
                <button
                  className="btn btn-primary"
                  onClick={() => navigate('/login')}
                >
                  Return to Login
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="page page-center" style={registerStyle}>
      <PageTitle title="Register for New Account" />
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
            
            {error && (
              <div key={error} className="alert alert-danger login-alert" role="alert">
                {error}
              </div>
            )}
            
            <form onSubmit={handleSubmit} autoComplete="off">
              <div className="row mb-3">
                <div className="col">
                  <label htmlFor="firstName" className="form-label">
                    First Name <span className="text-danger">*</span>
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    className={`form-control ${fieldErrors.firstName ? 'is-invalid' : ''}`}
                    placeholder="First name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="off"
                    required
                  />
                  {fieldErrors.firstName && <div className="invalid-feedback d-block">{fieldErrors.firstName}</div>}
                </div>
                <div className="col">
                  <label htmlFor="lastName" className="form-label">
                    Last Name <span className="text-danger">*</span>
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    className={`form-control ${fieldErrors.lastName ? 'is-invalid' : ''}`}
                    placeholder="Last name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="off"
                    required
                  />
                  {fieldErrors.lastName && <div className="invalid-feedback d-block">{fieldErrors.lastName}</div>}
                </div>
              </div>
              
              <div className="mb-3">
                <label htmlFor="companyName" className="form-label">
                  Company Name <span className="text-danger">*</span>
                </label>
                <input
                  id="companyName"
                  type="text"
                  className={`form-control ${fieldErrors.companyName ? 'is-invalid' : ''}`}
                  placeholder="Company name"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  autoComplete="off"
                  required
                />
                {fieldErrors.companyName && <div className="invalid-feedback d-block">{fieldErrors.companyName}</div>}
              </div>
              
              <div className="mb-3">
                <label htmlFor="accountNumber" className="form-label">
                  Account Number / Company Reference
                </label>
                <input
                  id="accountNumber"
                  type="text"
                  className="form-control"
                  placeholder="Enter account number (optional)"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  autoComplete="off"
                />
              </div>
              
              <div className="mb-3">
                <label htmlFor="email" className="form-label">
                  Email Address <span className="text-danger">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  className={`form-control ${fieldErrors.email ? 'is-invalid' : ''}`}
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="off"
                  required
                />
                {fieldErrors.email && <div className="invalid-feedback d-block">{fieldErrors.email}</div>}
              </div>
              
              <div className="form-footer">
                <button
                  type="submit"
                  className="btn btn-primary w-100"
                  disabled={loading}
                >
                  {loading ? 'Submitting...' : 'Submit Registration'}
                </button>
              </div>
            </form>
            
            <div className="text-center text-muted mt-3">
              <Link to="/login">Already have an account? Login</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
