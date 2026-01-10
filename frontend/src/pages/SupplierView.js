import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';

const SupplierView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings } = useSettings();
  const [supplier, setSupplier] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const isGlobalAdmin = user?.role === 'global_admin';
  const suppliersEnabled = settings?.suppliersEnabled !== false;
  
  useEffect(() => {
    if (!suppliersEnabled) {
      navigate('/dashboard');
      return;
    }
    fetchSupplier();
  }, [id, suppliersEnabled, navigate]);
  
  const fetchSupplier = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/suppliers/${id}`);
      setSupplier(response.data);
    } catch (error) {
      console.error('Error fetching supplier:', error);
      toast.error('Error fetching supplier details');
      navigate('/suppliers');
    } finally {
      setLoading(false);
    }
  };
  
  if (!suppliersEnabled) {
    return null;
  }
  
  if (loading) {
    return (
      <div className="page">
        <div className="page-body">
          <div className="container-fluid">
            <div className="text-center py-5">
              <div className="spinner-border" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  if (!supplier) {
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
              <h2 className="page-title">{supplier.name}</h2>
            </div>
            <div className="col-auto ms-auto">
              <div className="btn-list">
                {isGlobalAdmin && (
                  <>
                    <button
                      className="btn btn-outline-secondary"
                      onClick={() => navigate(`/suppliers/${id}/edit`)}
                    >
                      <i className="ti ti-edit me-1"></i>
                      Edit
                    </button>
                  </>
                )}
                <button
                  className="btn btn-outline-primary"
                  onClick={() => navigate('/suppliers')}
                >
                  <i className="ti ti-arrow-left me-1"></i>
                  Back
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div className="page-body">
        <div className="container-fluid">
          <div className="row row-cards">
            {/* Supplier Details */}
            <div className="col-12 col-lg-6">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Supplier Information</h3>
                </div>
                <div className="card-body">
                  <dl className="row">
                    <dt className="col-sm-4">Name</dt>
                    <dd className="col-sm-8">{supplier.name}</dd>
                    
                    {supplier.code && (
                      <>
                        <dt className="col-sm-4">Code</dt>
                        <dd className="col-sm-8">{supplier.code}</dd>
                      </>
                    )}
                    
                    {supplier.email && (
                      <>
                        <dt className="col-sm-4">Email</dt>
                        <dd className="col-sm-8">
                          <a href={`mailto:${supplier.email}`}>{supplier.email}</a>
                        </dd>
                      </>
                    )}
                    
                    {supplier.phone && (
                      <>
                        <dt className="col-sm-4">Phone</dt>
                        <dd className="col-sm-8">{supplier.phone}</dd>
                      </>
                    )}
                    
                    {supplier.address && Object.keys(supplier.address).length > 0 && (
                      <>
                        <dt className="col-sm-4">Address</dt>
                        <dd className="col-sm-8">
                          {supplier.address.line1 && <div>{supplier.address.line1}</div>}
                          {supplier.address.line2 && <div>{supplier.address.line2}</div>}
                          {supplier.address.city && supplier.address.state && (
                            <div>{supplier.address.city}, {supplier.address.state} {supplier.address.zip}</div>
                          )}
                          {supplier.address.country && <div>{supplier.address.country}</div>}
                        </dd>
                      </>
                    )}
                    
                    {supplier.taxId && (
                      <>
                        <dt className="col-sm-4">Tax ID</dt>
                        <dd className="col-sm-8">{supplier.taxId}</dd>
                      </>
                    )}
                    
                    {supplier.vatNumber && (
                      <>
                        <dt className="col-sm-4">VAT Number</dt>
                        <dd className="col-sm-8">{supplier.vatNumber}</dd>
                      </>
                    )}
                    
                    {supplier.website && (
                      <>
                        <dt className="col-sm-4">Website</dt>
                        <dd className="col-sm-8">
                          <a href={supplier.website} target="_blank" rel="noopener noreferrer">
                            {supplier.website}
                          </a>
                        </dd>
                      </>
                    )}
                    
                    <dt className="col-sm-4">Status</dt>
                    <dd className="col-sm-8">
                      <span className={`badge ${supplier.isActive ? 'bg-success' : 'bg-secondary'}`}>
                        {supplier.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </dd>
                    
                    {supplier.notes && (
                      <>
                        <dt className="col-sm-4">Notes</dt>
                        <dd className="col-sm-8">{supplier.notes}</dd>
                      </>
                    )}
                  </dl>
                </div>
              </div>
            </div>
            
            {/* Templates */}
            <div className="col-12 col-lg-6">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Templates</h3>
                  {isGlobalAdmin && (
                    <div className="card-actions">
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => navigate('/supplier-templates', { state: { supplierId: id } })}
                      >
                        <i className="ti ti-plus me-1"></i>
                        Add Template
                      </button>
                    </div>
                  )}
                </div>
                <div className="card-body">
                  {supplier.templates && supplier.templates.length > 0 ? (
                    <div className="list-group list-group-flush">
                      {supplier.templates.map((template) => (
                        <div key={template.id} className="list-group-item">
                          <div className="d-flex justify-content-between align-items-center">
                            <div>
                              <strong>{template.name}</strong>
                              <div className="text-muted small">
                                <span className={`badge bg-${template.templateType === 'invoice' ? 'primary' : template.templateType === 'credit_note' ? 'warning' : 'info'}`}>
                                  {template.templateType}
                                </span>
                                {' '}
                                <span className="badge bg-secondary">{template.fileType}</span>
                                {template.isDefault && <span className="badge bg-success ms-1">Default</span>}
                              </div>
                            </div>
                            <div>
                              {template.enabled ? (
                                <span className="badge bg-success">Enabled</span>
                              ) : (
                                <span className="badge bg-secondary">Disabled</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-3 text-muted">
                      <p>No templates found</p>
                      {isGlobalAdmin && (
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => navigate('/supplier-templates', { state: { supplierId: id } })}
                        >
                          Create First Template
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* Recent Documents */}
            <div className="col-12">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Recent Documents</h3>
                  <div className="card-actions">
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => navigate('/supplier-documents', { state: { supplierId: id } })}
                    >
                      View All
                    </button>
                  </div>
                </div>
                <div className="card-body">
                  {supplier.documents && supplier.documents.length > 0 ? (
                    <div className="table-responsive">
                      <table className="table table-vcenter table-hover">
                        <thead>
                          <tr>
                            <th>Type</th>
                            <th>Invoice Number</th>
                            <th>PO Number</th>
                            <th>Date</th>
                            <th>Amount</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {supplier.documents.map((doc) => (
                            <tr key={doc.id}>
                              <td>
                                <span className={`badge ${
                                  doc.documentType === 'invoice' ? 'bg-primary' : 
                                  doc.documentType === 'credit_note' ? 'bg-warning' : 
                                  'bg-info'
                                }`}>
                                  {doc.documentType}
                                </span>
                              </td>
                              <td>{doc.invoiceNumber || '-'}</td>
                              <td>{doc.poNumber || '-'}</td>
                              <td>{doc.documentDate ? new Date(doc.documentDate).toLocaleDateString() : '-'}</td>
                              <td>{doc.amount ? `£${parseFloat(doc.amount).toFixed(2)}` : '-'}</td>
                              <td>
                                <span className={`badge ${
                                  doc.status === 'ready' ? 'bg-success' :
                                  doc.status === 'processed' ? 'bg-primary' :
                                  doc.status === 'failed' ? 'bg-danger' :
                                  'bg-secondary'
                                }`}>
                                  {doc.status}
                                </span>
                              </td>
                              <td>
                                <button
                                  className="btn btn-sm btn-outline-primary"
                                  onClick={() => navigate(`/supplier-documents/${doc.id}`)}
                                >
                                  View
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-3 text-muted">
                      <p>No documents found</p>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => navigate('/supplier-documents', { state: { supplierId: id } })}
                      >
                        Upload Document
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupplierView;
