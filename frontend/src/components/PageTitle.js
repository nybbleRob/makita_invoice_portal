import { useEffect } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useLocation } from 'react-router-dom';

const PageTitle = ({ title }) => {
  const { settings } = useSettings();
  const location = useLocation();

  useEffect(() => {
    const siteTitle = settings?.siteTitle || settings?.siteName || 'eInvoice Portal';
    const pageTitle = title || getPageTitleFromPath(location.pathname);
    document.title = `${pageTitle} - ${siteTitle}`;
  }, [settings, location.pathname, title]);

  return null;
};

const getPageTitleFromPath = (pathname) => {
  const titles = {
    '/': 'Dashboard',
    '/reports': 'Reports',
    '/users': 'User Management',
    '/settings': 'Settings',
    '/profile': 'My Profile'
  };
  return titles[pathname] || 'Dashboard';
};

export default PageTitle;

