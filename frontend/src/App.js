import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import Dashboard from './pages/Dashboard';
import Reports from './pages/Reports';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import TwoFactorSetup from './pages/TwoFactorSetup';
import TwoFactorVerify from './pages/TwoFactorVerify';
import ChangePassword from './pages/ChangePassword';
import Settings from './pages/Settings';
import UserManagement from './pages/UserManagement';
import UserView from './pages/UserView';
import PendingAccounts from './pages/PendingAccounts';
import Profile from './pages/Profile';
import Templates from './pages/Templates';
import Companies from './pages/Companies';
import CompanyView from './pages/CompanyView';
import Branches from './pages/Branches';
import AddBranch from './pages/AddBranch';
import AddSubsidiary from './pages/AddSubsidiary';
import Invoices from './pages/Invoices';
import InvoiceView from './pages/InvoiceView';
import InvoiceEdit from './pages/InvoiceEdit';
import CreditNotes from './pages/CreditNotes';
import CreditNoteView from './pages/CreditNoteView';
import Statements from './pages/Statements';
import Unallocated from './pages/Unallocated';
import UnallocatedView from './pages/UnallocatedView';
import ActivityLogs from './pages/ActivityLogs';
import ImportData from './pages/ImportData';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import './App.css';

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  
  // Wait for auth check to complete before redirecting
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
  
  return isAuthenticated ? children : <Navigate to="/login" />;
};

// Admin Route Component - restricts access to specific roles
const AdminRoute = ({ children, allowedRoles = ['global_admin', 'administrator'] }) => {
  const { user, loading } = useAuth();
  
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
  
  if (!user || !allowedRoles.includes(user.role)) {
    return <Navigate to="/" />;
  }
  
  return children;
};

function AppRoutes() {
  return (
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/two-factor-setup" element={<TwoFactorSetup />} />
          <Route path="/two-factor-verify" element={<TwoFactorVerify />} />
          <Route path="/change-password" element={<ChangePassword />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
        {/* Admin-only routes */}
        <Route path="users" element={<AdminRoute><UserManagement /></AdminRoute>} />
        <Route path="users/:id/view" element={<AdminRoute><UserView /></AdminRoute>} />
        <Route path="users/pending-accounts" element={<AdminRoute><PendingAccounts /></AdminRoute>} />
        <Route path="users/pending-accounts/:id" element={<AdminRoute><PendingAccounts /></AdminRoute>} />
        <Route path="profile" element={<Profile />} />
        <Route path="templates" element={<AdminRoute allowedRoles={['global_admin']}><Templates /></AdminRoute>} />
        <Route path="companies" element={<AdminRoute><Companies /></AdminRoute>} />
        <Route path="companies/:id/view" element={<AdminRoute><CompanyView /></AdminRoute>} />
        <Route path="companies/add-branch" element={<AdminRoute><AddBranch /></AdminRoute>} />
        <Route path="companies/add-subsidiary" element={<AdminRoute><AddSubsidiary /></AdminRoute>} />
        <Route path="branches" element={<AdminRoute><Branches /></AdminRoute>} />
        {/* User-accessible routes */}
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/:id/view" element={<InvoiceView />} />
        <Route path="invoices/:id/edit" element={<AdminRoute><InvoiceEdit /></AdminRoute>} />
        <Route path="credit-notes" element={<CreditNotes />} />
        <Route path="credit-notes/:id/view" element={<CreditNoteView />} />
        <Route path="statements" element={<Statements />} />
        {/* Admin-only routes */}
        <Route path="unallocated" element={<AdminRoute><Unallocated /></AdminRoute>} />
        <Route path="unallocated/:id/view" element={<AdminRoute><UnallocatedView /></AdminRoute>} />
        <Route path="activity-logs" element={<AdminRoute><ActivityLogs /></AdminRoute>} />
        <Route path="import-data" element={<AdminRoute><ImportData /></AdminRoute>} />
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <SettingsProvider>
      <AuthProvider>
        <Router
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true
          }}
        >
          <AppRoutes />
        </Router>
      </AuthProvider>
    </SettingsProvider>
  );
}

export default App;