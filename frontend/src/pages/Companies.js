import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { useDebounce } from '../hooks/useDebounce';

const Companies = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user: currentUser } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [filteredCompanies, setFilteredCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
  const [typeFilters, setTypeFilters] = useState({
    CORP: true,
    SUB: true,
    BRANCH: true
  });
  const [statusFilter, setStatusFilter] = useState('all');
  const searchInputRef = useRef(null);
  const [showTypeFilterDropdown, setShowTypeFilterDropdown] = useState(false);
  
  // Parent company filter modal state
  const [showParentFilterModal, setShowParentFilterModal] = useState(false);
  const [parentFilterSearch, setParentFilterSearch] = useState('');
  const [parentFilterCompanies, setParentFilterCompanies] = useState([]);
  const [parentFilterLoading, setParentFilterLoading] = useState(false);
  const [parentFilterPage, setParentFilterPage] = useState(1);
  const [parentFilterTotal, setParentFilterTotal] = useState(0);
  const [parentFilterPages, setParentFilterPages] = useState(0);
  const [tempSelectedParents, setTempSelectedParents] = useState([]);
  const [selectedParentFilters, setSelectedParentFilters] = useState([]);
  const [selectedParentIds, setSelectedParentIds] = useState([]);
  const debouncedParentFilterSearch = useDebounce(parentFilterSearch, 300);
  
  // Modal states
  const [showCorporateModal, setShowCorporateModal] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [showSubsidiaryModal, setShowSubsidiaryModal] = useState(false);
  const [activeTab, setActiveTab] = useState('basic');
  const [editingCompany, setEditingCompany] = useState(null);
  // Modal relationships state - keyed by company ID (for lazy loading)
  const [modalRelationships, setModalRelationships] = useState({});
  const [loadingModalRelationships, setLoadingModalRelationships] = useState({});
  const [showRelationshipsModal, setShowRelationshipsModal] = useState(false);
  const [selectedCompanyForRelationships, setSelectedCompanyForRelationships] = useState(null);
  
  // Confirmation modal states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [companyToDelete, setCompanyToDelete] = useState(null);
  const [companyToDeactivate, setCompanyToDeactivate] = useState(null);
  
  // Form data states
  const [corporateFormData, setCorporateFormData] = useState({
    name: '',
    referenceNo: '',
    edi: false,
    globalSystemEmail: '',
    primaryContactId: null,
    primaryContact: null,
    sendInvoiceEmail: false,
    sendInvoiceAttachment: false,
    sendStatementEmail: false,
    sendStatementAttachment: false,
    sendEmailAsSummary: false,
    isActive: true,
    address: {
      line1: '',
      line2: '',
      city: '',
      state: '',
      zip: '',
      country: ''
    }
  });
  
  const [branchFormData, setBranchFormData] = useState({
    name: '',
    referenceNo: '',
    edi: false,
    globalSystemEmail: '',
    primaryContactId: null,
    primaryContact: null,
    sendInvoiceEmail: false,
    sendInvoiceAttachment: false,
    sendStatementEmail: false,
    sendStatementAttachment: false,
    sendEmailAsSummary: false,
    parentId: null,
    isActive: true,
    address: {
      line1: '',
      line2: '',
      city: '',
      state: '',
      zip: '',
      country: ''
    }
  });
  
  const [subsidiaryFormData, setSubsidiaryFormData] = useState({
    name: '',
    referenceNo: '',
    edi: false,
    globalSystemEmail: '',
    primaryContactId: null,
    primaryContact: null,
    sendInvoiceEmail: false,
    sendInvoiceAttachment: false,
    sendStatementEmail: false,
    sendStatementAttachment: false,
    sendEmailAsSummary: false,
    parentId: null,
    isActive: true,
    address: {
      line1: '',
      line2: '',
      city: '',
      state: '',
      zip: '',
      country: ''
    }
  });
  
  // Parent company selection states
  const [parentSearchQuery, setParentSearchQuery] = useState('');
  const [parentCompanies, setParentCompanies] = useState([]);
  const [parentPagination, setParentPagination] = useState({ page: 1, limit: 20, total: 0, pages: 0 });
  const [loadingParents, setLoadingParents] = useState(false);
  const debouncedParentSearch = useDebounce(parentSearchQuery, 300);
  const debouncedSearch = useDebounce(searchQuery, 300);
  
  // Primary contact / User search states
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [searchedUsers, setSearchedUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const debouncedUserSearch = useDebounce(userSearchQuery, 300);
  
  // Quick Add Contact Modal state
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);
  const [quickAddFormData, setQuickAddFormData] = useState({ 
    name: '', 
    email: '', 
    sendInvoiceEmail: false, 
    sendInvoiceAttachment: false, 
    sendStatementEmail: false, 
    sendStatementAttachment: false, 
    sendEmailAsSummary: false 
  });
  const [quickAddLoading, setQuickAddLoading] = useState(false);
  const [currentFormDataSetter, setCurrentFormDataSetter] = useState(null);
  const [currentCompanyId, setCurrentCompanyId] = useState(null);
  
  const [creating, setCreating] = useState(false);

  // Fetch companies with pagination
  useEffect(() => {
    fetchCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.limit, debouncedSearch, typeFilters, statusFilter, selectedParentIds]);

  // Handle edit from CompanyView page
  useEffect(() => {
    if (location.state?.editCompanyId && companies.length > 0) {
      const companyId = location.state.editCompanyId;
      const company = companies.find(c => c.id === companyId);
      if (company) {
        openEditModal(company);
        // Clear the state to prevent re-triggering
        navigate(location.pathname, { replace: true, state: {} });
      }
    }
  }, [location.state, companies]);

  // Reset to page 1 when filters change
  useEffect(() => {
    if (pagination.page !== 1) {
      setPagination(prev => ({ ...prev, page: 1 }));
    }
  }, [debouncedSearch, typeFilters, statusFilter]);

  // Fetch parent companies when modal opens or search changes
  useEffect(() => {
    if (showBranchModal || showSubsidiaryModal) {
      fetchParentCompanies(1);
    }
  }, [showBranchModal, showSubsidiaryModal, debouncedParentSearch]);

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

  // Parent filter modal - fetch companies when search or modal changes
  useEffect(() => {
    if (showParentFilterModal) {
      fetchParentFilterCompanies(debouncedParentFilterSearch, 1);
    }
  }, [debouncedParentFilterSearch, showParentFilterModal]);

  const fetchParentFilterCompanies = async (search = '', page = 1) => {
    try {
      setParentFilterLoading(true);
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20'
      });
      if (search.trim()) {
        params.append('search', search.trim());
      }
      const response = await api.get(`/api/companies?${params.toString()}`);
      const companiesData = response.data.data || response.data.companies || response.data || [];
      const total = response.data.total || companiesData.length;
      const pages = response.data.pages || Math.ceil(total / 20);
      
      setParentFilterCompanies(Array.isArray(companiesData) ? companiesData : []);
      setParentFilterTotal(total);
      setParentFilterPages(pages);
      setParentFilterPage(page);
    } catch (error) {
      console.error('Error fetching companies for filter:', error);
    } finally {
      setParentFilterLoading(false);
    }
  };

  const openParentFilterModal = () => {
    setTempSelectedParents([...selectedParentFilters]);
    setParentFilterSearch('');
    setShowParentFilterModal(true);
    fetchParentFilterCompanies('', 1);
  };

  const handleParentFilterToggle = (company) => {
    setTempSelectedParents(prev => {
      const exists = prev.find(c => c.id === company.id);
      if (exists) {
        return prev.filter(c => c.id !== company.id);
      } else {
        return [...prev, { id: company.id, name: company.name, referenceNo: company.referenceNo }];
      }
    });
  };

  const removeTempSelectedParent = (companyId) => {
    setTempSelectedParents(prev => prev.filter(c => c.id !== companyId));
  };

  const applyParentFilter = () => {
    const parentIds = tempSelectedParents.map(c => c.id);
    setSelectedParentIds(parentIds);
    setSelectedParentFilters([...tempSelectedParents]);
    setShowParentFilterModal(false);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const clearParentFilters = () => {
    setTempSelectedParents([]);
  };

  const closeParentFilterModal = () => {
    setShowParentFilterModal(false);
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setTypeFilters({ CORP: true, SUB: true, BRANCH: true });
    setSelectedParentIds([]);
    setSelectedParentFilters([]);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const fetchCompanies = async () => {
    try {
      setLoading(true);
      
      // Build query params
      const params = {
        page: pagination.page,
        limit: pagination.limit
      };
      
      if (debouncedSearch.trim()) {
        params.search = debouncedSearch.trim();
      }
      
      // Add type filter - if not all types selected, filter by selected types
      const activeTypes = Object.keys(typeFilters).filter(key => typeFilters[key]);
      if (activeTypes.length < 3) {
        // If not all types selected, we'll filter on frontend for now
        // Backend doesn't support multiple type filter
      }
      
      if (statusFilter !== 'all') {
        params.isActive = statusFilter === 'active';
      }
      
      const response = await api.get('/api/companies', { params });
      
      // Handle paginated response
      if (response.data && response.data.data) {
        let companiesData = response.data.data || [];
        
        // Apply type filter on frontend if needed
        const activeTypes = Object.keys(typeFilters).filter(key => typeFilters[key]);
        if (activeTypes.length < 3) {
          companiesData = companiesData.filter((company) => activeTypes.includes(company.type));
        }
        
        // Apply parent filter on frontend if selected
        if (selectedParentIds.length > 0) {
          companiesData = companiesData.filter((company) => selectedParentIds.includes(company.id));
        }
        
        setCompanies(companiesData);
        setFilteredCompanies(companiesData);
        
        // Update pagination - note: total may be slightly off if filtering by type on frontend
        // but this is acceptable for now since backend doesn't support multiple type filters
        setPagination(prev => ({
          ...prev,
          total: response.data.pagination?.total || 0,
          pages: response.data.pagination?.pages || 0
        }));
      } else {
        // Fallback for non-paginated response
        let companiesData = Array.isArray(response.data) ? response.data : [];
        
        // Apply type filter on frontend if needed
        const activeTypes = Object.keys(typeFilters).filter(key => typeFilters[key]);
        if (activeTypes.length < 3) {
          companiesData = companiesData.filter((company) => activeTypes.includes(company.type));
        }
        
        // Apply parent filter on frontend if selected
        if (selectedParentIds.length > 0) {
          companiesData = companiesData.filter((company) => selectedParentIds.includes(company.id));
        }
        
        setCompanies(companiesData);
        setFilteredCompanies(companiesData);
        
        // Set pagination for non-paginated response
        setPagination(prev => ({
          ...prev,
          total: companiesData.length,
          pages: Math.ceil(companiesData.length / prev.limit)
        }));
      }
    } catch (error) {
      console.error('Error fetching companies:', error);
      toast.error('Failed to fetch companies: ' + (error.response?.data?.message || error.message));
      setCompanies([]);
      setFilteredCompanies([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchParentCompanies = async (page = 1) => {
    try {
      setLoadingParents(true);
      const response = await api.get('/api/companies/parents', {
        params: {
          page,
          limit: 20,
          search: debouncedParentSearch
        }
      });
      setParentCompanies(response.data.data);
      setParentPagination(response.data.pagination);
    } catch (error) {
      console.error('Error fetching parent companies:', error);
      toast.error('Failed to fetch parent companies: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoadingParents(false);
    }
  };

  // Fetch users for primary contact selection
  const fetchUsers = async (searchTerm = '') => {
    try {
      setLoadingUsers(true);
      const response = await api.get('/users', {
        params: {
          page: 1,
          limit: 20,
          search: searchTerm
        }
      });
      // Ensure we always get an array
      const users = response.data?.data || response.data?.users || response.data;
      setSearchedUsers(Array.isArray(users) ? users : []);
    } catch (error) {
      console.error('Error fetching users:', error);
      setSearchedUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  // Fetch users when user search changes
  useEffect(() => {
    if (showCorporateModal || showBranchModal || showSubsidiaryModal) {
      fetchUsers(debouncedUserSearch);
    }
  }, [showCorporateModal, showBranchModal, showSubsidiaryModal, debouncedUserSearch]);

  // Handle quick add notification contact
  const handleQuickAddContact = async (companyId, setFormData) => {
    if (!quickAddFormData.email) {
      toast.error('Email is required');
      return;
    }

    try {
      setQuickAddLoading(true);
      
      const notificationSettings = {
        sendInvoiceEmail: quickAddFormData.sendInvoiceEmail || false,
        sendInvoiceAttachment: quickAddFormData.sendInvoiceAttachment || false,
        sendStatementEmail: quickAddFormData.sendStatementEmail || false,
        sendStatementAttachment: quickAddFormData.sendStatementAttachment || false,
        sendEmailAsSummary: quickAddFormData.sendEmailAsSummary || false
      };
      
      // If we have a company ID (editing), use the company endpoint
      if (companyId) {
        const response = await api.post(`/companies/${companyId}/notification-contact`, {
          name: quickAddFormData.name || quickAddFormData.email.split('@')[0],
          email: quickAddFormData.email,
          setAsPrimary: true,
          ...notificationSettings
        });
        
        setFormData(prev => ({
          ...prev,
          primaryContactId: response.data.user.id,
          primaryContact: response.data.user,
          ...notificationSettings
        }));
        
        toast.success(response.data.message);
      } else {
        // Creating new company - create user first, then set as primary contact
        const response = await api.post('/users', {
          name: quickAddFormData.name || quickAddFormData.email.split('@')[0],
          email: quickAddFormData.email,
          role: 'notification_contact',
          ...notificationSettings
        });
        
        setFormData(prev => ({
          ...prev,
          primaryContactId: response.data.id,
          primaryContact: response.data,
          ...notificationSettings
        }));
        
        toast.success('Notification contact created');
      }
      
      setShowQuickAddModal(false);
      setQuickAddFormData({ 
        name: '', 
        email: '', 
        sendInvoiceEmail: false, 
        sendInvoiceAttachment: false, 
        sendStatementEmail: false, 
        sendStatementAttachment: false, 
        sendEmailAsSummary: false 
      });
      fetchUsers(debouncedUserSearch); // Refresh user list
    } catch (error) {
      console.error('Error creating notification contact:', error);
      toast.error(error.response?.data?.message || 'Failed to create notification contact');
    } finally {
      setQuickAddLoading(false);
    }
  };

  const handleTypeFilterChange = (type) => {
    setTypeFilters(prev => ({
      ...prev,
      [type]: !prev[type]
    }));
  };

  const handleSelectCompany = (companyId) => {
    setSelectedCompanyIds((prev) =>
      prev.includes(companyId)
        ? prev.filter((id) => id !== companyId)
        : [...prev, companyId]
    );
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedCompanyIds(filteredCompanies.map((company) => company.id));
    } else {
      setSelectedCompanyIds([]);
    }
  };

  const isAllSelected = filteredCompanies.length > 0 && selectedCompanyIds.length === filteredCompanies.length;
  const isSomeSelected = selectedCompanyIds.length > 0 && selectedCompanyIds.length < filteredCompanies.length;
  const selectAllCheckboxRef = useRef(null);

  // Update indeterminate state of select all checkbox
  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = isSomeSelected;
    }
  }, [isSomeSelected]);

  const handleToggleStatus = async (company) => {
    setCompanyToDeactivate(company);
    setShowDeactivateModal(true);
  };

  const confirmDeactivate = async () => {
    if (!companyToDeactivate) return;
    
    try {
      await api.put(`/api/companies/${companyToDeactivate.id}`, {
        isActive: !companyToDeactivate.isActive
      });
      toast.success(`Company ${!companyToDeactivate.isActive ? 'activated' : 'deactivated'} successfully!`);
      fetchCompanies();
      setShowDeactivateModal(false);
      setCompanyToDeactivate(null);
    } catch (error) {
      toast.error('Error updating company status: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleDeleteCompany = (companyId) => {
    const company = companies.find(c => c.id === companyId);
    setCompanyToDelete(company);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!companyToDelete) return;
    
    try {
      await api.delete(`/api/companies/${companyToDelete.id}`);
      toast.success('Company deleted successfully!');
      fetchCompanies();
      setSelectedCompanyIds(selectedCompanyIds.filter(id => id !== companyToDelete.id));
      setShowDeleteModal(false);
      setCompanyToDelete(null);
    } catch (error) {
      toast.error('Error deleting company: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedCompanyIds.length === 0) return;
    
    const count = selectedCompanyIds.length;
    if (!window.confirm(`Are you sure you want to delete ${count} company(ies)?`)) return;
    
    try {
      await Promise.all(
        selectedCompanyIds.map((companyId) => api.delete(`/api/companies/${companyId}`))
      );
      toast.success(`${count} company(ies) deleted successfully!`);
      setSelectedCompanyIds([]);
      fetchCompanies();
    } catch (error) {
      toast.error('Error deleting companies: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleBulkStatusChange = async (isActive) => {
    if (selectedCompanyIds.length === 0) return;
    
    const count = selectedCompanyIds.length;
    const action = isActive ? 'activate' : 'deactivate';
    if (!window.confirm(`Are you sure you want to ${action} ${count} company(ies)?`)) return;
    
    try {
      await Promise.all(
        selectedCompanyIds.map((companyId) => 
          api.put(`/api/companies/${companyId}`, { isActive })
        )
      );
      toast.success(`${count} company(ies) ${action}d successfully!`);
      setSelectedCompanyIds([]);
      fetchCompanies();
    } catch (error) {
      toast.error(`Error ${action}ing companies: ` + (error.response?.data?.message || error.message));
    }
  };

  const handleBulkEDIChange = async (enabled) => {
    if (selectedCompanyIds.length === 0) return;
    
    const count = selectedCompanyIds.length;
    const action = enabled ? 'enable' : 'disable';
    if (!window.confirm(`Are you sure you want to ${action} EDI for ${count} company(ies)?`)) return;
    
    try {
      await Promise.all(
        selectedCompanyIds.map((companyId) => 
          api.put(`/api/companies/${companyId}`, { edi: enabled })
        )
      );
      toast.success(`EDI ${action}d for ${count} company(ies) successfully!`);
      setSelectedCompanyIds([]);
      fetchCompanies();
    } catch (error) {
      toast.error(`Error ${action}ing EDI: ` + (error.response?.data?.message || error.message));
    }
  };

  const handleBulkEmailNotificationsChange = async (enabled) => {
    if (selectedCompanyIds.length === 0) return;
    
    const count = selectedCompanyIds.length;
    const action = enabled ? 'enable' : 'disable';
    if (!window.confirm(`Are you sure you want to ${action} all email notifications for ${count} company(ies)?`)) return;
    
    try {
      await Promise.all(
        selectedCompanyIds.map((companyId) => 
          api.put(`/api/companies/${companyId}`, { 
            sendInvoiceEmail: enabled,
            sendInvoiceAttachment: enabled,
            sendStatementEmail: enabled,
            sendStatementAttachment: enabled
          })
        )
      );
      toast.success(`Email notifications ${action}d for ${count} company(ies) successfully!`);
      setSelectedCompanyIds([]);
      fetchCompanies();
    } catch (error) {
      toast.error(`Error ${action}ing email notifications: ` + (error.response?.data?.message || error.message));
    }
  };

  // Check if user is administrator
  const isAdministrator = () => {
    return currentUser?.role === 'global_admin' || currentUser?.role === 'administrator';
  };

  const resetCorporateForm = () => {
    setCorporateFormData({
      name: '',
      referenceNo: '',
      edi: false,
      globalSystemEmail: '',
      primaryContactId: null,
      primaryContact: null,
      sendInvoiceEmail: false,
      sendInvoiceAttachment: false,
      sendStatementEmail: false,
      sendStatementAttachment: false,
      sendEmailAsSummary: false,
      isActive: true,
      address: {
        line1: '',
        line2: '',
        city: '',
        state: '',
        zip: '',
        country: ''
      }
    });
    setUserSearchQuery('');
    setActiveTab('basic');
    setEditingCompany(null);
  };

  const resetBranchForm = () => {
    setBranchFormData({
      name: '',
      referenceNo: '',
      edi: false,
      globalSystemEmail: '',
      primaryContactId: null,
      primaryContact: null,
      sendInvoiceEmail: false,
      sendInvoiceAttachment: false,
      sendStatementEmail: false,
      sendStatementAttachment: false,
      sendEmailAsSummary: false,
      parentId: null,
      isActive: true,
      address: {
        line1: '',
        line2: '',
        city: '',
        state: '',
        zip: '',
        country: ''
      }
    });
    setParentSearchQuery('');
    setUserSearchQuery('');
    setActiveTab('basic');
    setEditingCompany(null);
  };

  const resetSubsidiaryForm = () => {
    setSubsidiaryFormData({
      name: '',
      referenceNo: '',
      edi: false,
      globalSystemEmail: '',
      primaryContactId: null,
      primaryContact: null,
      sendInvoiceEmail: false,
      sendInvoiceAttachment: false,
      sendStatementEmail: false,
      sendStatementAttachment: false,
      sendEmailAsSummary: false,
      parentId: null,
      isActive: true,
      address: {
        line1: '',
        line2: '',
        city: '',
        state: '',
        zip: '',
        country: ''
      }
    });
    setParentSearchQuery('');
    setUserSearchQuery('');
    setActiveTab('basic');
    setEditingCompany(null);
  };


  const openEditModal = (company) => {
    setEditingCompany(company);
    
    const formData = {
      name: company.name || '',
      referenceNo: company.referenceNo || '',
      edi: company.edi || false,
      globalSystemEmail: company.globalSystemEmail || '',
      primaryContactId: company.primaryContactId || null,
      primaryContact: company.primaryContact || null,
      sendInvoiceEmail: company.sendInvoiceEmail || false,
      sendInvoiceAttachment: company.sendInvoiceAttachment || false,
      sendStatementEmail: company.sendStatementEmail || false,
      sendStatementAttachment: company.sendStatementAttachment || false,
      sendEmailAsSummary: company.sendEmailAsSummary || false,
      parentId: company.parentId || null,
      isActive: company.isActive !== undefined ? company.isActive : true,
      address: company.address || {
        line1: '',
        line2: '',
        city: '',
        state: '',
        zip: '',
        country: ''
      }
    };

    if (company.type === 'CORP') {
      setCorporateFormData(formData);
      setShowCorporateModal(true);
    } else if (company.type === 'BRANCH') {
      setBranchFormData(formData);
      setShowBranchModal(true);
      // Fetch parent companies when editing branch
      fetchParentCompanies(1);
    } else if (company.type === 'SUB') {
      setSubsidiaryFormData(formData);
      setShowSubsidiaryModal(true);
      // Fetch parent companies when editing subsidiary
      fetchParentCompanies(1);
    }
    
    setActiveTab('basic');
  };

  const handleCreateCorporate = async (e) => {
    e.preventDefault();
    if (!corporateFormData.name.trim()) {
      toast.error('Company name is required');
      return;
    }

    try {
      setCreating(true);
      const payload = {
        name: corporateFormData.name.trim(),
        type: 'CORP',
        referenceNo: corporateFormData.referenceNo ? parseInt(corporateFormData.referenceNo) : null,
        edi: corporateFormData.edi,
        globalSystemEmail: corporateFormData.globalSystemEmail || null,
        primaryContactId: corporateFormData.primaryContactId || null,
        sendInvoiceEmail: corporateFormData.sendInvoiceEmail || false,
        sendInvoiceAttachment: corporateFormData.sendInvoiceAttachment || false,
        sendStatementEmail: corporateFormData.sendStatementEmail || false,
        sendStatementAttachment: corporateFormData.sendStatementAttachment || false,
        sendEmailAsSummary: corporateFormData.sendEmailAsSummary || false,
        isActive: editingCompany ? corporateFormData.isActive : true,
        address: corporateFormData.address
      };

      if (editingCompany) {
        await api.put(`/api/companies/${editingCompany.id}`, payload);
        toast.success('Corporate company updated successfully!');
      } else {
        await api.post('/api/companies', payload);
        toast.success('Corporate company created successfully!');
      }
      setShowCorporateModal(false);
      resetCorporateForm();
      setEditingCompany(null);
      fetchCompanies();
    } catch (error) {
      toast.error(`Error ${editingCompany ? 'updating' : 'creating'} company: ` + (error.response?.data?.message || error.message));
    } finally {
      setCreating(false);
    }
  };

  const handleCreateBranch = async (e) => {
    e.preventDefault();
    if (!branchFormData.name.trim()) {
      toast.error('Company name is required');
      return;
    }
    if (!editingCompany && !branchFormData.parentId) {
      toast.error('Please select a parent company');
      return;
    }

    try {
      setCreating(true);
      const payload = {
        name: branchFormData.name.trim(),
        type: 'BRANCH',
        referenceNo: branchFormData.referenceNo ? parseInt(branchFormData.referenceNo) : null,
        edi: branchFormData.edi,
        globalSystemEmail: branchFormData.globalSystemEmail || null,
        primaryContactId: branchFormData.primaryContactId || null,
        sendInvoiceEmail: branchFormData.sendInvoiceEmail || false,
        sendInvoiceAttachment: branchFormData.sendInvoiceAttachment || false,
        sendStatementEmail: branchFormData.sendStatementEmail || false,
        sendStatementAttachment: branchFormData.sendStatementAttachment || false,
        sendEmailAsSummary: branchFormData.sendEmailAsSummary || false,
        isActive: editingCompany ? branchFormData.isActive : true,
        address: branchFormData.address
      };

      if (editingCompany) {
        // Only update parentId if it's being changed
        if (branchFormData.parentId !== editingCompany.parentId) {
          payload.parentId = branchFormData.parentId;
        }
        await api.put(`/api/companies/${editingCompany.id}`, payload);
        toast.success('Branch updated successfully!');
      } else {
        payload.parentId = branchFormData.parentId;
        await api.post('/api/companies', payload);
        toast.success('Branch created successfully!');
      }
      setShowBranchModal(false);
      resetBranchForm();
      setEditingCompany(null);
      fetchCompanies();
    } catch (error) {
      toast.error(`Error ${editingCompany ? 'updating' : 'creating'} branch: ` + (error.response?.data?.message || error.message));
    } finally {
      setCreating(false);
    }
  };

  const handleCreateSubsidiary = async (e) => {
    e.preventDefault();
    if (!subsidiaryFormData.name.trim()) {
      toast.error('Company name is required');
      return;
    }
    if (!editingCompany && !subsidiaryFormData.parentId) {
      toast.error('Please select a parent company');
      return;
    }

    try {
      setCreating(true);
      const payload = {
        name: subsidiaryFormData.name.trim(),
        type: 'SUB',
        referenceNo: subsidiaryFormData.referenceNo ? parseInt(subsidiaryFormData.referenceNo) : null,
        edi: subsidiaryFormData.edi,
        globalSystemEmail: subsidiaryFormData.globalSystemEmail || null,
        primaryContactId: subsidiaryFormData.primaryContactId || null,
        sendInvoiceEmail: subsidiaryFormData.sendInvoiceEmail || false,
        sendInvoiceAttachment: subsidiaryFormData.sendInvoiceAttachment || false,
        sendStatementEmail: subsidiaryFormData.sendStatementEmail || false,
        sendStatementAttachment: subsidiaryFormData.sendStatementAttachment || false,
        sendEmailAsSummary: subsidiaryFormData.sendEmailAsSummary || false,
        isActive: editingCompany ? subsidiaryFormData.isActive : true,
        address: subsidiaryFormData.address
      };

      if (editingCompany) {
        // Only update parentId if it's being changed
        if (subsidiaryFormData.parentId !== editingCompany.parentId) {
          payload.parentId = subsidiaryFormData.parentId;
        }
        await api.put(`/api/companies/${editingCompany.id}`, payload);
        toast.success('Subsidiary updated successfully!');
      } else {
        payload.parentId = subsidiaryFormData.parentId;
        await api.post('/api/companies', payload);
        toast.success('Subsidiary created successfully!');
      }
      setShowSubsidiaryModal(false);
      resetSubsidiaryForm();
      setEditingCompany(null);
      fetchCompanies();
    } catch (error) {
      toast.error(`Error ${editingCompany ? 'updating' : 'creating'} subsidiary: ` + (error.response?.data?.message || error.message));
    } finally {
      setCreating(false);
    }
  };

  const getTypeLabel = (type) => {
    const labels = {
      'CORP': 'Corporate',
      'SUB': 'Subsidiary',
      'BRANCH': 'Branch'
    };
    return labels[type] || type || 'N/A';
  };

  const getTypeBadgeClass = (type) => {
    const classes = {
      'CORP': 'bg-primary-lt',
      'SUB': 'bg-info-lt',
      'BRANCH': 'bg-success-lt'
    };
    return classes[type] || 'bg-secondary-lt';
  };

  const getParentCompany = (company) => {
    if (company.parent) {
      return company.parent;
    }
    if (company.parentId) {
      return companies.find(c => c.id === company.parentId) || null;
    }
    return null;
  };

  // Check if company has children
  const hasChildren = (company) => {
    return companies.some(c => c.parentId === company.id);
  };

  // Load relationships for modal (lazy load)
  const loadModalRelationships = async (companyId) => {
    // If already loaded, don't reload
    if (modalRelationships[companyId]) {
      return;
    }

    setLoadingModalRelationships(prev => ({ ...prev, [companyId]: true }));
    try {
      const response = await api.get(`/api/companies/${companyId}/relationships`);
      setModalRelationships(prev => ({ ...prev, [companyId]: response.data }));
    } catch (error) {
      console.error('Error loading modal relationships:', error);
      toast.error('Failed to load relationships');
    } finally {
      setLoadingModalRelationships(prev => ({ ...prev, [companyId]: false }));
    }
  };

  // Handle opening relationships modal (lazy load)
  const handleViewRelationshipsModal = async (company) => {
    setSelectedCompanyForRelationships(company);
    setShowRelationshipsModal(true);
    // Lazy load relationships when modal opens
    if (!modalRelationships[company.id]) {
      await loadModalRelationships(company.id);
    }
  };

  const renderModal = (type, show, onClose, formData, setFormData, onSubmit, resetForm) => {
    const isBranch = type === 'BRANCH';
    const isSubsidiary = type === 'SUB';
    const needsParent = isBranch || isSubsidiary;
    const isEditing = !!editingCompany;
    const title = isEditing 
      ? (isBranch ? 'Edit Branch' : isSubsidiary ? 'Edit Subsidiary' : 'Edit Corporate Company')
      : (isBranch ? 'Add Branch' : isSubsidiary ? 'Add Subsidiary' : 'Add Corporate Company');

    return (
      show && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-xl modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{title}</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    onClose();
                    resetForm();
                  }}
                ></button>
              </div>
              <form onSubmit={onSubmit}>
                <div className="modal-body">
                  <div className="card">
                    <div className="card-header">
                      <ul className="nav nav-tabs card-header-tabs" data-bs-toggle="tabs">
                        <li className="nav-item">
                          <a
                            href="#basic-info"
                            className={`nav-link ${activeTab === 'basic' ? 'active' : ''}`}
                            onClick={(e) => {
                              e.preventDefault();
                              setActiveTab('basic');
                            }}
                          >
                            Basic Info
                          </a>
                        </li>
                        <li className="nav-item">
                          <a
                            href="#address"
                            className={`nav-link ${activeTab === 'address' ? 'active' : ''}`}
                            onClick={(e) => {
                              e.preventDefault();
                              setActiveTab('address');
                            }}
                          >
                            Address
                          </a>
                        </li>
                      </ul>
                    </div>
                    <div className="card-body">
                      <div className="tab-content">
                        <div className={`tab-pane ${activeTab === 'basic' ? 'active show' : ''}`} id="basic-info">
                          <div className="row">
                            {/* Left Column - Company Details */}
                            <div className="col-md-6">
                              <div className="mb-3">
                                <label className="form-label required">Company Name</label>
                                <input
                                  type="text"
                                  className="form-control"
                                  value={formData.name}
                                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                  required
                                  placeholder="Enter company name"
                                />
                              </div>
                              <div className="mb-3">
                                <label className="form-label required">Account Number / Company Number</label>
                                <input
                                  type="number"
                                  className="form-control"
                                  value={formData.referenceNo}
                                  onChange={(e) => setFormData(prev => ({ ...prev, referenceNo: e.target.value }))}
                                  placeholder="Enter account/company number"
                                  required
                                />
                              </div>
                              <div className="mb-3">
                                <label className="row">
                                  <span className="col">EDI</span>
                                  <span className="col-auto">
                                    <label className="form-check form-check-single form-switch">
                                      <input
                                        type="checkbox"
                                        className="form-check-input"
                                        checked={formData.edi}
                                        onChange={(e) => setFormData(prev => ({ ...prev, edi: e.target.checked }))}
                                      />
                                    </label>
                                  </span>
                                </label>
                              </div>
                              {isEditing && (
                                <div className="mb-3">
                                  <label className="row">
                                    <span className="col">Active Status</span>
                                    <span className="col-auto">
                                      <label className="form-check form-check-single form-switch">
                                        <input
                                          type="checkbox"
                                          className="form-check-input"
                                          checked={formData.isActive}
                                          onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                                        />
                                      </label>
                                    </span>
                                  </label>
                                  <small className="form-hint">Toggle to activate or deactivate this company</small>
                                </div>
                              )}
                              
                              {/* Parent Company Selection - for Branches/Subsidiaries */}
                              {needsParent && (
                                <div className="mb-3">
                                  <label className={`form-label ${!isEditing ? 'required' : ''}`}>Parent Company</label>
                                  <div className="input-group mb-2">
                                    <span className="input-group-text">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M21 21l-6-6"/></svg>
                                    </span>
                                    <input
                                      type="text"
                                      className="form-control"
                                      placeholder="Search parent companies..."
                                      value={parentSearchQuery}
                                      onChange={(e) => setParentSearchQuery(e.target.value)}
                                    />
                                  </div>
                                  <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #e0e0e0' }}>
                                    {loadingParents ? (
                                      <div className="text-center p-2">
                                        <div className="spinner-border spinner-border-sm" role="status"></div>
                                      </div>
                                    ) : parentCompanies.length === 0 ? (
                                      <div className="text-center text-muted p-2 small">No parent companies found</div>
                                    ) : (
                                      parentCompanies.map((parent) => (
                                        <div
                                          key={parent.id}
                                          className={`d-flex align-items-center gap-2 p-2 border-bottom ${formData.parentId === parent.id ? 'bg-primary-lt' : ''}`}
                                          style={{ cursor: 'pointer' }}
                                          onClick={() => setFormData(prev => ({ ...prev, parentId: parent.id }))}
                                        >
                                          <input
                                            type="radio"
                                            className="form-check-input"
                                            checked={formData.parentId === parent.id}
                                            onChange={() => setFormData(prev => ({ ...prev, parentId: parent.id }))}
                                          />
                                          <div className="flex-fill">
                                            <div className="small fw-medium">{parent.name}</div>
                                            <div className="text-muted" style={{ fontSize: '11px' }}>
                                              {parent.referenceNo || 'No ref'} • <span className={`badge ${getTypeBadgeClass(parent.type)}`} style={{ fontSize: '9px' }}>{getTypeLabel(parent.type)}</span>
                                            </div>
                                          </div>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                  {parentPagination.pages > 1 && (
                                    <div className="d-flex justify-content-between align-items-center mt-2">
                                      <small className="text-muted">Page {parentPagination.page}/{parentPagination.pages}</small>
                                      <div className="btn-group btn-group-sm">
                                        <button type="button" className="btn btn-sm btn-outline-secondary" disabled={parentPagination.page === 1} onClick={() => fetchParentCompanies(parentPagination.page - 1)}>Prev</button>
                                        <button type="button" className="btn btn-sm btn-outline-secondary" disabled={parentPagination.page === parentPagination.pages} onClick={() => fetchParentCompanies(parentPagination.page + 1)}>Next</button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            
                            {/* Right Column - Email Contacts & Notifications */}
                            <div className="col-md-6">
                              <div className="mb-3">
                                <label className="form-label">Primary Email Contact</label>
                                <div className="d-flex gap-2 mb-2">
                                  <div className="input-group flex-fill">
                                    <span className="input-group-text">
                                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M21 21l-6-6"/></svg>
                                    </span>
                                    <input
                                      type="text"
                                      className="form-control"
                                      placeholder="Search or add..."
                                      value={userSearchQuery}
                                      onChange={(e) => setUserSearchQuery(e.target.value)}
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    className="btn btn-outline-primary"
                                    onClick={() => {
                                      setCurrentFormDataSetter(() => setFormData);
                                      setCurrentCompanyId(editingCompany?.id || null);
                                      setShowQuickAddModal(true);
                                    }}
                                    title="Add new contact"
                                  >
                                    +
                                  </button>
                                </div>
                                
                                {/* Selected Primary Contact */}
                                {formData.primaryContact && (
                                  <div className="d-flex align-items-center gap-2 p-2 mb-2 bg-primary-lt">
                                    <div className="avatar avatar-sm bg-primary text-white">
                                      {formData.primaryContact.name?.charAt(0)?.toUpperCase() || 'U'}
                                    </div>
                                    <div className="flex-fill">
                                      <div className="fw-medium small">{formData.primaryContact.name}</div>
                                      <div className="text-muted" style={{ fontSize: '11px' }}>{formData.primaryContact.email}</div>
                                    </div>
                                    <button
                                      type="button"
                                      className="btn btn-sm btn-ghost-danger"
                                      onClick={() => setFormData(prev => ({ ...prev, primaryContactId: null, primaryContact: null }))}
                                    >
                                      ×
                                    </button>
                                  </div>
                                )}
                                
                                {/* User Search Results */}
                                {!formData.primaryContact && (
                                  <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid #e0e0e0' }}>
                                    {loadingUsers ? (
                                      <div className="text-center p-2"><div className="spinner-border spinner-border-sm" role="status"></div></div>
                                    ) : !searchedUsers || searchedUsers.length === 0 ? (
                                      <div className="text-center text-muted p-2 small">No users found</div>
                                    ) : (
                                      (searchedUsers || []).map(user => (
                                        <div
                                          key={user.id}
                                          className="d-flex align-items-center gap-2 p-2 border-bottom"
                                          style={{ cursor: 'pointer' }}
                                          onClick={() => setFormData(prev => ({ ...prev, primaryContactId: user.id, primaryContact: user }))}
                                        >
                                          <div className="avatar avatar-xs bg-secondary-lt">{user.name?.charAt(0)?.toUpperCase() || 'U'}</div>
                                          <div className="flex-fill">
                                            <div className="small fw-medium">{user.name}</div>
                                            <div className="text-muted" style={{ fontSize: '10px' }}>{user.email}</div>
                                          </div>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* Email Notification Toggles - Compact */}
                              <div className="mb-3">
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
                                            checked={formData.sendInvoiceEmail}
                                            onChange={(e) => setFormData(prev => ({ ...prev, sendInvoiceEmail: e.target.checked }))}
                                          />
                                        </label>
                                      </span>
                                    </label>
                                  </div>
                                  <div className="col-6">
                                    <label className="row g-0 p-2 border" style={{ cursor: 'pointer', opacity: formData.sendInvoiceEmail ? 1 : 0.5 }}>
                                      <span className="col small">With Attachment</span>
                                      <span className="col-auto">
                                        <label className="form-check form-check-single form-switch mb-0">
                                          <input
                                            type="checkbox"
                                            className="form-check-input"
                                            checked={formData.sendInvoiceAttachment}
                                            onChange={(e) => setFormData(prev => ({ ...prev, sendInvoiceAttachment: e.target.checked }))}
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
                                            checked={formData.sendStatementEmail}
                                            onChange={(e) => setFormData(prev => ({ ...prev, sendStatementEmail: e.target.checked }))}
                                          />
                                        </label>
                                      </span>
                                    </label>
                                  </div>
                                  <div className="col-6">
                                    <label className="row g-0 p-2 border" style={{ cursor: 'pointer', opacity: formData.sendStatementEmail ? 1 : 0.5 }}>
                                      <span className="col small">With Attachment</span>
                                      <span className="col-auto">
                                        <label className="form-check form-check-single form-switch mb-0">
                                          <input
                                            type="checkbox"
                                            className="form-check-input"
                                            checked={formData.sendStatementAttachment}
                                            onChange={(e) => setFormData(prev => ({ ...prev, sendStatementAttachment: e.target.checked }))}
                                            disabled={!formData.sendStatementEmail}
                                          />
                                        </label>
                                      </span>
                                    </label>
                                  </div>
                                  <div className="col-12">
                                    <label className="row g-0 p-2 border" style={{ cursor: 'pointer' }}>
                                      <span className="col small">Send as Summary</span>
                                      <span className="col-auto">
                                        <label className="form-check form-check-single form-switch mb-0">
                                          <input
                                            type="checkbox"
                                            className="form-check-input"
                                            checked={formData.sendEmailAsSummary}
                                            onChange={(e) => setFormData(prev => ({ ...prev, sendEmailAsSummary: e.target.checked }))}
                                          />
                                        </label>
                                      </span>
                                    </label>
                                  </div>
                                </div>
                                <small className="form-hint mt-1">These settings apply to the primary contact above</small>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className={`tab-pane ${activeTab === 'address' ? 'active show' : ''}`} id="address">
                          <div className="row">
                            <div className="col-md-6 mb-3">
                              <label className="form-label">Address Line 1</label>
                              <input
                                type="text"
                                className="form-control"
                                value={formData.address.line1}
                                onChange={(e) => setFormData(prev => ({
                                  ...prev,
                                  address: { ...prev.address, line1: e.target.value }
                                }))}
                                placeholder="Street address"
                              />
                            </div>
                            <div className="col-md-6 mb-3">
                              <label className="form-label">Address Line 2</label>
                              <input
                                type="text"
                                className="form-control"
                                value={formData.address.line2}
                                onChange={(e) => setFormData(prev => ({
                                  ...prev,
                                  address: { ...prev.address, line2: e.target.value }
                                }))}
                                placeholder="Apartment, suite, etc."
                              />
                            </div>
                            <div className="col-md-4 mb-3">
                              <label className="form-label">City</label>
                              <input
                                type="text"
                                className="form-control"
                                value={formData.address.city}
                                onChange={(e) => setFormData(prev => ({
                                  ...prev,
                                  address: { ...prev.address, city: e.target.value }
                                }))}
                                placeholder="City"
                              />
                            </div>
                            <div className="col-md-4 mb-3">
                              <label className="form-label">State/Province</label>
                              <input
                                type="text"
                                className="form-control"
                                value={formData.address.state}
                                onChange={(e) => setFormData(prev => ({
                                  ...prev,
                                  address: { ...prev.address, state: e.target.value }
                                }))}
                                placeholder="State or Province"
                              />
                            </div>
                            <div className="col-md-4 mb-3">
                              <label className="form-label">ZIP/Postal Code</label>
                              <input
                                type="text"
                                className="form-control"
                                value={formData.address.zip}
                                onChange={(e) => setFormData(prev => ({
                                  ...prev,
                                  address: { ...prev.address, zip: e.target.value }
                                }))}
                                placeholder="ZIP or Postal Code"
                              />
                            </div>
                            <div className="col-md-12 mb-3">
                              <label className="form-label">Country</label>
                              <input
                                type="text"
                                className="form-control"
                                value={formData.address.country}
                                onChange={(e) => setFormData(prev => ({
                                  ...prev,
                                  address: { ...prev.address, country: e.target.value }
                                }))}
                                placeholder="Country"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      onClose();
                      resetForm();
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={creating}
                  >
                    {creating 
                      ? (isEditing ? 'Updating...' : 'Creating...') 
                      : (isEditing 
                          ? `Update ${isBranch ? 'Branch' : isSubsidiary ? 'Subsidiary' : 'Corporate Company'}` 
                          : `Create ${isBranch ? 'Branch' : isSubsidiary ? 'Subsidiary' : 'Corporate Company'}`)
                    }
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )
    );
  };

  return (
    <div className="page">
      <div className="page-body">
        <div className="container-xl">
          <div className="card">
            <div className="card-header">
              <div className="row w-100 g-3">
                {/* Title and description */}
                <div className="col-lg-3 col-md-4 col-12">
                  <h3 className="card-title mb-0">Companies</h3>
                  <p className="text-secondary m-0">Manage company hierarchy</p>
                </div>
                {/* Controls */}
                <div className="col-lg-9 col-md-8 col-12">
                  <div className="d-flex flex-wrap btn-list gap-2 justify-content-md-end">
                    {/* Search */}
                    <div className="input-group input-group-flat" style={{ maxWidth: '280px' }}>
                      <span className="input-group-text">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon">
                          <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"></path>
                          <path d="M21 21l-6 -6"></path>
                        </svg>
                      </span>
                      <input
                        ref={searchInputRef}
                        type="text"
                        className="form-control"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                      <span className="input-group-text">
                        <kbd>Ctrl+K</kbd>
                      </span>
                    </div>
                    {/* Type Filter Dropdown */}
                    <div className="dropdown">
                      <button
                        className="btn btn-outline-secondary dropdown-toggle"
                        type="button"
                        onClick={() => setShowTypeFilterDropdown(!showTypeFilterDropdown)}
                      >
                        Company Types {Object.values(typeFilters).filter(v => v).length < 3 ? `(${Object.values(typeFilters).filter(v => v).length})` : ''}
                      </button>
                      {showTypeFilterDropdown && (
                        <div className="dropdown-menu show" style={{ position: 'absolute' }}>
                          <label className="dropdown-item d-flex align-items-center gap-2" style={{ cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              className="form-check-input m-0"
                              checked={typeFilters.CORP}
                              onChange={() => handleTypeFilterChange('CORP')}
                            />
                            <span className="badge bg-primary-lt">Corporate</span>
                          </label>
                          <label className="dropdown-item d-flex align-items-center gap-2" style={{ cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              className="form-check-input m-0"
                              checked={typeFilters.SUB}
                              onChange={() => handleTypeFilterChange('SUB')}
                            />
                            <span className="badge bg-info-lt">Subsidiary</span>
                          </label>
                          <label className="dropdown-item d-flex align-items-center gap-2" style={{ cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              className="form-check-input m-0"
                              checked={typeFilters.BRANCH}
                              onChange={() => handleTypeFilterChange('BRANCH')}
                            />
                            <span className="badge bg-success-lt">Branch</span>
                          </label>
                        </div>
                      )}
                    </div>
                    {/* Status Filter */}
                    <select
                      className="form-select w-auto"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                    >
                      <option value="all">All Status</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                    {/* Filter Companies */}
                    <button
                      type="button"
                      className={`btn ${selectedParentFilters.length > 0 ? 'btn-primary' : 'btn-outline-secondary'}`}
                      onClick={openParentFilterModal}
                    >
                      {selectedParentFilters.length === 0 
                        ? 'Filter Companies' 
                        : `Companies (${selectedParentFilters.length})`}
                    </button>
                    {/* Reset */}
                    <button 
                      className="btn btn-outline-secondary" 
                      onClick={handleResetFilters}
                      title="Reset all filters"
                    >
                      Reset
                    </button>
                    {/* Add buttons */}
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        setShowCorporateModal(true);
                        setActiveTab('basic');
                      }}
                    >
                      Add Corporate
                    </button>
                    <button
                      className="btn btn-info"
                      onClick={() => {
                        setShowSubsidiaryModal(true);
                        setActiveTab('basic');
                      }}
                    >
                      Add Subsidiary
                    </button>
                    <button
                      className="btn btn-success"
                      onClick={() => {
                        setShowBranchModal(true);
                        setActiveTab('basic');
                      }}
                    >
                      Add Branch
                    </button>
                    {/* Bulk Actions */}
                    {isAdministrator() && selectedCompanyIds.length > 0 && (
                      <div className="dropdown">
                        <button
                          className="btn btn-primary dropdown-toggle"
                          type="button"
                          data-bs-toggle="dropdown"
                          aria-expanded="false"
                        >
                          Bulk ({selectedCompanyIds.length})
                        </button>
                        <ul className="dropdown-menu">
                          <li>
                            <button
                              className="dropdown-item"
                              type="button"
                              onClick={() => handleBulkEDIChange(true)}
                            >
                              Enable EDI
                            </button>
                          </li>
                          <li>
                            <button
                              className="dropdown-item"
                              type="button"
                              onClick={() => handleBulkEDIChange(false)}
                            >
                              Disable EDI
                            </button>
                          </li>
                          <li><hr className="dropdown-divider" /></li>
                          <li>
                            <button
                              className="dropdown-item"
                              type="button"
                              onClick={() => handleBulkEmailNotificationsChange(true)}
                            >
                              Enable Email Notifications
                            </button>
                          </li>
                          <li>
                            <button
                              className="dropdown-item"
                              type="button"
                              onClick={() => handleBulkEmailNotificationsChange(false)}
                            >
                              Disable Email Notifications
                            </button>
                          </li>
                          <li><hr className="dropdown-divider" /></li>
                          <li>
                            <button
                              className="dropdown-item"
                              type="button"
                              onClick={() => handleBulkStatusChange(true)}
                            >
                              Activate
                            </button>
                          </li>
                          <li>
                            <button
                              className="dropdown-item"
                              type="button"
                              onClick={() => handleBulkStatusChange(false)}
                            >
                              Deactivate
                            </button>
                          </li>
                          <li><hr className="dropdown-divider" /></li>
                          <li>
                            <button
                              className="dropdown-item text-danger"
                              type="button"
                              onClick={handleBulkDelete}
                            >
                              Delete Selected
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
                          aria-label="Select all companies"
                          checked={isAllSelected}
                          onChange={handleSelectAll}
                        />
                      </th>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Account Number / Company Number</th>
                      <th>Relationships</th>
                      <th>EDI</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody className={loading ? 'placeholder-glow' : ''}>
                    {loading ? (
                      [...Array(10)].map((_, i) => (
                        <tr key={`skeleton-${i}`}>
                          <td><span className="placeholder" style={{ width: '16px', height: '16px', borderRadius: '3px' }}></span></td>
                          <td><span className="placeholder col-10"></span></td>
                          <td><span className="placeholder col-6" style={{ borderRadius: '4px' }}></span></td>
                          <td><span className="placeholder col-8"></span></td>
                          <td><span className="placeholder col-7"></span></td>
                          <td><span className="placeholder col-5" style={{ borderRadius: '4px' }}></span></td>
                          <td><span className="placeholder col-6" style={{ borderRadius: '4px' }}></span></td>
                          <td>
                            <div className="btn-list">
                              <span className="placeholder btn btn-sm disabled" style={{ width: '50px' }}></span>
                              <span className="placeholder btn btn-sm disabled" style={{ width: '60px' }}></span>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : filteredCompanies.length === 0 ? (
                      <tr>
                        <td colSpan="8" className="text-center text-muted py-4">
                          {pagination.total === 0 ? 'No companies found' : 'No companies match your filters on this page'}
                        </td>
                      </tr>
                    ) : (
                      filteredCompanies.map((company) => {
                        return (
                          <tr key={company.id}>
                            <td>
                              <input
                                className="form-check-input m-0 align-middle table-selectable-check"
                                type="checkbox"
                                aria-label="Select company"
                                checked={selectedCompanyIds.includes(company.id)}
                                onChange={() => handleSelectCompany(company.id)}
                              />
                            </td>
                            <td>{company.name}</td>
                            <td>
                              <span className={`badge ${getTypeBadgeClass(company.type)}`}>
                                {getTypeLabel(company.type)}
                              </span>
                            </td>
                            <td>{company.referenceNo || '-'}</td>
                            <td>
                              {(() => {
                                const parent = getParentCompany(company);
                                const hasKids = hasChildren(company);
                                const hasRel = parent || hasKids;
                                
                                if (!hasRel) {
                                  return <span className="text-muted">-</span>;
                                }
                                
                                return (
                                  <button
                                    className="btn btn-sm btn-link p-0 text-decoration-none"
                                    onClick={() => handleViewRelationshipsModal(company)}
                                  >
                                    View Relationships
                                  </button>
                                );
                              })()}
                            </td>
                            <td>
                              {company.edi ? (
                                <span className="badge bg-info-lt">EDI</span>
                              ) : (
                                <span className="badge bg-secondary-lt">No</span>
                              )}
                            </td>
                            <td>
                              <span className={`badge ${company.isActive ? 'bg-success-lt' : 'bg-danger-lt'}`}>
                                {company.isActive ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td>
                              <div className="btn-list">
                                <button
                                  className="btn btn-sm btn-primary"
                                  onClick={() => navigate(`/companies/${company.id}/view`)}
                                >
                                  View
                                </button>
                                <button
                                  className="btn btn-sm btn-info"
                                  onClick={() => openEditModal(company)}
                                >
                                  Edit
                                </button>
                                {isAdministrator() && (
                                  <>
                                    <button
                                      className={`btn btn-sm ${company.isActive ? 'btn-warning' : 'btn-success'}`}
                                      onClick={() => handleToggleStatus(company)}
                                      title={company.isActive ? 'Deactivate Company' : 'Activate Company'}
                                    >
                                      {company.isActive ? 'Deactivate' : 'Activate'}
                                    </button>
                                    <button
                                      className="btn btn-sm btn-danger"
                                      onClick={() => handleDeleteCompany(company.id)}
                                    >
                                      Delete
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              
              {/* Pagination Controls */}
              {pagination.total > pagination.limit && (
                <div className="d-flex justify-content-between align-items-center mt-3">
                  <div className="text-muted">
                    Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} companies
                  </div>
                  <div className="d-flex gap-2">
                    <button
                      className="btn btn-sm btn-outline-primary"
                      onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                      disabled={pagination.page === 1 || loading}
                    >
                      Previous
                    </button>
                    <div className="d-flex align-items-center gap-2">
                      <span className="text-muted">Page</span>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        style={{ width: '70px' }}
                        min="1"
                        max={pagination.pages}
                        value={pagination.page}
                        onChange={(e) => {
                          const page = parseInt(e.target.value);
                          if (page >= 1 && page <= pagination.pages) {
                            setPagination(prev => ({ ...prev, page }));
                          }
                        }}
                      />
                      <span className="text-muted">of {pagination.pages}</span>
                    </div>
                    <button
                      className="btn btn-sm btn-outline-primary"
                      onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                      disabled={pagination.page >= pagination.pages || loading}
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

      {/* Modals */}
      {renderModal('CORP', showCorporateModal, () => setShowCorporateModal(false), corporateFormData, setCorporateFormData, handleCreateCorporate, resetCorporateForm)}
      {renderModal('BRANCH', showBranchModal, () => setShowBranchModal(false), branchFormData, setBranchFormData, handleCreateBranch, resetBranchForm)}
      {renderModal('SUB', showSubsidiaryModal, () => setShowSubsidiaryModal(false), subsidiaryFormData, setSubsidiaryFormData, handleCreateSubsidiary, resetSubsidiaryForm)}
      
      {/* Import Modal - Moved to ImportData page */}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && companyToDelete && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Delete Company</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setCompanyToDelete(null);
                  }}
                ></button>
              </div>
              <div className="modal-body">
                <p>Are you sure you want to delete <strong>{companyToDelete.name}</strong>?</p>
                <p className="text-danger">This action cannot be undone.</p>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setCompanyToDelete(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={confirmDelete}
                >
                  Delete Company
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate/Activate Confirmation Modal */}
      {showDeactivateModal && companyToDeactivate && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {companyToDeactivate.isActive ? 'Deactivate Company' : 'Activate Company'}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowDeactivateModal(false);
                    setCompanyToDeactivate(null);
                  }}
                ></button>
              </div>
              <div className="modal-body">
                <p>
                  Are you sure you want to {companyToDeactivate.isActive ? 'deactivate' : 'activate'}{' '}
                  <strong>{companyToDeactivate.name}</strong>?
                </p>
                {companyToDeactivate.isActive && (
                  <p className="text-warning">
                    Deactivated companies will not be available for selection in other parts of the system.
                  </p>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    setShowDeactivateModal(false);
                    setCompanyToDeactivate(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`btn ${companyToDeactivate.isActive ? 'btn-warning' : 'btn-success'}`}
                  onClick={confirmDeactivate}
                >
                  {companyToDeactivate.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Purge All Companies Modal - Moved to Settings > Admin Tools */}

      {/* Relationships Modal - Clean List Format */}
      {showRelationshipsModal && selectedCompanyForRelationships && (() => {
        const relationships = modalRelationships[selectedCompanyForRelationships.id];
        const isLoading = loadingModalRelationships[selectedCompanyForRelationships.id];
        
        // Group relationships by hierarchy level
        const groupedByLevel = {};
        if (relationships) {
          // Add ancestors (parents) - group all ancestors together as "Top Level"
          if (relationships.ancestors && relationships.ancestors.length > 0) {
            const topLevel = -1; // Use -1 for all ancestors (Top Level)
            if (!groupedByLevel[topLevel]) {
              groupedByLevel[topLevel] = [];
            }
            relationships.ancestors.forEach((ancestor) => {
              groupedByLevel[topLevel].push({ ...ancestor, hierarchyLevel: topLevel });
            });
          }
          
          // Add descendants (children) - flatten nested structure with level tracking
          const flattenChildren = (children, currentLevel = 0) => {
            if (!children || children.length === 0) return;
            children.forEach(child => {
              const level = currentLevel; // Use currentLevel for grouping
              if (!groupedByLevel[level]) {
                groupedByLevel[level] = [];
              }
              // Remove children from the object to avoid duplication
              const { children: childChildren, ...childWithoutChildren } = child;
              groupedByLevel[level].push({ ...childWithoutChildren, hierarchyLevel: level });
              
              // Recursively process children at the next level
              if (childChildren && childChildren.length > 0) {
                flattenChildren(childChildren, currentLevel + 1);
              }
            });
          };
          if (relationships.descendants && relationships.descendants.length > 0) {
            flattenChildren(relationships.descendants, 0);
          }
        }
        
        // Get sorted levels (from top to bottom: -1, 0, 1, 2, ...)
        const sortedLevels = Object.keys(groupedByLevel)
          .map(Number)
          .sort((a, b) => a - b);
        
        return (
          <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
            <div className="modal-dialog modal-dialog-centered modal-xl">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Company Relationships</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => {
                      setShowRelationshipsModal(false);
                      setSelectedCompanyForRelationships(null);
                    }}
                  ></button>
                </div>
                <div className="modal-body">
                  {isLoading ? (
                    <div className="text-center py-4">
                      <div className="spinner-border" role="status">
                        <span className="visually-hidden">Loading...</span>
                      </div>
                    </div>
                  ) : sortedLevels.length === 0 ? (
                    <div className="text-center text-muted py-4">
                      <p>No relationships found.</p>
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-vcenter">
                        <thead>
                          <tr>
                            <th>Company Name</th>
                            <th>Company Number</th>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedLevels.map((level) => {
                            const levelCompanies = groupedByLevel[level];
                            return levelCompanies.map((rel) => (
                              <tr key={rel.id}>
                                <td className="fw-medium">{rel.name}</td>
                                <td>{rel.referenceNo || '-'}</td>
                                <td>
                                  <span className={`badge ${getTypeBadgeClass(rel.type)}`}>
                                    {getTypeLabel(rel.type)}
                                  </span>
                                </td>
                                <td>
                                  <span className={`badge ${rel.isActive ? 'bg-success-lt' : 'bg-danger-lt'}`}>
                                    {rel.isActive ? 'Active' : 'Inactive'}
                                  </span>
                                </td>
                                <td>
                                  <div className="btn-list">
                                    <button
                                      className="btn btn-sm btn-primary"
                                      onClick={() => {
                                        setShowRelationshipsModal(false);
                                        navigate(`/companies/${rel.id}/view`);
                                      }}
                                    >
                                      View
                                    </button>
                                    <button
                                      className="btn btn-sm btn-info"
                                      onClick={() => {
                                        setShowRelationshipsModal(false);
                                        setSelectedCompanyForRelationships(null);
                                        openEditModal(rel);
                                      }}
                                    >
                                      Edit
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ));
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setShowRelationshipsModal(false);
                      setSelectedCompanyForRelationships(null);
                    }}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Quick Add Notification Contact Modal */}
      {showQuickAddModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Add Notification Contact</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowQuickAddModal(false);
                    setQuickAddFormData({ name: '', email: '', sendInvoiceEmail: true, sendInvoiceAttachment: false, sendStatementEmail: true, sendStatementAttachment: false, sendEmailAsSummary: false });
                  }}
                ></button>
              </div>
              <div className="modal-body">
                <div className="row">
                  <div className="col-md-6">
                    <div className="mb-3">
                      <label className="form-label">Name</label>
                      <input
                        type="text"
                        className="form-control"
                        value={quickAddFormData.name || ''}
                        onChange={(e) => setQuickAddFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Contact name (optional)"
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label required">Email</label>
                      <input
                        type="email"
                        className="form-control"
                        value={quickAddFormData.email || ''}
                        onChange={(e) => setQuickAddFormData(prev => ({ ...prev, email: e.target.value }))}
                        placeholder="email@example.com"
                        required
                      />
                    </div>
                    <div className="alert alert-info mb-0">
                      <small>This contact will be created as a <strong>Notification Contact</strong> and set as the <strong>Primary Contact</strong>. They will not have login access.</small>
                    </div>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label">Email Notifications</label>
                    <div className="d-flex flex-column gap-2">
                      <label className="row g-0 p-2 border" style={{ cursor: 'pointer' }}>
                        <span className="col small">Upload Email</span>
                        <span className="col-auto">
                          <label className="form-check form-check-single form-switch mb-0">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={quickAddFormData.sendInvoiceEmail !== false}
                              onChange={(e) => setQuickAddFormData(prev => ({ ...prev, sendInvoiceEmail: e.target.checked }))}
                            />
                          </label>
                        </span>
                      </label>
                      <label className="row g-0 p-2 border" style={{ cursor: 'pointer', opacity: quickAddFormData.sendInvoiceEmail !== false ? 1 : 0.5 }}>
                        <span className="col small">With Attachment</span>
                        <span className="col-auto">
                          <label className="form-check form-check-single form-switch mb-0">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={quickAddFormData.sendInvoiceAttachment || false}
                              onChange={(e) => setQuickAddFormData(prev => ({ ...prev, sendInvoiceAttachment: e.target.checked }))}
                              disabled={quickAddFormData.sendInvoiceEmail === false}
                            />
                          </label>
                        </span>
                      </label>
                      <label className="row g-0 p-2 border" style={{ cursor: 'pointer' }}>
                        <span className="col small">Statement Email</span>
                        <span className="col-auto">
                          <label className="form-check form-check-single form-switch mb-0">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={quickAddFormData.sendStatementEmail !== false}
                              onChange={(e) => setQuickAddFormData(prev => ({ ...prev, sendStatementEmail: e.target.checked }))}
                            />
                          </label>
                        </span>
                      </label>
                      <label className="row g-0 p-2 border" style={{ cursor: 'pointer', opacity: quickAddFormData.sendStatementEmail !== false ? 1 : 0.5 }}>
                        <span className="col small">With Attachment</span>
                        <span className="col-auto">
                          <label className="form-check form-check-single form-switch mb-0">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={quickAddFormData.sendStatementAttachment || false}
                              onChange={(e) => setQuickAddFormData(prev => ({ ...prev, sendStatementAttachment: e.target.checked }))}
                              disabled={quickAddFormData.sendStatementEmail === false}
                            />
                          </label>
                        </span>
                      </label>
                      <label className="row g-0 p-2 border" style={{ cursor: 'pointer' }}>
                        <span className="col small">Send as Summary</span>
                        <span className="col-auto">
                          <label className="form-check form-check-single form-switch mb-0">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={quickAddFormData.sendEmailAsSummary || false}
                              onChange={(e) => setQuickAddFormData(prev => ({ ...prev, sendEmailAsSummary: e.target.checked }))}
                            />
                          </label>
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowQuickAddModal(false);
                    setQuickAddFormData({ name: '', email: '', sendInvoiceEmail: true, sendInvoiceAttachment: false, sendStatementEmail: true, sendStatementAttachment: false, sendEmailAsSummary: false });
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleQuickAddContact(currentCompanyId, currentFormDataSetter)}
                  disabled={quickAddLoading || !quickAddFormData.email}
                >
                  {quickAddLoading ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                      Adding...
                    </>
                  ) : (
                    'Add Contact'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Parent/Company Filter Modal */}
      {showParentFilterModal && (
        <div className="modal modal-blur fade show" style={{ display: 'block' }} tabIndex="-1">
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Filter Companies</h5>
                <button type="button" className="btn-close" onClick={closeParentFilterModal}></button>
              </div>
              <div className="modal-body">
                {/* Search */}
                <div className="mb-3">
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search companies by name or account number..."
                    value={parentFilterSearch}
                    onChange={(e) => setParentFilterSearch(e.target.value)}
                    autoFocus
                  />
                </div>

                {/* Selected companies as pills */}
                {tempSelectedParents.length > 0 && (
                  <div className="mb-3 d-flex flex-wrap gap-1">
                    {tempSelectedParents.map((company) => (
                      <span 
                        key={company.id} 
                        className="badge bg-primary-lt d-inline-flex align-items-center gap-1"
                      >
                        {company.name}
                        {company.referenceNo && <small className="text-muted">({company.referenceNo})</small>}
                        <button
                          type="button"
                          className="btn-close ms-1"
                          style={{ fontSize: '0.5rem' }}
                          onClick={() => removeTempSelectedParent(company.id)}
                          aria-label="Remove"
                        ></button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Company list */}
                <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                  {parentFilterLoading ? (
                    <div className="text-center py-4">
                      <div className="spinner-border" role="status">
                        <span className="visually-hidden">Loading...</span>
                      </div>
                    </div>
                  ) : parentFilterCompanies.length === 0 ? (
                    <div className="text-muted text-center py-4">No companies found</div>
                  ) : (
                    <div className="list-group list-group-flush">
                      {parentFilterCompanies.map((company) => {
                        const isSelected = tempSelectedParents.some(c => c.id === company.id);
                        return (
                          <label
                            key={company.id}
                            className={`list-group-item d-flex align-items-center gap-2 py-2 ${isSelected ? 'bg-primary-lt' : ''}`}
                            style={{ cursor: 'pointer' }}
                          >
                            <input
                              type="checkbox"
                              className="form-check-input m-0"
                              checked={isSelected}
                              onChange={() => handleParentFilterToggle(company)}
                            />
                            <span className="flex-grow-1 text-truncate">{company.name}</span>
                            {company.referenceNo && (
                              <small className="text-muted">{company.referenceNo}</small>
                            )}
                            {company.type && (
                              <span className={`badge ${company.type === 'CORP' ? 'bg-primary-lt' : company.type === 'SUB' ? 'bg-info-lt' : 'bg-success-lt'}`}>
                                {company.type}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Pagination */}
                {parentFilterPages > 1 && (
                  <div className="d-flex justify-content-between align-items-center mt-3 pt-3 border-top">
                    <small className="text-muted">
                      Showing {parentFilterCompanies.length} of {parentFilterTotal} companies
                    </small>
                    <div className="btn-group">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        disabled={parentFilterPage <= 1 || parentFilterLoading}
                        onClick={() => fetchParentFilterCompanies(parentFilterSearch, parentFilterPage - 1)}
                      >
                        Previous
                      </button>
                      <span className="btn btn-sm btn-outline-secondary disabled">
                        {parentFilterPage} / {parentFilterPages}
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        disabled={parentFilterPage >= parentFilterPages || parentFilterLoading}
                        onClick={() => fetchParentFilterCompanies(parentFilterSearch, parentFilterPage + 1)}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn" onClick={clearParentFilters}>
                  Clear All
                </button>
                <button type="button" className="btn btn-secondary" onClick={closeParentFilterModal}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={applyParentFilter}>
                  Apply Filter {tempSelectedParents.length > 0 && `(${tempSelectedParents.length})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Companies;

