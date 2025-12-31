import React, { createContext, useState, useContext, useEffect } from 'react';
import api, { API_BASE_URL } from '../services/api';

const SettingsContext = createContext();

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await api.get('/api/settings');
      setSettings(response.data);
      
      // Apply dynamic branding
      applyBranding(response.data);
    } catch (error) {
      console.error('Error fetching settings:', error);
      // Set default settings so the app doesn't break
      setSettings({
        companyName: 'eInvoice Portal',
        siteName: 'eInvoice Portal',
        primaryColor: '#066fd1',
        secondaryColor: '#6c757d'
      });
    } finally {
      setLoading(false);
    }
  };

  const applyBranding = (settingsData) => {
    if (!settingsData) return;

    // Apply primary colour
    if (settingsData.primaryColor) {
      document.documentElement.style.setProperty('--tblr-primary', settingsData.primaryColor);
      
      // Apply primary colour shades if available (now in HSLA format)
      if (settingsData.primaryColorShades) {
        document.documentElement.style.setProperty('--tblr-primary-light', settingsData.primaryColorShades.light);
        document.documentElement.style.setProperty('--tblr-primary-lighter', settingsData.primaryColorShades.lighter);
        document.documentElement.style.setProperty('--tblr-primary-dark', settingsData.primaryColorShades.dark);
        document.documentElement.style.setProperty('--tblr-primary-darker', settingsData.primaryColorShades.darker);
      }
    }

    // Apply secondary colour
    if (settingsData.secondaryColor) {
      document.documentElement.style.setProperty('--tblr-secondary', settingsData.secondaryColor);
      
      // Apply secondary colour shades if available (now in HSLA format)
      if (settingsData.secondaryColorShades) {
        document.documentElement.style.setProperty('--tblr-secondary-light', settingsData.secondaryColorShades.light);
        document.documentElement.style.setProperty('--tblr-secondary-lighter', settingsData.secondaryColorShades.lighter);
        document.documentElement.style.setProperty('--tblr-secondary-dark', settingsData.secondaryColorShades.dark);
        document.documentElement.style.setProperty('--tblr-secondary-darker', settingsData.secondaryColorShades.darker);
      }
    }

    // Update favicon
    if (settingsData.favicon) {
      const link = document.querySelector("link[rel~='icon']") || document.createElement('link');
      link.rel = 'icon';
      link.href = `${API_BASE_URL}${settingsData.favicon}`;
      document.getElementsByTagName('head')[0].appendChild(link);
    }

    // Page title will be updated by PageTitle component based on current route
    // Don't set a static title here

    // Set border radius to 0 globally
    document.documentElement.setAttribute('data-bs-theme-radius', '0');
  };

  const value = {
    settings,
    loading,
    refreshSettings: fetchSettings
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

