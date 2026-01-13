import axios from 'axios';

// Use REACT_APP_API_URL if set, otherwise use empty string for relative URLs
// This allows configuration via .env files while maintaining relative URL fallback
export const API_BASE_URL = process.env.REACT_APP_API_URL || '';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests if available
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle 401 errors (unauthorized)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Don't redirect if we're already on an auth page (login, forgot-password, etc.)
      // This prevents page refresh loops when login fails
      const authPages = ['/login', '/forgot-password', '/reset-password', '/register', '/two-factor'];
      const isAuthPage = authPages.some(page => window.location.pathname.startsWith(page));
      
      if (!isAuthPage) {
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;

