import React, { createContext, useState, useContext, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for stored token
    const token = localStorage.getItem('token');
    if (token) {
      fetchUser();
    } else {
      setLoading(false);
    }
  }, []);

  const fetchUser = async () => {
    try {
      const response = await api.get('/api/auth/me');
      setUser(response.data);
      setIsAuthenticated(true);
    } catch (error) {
      localStorage.removeItem('token');
      setIsAuthenticated(false);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password, skip2FA = false) => {
    try {
      const response = await api.post('/api/auth/login', { email, password });
      
      // Check if 2FA setup is required
      if (response.data.requires2FASetup) {
        return {
          success: false,
          requires2FASetup: true,
          user: response.data.user,
          sessionToken: response.data.sessionToken, // IMPORTANT: Pass session token
          message: response.data.message
        };
      }
      
      // Check if 2FA verification is required
      if (response.data.requires2FA) {
        return {
          success: false,
          requires2FA: true,
          user: response.data.user,
          sessionToken: response.data.sessionToken, // IMPORTANT: Pass session token
          message: response.data.message
        };
      }
      
      // Check if password change is required (first-time login or admin reset)
      if (response.data.mustChangePassword) {
        return {
          success: false,
          mustChangePassword: true,
          user: response.data.user,
          sessionToken: response.data.sessionToken, // IMPORTANT: Pass session token
          message: response.data.message
        };
      }
      
      const { token, user } = response.data;
      
      if (!token || !user) {
        return {
          success: false,
          message: 'Invalid response from server'
        };
      }
      
      localStorage.setItem('token', token);
      setUser(user);
      setIsAuthenticated(true);
      return { success: true };
    } catch (error) {
      console.error('Login API error:', error);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Login failed'
      };
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    setIsAuthenticated(false);
  };

  const refreshUser = async () => {
    await fetchUser();
  };

  const value = {
    user,
    isAuthenticated,
    loading,
    login,
    logout,
    refreshUser
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

