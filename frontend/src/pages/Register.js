import React, { useState } from 'react';
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
  
  // Form fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [email, setEmail] = useState('');
  
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
      await api.post('/api/registration/submit', {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        companyName: companyName.trim(),
        accountNumber: accountNumber.trim() || null,
        email: email.trim()
      });
      
      setSuccess(true);
    } catch (err) {
      const errorMessage = err.response?.data?.message || 'Failed to submit registration. Please try again.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };
  
  if (success) {
    return (
      <div className="page page-center">
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
    <div className="page page-center">
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
              <h1 className="mb-2">{settings?.companyName || settings?.siteName || 'Makita Invoice Portal'}</h1>
              <p className="text-muted">Register for New Account</p>
            </div>
            
            {error && (
              <div key={error} className="alert alert-danger login-alert" role="alert">
                {error}
              </div>
            )}
            
            <form onSubmit={handleSubmit}>
              <div className="row row-cols-2 g-3 mb-3">
                <div>
                  <label htmlFor="firstName" className="form-label">
                    First Name <span className="text-danger">*</span>
                  </label>
                  <div className="input-icon">
                    <span className="input-icon-addon">
                      <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                        <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
                        <path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
                      </svg>
                    </span>
                    <input
                      id="firstName"
                      type="text"
                      className={`form-control ${fieldErrors.firstName ? 'is-invalid' : ''}`}
                      placeholder="First name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                    />
                  </div>
                  {fieldErrors.firstName && <div className="invalid-feedback d-block">{fieldErrors.firstName}</div>}
                </div>
                
                <div>
                  <label htmlFor="lastName" className="form-label">
                    Last Name <span className="text-danger">*</span>
                  </label>
                  <div className="input-icon">
                    <span className="input-icon-addon">
                      <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                        <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
                        <path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
                      </svg>
                    </span>
                    <input
                      id="lastName"
                      type="text"
                      className={`form-control ${fieldErrors.lastName ? 'is-invalid' : ''}`}
                      placeholder="Last name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                    />
                  </div>
                  {fieldErrors.lastName && <div className="invalid-feedback d-block">{fieldErrors.lastName}</div>}
                </div>
                
                <div>
                  <label htmlFor="companyName" className="form-label">
                    Company Name <span className="text-danger">*</span>
                  </label>
                  <div className="input-icon">
                    <span className="input-icon-addon">
                      <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                        <path d="M3 21l18 0" />
                        <path d="M9 8l1 0" />
                        <path d="M9 12l1 0" />
                        <path d="M9 16l1 0" />
                        <path d="M14 8l1 0" />
                        <path d="M14 12l1 0" />
                        <path d="M14 16l1 0" />
                        <path d="M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16" />
                      </svg>
                    </span>
                    <input
                      id="companyName"
                      type="text"
                      className={`form-control ${fieldErrors.companyName ? 'is-invalid' : ''}`}
                      placeholder="Company name"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      required
                    />
                  </div>
                  {fieldErrors.companyName && <div className="invalid-feedback d-block">{fieldErrors.companyName}</div>}
                </div>
                
                <div>
                  <label htmlFor="email" className="form-label">
                    Email Address <span className="text-danger">*</span>
                  </label>
                  <div className="input-icon">
                    <span className="input-icon-addon">
                      <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                        <path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10z" />
                        <path d="M3 7l9 6l9 -6" />
                      </svg>
                    </span>
                    <input
                      id="email"
                      type="email"
                      className={`form-control ${fieldErrors.email ? 'is-invalid' : ''}`}
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  {fieldErrors.email && <div className="invalid-feedback d-block">{fieldErrors.email}</div>}
                </div>
              </div>
              
              <div className="mb-3">
                <label htmlFor="accountNumber" className="form-label">
                  Account Number / Company Reference
                </label>
                <div className="input-icon">
                  <span className="input-icon-addon">
                    <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                      <path d="M5 9l4 0l0 -4" />
                      <path d="M3 3l6 6" />
                      <path d="M5 20l6 -6l6 6" />
                      <path d="M21 3l-6 6" />
                      <path d="M21 9l-4 0l0 -4" />
                    </svg>
                  </span>
                  <input
                    id="accountNumber"
                    type="text"
                    className="form-control"
                    placeholder="Enter account number (optional)"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                  />
                </div>
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
