import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../services/api';
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
  
  // Debounced search for server-side filtering
  const [debouncedSearch, setDebouncedSearch] = useState('');
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setUsersPage(1); // Reset to page 1 when search changes
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    fetchManageableRoles();
  }, []);
  
  // Fetch users when pagination or filters change (server-side)
  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usersPage, debouncedSearch, roleFilter, selectedCompanyFilters]);

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
        search: debouncedSearch,
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
        sendEmailAsSummary: selectedUser.sendEmailAsSummary || false
      }));
    }
  }, [selectedUser]);

  const handleCreateUser = async (e) => {
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
      
      await api.post('/api/users', formData);
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
      companyIds: []
    });
    setCompanySearchQuery('');
    setCompanySearchResults([]);
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
      <div>
        <div className="page-header d-print-none">
          <div className="container-fluid">
            <div className="row g-2 align-items-center">
              <div className="col">
                <h2 className="page-title">User Management</h2>
                <div className="text-muted mt-1">Manage users and their permissions</div>
              </div>
            </div>
          </div>
        </div>
        <div className="page-body">
          <div className="container-fluid">
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">
                  <span className="placeholder col-2"></span>
                </h3>
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
      </div>
    );
  }

  return (
    <div>
      <div className="page-header d-print-none">
        <div className="container-fluid">
          <div className="row g-2 align-items-center">
            <div className="col">
              <h2 className="page-title">User Management</h2>
              <div className="text-muted mt-1">Manage users and their permissions</div>
            </div>
            <div className="col-auto ms-auto d-flex gap-2">
              {(currentUser?.role === 'global_admin' || currentUser?.role === 'administrator') && (
                <button
                  className="btn btn-outline-primary"
                  onClick={() => navigate('/users/pending-accounts')}
                >
                  Pending Accounts
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={() => {
                  setSelectedUser(null);
                  setFormData({ name: '', email: '', password: '', role: 'external_user' });
                  setShowModal(true);
                }}
              >
                Add User
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="container-xl">
          <div className="card">
            <div className="card-header">
              <div className="row w-full">
                <div className="col">
                  <h3 className="card-title mb-0">Users</h3>
                  <p className="text-secondary m-0">Manage users and their permissions</p>
                </div>
                <div className="col-md-auto col-sm-12">
                  <div className="ms-auto d-flex flex-wrap btn-list gap-2">
                    {/* Search */}
                    <div className="input-group input-group-flat w-auto">
                      <span className="input-group-text">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="24"
                          height="24"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="icon icon-1"
                        >
                          <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
                          <path d="M21 21l-6 -6" />
                        </svg>
                      </span>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="Search users..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
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
                      <th>2FA</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan="8" className="text-center text-muted py-4">
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
                              {user.id !== currentUser?.id && (
                                <button
                                  className={`btn btn-sm ${user.isActive ? 'btn-warning' : 'btn-success'}`}
                                  onClick={() => handleToggleUserStatus(user.id, user.isActive)}
                                  title={user.isActive ? 'Deactivate Account' : 'Activate Account'}
                                >
                                  {user.isActive ? 'Deactivate' : 'Activate'}
                                </button>
                              )}
                              {user.id !== currentUser?.id && (
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
              {/* Users Pagination */}
              {usersPagination.pages > 1 && (
                <div className="card-footer d-flex justify-content-between align-items-center">
                  <div className="text-muted">
                    Showing {((usersPage - 1) * usersPerPage) + 1} to {Math.min(usersPage * usersPerPage, usersPagination.total)} of {usersPagination.total} users
                  </div>
                  <div className="btn-group">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      disabled={usersPage === 1}
                      onClick={() => setUsersPage(prev => Math.max(1, prev - 1))}
                    >
                      Previous
                    </button>
                    {Array.from({ length: usersPagination.pages }, (_, i) => i + 1)
                      .filter(page => {
                        // Show first, last, and pages around current
                        return page === 1 || page === usersPagination.pages || (page >= usersPage - 2 && page <= usersPage + 2);
                      })
                      .map((page, idx, arr) => {
                        // Add ellipsis
                        const showEllipsisBefore = idx > 0 && page - arr[idx - 1] > 1;
                        return (
                          <React.Fragment key={page}>
                            {showEllipsisBefore && <span className="btn btn-sm btn-outline-secondary disabled">...</span>}
                            <button
                              type="button"
                              className={`btn btn-sm ${usersPage === page ? 'btn-primary' : 'btn-outline-primary'}`}
                              onClick={() => setUsersPage(page)}
                            >
                              {page}
                            </button>
                          </React.Fragment>
                        );
                      })}
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      disabled={usersPage >= usersPagination.pages}
                      onClick={() => setUsersPage(prev => Math.min(usersPagination.pages, prev + 1))}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
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
                      disabled={!!selectedUser}
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
                  {/* Password field for new users - hidden for notification_contact role */}
                  {!selectedUser && formData.role !== 'notification_contact' && (
                    <div className="mb-3">
                      <label className="form-label">Password</label>
                      <input
                        type="password"
                        className="form-control"
                        name="password"
                        value={formData.password || ''}
                        onChange={handleInputChange}
                        placeholder="Leave empty for temporary password"
                        autoComplete="new-password"
                      />
                    </div>
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

