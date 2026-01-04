import axios from 'axios';

// Empty base URL - all paths already include /api prefix
// This ensures relative requests work on any domain (production uses Nginx proxy)
export const API_BASE_URL = '';

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

