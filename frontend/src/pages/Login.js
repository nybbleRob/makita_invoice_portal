import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Don't clear error immediately - let user see previous error while loading
    setLoading(true);

    try {
      const result = await login(email, password);
      
      // Clear error only on success or redirect
      if (result.success) {
        setError('');
        navigate('/');
      } else if (result.requires2FASetup) {
        setError('');
        // SECURITY: Use session token instead of passing password
        // Password is only stored temporarily in state for final login after 2FA setup
        console.log('Redirecting to 2FA setup with sessionToken:', result.sessionToken ? 'Present' : 'MISSING');
        navigate('/two-factor-setup', {
          state: {
            user: result.user,
            sessionToken: result.sessionToken, // Secure session token
            password: password // Only for final login after 2FA setup completes
          }
        });
      } else if (result.requires2FA) {
        setError('');
        // SECURITY: Use session token instead of passing password
        // Password is only stored temporarily in state for final login after 2FA verification
        console.log('Redirecting to 2FA verify with sessionToken:', result.sessionToken ? 'Present' : 'MISSING');
        navigate('/two-factor-verify', {
          state: {
            user: result.user,
            sessionToken: result.sessionToken, // Secure session token
            password: password // Only for final login after 2FA verification completes
          }
        });
      } else if (result.mustChangePassword) {
        setError('');
        // First-time login or admin password reset - redirect to password change
        console.log('Redirecting to password change with sessionToken:', result.sessionToken ? 'Present' : 'MISSING');
        navigate('/change-password', {
          state: {
            user: result.user,
            sessionToken: result.sessionToken, // Secure session token
            isFirstTime: true
          }
        });
      } else {
        setError(result.message || 'Login failed. Please check your credentials.');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('An error occurred during login. Please try again.');
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
                  alt={settings.companyName || settings.siteName || 'Logo'} 
                  style={{ maxHeight: '60px', marginBottom: '1rem' }}
                />
              )}
              <h1 className="mb-2">{settings?.companyName || settings?.siteName || 'Makita Invoice Portal'}</h1>
              <p className="text-muted">Admin Dashboard</p>
            </div>
            <h2 className="card-title text-center mb-4">Login to your account</h2>
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
                    className={`form-control ${error && !password ? 'is-invalid' : ''}`}
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
