import React, { useEffect } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { usePermissions } from '../../context/PermissionContext';
import { getRoleLabel } from '../../utils/roleLabels';
import { getInitials, getAvatarColorClass } from '../../utils/avatar';
import PageTitle from '../PageTitle';
import { API_BASE_URL } from '../../services/api';

const Layout = () => {
  const { user, logout } = useAuth();
  const { settings } = useSettings();
  const { hasPermission } = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();


  // Apply horizontal layout and fluid layout to body
  useEffect(() => {
    document.body.classList.add('layout-horizontal', 'layout-fluid');
    return () => {
      document.body.classList.remove('layout-horizontal', 'layout-fluid');
    };
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Navigation menu items - using proper Tabler structure with <ul> and <li>
  const navItems = (
    <ul className="navbar-nav">
      <li className={`nav-item ${location.pathname === '/' ? 'active' : ''}`}>
        <Link to="/" className="nav-link">
          <span className="nav-link-icon">
            <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-1" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
              <path d="M5 12l-2 0l9 -9l9 9l-2 0" />
              <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7" />
              <path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6" />
            </svg>
          </span>
          <span className="nav-link-title">Dashboard</span>
        </Link>
      </li>
      <li className={`nav-item ${location.pathname === '/invoices' ? 'active' : ''}`}>
        <Link to="/invoices" className="nav-link">
          <span className="nav-link-icon">
            <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-1" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
              <path d="M14 3v4a1 1 0 0 0 1 1h4" />
              <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
              <path d="M9 9l1 0" />
              <path d="M9 13l6 0" />
              <path d="M9 17l6 0" />
            </svg>
          </span>
          <span className="nav-link-title">Invoices</span>
        </Link>
      </li>
      <li className={`nav-item ${location.pathname === '/credit-notes' ? 'active' : ''}`}>
        <Link to="/credit-notes" className="nav-link">
          <span className="nav-link-icon">
            <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-1" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
              <path d="M14 3v4a1 1 0 0 0 1 1h4" />
              <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
              <path d="M9 9l1 0" />
              <path d="M9 13l6 0" />
              <path d="M9 17l6 0" />
            </svg>
          </span>
          <span className="nav-link-title">Credit Notes</span>
        </Link>
      </li>
      {/* Statements - HIDDEN until client decides on scope */}
      {/* {hasPermission('STATEMENTS_VIEW') && (
        <li className={`nav-item ${location.pathname === '/statements' ? 'active' : ''}`}>
          <Link to="/statements" className="nav-link">
            <span className="nav-link-icon">
              <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-1" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
                <path d="M9 9l1 0" />
                <path d="M9 13l6 0" />
                <path d="M9 17l6 0" />
              </svg>
            </span>
            <span className="nav-link-title">Statements</span>
          </Link>
        </li>
      )} */}
      {/* Unallocated - GA, Admin, Manager */}
      {hasPermission('UNALLOCATED_VIEW') && (
        <li className={`nav-item ${location.pathname === '/unallocated' ? 'active' : ''}`}>
          <Link to="/unallocated" className="nav-link">
            <span className="nav-link-icon">
              <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-1" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
              </svg>
            </span>
            <span className="nav-link-title">Unallocated</span>
          </Link>
        </li>
      )}
      {/* Companies - Staff roles */}
      {hasPermission('COMPANIES_VIEW') && (
        <li className={`nav-item ${location.pathname === '/companies' ? 'active' : ''}`}>
          <Link to="/companies" className="nav-link">
            <span className="nav-link-icon">
              <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-1" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                <path d="M3 21l18 0" />
                <path d="M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16" />
                <path d="M9 7l6 0" />
                <path d="M9 11l6 0" />
                <path d="M9 15l6 0" />
              </svg>
            </span>
            <span className="nav-link-title">Companies</span>
          </Link>
        </li>
      )}
      {/* Users - GA, Admin, Manager */}
      {hasPermission('USERS_VIEW') && (
        <li className={`nav-item ${location.pathname === '/users' ? 'active' : ''}`}>
          <Link to="/users" className="nav-link">
            <span className="nav-link-icon">
              <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-1" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
                <path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
              </svg>
            </span>
            <span className="nav-link-title">Users</span>
          </Link>
        </li>
      )}
      {/* Activity Logs - GA, Admin */}
      {hasPermission('ACTIVITY_LOGS_VIEW') && (
        <li className={`nav-item ${location.pathname === '/activity-logs' ? 'active' : ''}`}>
          <Link to="/activity-logs" className="nav-link">
            <span className="nav-link-icon">
              <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-1" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
                <path d="M9 9l1 0" />
                <path d="M9 13l6 0" />
                <path d="M9 17l6 0" />
              </svg>
            </span>
            <span className="nav-link-title">Activity Logs</span>
          </Link>
        </li>
      )}
      {/* Suppliers - Staff roles (only if module enabled) */}
      {settings?.suppliersEnabled !== false && hasPermission('USERS_VIEW') && (
        <li className={`nav-item ${location.pathname.startsWith('/suppliers') || location.pathname.startsWith('/supplier-templates') || location.pathname.startsWith('/supplier-documents') ? 'active' : ''}`}>
          <Link to="/suppliers" className="nav-link">
            <span className="nav-link-icon">
              <svg xmlns="http://www.w3.org/2000/svg" className="icon icon-1" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                <path d="M3 21l18 0" />
                <path d="M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16" />
                <path d="M9 7l6 0" />
                <path d="M9 11l6 0" />
                <path d="M9 15l6 0" />
              </svg>
            </span>
            <span className="nav-link-title">Suppliers</span>
          </Link>
        </li>
      )}
    </ul>
  );

  // Disable autocomplete globally for all forms (except login)
  useEffect(() => {
    // More aggressive autocomplete prevention for Chrome
    const disableAutocomplete = () => {
      // Only target forms/inputs within the Layout (not login page)
      const pageWrapper = document.querySelector('.page:not(.page-center)');
      if (!pageWrapper) return;
      
      // Skip if on auth pages
      const isAuthPage = window.location.pathname.includes('/login') ||
                        window.location.pathname.includes('/forgot-password') ||
                        window.location.pathname.includes('/reset-password') ||
                        window.location.pathname.includes('/change-password');
      
      if (isAuthPage) return;
      
      const forms = pageWrapper.querySelectorAll('form');
      const passwordInputs = pageWrapper.querySelectorAll('input[type="password"]');
      const textInputs = pageWrapper.querySelectorAll('input[type="text"], input[type="email"]');
      const allInputs = pageWrapper.querySelectorAll('input, textarea, select');
      
      forms.forEach(form => {
        // Skip if already has autocomplete attribute or is on auth pages
        if (!form.hasAttribute('autocomplete') && !form.closest('.page-center')) {
          form.setAttribute('autocomplete', 'off');
          form.setAttribute('data-form-type', 'other'); // Additional hint for Chrome
        }
      });
      
      // For password fields, use "new-password" which Chrome respects better
      passwordInputs.forEach(input => {
        if (!input.hasAttribute('autocomplete') && !input.closest('.page-center')) {
          input.setAttribute('autocomplete', 'new-password');
          // Add readonly trick - Chrome won't autofill readonly fields
          // Only apply if field is empty
          if (!input.value && !input.hasAttribute('readonly') && !input.hasAttribute('data-readonly-handled')) {
            input.setAttribute('readonly', 'readonly');
            input.setAttribute('data-readonly-handled', 'true');
            input.style.caretColor = 'auto'; // Ensure cursor shows
            
            // Remove readonly on focus
            const handleFocus = (e) => {
              e.target.removeAttribute('readonly');
            };
            
            // Remove readonly on mousedown (before focus) for better UX
            const handleMouseDown = (e) => {
              e.target.removeAttribute('readonly');
            };
            
            input.addEventListener('focus', handleFocus, { once: true });
            input.addEventListener('mousedown', handleMouseDown, { once: true });
          }
        }
      });
      
      // For text/email inputs, use "off"
      textInputs.forEach(input => {
        if (!input.hasAttribute('autocomplete') && !input.closest('.page-center')) {
          input.setAttribute('autocomplete', 'off');
        }
      });
      
      // For other inputs
      allInputs.forEach(input => {
        if (input.type !== 'password' && 
            input.type !== 'text' && 
            input.type !== 'email' &&
            !input.hasAttribute('autocomplete') && 
            !input.closest('.page-center')) {
          input.setAttribute('autocomplete', 'off');
        }
      });
    };
    
    // Run on mount and after route changes
    const timer = setTimeout(disableAutocomplete, 100);
    
    // Also disable for dynamically added inputs (debounced)
    let debounceTimer;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(disableAutocomplete, 150);
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    return () => {
      clearTimeout(timer);
      clearTimeout(debounceTimer);
      observer.disconnect();
    };
  }, [location]);

  return (
    <div className="page" autoComplete="off">
      <PageTitle />
      {/* Navbar - Logo, Menu, Notifications, User Menu all inline */}
      <header className="navbar navbar-expand-md d-print-none">
        <div className="container-fluid">
          <button
            className="navbar-toggler"
            type="button"
            data-bs-toggle="collapse"
            data-bs-target="#navbar-menu"
            aria-controls="navbar-menu"
            aria-expanded="false"
            aria-label="Toggle navigation"
          >
            <span className="navbar-toggler-icon"></span>
          </button>
          
          {/* Logo */}
          <div className="navbar-brand navbar-brand-autodark me-3">
            <Link to="/" className="navbar-brand-image">
              {settings?.logoLight ? (
                <img 
                  src={`${API_BASE_URL}${settings.logoLight}`} 
                  alt={settings.siteTitle || settings.siteName || 'Logo'} 
                  style={{ maxHeight: '32px' }}
                />
              ) : (
                <h3 className="mb-0">{settings?.siteTitle || settings?.siteName || 'Makita Invoice Portal'}</h3>
              )}
            </Link>
          </div>

          {/* Navigation Menu - Inline with logo, collapses on mobile */}
          <div className="collapse navbar-collapse" id="navbar-menu">
            {navItems}
          </div>

          {/* Right side menu items - User */}
          <div className="navbar-nav flex-row order-md-last ms-auto">
            {/* User Dropdown */}
            <div className="nav-item dropdown">
              <Link
                to="#"
                className="nav-link d-flex lh-1 text-reset"
                data-bs-toggle="dropdown"
                aria-label="Open user menu"
                onClick={(e) => e.preventDefault()}
              >
                {user?.avatar ? (
                  <span className="avatar avatar-sm" style={{ backgroundImage: `url(${API_BASE_URL}${user.avatar})` }}></span>
                ) : (
                  <span className={`avatar avatar-sm ${getAvatarColorClass(user?.name)} text-white`}>
                    {getInitials(user?.name)}
                  </span>
                )}
                <div className="d-none d-xl-block ps-2">
                  <div>{user?.name || 'User'}</div>
                  <div className="mt-1 small text-secondary">{getRoleLabel(user?.role) || 'User'}</div>
                </div>
              </Link>
              <div className="dropdown-menu dropdown-menu-end dropdown-menu-arrow">
                <Link to="/profile" className="dropdown-item">My Profile</Link>
                {hasPermission('IMPORT_DATA_VIEW') && (
                  <Link to="/import-data" className="dropdown-item">Import Data</Link>
                )}
                {hasPermission('SETTINGS_VIEW') && (
                  <Link to="/settings" className="dropdown-item">Settings</Link>
                )}
                {hasPermission('TEMPLATES_VIEW') && (
                  <Link to="/templates" className="dropdown-item">Templates</Link>
                )}
                <div className="dropdown-divider"></div>
                <button onClick={handleLogout} className="dropdown-item">Logout</button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="page-wrapper">
        {/* Page header is handled by individual pages, not here */}
        <div className="page-body">
          <div className="container-fluid">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Layout;
