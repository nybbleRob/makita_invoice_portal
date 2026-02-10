import React from 'react';
import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import { API_BASE_URL } from '../services/api';
import PageTitle from '../components/PageTitle';

const ValidateEmailChange = () => {
  const { settings } = useSettings();

  const loginStyle = settings?.primaryColor ? {
    minHeight: '100vh',
    height: '100%',
    '--tblr-primary': settings.primaryColor
  } : {
    minHeight: '100vh',
    height: '100%'
  };

  return (
    <div className="page page-center" style={loginStyle}>
      <PageTitle title="Validate Email Change" />
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
              <h1 className="mb-2">Email Change</h1>
            </div>
            <div className="alert alert-info" role="alert">
              Email change is now done by manager approval. If you requested an email change, a manager or credit controller will review it. You will receive an email once it has been approved.
            </div>
            <div className="text-center mt-4">
              <Link to="/profile" className="btn btn-primary me-2">
                Profile
              </Link>
              <Link to="/login" className="btn btn-outline-primary">
                Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ValidateEmailChange;
