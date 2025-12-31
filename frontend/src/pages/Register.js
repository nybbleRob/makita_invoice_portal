import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import api, { API_BASE_URL } from '../services/api';
import PageTitle from '../components/PageTitle';

const Register = () => {
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  
  // Form fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [email, setEmail] = useState('');
  
  const validateForm = () => {
    if (!firstName.trim()) {
      setError('First Name is required');
      return false;
    }
    if (!lastName.trim()) {
      setError('Last Name is required');
      return false;
    }
    if (!companyName.trim()) {
      setError('Company Name is required');
      return false;
    }
    if (!email.trim()) {
      setError('Email is required');
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Invalid email address');
      return false;
    }
    return true;
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
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
              <div className="alert alert-danger" role="alert">
                {error}
              </div>
            )}
            
            <form onSubmit={handleSubmit}>
              <div className="row row-cols-2 g-4 mb-3">
                <div>
                  <label htmlFor="firstName" className="form-label">
                    First Name <span className="text-danger">*</span>
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    className="form-control"
                    placeholder="Enter your first name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </div>
                
                <div>
                  <label htmlFor="lastName" className="form-label">
                    Last Name <span className="text-danger">*</span>
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    className="form-control"
                    placeholder="Enter your last name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                  />
                </div>
                
                <div>
                  <label htmlFor="companyName" className="form-label">
                    Company Name <span className="text-danger">*</span>
                  </label>
                  <input
                    id="companyName"
                    type="text"
                    className="form-control"
                    placeholder="Enter your company name"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    required
                  />
                </div>
                
                <div>
                  <label htmlFor="email" className="form-label">
                    Email Address <span className="text-danger">*</span>
                  </label>
                  <input
                    id="email"
                    type="email"
                    className="form-control"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
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
                />
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
              <a href="/login">Already have an account? Login</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;
