import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useDebounce } from '../hooks/useDebounce';

const AddSubsidiary = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    referenceNo: '',
    edi: false,
    parentId: '',
    address: {
      line1: '',
      line2: '',
      city: '',
      state: '',
      zip: '',
      country: ''
    }
  });

  // Parent selection state
  const [parentSearch, setParentSearch] = useState('');
  const [parentCompanies, setParentCompanies] = useState([]);
  const [parentPagination, setParentPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0
  });
  const [loadingParents, setLoadingParents] = useState(false);
  const [selectedParent, setSelectedParent] = useState(null);

  const debouncedSearch = useDebounce(parentSearch, 500);

  const fetchParentCompanies = useCallback(async (page = 1, search = '') => {
    try {
      setLoadingParents(true);
      const response = await api.get('/api/companies/parents', {
        params: {
          page,
          limit: 20,
          search
        }
      });
      setParentCompanies(response.data.data);
      setParentPagination(response.data.pagination);
    } catch (error) {
      console.error('Error fetching parent companies:', error);
      toast.error('Failed to load parent companies');
    } finally {
      setLoadingParents(false);
    }
  }, []);

  useEffect(() => {
    fetchParentCompanies(1, debouncedSearch);
  }, [debouncedSearch, fetchParentCompanies]);

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

  const handleParentSelect = (parent) => {
    setSelectedParent(parent);
    setFormData(prev => ({
      ...prev,
      parentId: parent.id
    }));
  };

  const handleParentPageChange = (newPage) => {
    fetchParentCompanies(newPage, debouncedSearch);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      toast.error('Company name is required');
      return;
    }

    if (!formData.parentId) {
      toast.error('Please select a parent company');
      return;
    }

    try {
      setLoading(true);
      const payload = {
        name: formData.name.trim(),
        type: 'SUB',
        referenceNo: formData.referenceNo ? parseInt(formData.referenceNo) : null,
        edi: formData.edi,
        parentId: formData.parentId,
        address: formData.address
      };

      await api.post('/api/companies', payload);
      toast.success('Subsidiary created successfully!');
      navigate('/companies');
    } catch (error) {
      toast.error('Error creating subsidiary: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header d-print-none">
        <div className="container-fluid">
          <div className="row g-2 align-items-center">
            <div className="col">
              <h2 className="page-title">Add Subsidiary</h2>
              <div className="text-muted mt-1">Create a new subsidiary company</div>
            </div>
            <div className="col-auto ms-auto">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate('/companies')}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="container-xl">
          <div className="row">
            <div className="col-12">
              <form className="card" onSubmit={handleSubmit}>
                <div className="card-header">
                  <h3 className="card-title">Subsidiary Details</h3>
                </div>
                <div className="card-body">
                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label required">Subsidiary Name</label>
                      <input
                        type="text"
                        className="form-control"
                        name="name"
                        value={formData.name}
                        onChange={handleInputChange}
                        required
                        placeholder="Enter subsidiary name"
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Account Number (Reference No.)</label>
                      <input
                        type="number"
                        className="form-control"
                        name="referenceNo"
                        value={formData.referenceNo}
                        onChange={handleInputChange}
                        placeholder="Enter account/reference number"
                      />
                    </div>
                    <div className="col-md-12 mb-3">
                      <label className="form-check form-switch">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          name="edi"
                          checked={formData.edi}
                          onChange={handleInputChange}
                        />
                        <span className="form-check-label">Enable EDI (Electronic Data Interchange)</span>
                      </label>
                      <small className="form-hint d-block">Enable EDI for automated invoice processing</small>
                    </div>
                  </div>

                  <div className="hr-text">Select Parent Company</div>

                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label required">Search Parent Company</label>
                      <input
                        type="text"
                        className="form-control"
                        value={parentSearch}
                        onChange={(e) => setParentSearch(e.target.value)}
                        placeholder="Search by name, reference number, or code..."
                      />
                      <small className="form-hint">Search for Corporate or Subsidiary companies</small>
                    </div>
                    <div className="col-md-6 mb-3">
                      {selectedParent && (
                        <div className="alert alert-info mb-0">
                          <strong>Selected:</strong> {selectedParent.name}
                          {selectedParent.referenceNo && ` (Ref: ${selectedParent.referenceNo})`}
                          <button
                            type="button"
                            className="btn btn-sm btn-link float-end"
                            onClick={() => {
                              setSelectedParent(null);
                              setFormData(prev => ({ ...prev, parentId: '' }));
                            }}
                          >
                            Clear
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="card mb-3" style={{ maxHeight: '350px', overflowY: 'auto' }}>
                    <div className="card-body">
                      {loadingParents ? (
                        <div className="text-center py-3">
                          <div className="spinner-border spinner-border-sm" role="status">
                            <span className="visually-hidden">Loading...</span>
                          </div>
                        </div>
                      ) : parentCompanies.length === 0 ? (
                        <div className="text-center py-3 text-muted">
                          No parent companies found
                        </div>
                      ) : (
                        <>
                          <div className="list-group list-group-flush">
                            {parentCompanies.map((parent) => (
                              <label
                                key={parent.id}
                                className={`list-group-item list-group-item-action ${selectedParent?.id === parent.id ? 'active' : ''}`}
                              >
                                <div className="form-check">
                                  <input
                                    type="radio"
                                    className="form-check-input"
                                    name="parentId"
                                    checked={selectedParent?.id === parent.id}
                                    onChange={() => handleParentSelect(parent)}
                                  />
                                  <div className="form-check-label">
                                    <strong>{parent.name}</strong>
                                    {parent.referenceNo && (
                                      <span className="text-muted ms-2">(Ref: {parent.referenceNo})</span>
                                    )}
                                    {parent.code && (
                                      <span className="text-muted ms-2">Code: {parent.code}</span>
                                    )}
                                    <span className={`badge ${parent.type === 'CORP' ? 'bg-primary-lt' : 'bg-info-lt'} ms-2`}>
                                      {parent.type === 'CORP' ? 'Corporate' : 'Subsidiary'}
                                    </span>
                                  </div>
                                </div>
                              </label>
                            ))}
                          </div>
                          {parentPagination.pages > 1 && (
                            <div className="d-flex justify-content-between align-items-center mt-3">
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary"
                                disabled={parentPagination.page === 1}
                                onClick={() => handleParentPageChange(parentPagination.page - 1)}
                              >
                                Previous
                              </button>
                              <span className="text-muted">
                                Page {parentPagination.page} of {parentPagination.pages}
                              </span>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary"
                                disabled={parentPagination.page === parentPagination.pages}
                                onClick={() => handleParentPageChange(parentPagination.page + 1)}
                              >
                                Next
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="hr-text">Address (Optional)</div>

                  <div className="row">
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Address Line 1</label>
                      <input
                        type="text"
                        className="form-control"
                        name="address.line1"
                        value={formData.address.line1}
                        onChange={handleInputChange}
                        placeholder="Street address"
                      />
                    </div>
                    <div className="col-md-6 mb-3">
                      <label className="form-label">Address Line 2</label>
                      <input
                        type="text"
                        className="form-control"
                        name="address.line2"
                        value={formData.address.line2}
                        onChange={handleInputChange}
                        placeholder="Apartment, suite, etc."
                      />
                    </div>
                    <div className="col-md-3 mb-3">
                      <label className="form-label">City</label>
                      <input
                        type="text"
                        className="form-control"
                        name="address.city"
                        value={formData.address.city}
                        onChange={handleInputChange}
                        placeholder="City"
                      />
                    </div>
                    <div className="col-md-3 mb-3">
                      <label className="form-label">State/Province</label>
                      <input
                        type="text"
                        className="form-control"
                        name="address.state"
                        value={formData.address.state}
                        onChange={handleInputChange}
                        placeholder="State or Province"
                      />
                    </div>
                    <div className="col-md-3 mb-3">
                      <label className="form-label">ZIP/Postal Code</label>
                      <input
                        type="text"
                        className="form-control"
                        name="address.zip"
                        value={formData.address.zip}
                        onChange={handleInputChange}
                        placeholder="ZIP or Postal Code"
                      />
                    </div>
                    <div className="col-md-3 mb-3">
                      <label className="form-label">Country</label>
                      <input
                        type="text"
                        className="form-control"
                        name="address.country"
                        value={formData.address.country}
                        onChange={handleInputChange}
                        placeholder="Country"
                      />
                    </div>
                  </div>
                </div>
                <div className="card-footer">
                  <div className="d-flex">
                    <button
                      type="button"
                      className="btn btn-link"
                      onClick={() => navigate('/companies')}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn btn-info ms-auto"
                      disabled={loading || !formData.parentId}
                    >
                      {loading ? 'Creating...' : 'Create Subsidiary'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddSubsidiary;

