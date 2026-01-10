import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useDebounce } from '../hooks/useDebounce';

const Suppliers = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings } = useSettings();
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [isActiveFilter, setIsActiveFilter] = useState('all');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [supplierToDelete, setSupplierToDelete] = useState(null);
  const debouncedSearch = useDebounce(searchQuery, 300);
  
  const isGlobalAdmin = user?.role === 'global_admin';
  
  // Check if suppliers module is enabled
  const suppliersEnabled = settings?.suppliersEnabled !== false;
  
  useEffect(() => {
    if (!suppliersEnabled) {
      toast.error('Suppliers module is disabled');
      navigate('/dashboard');
      return;
    }
    fetchSuppliers();
  }, [pagination.page, debouncedSearch, isActiveFilter, suppliersEnabled, navigate]);
  
  const fetchSuppliers = async () => {
    try {
      setLoading(true);
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        search: debouncedSearch || '',
        isActive: isActiveFilter === 'all' ? undefined : isActiveFilter === 'active'
      };
      
      const response = await api.get('/suppliers', { params });
      setSuppliers(response.data.suppliers || []);
      setPagination(response.data.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 });
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
      await api.delete(`/suppliers/${supplierToDelete.id}`);
      toast.success('Supplier deleted successfully');
      setShowDeleteModal(false);
      setSupplierToDelete(null);
      fetchSuppliers();
    } catch (error) {
      console.error('Error deleting supplier:', error);
      toast.error(error.response?.data?.message || 'Error deleting supplier');
    }
  };
  
  const handlePageChange = (newPage) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };
  
  if (!suppliersEnabled) {
    return null;
  }
  
  return (
    <div className="page">
      <div className="page-header">
        <div className="container-fluid">
          <div className="row g-2 align-items-center">
            <div className="col">
              <div className="page-pretitle">Internal</div>
              <h2 className="page-title">Suppliers</h2>
            </div>
            <div className="col-auto ms-auto">
              {isGlobalAdmin && (
                <button
                  className="btn btn-primary"
                  onClick={() => navigate('/suppliers/new')}
                >
                  <i className="ti ti-plus me-1"></i>
                  Add Supplier
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      
      <div className="page-body">
        <div className="container-fluid">
          <div className="row row-cards">
            <div className="col-12">
              <div className="card">
                <div className="card-header">
                  <div className="card-title">All Suppliers</div>
                  <div className="card-actions">
                    <div className="input-group">
                      <input
                        type="text"
                        className="form-control"
                        placeholder="Search suppliers..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                      <span className="input-group-text">
                        <i className="ti ti-search"></i>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="card-body">
                  {/* Filters */}
                  <div className="mb-3">
                    <div className="btn-group" role="group">
                      <button
                        type="button"
                        className={`btn btn-sm ${isActiveFilter === 'all' ? 'btn-primary' : 'btn-outline-primary'}`}
                        onClick={() => setIsActiveFilter('all')}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${isActiveFilter === 'active' ? 'btn-primary' : 'btn-outline-primary'}`}
                        onClick={() => setIsActiveFilter('active')}
                      >
                        Active
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${isActiveFilter === 'inactive' ? 'btn-primary' : 'btn-outline-primary'}`}
                        onClick={() => setIsActiveFilter('inactive')}
                      >
                        Inactive
                      </button>
                    </div>
                  </div>
                  
                  {/* Suppliers Table */}
                  {loading ? (
                    <div className="text-center py-5">
                      <div className="spinner-border" role="status">
                        <span className="visually-hidden">Loading...</span>
                      </div>
                    </div>
                  ) : suppliers.length === 0 ? (
                    <div className="text-center py-5 text-muted">
                      <p>No suppliers found</p>
                      {isGlobalAdmin && (
                        <button
                          className="btn btn-primary mt-2"
                          onClick={() => navigate('/suppliers/new')}
                        >
                          Add First Supplier
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-vcenter table-hover">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Code</th>
                            <th>Email</th>
                            <th>Phone</th>
                            <th>Status</th>
                            <th>Templates</th>
                            <th>Documents</th>
                            <th className="w-1">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {suppliers.map((supplier) => (
                            <tr key={supplier.id}>
                              <td>
                                <a
                                  href="#"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    navigate(`/suppliers/${supplier.id}`);
                                  }}
                                  className="text-reset"
                                >
                                  {supplier.name}
                                </a>
                              </td>
                              <td>{supplier.code || '-'}</td>
                              <td>{supplier.email || '-'}</td>
                              <td>{supplier.phone || '-'}</td>
                              <td>
                                <span className={`badge ${supplier.isActive ? 'bg-success' : 'bg-secondary'}`}>
                                  {supplier.isActive ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td>
                                <span className="badge bg-info">
                                  {supplier.templateCount || 0}
                                </span>
                              </td>
                              <td>
                                <span className="badge bg-primary">
                                  {supplier.documentCount || 0}
                                </span>
                              </td>
                              <td>
                                <div className="btn-list flex-nowrap">
                                  <button
                                    className="btn btn-sm btn-outline-primary"
                                    onClick={() => navigate(`/suppliers/${supplier.id}`)}
                                  >
                                    View
                                  </button>
                                  {isGlobalAdmin && (
                                    <>
                                      <button
                                        className="btn btn-sm btn-outline-secondary"
                                        onClick={() => navigate(`/suppliers/${supplier.id}/edit`)}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        className="btn btn-sm btn-outline-danger"
                                        onClick={() => {
                                          setSupplierToDelete(supplier);
                                          setShowDeleteModal(true);
                                        }}
                                      >
                                        Delete
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      
                      {/* Pagination */}
                      {pagination.totalPages > 1 && (
                        <div className="d-flex justify-content-between align-items-center mt-3">
                          <div className="text-muted">
                            Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} suppliers
                          </div>
                          <nav>
                            <ul className="pagination mb-0">
                              <li className={`page-item ${pagination.page === 1 ? 'disabled' : ''}`}>
                                <button
                                  className="page-link"
                                  onClick={() => handlePageChange(pagination.page - 1)}
                                  disabled={pagination.page === 1}
                                >
                                  Previous
                                </button>
                              </li>
                              {[...Array(pagination.totalPages)].map((_, i) => {
                                const page = i + 1;
                                if (
                                  page === 1 ||
                                  page === pagination.totalPages ||
                                  (page >= pagination.page - 2 && page <= pagination.page + 2)
                                ) {
                                  return (
                                    <li key={page} className={`page-item ${pagination.page === page ? 'active' : ''}`}>
                                      <button
                                        className="page-link"
                                        onClick={() => handlePageChange(page)}
                                      >
                                        {page}
                                      </button>
                                    </li>
                                  );
                                } else if (page === pagination.page - 3 || page === pagination.page + 3) {
                                  return (
                                    <li key={page} className="page-item disabled">
                                      <span className="page-link">...</span>
                                    </li>
                                  );
                                }
                                return null;
                              })}
                              <li className={`page-item ${pagination.page === pagination.totalPages ? 'disabled' : ''}`}>
                                <button
                                  className="page-link"
                                  onClick={() => handlePageChange(pagination.page + 1)}
                                  disabled={pagination.page === pagination.totalPages}
                                >
                                  Next
                                </button>
                              </li>
                            </ul>
                          </nav>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
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
