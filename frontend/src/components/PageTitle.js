import { useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useLocation } from 'react-router-dom';

const PageTitle = ({ title }) => {
  const { settings } = useSettings();
  const location = useLocation();

  useEffect(() => {
    const siteTitle = settings?.siteTitle || settings?.siteName || 'Makita Invoice Portal';
    const pageTitle = title || getPageTitleFromPath(location.pathname);
    document.title = `${pageTitle} - ${siteTitle}`;
  }, [settings, location.pathname, title]);

  return null;
};

const getPageTitleFromPath = (pathname) => {
  const titles = {
    '/': 'Dashboard',
    '/invoices': 'Invoices',
    '/credit-notes': 'Credit Notes',
    '/statements': 'Statements',
    '/companies': 'Companies',
    '/branches': 'Branches',
    '/users': 'User Management',
    '/users/pending-accounts': 'Pending Accounts',
    '/settings': 'Settings',
    '/profile': 'My Profile',
    '/import': 'Import Data',
    '/templates': 'Templates',
    '/activity-logs': 'Activity Logs',
    '/unallocated': 'Unallocated Documents',
    '/reports': 'Reports'
  };
  // Handle dynamic routes like /invoices/:id/view
  const basePath = '/' + pathname.split('/')[1];
  return titles[pathname] || titles[basePath] || 'Dashboard';
};

export default PageTitle;

