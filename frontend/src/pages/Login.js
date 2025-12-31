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
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await login(email, password);
      
      if (result.success) {
        navigate('/');
      } else if (result.requires2FASetup) {
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
              <h1 className="mb-2">{settings?.companyName || settings?.siteName || 'eInvoice Portal'}</h1>
              <p className="text-muted">Admin Dashboard</p>
            </div>
            <h2 className="card-title text-center mb-4">Login to your account</h2>
            {error && (
              <div className="alert alert-danger" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={handleSubmit} autoComplete="on">
              <div className="mb-3">
                <label className="form-label">Email address</label>
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
              <div className="mb-3">
                <label className="form-label">Password</label>
                <input
                  type="password"
                  className="form-control"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
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
