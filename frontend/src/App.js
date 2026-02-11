import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import Dashboard from './pages/Dashboard';
import Reports from './pages/Reports';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ValidateEmailChange from './pages/ValidateEmailChange';
import TwoFactorSetup from './pages/TwoFactorSetup';
import TwoFactorVerify from './pages/TwoFactorVerify';
import TwoFactorMethodSelect from './pages/TwoFactorMethodSelect';
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
import CreditNoteEdit from './pages/CreditNoteEdit';
// import Statements from './pages/Statements'; // Unused - route is commented out
import Unallocated from './pages/Unallocated';
import UnallocatedView from './pages/UnallocatedView';
import ActivityLogs from './pages/ActivityLogs';
import ImportData from './pages/ImportData';
import Suppliers from './pages/Suppliers';
import SupplierView from './pages/SupplierView';
import EditSupplier from './pages/EditSupplier';
import SupplierDocuments from './pages/SupplierDocuments';
import SupplierDocumentView from './pages/SupplierDocumentView';
import SupplierInvoices from './pages/SupplierInvoices';
import SupplierCreditNotes from './pages/SupplierCreditNotes';
import SupplierStatements from './pages/SupplierStatements';
import InactivityLogout from './components/InactivityLogout';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { PermissionProvider, usePermissions } from './context/PermissionContext';
import './App.css';

// Protected Route Component
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  
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
  
  // If not authenticated, redirect to login with the current location as state
  // This allows the login page to redirect back after successful authentication
  return isAuthenticated ? children : <Navigate to="/login" state={{ from: location }} replace />;
};

// Admin Route Component - restricts access to specific roles (legacy, use PermissionRoute)
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

// Permission Route Component - restricts access based on permissions
const PermissionRoute = ({ children, permission, anyOf, allOf }) => {
  const { loading } = useAuth();
  const { hasPermission, hasAnyPermission, hasAllPermissions } = usePermissions();
  
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
  
  let hasAccess = false;
  
  if (permission) {
    hasAccess = hasPermission(permission);
  } else if (anyOf && anyOf.length > 0) {
    hasAccess = hasAnyPermission(anyOf);
  } else if (allOf && allOf.length > 0) {
    hasAccess = hasAllPermissions(allOf);
  } else {
    hasAccess = true; // No permission specified
  }
  
  if (!hasAccess) {
    return <Navigate to="/" />;
  }
  
  return children;
};

