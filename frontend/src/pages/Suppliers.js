import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { usePermissions } from '../context/PermissionContext';
import { useDebounce } from '../hooks/useDebounce';
import { getRoleLabel, getRoleBadgeClass } from '../utils/roleLabels';

const Suppliers = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings } = useSettings();
  const { hasPermission } = usePermissions();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [supplierToDelete, setSupplierToDelete] = useState(null);
  const debouncedSearch = useDebounce(searchQuery, 300);
  const searchInputRef = useRef(null);
  
  const isGlobalAdmin = user?.role === 'global_admin' || user?.role === 'administrator';
  const suppliersEnabled = settings?.suppliersEnabled !== false;
  
  // Check permissions - suppliers requires staff role
  const canCreate = isGlobalAdmin;
  const canEdit = isGlobalAdmin;
  const canDelete = isGlobalAdmin;
  const canView = user?.role && ['global_admin', 'administrator', 'manager', 'credit_senior', 'credit_controller'].includes(user.role);
  
  useEffect(() => {
    if (!suppliersEnabled) {
      toast.error('Suppliers module is disabled');
      navigate('/dashboard');
      return;
    }
    fetchSuppliers();
  }, [pagination.page, debouncedSearch, statusFilter, suppliersEnabled, navigate]);
  
  // Keyboard shortcut for search (Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  const fetchSuppliers = async () => {
    try {
      setLoading(true);
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        search: debouncedSearch || '',
      };
      
      if (statusFilter !== 'all') {
        params.isActive = statusFilter === 'active';
      }
      
      const response = await api.get('/api/suppliers', { params });
      setSuppliers(response.data.suppliers || []);
      setPagination({
        page: response.data.pagination?.page || pagination.page,
        limit: pagination.limit,
        total: response.data.pagination?.total || 0,
        pages: response.data.pagination?.totalPages || response.data.pagination?.pages || 0
      });
    } catch (error) {
      console.error('Error fetching suppliers:', error);
      toast.error('Error fetching suppliers');
    } finally {
      setLoading(false);
    }
  };
  
  const handleDelete = async () => {
    if (!supplierToDelete) return;
    
    try {
      await api.delete(`/api/suppliers/${supplierToDelete.id}`);
      toast.success('Supplier deleted successfully');
      setShowDeleteModal(false);
      setSupplierToDelete(null);
      fetchSuppliers();
    } catch (error) {
      console.error('Error deleting supplier:', error);
      toast.error(error.response?.data?.message || 'Error deleting supplier');
    }
  };
  
  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setPagination(prev => ({ ...prev, page: 1 }));
  };
  
  const getInitials = (name) => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
      return parts[0].charAt(0).toUpperCase();
    }
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  };
  
  if (!suppliersEnabled) {
    return null;
  }
  
  return (
    <div className="page">
      <div className="page-body">
        <div className="container-xl">
          <div className="card">
            <div className="card-header">
              <div className="row w-100 g-3">
                {/* Title and description */}
                <div className="col-lg-3 col-md-4 col-12">
                  <h3 className="card-title mb-0">Suppliers</h3>
                  <p className="text-secondary m-0">Manage supplier information</p>
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
                        onChange={(e) => {
                          setSearchQuery(e.target.value);
                          setPagination(prev => ({ ...prev, page: 1 }));
                        }}
                      />
                      <span className="input-group-text">
                        <kbd>Ctrl+K</kbd>
                      </span>
                    </div>
                    {/* Status Filter */}
                    <select
                      className="form-select w-auto"
                      value={statusFilter}
                      onChange={(e) => {
                        setStatusFilter(e.target.value);
                        setPagination(prev => ({ ...prev, page: 1 }));
                      }}
                    >
                      <option value="all">All Status</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                    {/* Reset */}
                    <button 
                      className="btn btn-outline-secondary" 
                      onClick={handleResetFilters}
                      title="Reset all filters"
                    >
                      Reset
                    </button>
                    {/* Add Supplier */}
                    {canCreate && (
                      <button
                        className="btn btn-primary"
                        onClick={() => navigate('/suppliers/add')}
                      >
                        Add Supplier
                      </button>
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
                      <th>Name</th>
                      <th>Reference No.</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th>Status</th>
                      <th>Created By</th>
                      <th>Created At</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan="8" className="text-center py-4">
                          <div className="spinner-border spinner-border-sm" role="status">
                            <span className="visually-hidden">Loading...</span>
                          </div>
                        </td>
                      </tr>
                    ) : suppliers.length === 0 ? (
                      <tr>
                        <td colSpan="8" className="text-center text-muted py-4">
                          {pagination.total === 0 ? 'No suppliers found' : 'No suppliers match your filters on this page'}
                        </td>
                      </tr>
                    ) : (
                      suppliers.map((supplier) => (
                        <tr key={supplier.id}>
                          <td>{supplier.name}</td>
                          <td>{supplier.code || '-'}</td>
                          <td>{supplier.email || '-'}</td>
                          <td>{supplier.phone || '-'}</td>
                          <td>
                            <span className={`badge ${supplier.isActive ? 'bg-success-lt' : 'bg-danger-lt'}`}>
                              {supplier.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td>
                            {supplier.createdBy ? (
                              <div className="d-flex align-items-center">
                                <span className={`avatar avatar-xs me-2 ${getRoleBadgeClass(supplier.createdBy.role)}`}>
                                  {getInitials(supplier.createdBy.name)}
                                </span>
                                <span>{supplier.createdBy.name}</span>
                              </div>
                            ) : (
                              <span className="text-muted">System</span>
                            )}
                          </td>
                          <td>{new Date(supplier.createdAt).toLocaleDateString()}</td>
                          <td>
                            <div className="btn-list">
                              {canView && (
                                <button
                                  className="btn btn-sm btn-primary"
                                  onClick={() => navigate(`/suppliers/${supplier.id}/view`)}
                                >
                                  View
                                </button>
                              )}
                              {canEdit && (
                                <>
                                  <button
                                    className="btn btn-sm btn-info"
                                    onClick={() => navigate(`/suppliers/${supplier.id}/edit`)}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    className="btn btn-sm btn-secondary"
                                    onClick={() => navigate(`/suppliers/${supplier.id}/templates`)}
                                  >
                                    Templates
                                  </button>
                                </>
                              )}
                              {canDelete && (
                                <button
                                  className="btn btn-sm btn-danger"
                                  onClick={() => {
                                    setSupplierToDelete(supplier);
                                    setShowDeleteModal(true);
                                  }}
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
              {pagination.total > 0 && (
                <div className="d-flex justify-content-between align-items-center mt-3">
                  <div className="text-muted">
                    Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} suppliers
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
                        defaultValue={pagination.page}
                        key={pagination.page}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const page = parseInt(e.target.value);
                            if (page >= 1 && page <= pagination.pages) {
                              setPagination(prev => ({ ...prev, page }));
                            }
                            e.target.blur();
                          }
                        }}
                        onBlur={(e) => {
                          const page = parseInt(e.target.value);
                          if (page >= 1 && page <= pagination.pages && page !== pagination.page) {
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
      
      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Delete Supplier</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setSupplierToDelete(null);
                  }}
                ></button>
              </div>
              <div className="modal-body">
                <p>
                  Are you sure you want to delete <strong>{supplierToDelete?.name}</strong>?
                </p>
                <p className="text-danger small">
                  This action cannot be undone. If the supplier has documents, you must delete or archive them first.
                </p>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setSupplierToDelete(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleDelete}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Suppliers;