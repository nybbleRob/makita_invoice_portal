import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useSettings } from '../context/SettingsContext';

const AddSupplier = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    email: '',
    phone: '',
    address: { line1: '', line2: '', city: '', state: '', zip: '', country: '' },
    taxId: '',
    vatNumber: '',
    website: '',
    notes: '',
    isActive: true
  });
  
  const suppliersEnabled = settings?.suppliersEnabled !== false;
  
  useEffect(() => {
    if (!suppliersEnabled) {
      navigate('/dashboard');
    }
  }, [suppliersEnabled, navigate]);
  
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name.startsWith('address.')) {
      const field = name.split('.')[1];
      setFormData(prev => ({
        ...prev,
        address: { ...prev.address, [field]: value }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [name]: type === 'checkbox' ? checked : value
      }));
    }
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      await api.post('/suppliers', formData);
      toast.success('Supplier created successfully');
      navigate('/suppliers');
    } catch (error) {
      console.error('Error creating supplier:', error);
      toast.error(error.response?.data?.message || 'Error creating supplier');
    } finally {
      setLoading(false);
    }
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
              <div className="page-pretitle">
                <a href="#" onClick={(e) => { e.preventDefault(); navigate('/suppliers'); }}>Suppliers</a>
              </div>
              <h2 className="page-title">Add Supplier</h2>
            </div>
          </div>
        </div>
      </div>
      
      <div className="page-body">
        <div className="container-fluid">
          <div className="row row-cards">
            <div className="col-12 col-lg-8">
              <form onSubmit={handleSubmit}>
                <div className="card">
                  <div className="card-header">
                    <h3 className="card-title">Supplier Information</h3>
                  </div>
                  <div className="card-body">
                    <div className="mb-3">
                      <label htmlFor="supplier-name" className="form-label required">Name</label>
                      <input
                        id="supplier-name"
                        type="text"
                        className="form-control"
                        name="name"
                        value={formData.name}
                        onChange={handleChange}
                        required
                      />
                    </div>
                    
                    <div className="mb-3">
                      <label htmlFor="supplier-code" className="form-label">Code</label>
                      <input
                        id="supplier-code"
                        type="text"
                        className="form-control"
                        name="code"
                        value={formData.code}
                        onChange={handleChange}
                      />
                    </div>
                    
                    <div className="mb-3">
                      <label htmlFor="supplier-email" className="form-label">Email</label>
                      <input
                        id="supplier-email"
                        type="email"
                        className="form-control"
                        name="email"
                        value={formData.email}
                        onChange={handleChange}
                      />
                    </div>
                    
                    <div className="mb-3">
                      <label htmlFor="supplier-phone" className="form-label">Phone</label>
                      <input
                        id="supplier-phone"
                        type="text"
                        className="form-control"
                        name="phone"
                        value={formData.phone}
                        onChange={handleChange}
                      />
                    </div>
                    
                    <div className="mb-3">
                      <label htmlFor="supplier-address-line1" className="form-label">Address Line 1</label>
                      <input
                        id="supplier-address-line1"
                        type="text"
                        className="form-control"
                        name="address.line1"
                        value={formData.address.line1}
                        onChange={handleChange}
                      />
                    </div>
                    
                    <div className="mb-3">
                      <label htmlFor="supplier-address-city" className="form-label">City</label>
                      <input
                        id="supplier-address-city"
                        type="text"
                        className="form-control"
                        name="address.city"
                        value={formData.address.city}
                        onChange={handleChange}
                      />
                    </div>
                    
                    <div className="mb-3">
                      <label htmlFor="supplier-address-state" className="form-label">State</label>
                      <input
                        id="supplier-address-state"
                        type="text"
                        className="form-control"
                        name="address.state"
                        value={formData.address.state}
                        onChange={handleChange}
                      />
                    </div>
                    
                    <div className="mb-3">
                      <label htmlFor="supplier-address-zip" className="form-label">Zip</label>
                      <input
                        id="supplier-address-zip"
                        type="text"
                        className="form-control"
                        name="address.zip"
                        value={formData.address.zip}
                        onChange={handleChange}
                      />
                    </div>
                    
                    <div className="mb-3">
                      <label htmlFor="supplier-address-country" className="form-label">Country</label>
                      <input
                        id="supplier-address-country"
                        type="text"
                        className="form-control"
                        name="address.country"
                        value={formData.address.country}
                        onChange={handleChange}
                      />
                    </div>
                    
                    <div className="mb-3">
                      <label htmlFor="supplier-tax-id" className="form-label">Tax ID</label>
                      <input
                        id="supplier-tax-id"
                        type="text"
                        className="form-control"
                        name="taxId"
                        value={formData.taxId}
                        onChange={handleChange}
                      />
                    </div>
                    
                    <div className="mb-3">
                      <label htmlFor="supplier-vat-number" className="form-label">VAT Number</label>
                      <input
                        id="supplier-vat-number"
                        type="text"
                        className="form-control"
                        name="vatNumber"
                        value={formData.vatNumber}
                        onChange={handleChange}
                      />
                    </div>
                    
                    <div className="mb-3">
                      <label htmlFor="supplier-website" className="form-label">Website</label>
                      <input
                        id="supplier-website"
                        type="url"
                        className="form-control"
                        name="website"
                        value={formData.website}
                        onChange={handleChange}
                      />
                    </div>
                    
                    <div className="mb-3">
                      <label htmlFor="supplier-notes" className="form-label">Notes</label>
                      <textarea
                        id="supplier-notes"
                        className="form-control"
                        name="notes"
                        rows="4"
                        value={formData.notes}
                        onChange={handleChange}
                      />
                    </div>
                    
                    <div className="mb-3">
                      <div className="form-check form-switch">
                        <input
                          id="supplier-is-active"
                          className="form-check-input"
                          type="checkbox"
                          name="isActive"
                          checked={formData.isActive}
                          onChange={handleChange}
                        />
                        <label htmlFor="supplier-is-active" className="form-check-label">Active</label>
                      </div>
                    </div>
                  </div>
                  <div className="card-footer">
                    <div className="btn-list">
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={loading}
                      >
                        {loading ? 'Creating...' : 'Create Supplier'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => navigate('/suppliers')}
                      >
                        Cancel
                      </button>
                    </div>
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

export default AddSupplier;
