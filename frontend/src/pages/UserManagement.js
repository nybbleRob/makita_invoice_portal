import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { getRoleLabel, getRoleBadgeClass } from '../utils/roleLabels';
import { useDebounce } from '../hooks/useDebounce';
import HierarchicalCompanyFilter from '../components/HierarchicalCompanyFilter';

const UserManagement = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [manageableRoles, setManageableRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  // Password Management state (for edit modal)
  const [passwordData, setPasswordData] = useState({
    password: '',
    confirmPassword: ''
  });
  const [passwordRequirements, setPasswordRequirements] = useState({
    minLength: false,
    hasUpperCase: false,
    hasLowerCase: false,
    hasNumber: false,
    hasSymbol: false
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [selectedCompanyFilters, setSelectedCompanyFilters] = useState([]); // Array of {id, name, referenceNo}
  const [tempSelectedCompanies, setTempSelectedCompanies] = useState([]); // Temp selection in modal
  const [filterCompanies, setFilterCompanies] = useState([]);
  const [filterCompanySearch, setFilterCompanySearch] = useState('');
  const [filterCompanyPage, setFilterCompanyPage] = useState(1);
  const [filterCompanyTotal, setFilterCompanyTotal] = useState(0);
  const [filterCompanyPages, setFilterCompanyPages] = useState(0);
  const [filterCompanyLoading, setFilterCompanyLoading] = useState(false);
  const [showCompanyFilterModal, setShowCompanyFilterModal] = useState(false);
  const debouncedFilterCompanySearch = useDebounce(filterCompanySearch, 300);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'external_user',
    allCompanies: false,
    sendInvoiceEmail: false,
    sendInvoiceAttachment: false,
    sendStatementEmail: false,
    sendStatementAttachment: false,
    sendEmailAsSummary: false,
    sendImportSummaryReport: false,
    companyIds: []
  });
  
  // Company assignment states
  const [showCompanyAssignmentModal, setShowCompanyAssignmentModal] = useState(false);
  const [userAssignedCompanyObjects, setUserAssignedCompanyObjects] = useState([]); // Full company objects for currently edited user
  
  // Assigned Companies Modal state
  const [showAssignedCompaniesModal, setShowAssignedCompaniesModal] = useState(false);
  const [selectedUserForCompanies, setSelectedUserForCompanies] = useState(null);
  const [assignedCompanies, setAssignedCompanies] = useState({});
  const [loadingAssignedCompanies, setLoadingAssignedCompanies] = useState({});
  const [assignedCompaniesPagination, setAssignedCompaniesPagination] = useState({});
  
  // Users table pagination (server-side)
  const [usersPage, setUsersPage] = useState(1);
  const [usersPagination, setUsersPagination] = useState({ total: 0, pages: 0 });
  const usersPerPage = 50;
  const searchInputRef = useRef(null);
  
  // Active search query - only updates when Search button is clicked or Enter is pressed
  const [activeSearchQuery, setActiveSearchQuery] = useState('');

  useEffect(() => {
    fetchManageableRoles();
  }, []);
  
  // Fetch users when pagination or filters change (server-side)
  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usersPage, activeSearchQuery, roleFilter, selectedCompanyFilters]);

  // Ctrl+K keyboard shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle edit user from UserView navigation
  useEffect(() => {
    const handleEditFromNav = async () => {
      if (location.state && location.state.editUserId) {
        const userId = location.state.editUserId;
        // First check if user is in current list
        const user = users.find(u => u.id === userId);
        if (user) {
          openEditModal(user);
        } else {
          // If not found in current page, fetch the user directly
          try {
            const response = await api.get(`/api/users/${userId}`);
            if (response.data) {
              openEditModal(response.data);
            }
          } catch (error) {
            console.error('Error fetching user for edit:', error);
            toast.error('Failed to load user for editing');
          }
        }
        // Clear the state to prevent re-triggering
        navigate(location.pathname, { replace: true, state: {} });
      }
    };
    handleEditFromNav();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // Client-side status filter (status isn't sent to server to avoid complexity)
  useEffect(() => {
    // Safety check: ensure users is an array
    if (!Array.isArray(users)) {
      setFilteredUsers([]);
      return;
    }
    
    let filtered = [...users];

    // Status filter (client-side only)
    if (statusFilter !== 'all') {
      filtered = filtered.filter(
        (user) => (statusFilter === 'active' && user.isActive) || (statusFilter === 'inactive' && !user.isActive)
      );
    }

    setFilteredUsers(filtered);
  }, [users, statusFilter]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const params = {
        page: usersPage,
        limit: usersPerPage,
        ...(activeSearchQuery && activeSearchQuery.trim().length >= 3 && { search: activeSearchQuery }),
        role: roleFilter !== 'all' ? roleFilter : undefined,
        companyIds: selectedCompanyFilters.length > 0 
          ? selectedCompanyFilters.map(c => c.id).join(',') 
          : undefined
      };
      
      const response = await api.get('/api/users', { params });
      
      // Handle both old (array) and new (paginated) response formats
      if (Array.isArray(response.data)) {
        setUsers(response.data);
        setUsersPagination({ total: response.data.length, pages: 1 });
      } else if (response.data && typeof response.data === 'object') {
        const usersData = Array.isArray(response.data.users) ? response.data.users : [];
        setUsers(usersData);
        setUsersPagination(response.data.pagination || { total: usersData.length, pages: 1 });
      } else {
        setUsers([]);
        setUsersPagination({ total: 0, pages: 0 });
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      setUsers([]); // Reset to empty array on error
      setUsersPagination({ total: 0, pages: 0 });
    } finally {
      setLoading(false);
    }
  };

  const fetchManageableRoles = async () => {
    try {
      const response = await api.get('/api/users/roles/manageable');
      setManageableRoles(response.data);
    } catch (error) {
      console.error('Error fetching roles:', error);
    }
  };

  const fetchFilterCompanies = async (search = '', page = 1) => {
    try {
      setFilterCompanyLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20'
      });
      if (search.trim()) {
        params.append('search', search.trim());
      }
      const response = await api.get(`/api/companies?${params.toString()}`);
      const companies = response.data.data || response.data.companies || response.data || [];
      const total = response.data.total || companies.length;
      const pages = response.data.pages || Math.ceil(total / 20);
      
      setFilterCompanies(Array.isArray(companies) ? companies : []);
      setFilterCompanyTotal(total);
      setFilterCompanyPages(pages);
      setFilterCompanyPage(page);
    } catch (error) {
      console.error('Error fetching companies for filter:', error);
    } finally {
      setFilterCompanyLoading(false);
    }
  };

  // Fetch companies when search or page changes in modal
  useEffect(() => {
    if (showCompanyFilterModal) {
      fetchFilterCompanies(debouncedFilterCompanySearch, 1);
    }
  }, [debouncedFilterCompanySearch, showCompanyFilterModal]);

  const openCompanyFilterModal = () => {
    setTempSelectedCompanies([...selectedCompanyFilters]);
    setFilterCompanySearch('');
    setShowCompanyFilterModal(true);
    fetchFilterCompanies('', 1);
  };

  const handleCompanyFilterToggle = (company) => {
    setTempSelectedCompanies(prev => {
      const exists = prev.find(c => c.id === company.id);
      if (exists) {
        return prev.filter(c => c.id !== company.id);
      } else {
        return [...prev, { id: company.id, name: company.name, referenceNo: company.referenceNo }];
      }
    });
  };

  const removeTempSelectedCompany = (companyId) => {
    setTempSelectedCompanies(prev => prev.filter(c => c.id !== companyId));
  };

  const applyCompanyFilter = () => {
    setSelectedCompanyFilters([...tempSelectedCompanies]);
    setShowCompanyFilterModal(false);
    setUsersPage(1); // Reset to page 1 when filters change
  };

  const clearCompanyFilters = () => {
    setTempSelectedCompanies([]);
  };

  const closeCompanyFilterModal = () => {
    setShowCompanyFilterModal(false);
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value
    });
    
    // Handle conditional checkboxes
    if (name === 'sendInvoiceEmail' && !checked) {
      setFormData(prev => {
        const updated = { ...prev, sendInvoiceAttachment: false };
        // Also disable summary if both invoice and statement emails are disabled
        if (!prev.sendStatementEmail) {
          updated.sendEmailAsSummary = false;
        }
        return updated;
      });
    }
    if (name === 'sendStatementEmail' && !checked) {
      setFormData(prev => {
        const updated = { ...prev, sendStatementAttachment: false };
        // Also disable summary if both invoice and statement emails are disabled
        if (!prev.sendInvoiceEmail) {
          updated.sendEmailAsSummary = false;
        }
        return updated;
      });
    }
  };
  
  // Handle company assignment from hierarchical filter
  const handleCompanyAssignmentChange = (selectedIds) => {
    setFormData(prev => ({
      ...prev,
      companyIds: selectedIds
    }));
  };

  // Handle "All Companies" toggle
  const handleAllCompaniesToggle = (e) => {
    const isEnabled = e.target.checked;
    setFormData(prev => ({
      ...prev,
      allCompanies: isEnabled,
      // Clear company assignments when "All Companies" is enabled
      companyIds: isEnabled ? [] : prev.companyIds
    }));
  };

  // Load assigned companies for modal (with pagination)
  const loadAssignedCompanies = async (userId, page = 1, forceReload = false) => {
    // If already loaded and not forcing reload, don't reload
    if (assignedCompanies[userId] && !forceReload && page === 1) {
      return;
    }

    setLoadingAssignedCompanies(prev => ({ ...prev, [userId]: true }));
    try {
      const response = await api.get(`/api/users/${userId}/companies`, {
        params: { page, limit: 50 }
      });
      setAssignedCompanies(prev => ({ ...prev, [userId]: response.data.companies || response.data.data || [] }));
      if (response.data.pagination) {
        setAssignedCompaniesPagination(prev => ({ ...prev, [userId]: response.data.pagination }));
      } else {
        // If no pagination returned, calculate it
        const total = response.data.total || (response.data.companies || response.data.data || []).length;
        setAssignedCompaniesPagination(prev => ({ 
          ...prev, 
          [userId]: { page, limit: 50, total, pages: Math.ceil(total / 50) } 
        }));
      }
    } catch (error) {
      console.error('Error loading assigned companies:', error);
      toast.error('Failed to load assigned companies');
    } finally {
      setLoadingAssignedCompanies(prev => ({ ...prev, [userId]: false }));
    }
  };

  // Handle opening assigned companies modal (lazy load)
  const handleViewAssignedCompanies = async (user) => {
    setSelectedUserForCompanies(user);
    setShowAssignedCompaniesModal(true);
    // Lazy load companies when modal opens
    if (!assignedCompanies[user.id]) {
      await loadAssignedCompanies(user.id);
    }
  };

  // Helper function to get type badge class
  const getTypeBadgeClass = (type) => {
    const classes = {
      'CORP': 'bg-primary-lt',
      'SUB': 'bg-info-lt',
      'BRANCH': 'bg-success-lt'
    };
    return classes[type] || 'bg-secondary-lt';
  };

  // Helper function to get type label
  const getTypeLabel = (type) => {
    const labels = {
      'CORP': 'Corporate',
      'SUB': 'Subsidiary',
      'BRANCH': 'Branch'
    };
    return labels[type] || type || 'N/A';
  };
  
  // Load user's assigned companies when editing
  useEffect(() => {
    if (selectedUser && selectedUser.companies) {
      setFormData(prev => ({
        ...prev,
        companyIds: selectedUser.companies.map(c => c.id),
        allCompanies: selectedUser.allCompanies || false,
        sendInvoiceEmail: selectedUser.sendInvoiceEmail || false,
        sendInvoiceAttachment: selectedUser.sendInvoiceAttachment || false,
        sendStatementEmail: selectedUser.sendStatementEmail || false,
        sendStatementAttachment: selectedUser.sendStatementAttachment || false,
        sendEmailAsSummary: selectedUser.sendEmailAsSummary || false,
        sendImportSummaryReport: selectedUser.sendImportSummaryReport || false
      }));
    }
  }, [selectedUser]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      // Validate password if provided
      if (passwordData.password) {
        if (passwordData.password !== passwordData.confirmPassword) {
          toast.error('Passwords do not match');
          return;
        }
        if (!isPasswordValid()) {
          toast.error('Password does not meet requirements');
          return;
        }
      }
      
      // Validate email preferences
      if (formData.sendInvoiceAttachment && !formData.sendInvoiceEmail) {
        toast.error('Cannot send invoice attachments without enabling invoice emails');
        return;
      }
      if (formData.sendStatementAttachment && !formData.sendStatementEmail) {
        toast.error('Cannot send statement attachments without enabling statement emails');
        return;
      }
      if (formData.sendEmailAsSummary && !formData.sendInvoiceEmail && !formData.sendStatementEmail) {
        toast.error('Cannot send summary emails without enabling at least invoice or statement emails');
        return;
      }
      
      // Validate external users must have company assignment
      if (formData.role === 'external_user' && !formData.allCompanies && (!formData.companyIds || formData.companyIds.length === 0)) {
        toast.error('External users must be assigned to at least one company or have "All Companies" enabled');
        return;
      }
      
      // Use password from passwordData if provided, otherwise use empty string (will create temporary password)
      const userData = {
        ...formData,
        password: passwordData.password || ''
      };
      
      await api.post('/api/users', userData);
      toast.success('User created successfully!');
      setShowModal(false);
      resetForm();
      fetchUsers();
    } catch (error) {
      toast.error('Error creating user: ' + (error.response?.data?.message || error.message));
    }
  };
  
  const resetForm = () => {
    setFormData({
      name: '',
      email: '',
      password: '',
      role: 'external_user',
      allCompanies: false,
      sendInvoiceEmail: false,
      sendInvoiceAttachment: false,
      sendStatementEmail: false,
      sendStatementAttachment: false,
      sendEmailAsSummary: false,
      sendImportSummaryReport: false,
      companyIds: []
    });
    setPasswordData({
      password: '',
      confirmPassword: ''
    });
    setPasswordRequirements({
      minLength: false,
      hasUpperCase: false,
      hasLowerCase: false,
      hasNumber: false,
      hasSymbol: false
    });
    setUserAssignedCompanyObjects([]);
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    try {
      // Validate email preferences
      if (formData.sendInvoiceAttachment && !formData.sendInvoiceEmail) {
        toast.error('Cannot send invoice attachments without enabling invoice emails');
        return;
      }
      if (formData.sendStatementAttachment && !formData.sendStatementEmail) {
        toast.error('Cannot send statement attachments without enabling statement emails');
        return;
      }
      if (formData.sendEmailAsSummary && !formData.sendInvoiceEmail && !formData.sendStatementEmail) {
        toast.error('Cannot send summary emails without enabling at least invoice or statement emails');
        return;
      }
      
      await api.put(`/api/users/${selectedUser.id}`, formData);
      toast.success('User updated successfully!');
      setShowModal(false);
      setSelectedUser(null);
      resetForm();
      fetchUsers();
    } catch (error) {
      toast.error('Error updating user: ' + (error.response?.data?.message || error.message));
    }
  };
  
  const closeModals = () => {
    setShowModal(false);
    setShowPasswordModal(false);
    setSelectedUser(null);
    setUserAssignedCompanyObjects([]);
    setPasswordData({
      password: '',
      confirmPassword: ''
    });
    setPasswordRequirements({
      minLength: false,
      hasUpperCase: false,
      hasLowerCase: false,
      hasNumber: false,
      hasSymbol: false
    });
    resetForm();
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    
    try {
      await api.delete(`/api/users/${userId}`);
      toast.success('User deleted successfully!');
      setSelectedUserIds(selectedUserIds.filter(id => id !== userId));
      fetchUsers();
    } catch (error) {
      toast.error('Error deleting user: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedUserIds.length === 0) return;
    
    const count = selectedUserIds.length;
    if (!window.confirm(`Are you sure you want to delete ${count} user(s)?`)) return;
    
    try {
      // Delete users in parallel
      await Promise.all(
        selectedUserIds.map((userId) => api.delete(`/api/users/${userId}`))
      );
      toast.success(`${count} user(s) deleted successfully!`);
      setSelectedUserIds([]);
      fetchUsers();
    } catch (error) {
      toast.error('Error deleting users: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleBulkStatusChange = async (isActive) => {
    if (selectedUserIds.length === 0) return;
    
    const count = selectedUserIds.length;
    const action = isActive ? 'activate' : 'deactivate';
    if (!window.confirm(`Are you sure you want to ${action} ${count} user(s)?`)) return;
    
    try {
      const response = await api.post('/api/users/bulk-status', {
        userIds: selectedUserIds,
        isActive
      });
      toast.success(response.data.message);
      setSelectedUserIds([]);
      fetchUsers();
    } catch (error) {
      toast.error('Error updating user status: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleUnlockAccount = async (userId) => {
    if (!window.confirm('Are you sure you want to unlock this account?')) return;
    
    try {
      await api.post(`/api/users/${userId}/unlock`);
      toast.success('Account unlocked successfully!');
      fetchUsers(); // Refresh user list
    } catch (error) {
      toast.error('Error unlocking account: ' + (error.response?.data?.message || error.message));
    }
  };

  // Export users to CSV/XLS/XLSX
  const handleExportUsers = async (format = 'csv') => {
    try {
      const token = localStorage.getItem('token');
      const url = `${API_BASE_URL}/api/users/export?format=${format}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `users-export-${new Date().toISOString().split('T')[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
      
      toast.success(`Users exported to ${format.toUpperCase()} successfully!`);
    } catch (error) {
      toast.error('Error exporting users: ' + error.message);
    }
  };

  // Helper function to check if current user can manage target user's role
  const canManageUserRole = (targetRole) => {
    if (!currentUser) return false;
    const currentRole = currentUser.role;
    
    // Global Admin can manage all roles (including other Global Admins)
    if (currentRole === 'global_admin') {
      return true;
    }
    
    // Administrator can manage other Administrators and roles below their level
    if (currentRole === 'administrator') {
      const ROLE_HIERARCHY = {
        global_admin: 7,
        administrator: 6,
        manager: 5,
        credit_senior: 4,
        credit_controller: 3,
        external_user: 2,
        notification_contact: 1
      };
      const currentLevel = ROLE_HIERARCHY[currentRole] || 0;
      const targetLevel = ROLE_HIERARCHY[targetRole] || 0;
      return currentLevel >= targetLevel;
    }
    
    return false;
  };

  const handleReset2FA = async () => {
    if (!selectedUser) return;
    
    const confirmMessage = `Are you sure you want to reset 2FA for ${selectedUser.name}? They will need to set up 2FA again on their next login.`;
    if (!window.confirm(confirmMessage)) return;
    
    try {
      await api.delete(`/api/users/${selectedUser.id}/two-factor`);
      toast.success('2FA reset successfully!');
      fetchUsers(); // Refresh user list to reflect the change
      // Update selectedUser state to reflect 2FA is now disabled
      setSelectedUser({ ...selectedUser, twoFactorEnabled: false, twoFactorVerified: false });
    } catch (error) {
      toast.error('Error resetting 2FA: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleToggleUserStatus = async (userId, currentStatus) => {
    const newStatus = !currentStatus;
    const action = newStatus ? 'activate' : 'deactivate';
    
    if (!window.confirm(`Are you sure you want to ${action} this user?`)) return;
    
    try {
      const response = await api.put(`/api/users/${userId}/status`, {
        isActive: newStatus
      });
      toast.success(response.data.message);
      fetchUsers();
    } catch (error) {
      toast.error('Error updating user status: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedUserIds(filteredUsers.map((user) => user.id));
    } else {
      setSelectedUserIds([]);
    }
  };

  const handleSelectUser = (userId) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const isAllSelected = filteredUsers.length > 0 && selectedUserIds.length === filteredUsers.length;
  const isSomeSelected = selectedUserIds.length > 0 && selectedUserIds.length < filteredUsers.length;
  const selectAllCheckboxRef = useRef(null);

  // Update indeterminate state of select all checkbox
  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = isSomeSelected;
    }
  }, [isSomeSelected]);

  const handleSetPassword = async (e) => {
    e.preventDefault();
    try {
      await api.put(`/api/users/${selectedUser.id}/password`, {
        password: formData.password
      });
      toast.success('Password set successfully!');
      setShowPasswordModal(false);
      setSelectedUser(null);
      setFormData({ ...formData, password: '' });
    } catch (error) {
      toast.error('Error setting password: ' + (error.response?.data?.message || error.message));
    }
  };

  const openEditModal = async (user) => {
    setSelectedUser(user);
    setFormData({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role,
      allCompanies: user.allCompanies || false,
      sendInvoiceEmail: user.sendInvoiceEmail || false,
      sendInvoiceAttachment: user.sendInvoiceAttachment || false,
      sendStatementEmail: user.sendStatementEmail || false,
      sendStatementAttachment: user.sendStatementAttachment || false,
      sendEmailAsSummary: user.sendEmailAsSummary || false,
      sendImportSummaryReport: user.sendImportSummaryReport || false,
      companyIds: []
    });
    
    // Fetch user's assigned companies (for ALL roles)
    try {
      const response = await api.get(`/api/users/${user.id}/companies`);
      const assignedCompanyList = response.data.companies || [];
      setFormData(prev => ({
        ...prev,
        allCompanies: response.data.allCompanies || false,
        companyIds: assignedCompanyList.map(c => c.id)
      }));
      // Store full company objects so they appear in the pills display
      setUserAssignedCompanyObjects(assignedCompanyList);
    } catch (error) {
      console.error('Error fetching user companies:', error);
      setUserAssignedCompanyObjects([]);
    }
    
    setShowModal(true);
  };

  // Password validation and generation functions
  const validatePassword = (password) => {
    setPasswordRequirements({
      minLength: password.length >= 8,
      hasUpperCase: /[A-Z]/.test(password),
      hasLowerCase: /[a-z]/.test(password),
      hasNumber: /[0-9]/.test(password),
      hasSymbol: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)
    });
  };

  const handlePasswordDataChange = (e) => {
    const { name, value } = e.target;
    setPasswordData(prev => ({ ...prev, [name]: value }));
    if (name === 'password') {
      validatePassword(value);
    }
  };

  const isPasswordValid = () => {
    return Object.values(passwordRequirements).every(req => req === true) && 
           passwordData.password === passwordData.confirmPassword &&
           passwordData.password.length > 0;
  };

  const generatePassword = () => {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const allChars = uppercase + lowercase + numbers + symbols;
    
    // Ensure at least one of each required character type
    let password = '';
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += symbols[Math.floor(Math.random() * symbols.length)];
    
    // Fill the rest to make it 12 characters
    for (let i = password.length; i < 12; i++) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }
    
    // Shuffle the password
    password = password.split('').sort(() => Math.random() - 0.5).join('');
    
    setPasswordData(prev => ({ ...prev, password, confirmPassword: password }));
    validatePassword(password);
  };

  const copyPassword = () => {
    if (passwordData.password) {
      navigator.clipboard.writeText(passwordData.password);
      toast.success('Password copied to clipboard!');
    }
  };

  const handleResetPasswordInModal = async (e) => {
    e.preventDefault();
    if (!isPasswordValid()) {
      toast.error('Please ensure all password requirements are met');
      return;
    }

    if (!selectedUser) return;

    try {
      await api.put(`/api/users/${selectedUser.id}/password`, {
        password: passwordData.password
      });
      toast.success('Password reset successfully!');
      setPasswordData({ password: '', confirmPassword: '' });
      setPasswordRequirements({
        minLength: false,
        hasUpperCase: false,
        hasLowerCase: false,
        hasNumber: false,
        hasSymbol: false
      });
      setShowPassword(false);
      setShowConfirmPassword(false);
    } catch (error) {
      toast.error('Error resetting password: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleResetWithTempPassword = async () => {
    if (!selectedUser) return;
    if (!window.confirm('Reset password with temporary password? An email will be sent to the user.')) return;
    
    try {
      await api.post(`/api/users/${selectedUser.id}/reset-password`);
      toast.success('Temporary password generated and email sent to user!', 5000);
      fetchUsers();
    } catch (error) {
      toast.error('Error resetting password: ' + (error.response?.data?.message || error.message));
    }
  };





  if (loading) {
    return (
      <div className="page-body">
        <div className="container-xl">
          <div className="card">
            <div className="card-header">
              <div className="row w-100 g-3">
                <div className="col-lg-3 col-md-4 col-12">
                  <h3 className="card-title mb-0">Users</h3>
                  <p className="text-secondary m-0">Manage users and their permissions</p>
                </div>
                <div className="col-lg-9 col-md-8 col-12">
                  <div className="d-flex flex-wrap btn-list gap-2 justify-content-md-end">
                    <span className="placeholder btn disabled" style={{ width: '100px' }}></span>
                    <span className="placeholder btn disabled" style={{ width: '80px' }}></span>
                  </div>
                </div>
              </div>
            </div>
              <div className="table-responsive placeholder-glow">
                <table className="table table-vcenter card-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}></th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Companies</th>
                      <th>Status</th>
                      <th>2FA</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...Array(10)].map((_, i) => (
                      <tr key={i}>
                        <td>
                          <span className="placeholder" style={{ width: '16px', height: '16px', borderRadius: '3px' }}></span>
                        </td>
                        <td>
                          <span className="placeholder col-8"></span>
                        </td>
                        <td>
                          <span className="placeholder col-10"></span>
                        </td>
                        <td>
                          <span className="placeholder col-6" style={{ borderRadius: '4px' }}></span>
                        </td>
                        <td>
                          <span className="placeholder col-4"></span>
                        </td>
                        <td>
                          <span className="placeholder col-5" style={{ borderRadius: '4px' }}></span>
                        </td>
                        <td>
                          <span className="placeholder col-5" style={{ borderRadius: '4px' }}></span>
                        </td>
                        <td>
                          <div className="btn-list">
                            <span className="placeholder btn btn-sm disabled" style={{ width: '50px' }}></span>
                            <span className="placeholder btn btn-sm disabled" style={{ width: '40px' }}></span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
    );
  }

  return (
    <div className="page-body">
      <div className="container-xl">
        <div className="card">
          <div className="card-header">
            <div className="row w-100 g-3">
              <div className="col-lg-3 col-md-4 col-12">
                <h3 className="card-title mb-0">Users</h3>
                <p className="text-secondary m-0">Manage users and their permissions</p>
              </div>
              <div className="col-lg-9 col-md-8 col-12">
                <div className="d-flex flex-wrap btn-list gap-2 justify-content-md-end">
                    {/* Search */}
                    <div className="input-group input-group-flat w-auto">
                      <span className="input-group-text">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon icon-1">
                          <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"></path>
                          <path d="M21 21l-6 -6"></path>
                        </svg>
                      </span>
                      <input
                        ref={searchInputRef}
                        type="text"
                        className="form-control"
                        placeholder="Search for Users"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            setActiveSearchQuery(searchQuery);
                            setUsersPage(1);
                          }
                        }}
                        autoComplete="off"
                      />
                      <span className="input-group-text">
                        <kbd>ctrl + K</kbd>
                      </span>
                      <button 
                        className="btn btn-primary" 
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setActiveSearchQuery(searchQuery);
                          setUsersPage(1);
                        }}
                      >
                        Search
                      </button>
                    </div>
                    {/* Status Filter */}
                    <select
                      className="form-select w-auto"
                      value={statusFilter}
                      onChange={(e) => { setStatusFilter(e.target.value); }}
                    >
                      <option value="all">All Status</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                    {/* Role Filter */}
                    <select
                      className="form-select w-auto"
                      value={roleFilter}
                      onChange={(e) => { setRoleFilter(e.target.value); setUsersPage(1); }}
                    >
                      <option value="all">All Roles</option>
                      {manageableRoles.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                    {/* Company Filter Button */}
                    <button
                      type="button"
                      className={`btn ${selectedCompanyFilters.length > 0 ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={openCompanyFilterModal}
                    >
                      {selectedCompanyFilters.length === 0 
                        ? 'Filter by Company' 
                        : `Companies (${selectedCompanyFilters.length})`}
                    </button>
                    {/* Bulk Actions */}
                    {selectedUserIds.length > 0 && (
                      <div className="dropdown">
                        <button
                          className="btn btn-primary dropdown-toggle"
                          type="button"
                          data-bs-toggle="dropdown"
                          aria-expanded="false"
                        >
                          Bulk Actions ({selectedUserIds.length})
                        </button>
                        <ul className="dropdown-menu">
                          <li>
                            <button
                              className="dropdown-item"
                              type="button"
                              onClick={() => handleBulkStatusChange(true)}
                            >
                              Activate Accounts
                            </button>
                          </li>
                          <li>
                            <button
                              className="dropdown-item"
                              type="button"
                              onClick={() => handleBulkStatusChange(false)}
                            >
                              Deactivate Accounts
                            </button>
                          </li>
                          <li><hr className="dropdown-divider" /></li>
                          <li>
                            <button
                              className="dropdown-item text-danger"
                              type="button"
                              onClick={handleBulkDelete}
                            >
                              Delete Selected Users
                            </button>
                          </li>
                        </ul>
                      </div>
                    )}
                    {/* Export dropdown */}
                    {(currentUser?.role === 'global_admin' || currentUser?.role === 'administrator') && (
                      <div className="dropdown">
                        <button
                          className="btn btn-outline-secondary dropdown-toggle"
                          type="button"
                          data-bs-toggle="dropdown"
                          aria-expanded="false"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="me-1">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                          </svg>
                          Export
                        </button>
                        <ul className="dropdown-menu">
                          <li>
                            <button className="dropdown-item" type="button" onClick={() => handleExportUsers('csv')}>
                              Export as CSV
                            </button>
                          </li>
                          <li>
                            <button className="dropdown-item" type="button" onClick={() => handleExportUsers('xlsx')}>
                              Export as XLSX
                            </button>
                          </li>
                        </ul>
                      </div>
                    )}
                    {/* Pending Accounts button */}
                    {(currentUser?.role === 'global_admin' || currentUser?.role === 'administrator') && (
                      <button
                        className="btn btn-outline-primary"
                        onClick={() => navigate('/users/pending-accounts')}
                      >
                        Pending Accounts
                      </button>
                    )}
                    {/* Add User button */}
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        setSelectedUser(null);
                        setFormData({ name: '', email: '', password: '', role: 'external_user' });
                        setPasswordData({ password: '', confirmPassword: '' });
                        setPasswordRequirements({
                          minLength: false,
                          hasUpperCase: false,
                          hasLowerCase: false,
                          hasNumber: false,
                          hasSymbol: false
                        });
                        setShowModal(true);
                      }}
                    >
                      Add User
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="card-body">
              <div className="table-responsive">
                <table className="table table-vcenter table-selectable">
                  <thead>
                    <tr>
                      <th className="w-1">
                        <input
                          ref={selectAllCheckboxRef}
                          className="form-check-input m-0 align-middle"
                          type="checkbox"
                          aria-label="Select all users"
                          checked={isAllSelected}
                          onChange={handleSelectAll}
                        />
                      </th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Assigned Companies</th>
                      <th>Status</th>
                      <th>Lockout</th>
                      <th>2FA</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan="9" className="text-center text-muted py-4">
                          {users.length === 0 ? 'No users found' : 'No users match your filters'}
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.map((user) => (
                        <tr key={user.id}>
                          <td>
                            <input
                              className="form-check-input m-0 align-middle table-selectable-check"
                              type="checkbox"
                              aria-label="Select user"
                              checked={selectedUserIds.includes(user.id)}
                              onChange={() => handleSelectUser(user.id)}
                            />
                          </td>
                          <td>{user.name}</td>
                          <td>{user.email}</td>
                          <td>
                            <span className={`badge ${getRoleBadgeClass(user.role)}`}>
                              {getRoleLabel(user.role)}
                            </span>
                          </td>
                          <td>
                            {user.allCompanies ? (
                              <span className="badge bg-info-lt">All Companies</span>
                            ) : user.companies && user.companies.length > 0 ? (
                              <button
                                className="btn btn-sm btn-link p-0 text-decoration-none"
                                onClick={() => handleViewAssignedCompanies(user)}
                              >
                                {user.companies.length} {user.companies.length === 1 ? 'Company' : 'Companies'}
                              </button>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${user.isActive ? 'bg-success-lt' : 'bg-danger-lt'}`}>
                              {user.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td>
                            {user.accountLockedUntil ? (() => {
                              const lockedUntil = new Date(user.accountLockedUntil);
                              const now = new Date();
                              const isLocked = lockedUntil > now;
                              if (isLocked) {
                                const remainingMinutes = Math.ceil((lockedUntil - now) / (1000 * 60));
                                return (
                                  <span className="badge bg-warning-lt" title={`Locked until ${lockedUntil.toLocaleString()}. Reason: ${user.lockReason || 'brute_force'}`}>
                                    Locked ({remainingMinutes}m)
                                  </span>
                                );
                              }
                              return <span className="badge bg-secondary-lt">Unlocked</span>;
                            })() : (
                              <span className="badge bg-secondary-lt">Unlocked</span>
                            )}
                          </td>
                          <td>
                            {user.twoFactorEnabled ? (
                              <span className="badge bg-success-lt">Enabled</span>
                            ) : (
                              <span className="badge bg-secondary-lt">Disabled</span>
                            )}
                          </td>
                          <td>
                            <div className="btn-list">
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => navigate(`/users/${user.id}/view`)}
                              >
                                View
                              </button>
                              <button
                                className="btn btn-sm btn-info"
                                onClick={() => openEditModal(user)}
                              >
                                Edit
                              </button>
                              {user.id !== currentUser?.id && user.accountLockedUntil && (() => {
                                const lockedUntil = new Date(user.accountLockedUntil);
                                const now = new Date();
                                if (lockedUntil > now) {
                                  return (
                                    <button
                                      className="btn btn-sm btn-success"
                                      onClick={() => handleUnlockAccount(user.id)}
                                      title="Unlock Account"
                                    >
                                      Unlock
                                    </button>
                                  );
                                }
                                return null;
                              })()}
                              {user.id !== currentUser?.id && (
                                <button
                                  className={`btn btn-sm ${user.isActive ? 'btn-warning' : 'btn-success'}`}
                                  onClick={() => handleToggleUserStatus(user.id, user.isActive)}
                                  title={user.isActive ? 'Deactivate Account' : 'Activate Account'}
                                >
                                  {user.isActive ? 'Deactivate' : 'Activate'}
                                </button>
                              )}
                              {user.id !== currentUser?.id && 
                               // Only Global Admins can delete Administrators
                               !(user.role === 'administrator' && currentUser?.role === 'administrator') && (
                                <button
                                  className="btn btn-sm btn-danger"
                                  onClick={() => handleDeleteUser(user.id)}
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              
              {/* Pagination Controls */}
              {usersPagination.total > usersPerPage && (
                <div className="card-footer">
                  <div className="d-flex justify-content-between align-items-center">
                    <div className="text-muted">
                      Showing {((usersPage - 1) * usersPerPage) + 1} to {Math.min(usersPage * usersPerPage, usersPagination.total)} of {usersPagination.total} Users
                    </div>
                    {(() => {
                      // Calculate which page numbers to show
                      const currentPage = usersPage;
                      const totalPages = usersPagination.pages;
                      const pagesToShow = [];
                      
                      if (totalPages <= 7) {
                        // Show all pages if 7 or fewer
                        for (let i = 1; i <= totalPages; i++) {
                          pagesToShow.push(i);
                        }
                      } else {
                        // Show first page
                        pagesToShow.push(1);
                        
                        if (currentPage <= 4) {
                          // Near the start: 1, 2, 3, 4, 5, ..., last
                          for (let i = 2; i <= 5; i++) {
                            pagesToShow.push(i);
                          }
                          pagesToShow.push('ellipsis');
                          pagesToShow.push(totalPages);
                        } else if (currentPage >= totalPages - 3) {
                          // Near the end: 1, ..., last-4, last-3, last-2, last-1, last
                          pagesToShow.push('ellipsis');
                          for (let i = totalPages - 4; i <= totalPages; i++) {
                            pagesToShow.push(i);
                          }
                        } else {
                          // In the middle: 1, ..., current-1, current, current+1, ..., last
                          pagesToShow.push('ellipsis');
                          for (let i = currentPage - 1; i <= currentPage + 1; i++) {
                            pagesToShow.push(i);
                          }
                          pagesToShow.push('ellipsis');
                          pagesToShow.push(totalPages);
                        }
                      }
                      
                      return (
                        <div className="d-flex align-items-center gap-2">
                          {/* Tabler-style pagination */}
                          <ul className="pagination m-0">
                            {/* First page button */}
                            <li className={`page-item ${usersPage === 1 || loading ? 'disabled' : ''}`}>
                              <a 
                                className="page-link" 
                                href="#" 
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (usersPage > 1 && !loading) {
                                    setUsersPage(1);
                                  }
                                }}
                                tabIndex={usersPage === 1 || loading ? -1 : 0}
                                aria-disabled={usersPage === 1 || loading}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="icon">
                                  <path d="M11 7l-5 5l5 5" />
                                  <path d="M17 7l-5 5l5 5" />
                                </svg>
                              </a>
                            </li>
                            {/* Previous page button */}
                            <li className={`page-item ${usersPage === 1 || loading ? 'disabled' : ''}`}>
                              <a 
                                className="page-link" 
                                href="#" 
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (usersPage > 1 && !loading) {
                                    setUsersPage(prev => Math.max(1, prev - 1));
                                  }
                                }}
                                tabIndex={usersPage === 1 || loading ? -1 : 0}
                                aria-disabled={usersPage === 1 || loading}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="icon">
                                  <path d="M15 6l-6 6l6 6" />
                                </svg>
                              </a>
                            </li>
                            {/* Page numbers */}
                            {pagesToShow.map((page, index) => {
                              if (page === 'ellipsis') {
                                return (
                                  <li key={`ellipsis-${index}`} className="page-item disabled">
                                    <span className="page-link">...</span>
                                  </li>
                                );
                              }
                              return (
                                <li key={page} className={`page-item ${page === currentPage ? 'active' : ''}`}>
                                  <a 
                                    className="page-link" 
                                    href="#" 
                                    onClick={(e) => {
                                      e.preventDefault();
                                      if (page !== currentPage && !loading) {
                                        setUsersPage(page);
                                      }
                                    }}
                                  >
                                    {page}
                                  </a>
                                </li>
                              );
                            })}
                            {/* Next page button */}
                            <li className={`page-item ${usersPage >= usersPagination.pages || loading ? 'disabled' : ''}`}>
                              <a 
                                className="page-link" 
                                href="#" 
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (usersPage < usersPagination.pages && !loading) {
                                    setUsersPage(prev => Math.min(usersPagination.pages, prev + 1));
                                  }
                                }}
                                tabIndex={usersPage >= usersPagination.pages || loading ? -1 : 0}
                                aria-disabled={usersPage >= usersPagination.pages || loading}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="icon">
                                  <path d="M9 6l6 6l-6 6" />
                                </svg>
                              </a>
                            </li>
                            {/* Last page button */}
                            <li className={`page-item ${usersPage >= usersPagination.pages || loading ? 'disabled' : ''}`}>
                              <a 
                                className="page-link" 
                                href="#" 
                                onClick={(e) => {
                                  e.preventDefault();
                                  if (usersPage < usersPagination.pages && !loading) {
                                    setUsersPage(usersPagination.pages);
                                  }
                                }}
                                tabIndex={usersPage >= usersPagination.pages || loading ? -1 : 0}
                                aria-disabled={usersPage >= usersPagination.pages || loading}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="icon">
                                  <path d="M7 7l5 5l-5 5" />
                                  <path d="M13 7l5 5l-5 5" />
                                </svg>
                              </a>
                            </li>
                          </ul>
                          {/* Number input box */}
                          <div className="d-flex align-items-center gap-2">
                            <span className="text-muted">Page</span>
                            <input
                              type="number"
                              className="form-control form-control-sm"
                              style={{ width: '70px' }}
                              min="1"
                              max={usersPagination.pages}
                              defaultValue={usersPage}
                              key={usersPage} // Reset input when page changes externally
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  const page = parseInt(e.target.value);
                                  if (page >= 1 && page <= usersPagination.pages) {
                                    setUsersPage(page);
                                  }
                                  e.target.blur();
                                }
                              }}
                              onBlur={(e) => {
                                const page = parseInt(e.target.value);
                                if (page >= 1 && page <= usersPagination.pages && page !== usersPage) {
                                  setUsersPage(page);
                                }
                              }}
                            />
                            <span className="text-muted">of {usersPagination.pages}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

      {/* Add/Edit User Modal */}
      {showModal && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered modal-xl">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {selectedUser ? 'Edit User' : 'Add User'}
                </h5>
                <button type="button" className="btn-close" onClick={closeModals}></button>
              </div>
              <form onSubmit={selectedUser ? handleUpdateUser : handleCreateUser}>
                <div className="modal-body">
                  <div className="row">
                    {/* Left Column - User Details */}
                    <div className="col-md-6">
                      <h4 className="mb-3">User Details</h4>
                  <div className="mb-3">
                    <label className="form-label">Name</label>
                    <input
                      type="text"
                      className="form-control"
                      name="name"
                      value={formData.name || ''}
                      onChange={handleInputChange}
                      required
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Email</label>
                    <input
                      type="email"
                      className="form-control"
                      name="email"
                      value={formData.email || ''}
                      onChange={handleInputChange}
                      required
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Role</label>
                    <select
                      className="form-select"
                      name="role"
                      value={formData.role || 'external_user'}
                      onChange={handleInputChange}
                      required
                    >
                      {manageableRoles.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* Password Management Section for new users - hidden for notification_contact role */}
                  {!selectedUser && formData.role !== 'notification_contact' && (
                    <>
                      <hr className="my-4" />
                      <h4 className="mb-3">Password Management</h4>
                      <div className="mb-3">
                        <label className="form-label">Password</label>
                        <div className="input-group">
                          <input
                            type={showPassword ? 'text' : 'password'}
                            className="form-control"
                            name="password"
                            value={passwordData.password || ''}
                            onChange={handlePasswordDataChange}
                            autoComplete="new-password"
                            placeholder="Leave empty to create user with temporary password"
                          />
                          <button
                            type="button"
                            className="btn btn-outline-secondary"
                            onClick={() => setShowPassword(!showPassword)}
                            title={showPassword ? 'Hide password' : 'Show password'}
                          >
                            {showPassword ? (
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                <line x1="1" y1="1" x2="23" y2="23"></line>
                              </svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                              </svg>
                            )}
                          </button>
                          {passwordData.password && (
                            <button
                              type="button"
                              className="btn btn-outline-secondary"
                              onClick={copyPassword}
                              title="Copy password"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                              </svg>
                            </button>
                          )}
                        </div>
                        <div className="mt-2">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-info mb-2"
                            onClick={generatePassword}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="me-1">
                              <path d="M21 12v1a10 10 0 1 1-9-10"></path>
                              <path d="M12 3v9"></path>
                              <path d="M21 12h-9"></path>
                            </svg>
                            Generate Password
                          </button>
                          {passwordData.password && (
                            <div className="d-flex flex-wrap gap-2">
                              <div className={`badge ${passwordRequirements.minLength ? 'bg-success-lt' : 'bg-secondary-lt'}`}>
                                {passwordRequirements.minLength ? '✓' : '✗'} 8+ Characters
                              </div>
                              <div className={`badge ${passwordRequirements.hasUpperCase ? 'bg-success-lt' : 'bg-secondary-lt'}`}>
                                {passwordRequirements.hasUpperCase ? '✓' : '✗'} Uppercase
                              </div>
                              <div className={`badge ${passwordRequirements.hasLowerCase ? 'bg-success-lt' : 'bg-secondary-lt'}`}>
                                {passwordRequirements.hasLowerCase ? '✓' : '✗'} Lowercase
                              </div>
                              <div className={`badge ${passwordRequirements.hasNumber ? 'bg-success-lt' : 'bg-secondary-lt'}`}>
                                {passwordRequirements.hasNumber ? '✓' : '✗'} Number
                              </div>
                              <div className={`badge ${passwordRequirements.hasSymbol ? 'bg-success-lt' : 'bg-secondary-lt'}`}>
                                {passwordRequirements.hasSymbol ? '✓' : '✗'} Symbol
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="mb-3">
                        <label className="form-label">Confirm Password</label>
                        <div className="input-group">
                          <input
                            type={showConfirmPassword ? 'text' : 'password'}
                            className="form-control"
                            name="confirmPassword"
                            value={passwordData.confirmPassword || ''}
                            onChange={handlePasswordDataChange}
                            autoComplete="new-password"
                            placeholder="Confirm password"
                          />
                          <button
                            type="button"
                            className="btn btn-outline-secondary"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            title={showConfirmPassword ? 'Hide password' : 'Show password'}
                          >
                            {showConfirmPassword ? (
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                <line x1="1" y1="1" x2="23" y2="23"></line>
                              </svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                              </svg>
                            )}
                          </button>
                        </div>
                        {passwordData.confirmPassword && passwordData.password !== passwordData.confirmPassword && (
                          <small className="text-danger">Passwords do not match</small>
                        )}
                      </div>
                      <div className="mb-3">
                        <small className="form-hint d-block">
                          Leave password field empty to create the user with a temporary password. They will be forced to change this on first time login.
                        </small>
                      </div>
                    </>
                  )}
                  {!selectedUser && formData.role === 'notification_contact' && (
                    <div className="alert alert-info mb-3">
                      <strong>Note:</strong> Notification contacts do not require a password as they do not log in to the portal.
                    </div>
                  )}
                  
                  {/* Password Management Section (only when editing, hidden for notification_contact) */}
                  {selectedUser && formData.role !== 'notification_contact' && (
                    <>
                      <hr className="my-4" />
                      <h4 className="mb-3">Password Management</h4>
                      <div className="mb-3">
                        <label className="form-label">New Password</label>
                        <div className="input-group">
                          <input
                            type={showPassword ? 'text' : 'password'}
                            className="form-control"
                            name="password"
                            value={passwordData.password || ''}
                            onChange={handlePasswordDataChange}
                            autoComplete="new-password"
                            placeholder="Leave empty to keep current password"
                          />
                          <button
                            type="button"
                            className="btn btn-outline-secondary"
                            onClick={() => setShowPassword(!showPassword)}
                            title={showPassword ? 'Hide password' : 'Show password'}
                          >
                            {showPassword ? (
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                <line x1="1" y1="1" x2="23" y2="23"></line>
                              </svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                              </svg>
                            )}
                          </button>
                          {passwordData.password && (
                            <button
                              type="button"
                              className="btn btn-outline-secondary"
                              onClick={copyPassword}
                              title="Copy password"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                              </svg>
                            </button>
                          )}
                        </div>
                        <div className="mt-2">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-info mb-2"
                            onClick={generatePassword}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="me-1">
                              <path d="M21 12v1a10 10 0 1 1-9-10"></path>
                              <path d="M12 3v9"></path>
                              <path d="M21 12h-9"></path>
                            </svg>
                            Generate Password
                          </button>
                          {passwordData.password && (
                            <div className="d-flex flex-wrap gap-2">
                              <div className={`badge ${passwordRequirements.minLength ? 'bg-success-lt' : 'bg-secondary-lt'}`}>
                                {passwordRequirements.minLength ? '✓' : '✗'} 8+ Characters
                              </div>
                              <div className={`badge ${passwordRequirements.hasUpperCase ? 'bg-success-lt' : 'bg-secondary-lt'}`}>
                                {passwordRequirements.hasUpperCase ? '✓' : '✗'} Uppercase
                              </div>
                              <div className={`badge ${passwordRequirements.hasLowerCase ? 'bg-success-lt' : 'bg-secondary-lt'}`}>
                                {passwordRequirements.hasLowerCase ? '✓' : '✗'} Lowercase
                              </div>
                              <div className={`badge ${passwordRequirements.hasNumber ? 'bg-success-lt' : 'bg-secondary-lt'}`}>
                                {passwordRequirements.hasNumber ? '✓' : '✗'} Number
                              </div>
                              <div className={`badge ${passwordRequirements.hasSymbol ? 'bg-success-lt' : 'bg-secondary-lt'}`}>
                                {passwordRequirements.hasSymbol ? '✓' : '✗'} Symbol
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="mb-3">
                        <label className="form-label">Confirm Password</label>
                        <div className="input-group">
                          <input
                            type={showConfirmPassword ? 'text' : 'password'}
                            className="form-control"
                            name="confirmPassword"
                            value={passwordData.confirmPassword || ''}
                            onChange={handlePasswordDataChange}
                            autoComplete="new-password"
                            placeholder="Confirm new password"
                          />
                          <button
                            type="button"
                            className="btn btn-outline-secondary"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            title={showConfirmPassword ? 'Hide password' : 'Show password'}
                          >
                            {showConfirmPassword ? (
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                <line x1="1" y1="1" x2="23" y2="23"></line>
                              </svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                              </svg>
                            )}
                          </button>
                        </div>
                        {passwordData.confirmPassword && passwordData.password !== passwordData.confirmPassword && (
                          <small className="text-danger">Passwords do not match</small>
                        )}
                      </div>
                      <div className="mb-3">
                        <button
                          type="button"
                          className="btn btn-warning btn-sm"
                          onClick={handleResetPasswordInModal}
                          disabled={!passwordData.password || !isPasswordValid()}
                        >
                          Reset Password
                        </button>
                        <button
                          type="button"
                          className="btn btn-info btn-sm ms-2"
                          onClick={handleResetWithTempPassword}
                        >
                          Reset With Temporary Password
                        </button>
                        <small className="form-hint d-block mt-2">
                          Reset Password: Set a new password manually. Reset With Temporary Password: Generates a temporary password and sends it via email.
                        </small>
                      </div>
                    </>
                  )}
                  {/* Two-Factor Authentication Section */}
                  {selectedUser && 
                   (currentUser?.role === 'global_admin' || currentUser?.role === 'administrator') &&
                   canManageUserRole(selectedUser.role) && (
                    <>
                      <hr className="my-4" />
                      <h4 className="mb-3">Two-Factor Authentication</h4>
                      <div className="mb-3">
                        <label className="form-label">Status</label>
                        <div className="mb-2">
                          {selectedUser.twoFactorEnabled ? (
                            <span className="badge bg-success-lt">Enabled</span>
                          ) : (
                            <span className="badge bg-secondary-lt">Disabled</span>
                          )}
                        </div>
                        {selectedUser.twoFactorEnabled && (
                          <button
                            type="button"
                            className="btn btn-warning btn-sm"
                            onClick={handleReset2FA}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="me-1">
                              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                              <path d="M21 3v5h-5"></path>
                              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                              <path d="M3 21v-5h5"></path>
                            </svg>
                            Reset 2FA
                          </button>
                        )}
                        {selectedUser.twoFactorEnabled && (
                          <small className="form-hint d-block mt-2">
                            Resetting 2FA will clear the user's 2FA configuration. They will need to set up 2FA again on their next login.
                          </small>
                        )}
                      </div>
                    </>
                  )}
                  {/* Note for notification contacts */}
                  {selectedUser && formData.role === 'notification_contact' && (
                    <>
                      <hr className="my-4" />
                      <div className="alert alert-info mb-0">
                        <strong>Notification Contact:</strong> This user does not log in to the portal and does not require a password. 
                        To grant portal access, change the role to "External User" and set a password.
                      </div>
                    </>
                  )}
                    </div>
                    
                    {/* Right Column - Email Preferences & Company Assignment */}
                    <div className="col-md-6 d-flex flex-column">
                        {/* Email Notifications - Compact Grid Layout */}
                        <div className="mb-4">
                          <label className="form-label">Email Notifications</label>
                          <div className="row g-2">
                            <div className="col-6">
                              <label className="row g-0 p-2 border" style={{ cursor: 'pointer' }}>
                                <span className="col small">Upload Email</span>
                                <span className="col-auto">
                                  <label className="form-check form-check-single form-switch mb-0">
                                    <input
                                      type="checkbox"
                                      className="form-check-input"
                                      name="sendInvoiceEmail"
                                      checked={formData.sendInvoiceEmail || false}
                                      onChange={handleInputChange}
                                    />
                                  </label>
                                </span>
                              </label>
                            </div>
                            <div className="col-6">
                              <label 
                                className="row g-0 p-2 border" 
                                style={{ cursor: formData.sendInvoiceEmail ? 'pointer' : 'default', opacity: formData.sendInvoiceEmail ? 1 : 0.5 }}
                              >
                                <span className="col small">With Attachment</span>
                                <span className="col-auto">
                                  <label className="form-check form-check-single form-switch mb-0">
                                    <input
                                      type="checkbox"
                                      className="form-check-input"
                                      name="sendInvoiceAttachment"
                                      checked={formData.sendInvoiceAttachment || false}
                                      onChange={handleInputChange}
                                      disabled={!formData.sendInvoiceEmail}
                                    />
                                  </label>
                                </span>
                              </label>
                            </div>
                            <div className="col-6">
                              <label className="row g-0 p-2 border" style={{ cursor: 'pointer' }}>
                                <span className="col small">Statement Email</span>
                                <span className="col-auto">
                                  <label className="form-check form-check-single form-switch mb-0">
                                    <input
                                      type="checkbox"
                                      className="form-check-input"
                                      name="sendStatementEmail"
                                      checked={formData.sendStatementEmail || false}
                                      onChange={handleInputChange}
                                    />
                                  </label>
                                </span>
                              </label>
                            </div>
                            <div className="col-6">
                              <label 
                                className="row g-0 p-2 border" 
                                style={{ cursor: formData.sendStatementEmail ? 'pointer' : 'default', opacity: formData.sendStatementEmail ? 1 : 0.5 }}
                              >
                                <span className="col small">With Attachment</span>
                                <span className="col-auto">
                                  <label className="form-check form-check-single form-switch mb-0">
                                    <input
                                      type="checkbox"
                                      className="form-check-input"
                                      name="sendStatementAttachment"
                                      checked={formData.sendStatementAttachment || false}
                                      onChange={handleInputChange}
                                      disabled={!formData.sendStatementEmail}
                                    />
                                  </label>
                                </span>
                              </label>
                            </div>
                            <div className="col-12">
                              <label 
                                className="row g-0 p-2 border" 
                                style={{ cursor: (formData.sendInvoiceEmail || formData.sendStatementEmail) ? 'pointer' : 'default', opacity: (formData.sendInvoiceEmail || formData.sendStatementEmail) ? 1 : 0.5 }}
                              >
                                <span className="col small">Send as Summary</span>
                                <span className="col-auto">
                                  <label className="form-check form-check-single form-switch mb-0">
                                    <input
                                      type="checkbox"
                                      className="form-check-input"
                                      name="sendEmailAsSummary"
                                      checked={formData.sendEmailAsSummary || false}
                                      onChange={handleInputChange}
                                      disabled={!formData.sendInvoiceEmail && !formData.sendStatementEmail}
                                    />
                                  </label>
                                </span>
                              </label>
                            </div>
                          </div>
                          <small className="form-hint mt-1">Receive one summary email per import instead of individual emails</small>
                        </div>
                        
                        {/* Import Summary Report - Only for Global Admins and Administrators */}
                        {(formData.role === 'global_admin' || formData.role === 'administrator') && (
                          <div className="mb-3">
                            <div className="form-selectgroup-item">
                              <label className="row">
                                <span className="col small">Receive Import Summary Reports</span>
                                <span className="col-auto">
                                  <label className="form-check form-check-single form-switch mb-0">
                                    <input
                                      type="checkbox"
                                      className="form-check-input"
                                      name="sendImportSummaryReport"
                                      checked={formData.sendImportSummaryReport || false}
                                      onChange={handleInputChange}
                                    />
                                  </label>
                                </span>
                              </label>
                            </div>
                            <small className="form-hint mt-1">Receive an email summary after each import batch completes (includes: start/finish time, files processed, success/failure counts, unallocated documents)</small>
                          </div>
                        )}
                        
                        {/* Company Assignment */}
                        <h4 className="mb-3">Company Assignment</h4>
                        
                        {/* All Companies Toggle */}
                        <div className="mb-3">
                          <label className="row">
                            <span className="col">All Companies</span>
                            <span className="col-auto">
                              <label className="form-check form-check-single form-switch">
                                <input
                                  className="form-check-input"
                                  type="checkbox"
                                  name="allCompanies"
                                  checked={formData.allCompanies || false}
                                  onChange={handleAllCompaniesToggle}
                                />
                              </label>
                            </span>
                          </label>
                          {formData.allCompanies && (
                            <small className="text-muted d-block mt-2">
                              When enabled, this user can view all invoices, credit notes, and statements from all companies in the database, including any new companies added in the future. Individual company assignments are disabled.
                            </small>
                          )}
                        </div>
                        
                        {!formData.allCompanies && (
                          <>
                            <button
                              type="button"
                              className={`btn w-100 mb-3 ${formData.companyIds?.length > 0 ? 'btn-primary' : 'btn-outline-secondary'}`}
                              onClick={() => setShowCompanyAssignmentModal(true)}
                            >
                              {formData.companyIds?.length > 0 
                                ? `${formData.companyIds.length} Compan${formData.companyIds.length !== 1 ? 'ies' : 'y'} Selected` 
                                : 'Select Companies...'}
                            </button>
                            
                            {/* Show selected company names */}
                            {formData.companyIds?.length > 0 && formData.companyIds.length <= 10 && userAssignedCompanyObjects.length > 0 && (
                              <div className="d-flex flex-wrap gap-1 mb-2">
                                {userAssignedCompanyObjects
                                  .filter(c => formData.companyIds.includes(c.id))
                                  .map(company => (
                                    <span key={company.id} className="badge bg-primary-lt">
                                      {company.name} {company.referenceNo && `(${company.referenceNo})`}
                                    </span>
                                  ))}
                              </div>
                            )}
                            
                            {formData.companyIds?.length > 10 && (
                              <div className="mb-2">
                                <small className="text-muted">
                                  {formData.companyIds.length} companies selected
                                </small>
                              </div>
                            )}
                          </>
                        )}
                        
                        {formData.allCompanies && (
                          <div className="flex-grow-1 d-flex align-items-center justify-content-center" style={{ minHeight: '250px', maxHeight: '300px', border: '1px solid #dee2e6', borderRadius: '4px', padding: '20px' }}>
                            <div className="text-center text-muted">
                              <p className="mb-0">All companies are assigned to this user.</p>
                              <p className="mb-0 small mt-2">Disable "All Companies" to assign specific companies.</p>
                            </div>
                          </div>
                        )}
                      </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-danger" onClick={closeModals}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    {selectedUser ? 'Update' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Assigned Companies Modal */}
      {showAssignedCompaniesModal && selectedUserForCompanies && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered modal-xl">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  Assigned Companies - {selectedUserForCompanies.name}
                  {assignedCompaniesPagination[selectedUserForCompanies.id]?.total > 0 && (
                    <span className="ms-2 text-muted small">
                      ({assignedCompaniesPagination[selectedUserForCompanies.id].total} total)
                    </span>
                  )}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowAssignedCompaniesModal(false);
                    setSelectedUserForCompanies(null);
                  }}
                ></button>
              </div>
              <div className="modal-body">
                {loadingAssignedCompanies[selectedUserForCompanies.id] ? (
                  <div className="text-center py-4">
                    <div className="spinner-border" role="status">
                      <span className="visually-hidden">Loading...</span>
                    </div>
                  </div>
                ) : (assignedCompanies[selectedUserForCompanies.id] || []).length === 0 ? (
                  <div className="text-center text-muted py-4">
                    <p>No companies assigned to this user.</p>
                  </div>
                ) : (
                  <>
                    <div className="table-responsive" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                      <table className="table table-vcenter table-sm">
                        <thead>
                          <tr>
                            <th>Company Name</th>
                            <th>Company Number</th>
                            <th>Type</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(assignedCompanies[selectedUserForCompanies.id] || []).map((company) => (
                            <tr key={company.id}>
                              <td className="fw-medium">{company.name}</td>
                              <td>{company.referenceNo || '-'}</td>
                              <td>
                                <span className={`badge ${getTypeBadgeClass(company.type)}`}>
                                  {getTypeLabel(company.type)}
                                </span>
                              </td>
                              <td>
                                <span className={`badge ${company.isActive ? 'bg-success-lt' : 'bg-danger-lt'}`}>
                                  {company.isActive ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Pagination */}
                    {assignedCompaniesPagination[selectedUserForCompanies.id]?.pages > 1 && (
                      <div className="d-flex justify-content-between align-items-center mt-3">
                        <div className="text-muted small">
                          Page {assignedCompaniesPagination[selectedUserForCompanies.id].page} of {assignedCompaniesPagination[selectedUserForCompanies.id].pages}
                        </div>
                        <div className="btn-group">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary"
                            disabled={assignedCompaniesPagination[selectedUserForCompanies.id].page === 1 || loadingAssignedCompanies[selectedUserForCompanies.id]}
                            onClick={() => loadAssignedCompanies(selectedUserForCompanies.id, assignedCompaniesPagination[selectedUserForCompanies.id].page - 1, true)}
                          >
                            Previous
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary"
                            disabled={assignedCompaniesPagination[selectedUserForCompanies.id].page >= assignedCompaniesPagination[selectedUserForCompanies.id].pages || loadingAssignedCompanies[selectedUserForCompanies.id]}
                            onClick={() => loadAssignedCompanies(selectedUserForCompanies.id, assignedCompaniesPagination[selectedUserForCompanies.id].page + 1, true)}
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowAssignedCompaniesModal(false);
                    setSelectedUserForCompanies(null);
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Set Password Modal */}
      {showPasswordModal && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Set Password for {selectedUser?.name}</h5>
                <button type="button" className="btn-close" onClick={closeModals}></button>
              </div>
              <form onSubmit={handleSetPassword}>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label">New Password</label>
                    <input
                      type="password"
                      className="form-control"
                      name="password"
                      value={formData.password}
                      onChange={handleInputChange}
                      autoComplete="new-password"
                      required
                      minLength="6"
                    />
                    <small className="form-hint">Minimum 6 characters</small>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-danger" onClick={closeModals}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Set Password
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Company Filter Modal */}
      {showCompanyFilterModal && (
        <HierarchicalCompanyFilter
          selectedCompanyIds={selectedCompanyFilters.map(c => c.id)}
          onSelectionChange={(ids) => {
            setSelectedCompanyFilters(ids.map(id => ({ id })));
            setUsersPage(1);
          }}
          onClose={() => setShowCompanyFilterModal(false)}
          onApply={() => setShowCompanyFilterModal(false)}
        />
      )}
      
      {/* Company Assignment Modal for Add/Edit User */}
      {showCompanyAssignmentModal && (
        <HierarchicalCompanyFilter
          selectedCompanyIds={formData.companyIds || []}
          onSelectionChange={handleCompanyAssignmentChange}
          onClose={() => setShowCompanyAssignmentModal(false)}
          onApply={() => setShowCompanyAssignmentModal(false)}
        />
      )}
    </div>
  );
};

export default UserManagement;

