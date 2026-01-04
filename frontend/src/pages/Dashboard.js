import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { usePermissions } from '../context/PermissionContext';

const Dashboard = () => {
  const { hasPermission } = usePermissions();
  const [stats, setStats] = useState({
    invoices: null,
    creditNotes: null,
    users: null,
    companies: null
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await api.get('/api/stats/dashboard');
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="page page-center">
        <div className="container container-tight py-4">
          <div className="text-center">
            <div className="spinner-border" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header d-print-none">
        <div className="container-fluid">
          <div className="row g-2 align-items-center">
            <div className="col">
              <div className="page-pretitle">Overview</div>
              <h2 className="page-title">Dashboard</h2>
            </div>
          </div>
        </div>
      </div>
      <div className="page-body">
        <div className="container-fluid">
          <div className="row row-cards">
            {/* Invoices - visible to all */}
            <div className="col-sm-6 col-lg-3">
              <Link to="/invoices" className="card card-link">
                <div className="card-body">
                  <div className="d-flex align-items-center mb-3">
                    <span className="avatar bg-primary-lt me-3">
                      <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                        <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
                        <path d="M9 9l1 0" />
                        <path d="M9 13l6 0" />
                        <path d="M9 17l6 0" />
                      </svg>
                    </span>
                    <div className="subheader">Invoices</div>
                  </div>
                  <div className="h1 mb-0">{stats.invoices?.total ?? 0}</div>
                  <div className="text-muted mt-1">Total documents</div>
                </div>
              </Link>
            </div>

            {/* Credit Notes - visible to all */}
            <div className="col-sm-6 col-lg-3">
              <Link to="/credit-notes" className="card card-link">
                <div className="card-body">
                  <div className="d-flex align-items-center mb-3">
                    <span className="avatar bg-green-lt me-3">
                      <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                        <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                        <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
                        <path d="M9 9l1 0" />
                        <path d="M9 13l6 0" />
                        <path d="M9 17l6 0" />
                      </svg>
                    </span>
                    <div className="subheader">Credit Notes</div>
                  </div>
                  <div className="h1 mb-0">{stats.creditNotes?.total ?? 0}</div>
                  <div className="text-muted mt-1">Total documents</div>
                </div>
              </Link>
            </div>

            {/* Users - only if permission */}
            {hasPermission('USERS_VIEW') && stats.users !== null && (
              <div className="col-sm-6 col-lg-3">
                <Link to="/users" className="card card-link">
                  <div className="card-body">
                    <div className="d-flex align-items-center mb-3">
                      <span className="avatar bg-azure-lt me-3">
                        <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                          <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
                          <path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
                        </svg>
                      </span>
                      <div className="subheader">Users</div>
                    </div>
                    <div className="h1 mb-0">{stats.users?.total ?? 0}</div>
                    <div className="text-muted mt-1">Manageable users</div>
                  </div>
                </Link>
              </div>
            )}

            {/* Companies - only if permission */}
            {hasPermission('COMPANIES_VIEW') && stats.companies !== null && (
              <div className="col-sm-6 col-lg-3">
                <Link to="/companies" className="card card-link">
                  <div className="card-body">
                    <div className="d-flex align-items-center mb-3">
                      <span className="avatar bg-yellow-lt me-3">
                        <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                          <path d="M3 21l18 0" />
                          <path d="M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16" />
                          <path d="M9 7l6 0" />
                          <path d="M9 11l6 0" />
                          <path d="M9 15l6 0" />
                        </svg>
                      </span>
                      <div className="subheader">Companies</div>
                    </div>
                    <div className="h1 mb-0">{stats.companies?.total ?? 0}</div>
                    <div className="text-muted mt-1">Accessible accounts</div>
                  </div>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
