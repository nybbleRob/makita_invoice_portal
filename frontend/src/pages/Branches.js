import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import toast from '../utils/toast';
const Branches = () => {
  const [branches, setBranches] = useState([]);
  const [filteredBranches, setFilteredBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [parentCompanies, setParentCompanies] = useState([]);
  const searchInputRef = useRef(null);
  const [formData, setFormData] = useState({
    name: '',
    referenceNo: '',
    code: '',
    parentId: '',
    email: '',
    phone: '',
    address: {
      line1: '',
      line2: '',
      city: '',
      state: '',
      zip: '',
      country: ''
    },
    taxId: '',
    vatNumber: '',
    website: '',
    isActive: true
  });

  useEffect(() => {
    fetchBranches();
    fetchParentCompanies();
  }, []);

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

  // Filter branches based on search and status
  useEffect(() => {
    let filtered = [...branches];

    // Search filter - only filter if 3+ characters
    if (searchQuery.trim().length >= 3) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (branch) =>
          branch.name.toLowerCase().includes(query) ||
          (branch.code && branch.code.toLowerCase().includes(query)) ||
          (branch.email && branch.email.toLowerCase().includes(query)) ||
          (branch.referenceNo && branch.referenceNo.toString().includes(query))
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(
        (branch) => (statusFilter === 'active' && branch.isActive) || (statusFilter === 'inactive' && !branch.isActive)
      );
    }

    setFilteredBranches(filtered);
  }, [branches, searchQuery, statusFilter]);

  const fetchBranches = async () => {
    try {
      setLoading(true);
      const response = await api.get('/api/companies', {
        params: {
          type: 'BRANCH'
        }
      });
      setBranches(response.data);
    } catch (error) {
      console.error('Error fetching branches:', error);
      toast.error('Failed to fetch branches: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  const fetchParentCompanies = async () => {
    try {
      // Fetch all companies that can be parents (CORP and SUB)
      const response = await api.get('/api/companies');
      const parents = response.data.filter(c => c.type === 'CORP' || c.type === 'SUB');
      setParentCompanies(parents);
    } catch (error) {
      console.error('Error fetching parent companies:', error);
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name.startsWith('address.')) {
      const addressField = name.split('.')[1];
      setFormData(prev => ({
        ...prev,
        address: {
          ...prev.address,
          [addressField]: value
        }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? checked : value
      }));
    }
  };

  const handleCreateBranch = async (e) => {
    e.preventDefault();
    try {
      const submitData = {
        ...formData,
        type: 'BRANCH',
        referenceNo: formData.referenceNo ? parseInt(formData.referenceNo) : null,
        parentId: formData.parentId || null,
        address: Object.values(formData.address).some(v => v) ? formData.address : null
      };
      
      await api.post('/api/companies', submitData);
      toast.success('Branch created successfully!');
      setShowModal(false);
      resetForm();
      fetchBranches();
      fetchParentCompanies();
    } catch (error) {
      toast.error('Error creating branch: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleUpdateBranch = async (e) => {
    e.preventDefault();
    try {
      const submitData = {
        ...formData,
        type: 'BRANCH',
        referenceNo: formData.referenceNo ? parseInt(formData.referenceNo) : null,
        parentId: formData.parentId || null,
        address: Object.values(formData.address).some(v => v) ? formData.address : null
      };
      
      await api.put(`/api/companies/${selectedBranch.id}`, submitData);
      toast.success('Branch updated successfully!');
      setShowModal(false);
      setSelectedBranch(null);
      resetForm();
      fetchBranches();
      fetchParentCompanies();
    } catch (error) {
      toast.error('Error updating branch: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleDeleteBranch = async (branchId) => {
    if (!window.confirm('Are you sure you want to delete this branch?')) return;
    
    try {
      await api.delete(`/api/companies/${branchId}`);
      toast.success('Branch deleted successfully!');
      fetchBranches();
      fetchParentCompanies();
    } catch (error) {
      toast.error('Error deleting branch: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleToggleStatus = async (branch) => {
    try {
      await api.put(`/api/companies/${branch.id}`, {
        isActive: !branch.isActive
      });
      toast.success(`Branch ${!branch.isActive ? 'activated' : 'deactivated'} successfully!`);
      fetchBranches();
    } catch (error) {
      toast.error('Error updating branch status: ' + (error.response?.data?.message || error.message));
    }
  };

  const openEditModal = (branch) => {
    setSelectedBranch(branch);
    setFormData({
      name: branch.name || '',
      referenceNo: branch.referenceNo || '',
      code: branch.code || '',
      parentId: branch.parentId || '',
      email: branch.email || '',
      phone: branch.phone || '',
      address: branch.address || {
        line1: '',
        line2: '',
        city: '',
        state: '',
        zip: '',
        country: ''
      },
      taxId: branch.taxId || '',
      vatNumber: branch.vatNumber || '',
      website: branch.website || '',
      isActive: branch.isActive !== undefined ? branch.isActive : true
    });
    setShowModal(true);
  };

  const resetForm = () => {
    setFormData({
      name: '',
      referenceNo: '',
      code: '',
      parentId: '',
      email: '',
      phone: '',
      address: {
        line1: '',
        line2: '',
        city: '',
        state: '',
        zip: '',
        country: ''
      },
      taxId: '',
      vatNumber: '',
      website: '',
      isActive: true
    });
    setSelectedBranch(null);
  };

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

  return (
    <div>
      <div className="page-header d-print-none">
        <div className="container-fluid">
          <div className="row g-2 align-items-center">
            <div className="col">
              <h2 className="page-title">Branches</h2>
              <div className="text-muted mt-1">Manage branch locations</div>
            </div>
            <div className="col-auto ms-auto">
              <button
                className="btn btn-primary"
                onClick={() => {
                  resetForm();
                  setShowModal(true);
                }}
              >
                Add Branch
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
                  <h3 className="card-title mb-0">Branches</h3>
                  <p className="text-secondary m-0">Manage your branch locations</p>
                </div>
                <div className="col-md-auto col-sm-12">
                  <div className="ms-auto d-flex flex-wrap btn-list gap-2">
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
                        autocomplete="off"
                      />
                      <span className="input-group-text">
                        <kbd>Ctrl+K</kbd>
                      </span>
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
                  </div>
                </div>
              </div>
            </div>
            <div className="card-body">
              {filteredBranches.length === 0 ? (
                <div className="text-center py-5">
                  <p className="text-muted">No branches found</p>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-vcenter card-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Reference No.</th>
                        <th>Code</th>
                        <th>Parent Company</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Status</th>
                        <th className="w-1">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBranches.map((branch) => (
                        <tr key={branch.id}>
                          <td>
                            <strong>{branch.name}</strong>
                          </td>
                          <td>{branch.referenceNo || '-'}</td>
                          <td>{branch.code || '-'}</td>
                          <td>
                            {branch.parent ? (
                              <span>{branch.parent.name}</span>
                            ) : (
                              <span className="text-muted">-</span>
                            )}
                          </td>
                          <td>{branch.email || '-'}</td>
                          <td>{branch.phone || '-'}</td>
                          <td>
                            <span className={`badge ${branch.isActive ? 'bg-success-lt' : 'bg-secondary-lt'}`}>
                              {branch.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td>
                            <div className="btn-list">
                              <button
                                className="btn btn-sm btn-outline-primary"
                                onClick={() => openEditModal(branch)}
                                title="Edit"
                              >
                                Edit
                              </button>
                              <button
                                className="btn btn-sm btn-outline-secondary"
                                onClick={() => handleToggleStatus(branch)}
                                title={branch.isActive ? 'Deactivate' : 'Activate'}
                              >
                                {branch.isActive ? 'Deactivate' : 'Activate'}
                              </button>
                              <button
                                className="btn btn-sm btn-outline-danger"
                                onClick={() => handleDeleteBranch(branch.id)}
                                title="Delete"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {selectedBranch ? 'Edit Branch' : 'Create Branch'}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowModal(false);
                    resetForm();
                  }}
                ></button>
              </div>
              <form onSubmit={selectedBranch ? handleUpdateBranch : handleCreateBranch}>
                <div className="modal-body">
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label required">Branch Name</label>
                      <input
                        type="text"
                        className="form-control"
                        name="name"
                        value={formData.name}
                        onChange={handleInputChange}
                        required
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label required">Parent Company</label>
                      <select
                        className="form-select"
                        name="parentId"
                        value={formData.parentId}
                        onChange={handleInputChange}
                        required
                      >
                        <option value="">Select Parent Company</option>
                        {parentCompanies
                          .filter(parent => !selectedBranch || parent.id !== selectedBranch.id)
                          .map((parent) => (
                            <option key={parent.id} value={parent.id}>
                              {parent.name} {parent.referenceNo ? `(${parent.referenceNo})` : ''}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Reference Number</label>
                      <input
                        type="number"
                        className="form-control"
                        name="referenceNo"
                        value={formData.referenceNo}
                        onChange={handleInputChange}
                        placeholder="Unique reference number"
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Code</label>
                      <input
                        type="text"
                        className="form-control"
                        name="code"
                        value={formData.code}
                        onChange={handleInputChange}
                        placeholder="Branch code"
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Email</label>
                      <input
                        type="email"
                        className="form-control"
                        name="email"
                        value={formData.email}
                        onChange={handleInputChange}
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Phone</label>
                      <input
                        type="text"
                        className="form-control"
                        name="phone"
                        value={formData.phone}
                        onChange={handleInputChange}
                      />
                    </div>
                    <div className="col-md-12 mb-3">
                      <label className="form-label">Address Line 1</label>
                      <input
                        type="text"
                        className="form-control"
                        name="address.line1"
                        value={formData.address.line1}
                        onChange={handleInputChange}
                      />
                    </div>
                    <div className="col-md-12 mb-3">
                      <label className="form-label">Address Line 2</label>
                      <input
                        type="text"
                        className="form-control"
                        name="address.line2"
                        value={formData.address.line2}
                        onChange={handleInputChange}
                      />
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">City</label>
                      <input
                        type="text"
                        className="form-control"
                        name="address.city"
                        value={formData.address.city}
                        onChange={handleInputChange}
                      />
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">State</label>
                      <input
                        type="text"
                        className="form-control"
                        name="address.state"
                        value={formData.address.state}
                        onChange={handleInputChange}
                      />
                    </div>
                    <div className="col-md-4 mb-3">
                      <label className="form-label">ZIP/Postal Code</label>
                      <input
                        type="text"
                        className="form-control"
                        name="address.zip"
                        value={formData.address.zip}
                        onChange={handleInputChange}
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Tax ID</label>
                      <input
                        type="text"
                        className="form-control"
                        name="taxId"
                        value={formData.taxId}
                        onChange={handleInputChange}
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">VAT Number</label>
                      <input
                        type="text"
                        className="form-control"
                        name="vatNumber"
                        value={formData.vatNumber}
                        onChange={handleInputChange}
                      />
                    </div>
                    <div className="col-md-12 mb-3">
                      <label className="form-label">Website</label>
                      <input
                        type="url"
                        className="form-control"
                        name="website"
                        value={formData.website}
                        onChange={handleInputChange}
                        placeholder="https://example.com"
                      />
                    </div>
                    <div className="col-md-12 mb-3">
                      <label className="form-check">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          name="isActive"
                          checked={formData.isActive}
                          onChange={handleInputChange}
                        />
                        <span className="form-check-label">Active</span>
                      </label>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      setShowModal(false);
                      resetForm();
                    }}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    {selectedBranch ? 'Update' : 'Create'} Branch
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Branches;