function AppRoutes() {
  return (
    <Routes>
      {/* Public auth routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/validate-email-change" element={<ValidateEmailChange />} />
      <Route path="/two-factor-setup" element={<TwoFactorSetup />} />
      <Route path="/two-factor-verify" element={<TwoFactorVerify />} />
      <Route path="/two-factor-method-select" element={<TwoFactorMethodSelect />} />
      {/* Aliases for shorter 2FA routes */}
      <Route path="/2fa-setup" element={<TwoFactorSetup />} />
      <Route path="/2fa-verify" element={<TwoFactorVerify />} />
      <Route path="/2fa-method-select" element={<TwoFactorMethodSelect />} />
      <Route path="/change-password" element={<ChangePassword />} />
      
      {/* Protected routes - require authentication */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <PermissionProvider>
              <Layout />
            </PermissionProvider>
          </ProtectedRoute>
        }
      >
        {/* Dashboard - all authenticated users */}
        <Route index element={<Dashboard />} />
        
        {/* Profile - all authenticated users */}
        <Route path="profile" element={<Profile />} />
        
        {/* Settings - GA only */}
        <Route path="settings" element={<PermissionRoute permission="SETTINGS_VIEW"><Settings /></PermissionRoute>} />
        
        {/* Templates - GA only */}
        <Route path="templates" element={<PermissionRoute permission="TEMPLATES_VIEW"><Templates /></PermissionRoute>} />
        
        {/* Reports - GA only */}
        <Route path="reports" element={<PermissionRoute permission="REPORTS_VIEW"><Reports /></PermissionRoute>} />
        
        {/* Import Data - GA only */}
        <Route path="import-data" element={<PermissionRoute permission="IMPORT_DATA_VIEW"><ImportData /></PermissionRoute>} />
        
        {/* User Management - GA, Admin, Manager */}
        <Route path="users" element={<PermissionRoute permission="USERS_VIEW"><UserManagement /></PermissionRoute>} />
        <Route path="users/:id/view" element={<PermissionRoute permission="USERS_VIEW"><UserView /></PermissionRoute>} />
        <Route path="users/pending-accounts" element={<PermissionRoute permission="USERS_VIEW"><PendingAccounts /></PermissionRoute>} />
        <Route path="users/pending-accounts/:id" element={<PermissionRoute permission="USERS_VIEW"><PendingAccounts /></PermissionRoute>} />
        
        {/* Companies - Staff roles */}
        <Route path="companies" element={<PermissionRoute permission="COMPANIES_VIEW"><Companies /></PermissionRoute>} />
        <Route path="companies/:id/view" element={<PermissionRoute permission="COMPANIES_VIEW"><CompanyView /></PermissionRoute>} />
        <Route path="companies/add-branch" element={<PermissionRoute permission="COMPANIES_CREATE"><AddBranch /></PermissionRoute>} />
        <Route path="companies/add-subsidiary" element={<PermissionRoute permission="COMPANIES_CREATE"><AddSubsidiary /></PermissionRoute>} />
        <Route path="branches" element={<PermissionRoute permission="COMPANIES_VIEW"><Branches /></PermissionRoute>} />
        
        {/* Invoices - All portal users can view, edit requires permission */}
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/:id/view" element={<InvoiceView />} />
        <Route path="invoices/:id/edit" element={<PermissionRoute permission="INVOICES_EDIT"><InvoiceEdit /></PermissionRoute>} />
        
        {/* Credit Notes - All portal users can view, edit requires permission */}
        <Route path="credit-notes" element={<CreditNotes />} />
        <Route path="credit-notes/:id/view" element={<CreditNoteView />} />
        <Route path="credit-notes/:id/edit" element={<PermissionRoute permission="CREDIT_NOTES_EDIT"><CreditNoteEdit /></PermissionRoute>} />
        
        {/* Statements - HIDDEN until client decides on scope */}
        {/* <Route path="statements" element={<PermissionRoute permission="STATEMENTS_VIEW"><Statements /></PermissionRoute>} /> */}
        
        {/* Unallocated - GA, Admin, Manager */}
        <Route path="unallocated" element={<PermissionRoute permission="UNALLOCATED_VIEW"><Unallocated /></PermissionRoute>} />
        <Route path="unallocated/:id/view" element={<PermissionRoute permission="UNALLOCATED_VIEW"><UnallocatedView /></PermissionRoute>} />
        
        {/* Activity Logs - GA, Admin */}
        <Route path="activity-logs" element={<PermissionRoute permission="ACTIVITY_LOGS_VIEW"><ActivityLogs /></PermissionRoute>} />
        
        {/* Suppliers - Staff roles (only if module enabled) */}
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="suppliers/:id/edit" element={<AdminRoute><EditSupplier /></AdminRoute>} />
        <Route path="suppliers/:id" element={<SupplierView />} />
        <Route path="supplier-invoices" element={<SupplierInvoices />} />
        <Route path="supplier-credit-notes" element={<SupplierCreditNotes />} />
        <Route path="supplier-statements" element={<SupplierStatements />} />
        <Route path="supplier-documents" element={<SupplierDocuments />} />
        <Route path="supplier-documents/:id" element={<SupplierDocumentView />} />
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
          <InactivityLogout />
          <AppRoutes />
        </Router>
      </AuthProvider>
    </SettingsProvider>
  );
}

export default App;