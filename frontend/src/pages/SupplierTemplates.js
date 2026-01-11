import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';

const SupplierTemplates = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { settings } = useSettings();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [supplierFilter, setSupplierFilter] = useState(location.state?.supplierId || '');
  const [typeFilter, setTypeFilter] = useState('');
  const [fileTypeFilter, setFileTypeFilter] = useState('');
  
  const isGlobalAdmin = user?.role === 'global_admin';
  const suppliersEnabled = settings?.suppliersEnabled !== false;
  
  useEffect(() => {
    if (!suppliersEnabled) {
      navigate('/dashboard');
      return;
    }
    fetchTemplates();
  }, [supplierFilter, typeFilter, fileTypeFilter, suppliersEnabled, navigate]);
  
  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const params = {};
      if (supplierFilter) params.supplierId = supplierFilter;
      if (typeFilter) params.templateType = typeFilter;
      if (fileTypeFilter) params.fileType = fileTypeFilter;
      
      const response = await api.get('/supplier-templates', { params });
      // Ensure templates is always an array
      const templatesData = response.data || [];
      setTemplates(Array.isArray(templatesData) ? templatesData : []);
    } catch (error) {
      console.error('Error fetching templates:', error);
      toast.error('Error fetching supplier templates');
      setTemplates([]); // Ensure templates is set to empty array on error
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
              <div className="page-pretitle">Suppliers</div>
              <h2 className="page-title">Supplier Templates</h2>
            </div>
            {isGlobalAdmin && (
              <div className="col-auto ms-auto">
                <button
                  className="btn btn-primary"
                  onClick={() => navigate('/supplier-templates/new')}
                >
                  <i className="ti ti-plus me-1"></i>
                  Add Template
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      
      <div className="page-body">
        <div className="container-fluid">
          <div className="card">
            <div className="card-body">
              {loading ? (
                <div className="text-center py-5">
                  <div className="spinner-border" role="status">
                    <span className="visually-hidden">Loading...</span>
                  </div>
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-vcenter table-hover">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Supplier</th>
                        <th>Type</th>
                        <th>File Type</th>
                        <th>Default</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Array.isArray(templates) && templates.map((template) => (
                        <tr key={template.id}>
                          <td>{template.name}</td>
                          <td>
                            {template.supplier ? (
                              <a
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  navigate(`/suppliers/${template.supplier.id}`);
                                }}
                              >
                                {template.supplier.name}
                              </a>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td>
                            <span className={`badge ${
                              template.templateType === 'invoice' ? 'bg-primary' :
                              template.templateType === 'credit_note' ? 'bg-warning' :
                              'bg-info'
                            }`}>
                              {template.templateType}
                            </span>
                          </td>
                          <td>
                            <span className="badge bg-secondary">{template.fileType}</span>
                          </td>
                          <td>
                            {template.isDefault ? (
                              <span className="badge bg-success">Yes</span>
                            ) : (
                              <span className="badge bg-secondary">No</span>
                            )}
                          </td>
                          <td>
                            {template.enabled ? (
                              <span className="badge bg-success">Enabled</span>
                            ) : (
                              <span className="badge bg-secondary">Disabled</span>
                            )}
                          </td>
                          <td>
                            <div className="btn-list flex-nowrap">
                              <button
                                className="btn btn-sm btn-outline-primary"
                                onClick={() => navigate(`/supplier-templates/${template.id}`)}
                              >
                                View
                              </button>
                              {isGlobalAdmin && (
                                <button
                                  className="btn btn-sm btn-outline-danger"
                                  onClick={() => {
                                    if (window.confirm('Delete this template?')) {
                                      api.delete(`/supplier-templates/${template.id}`)
                                        .then(() => {
                                          toast.success('Template deleted');
                                          fetchTemplates();
                                        })
                                        .catch(err => toast.error(err.response?.data?.message || 'Error deleting template'));
                                    }
                                  }}
                                >
                                  Delete
                                </button>
                              )}
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
    </div>
  );
};

export default SupplierTemplates;
