import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import ExcelTemplateBuilder from '../components/ExcelTemplateBuilder';
import TemplateBuilder from '../components/TemplateBuilder';

const SupplierView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings } = useSettings();
  const [supplier, setSupplier] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [builderType, setBuilderType] = useState(null); // 'excel' or 'pdf'
  
  const isGlobalAdmin = user?.role === 'global_admin' || user?.role === 'administrator';
  const suppliersEnabled = settings?.suppliersEnabled !== false;
  
  const fetchSupplier = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/api/suppliers/${id}`);
      setSupplier(response.data);
    } catch (error) {
      console.error('Error fetching supplier:', error);
      toast.error('Error fetching supplier details');
      navigate('/suppliers');
    } finally {
      setLoading(false);
    }
  };
  
  const fetchTemplates = async () => {
    try {
      setTemplatesLoading(true);
      const response = await api.get('/api/supplier-templates', {
        params: { supplierId: id }
      });
      const templatesData = response.data || [];
      setTemplates(Array.isArray(templatesData) ? templatesData : []);
    } catch (error) {
      console.error('Error fetching templates:', error);
      toast.error('Error fetching supplier templates');
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  };
  
  useEffect(() => {
    if (!suppliersEnabled) {
      navigate('/dashboard');
      return;
    }
    fetchSupplier();
    fetchTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, suppliersEnabled, navigate]);
  
  const handleDeleteTemplate = async (templateId) => {
    if (!window.confirm('Are you sure you want to delete this template?')) {
      return;
    }
    
    try {
      await api.delete(`/api/supplier-templates/${templateId}`);
      toast.success('Template deleted successfully');
      fetchTemplates();
    } catch (error) {
      toast.error('Failed to delete template: ' + (error.response?.data?.message || error.message));
    }
  };
  
  const handleEditTemplate = (template) => {
    setEditingTemplate(template);
    setBuilderType(template.fileType || 'pdf');
    setShowBuilder(true);
  };
  
  const handleNewTemplate = (type, fileType = 'pdf') => {
    setEditingTemplate({ 
      templateType: type, 
      fileType: fileType,
      supplierId: id 
    });
    setBuilderType(fileType);
    setShowBuilder(true);
  };
  
  const handleBuilderClose = () => {
    setShowBuilder(false);
    setEditingTemplate(null);
    fetchTemplates();
  };
  
  if (!suppliersEnabled) {
    return null;
  }
  
  if (showBuilder) {
    return (
      <div className="page-header d-print-none">
        <div className="container-fluid">
          <div className="row g-2 align-items-center">
            <div className="col">
              <div className="page-pretitle">Suppliers</div>
              <h2 className="page-title">
                {editingTemplate?.id ? 'Edit Template' : 'Create Template'}
                {supplier && ` - ${supplier.name}`}
              </h2>
            </div>
            <div className="col-auto ms-auto">
              <button
                className="btn btn-secondary"
                onClick={handleBuilderClose}
              >
                Back to Supplier
              </button>
            </div>
          </div>
        </div>
        <div className="page-body">
          <div className="container-fluid">
            {builderType === 'pdf' ? (
              <TemplateBuilder
                template={editingTemplate}
                supplierId={id}
                onSave={handleBuilderClose}
                onCancel={handleBuilderClose}
              />
            ) : (
              <ExcelTemplateBuilder
                template={editingTemplate}
                supplierId={id}
                onSave={handleBuilderClose}
                onCancel={handleBuilderClose}
              />
            )}
          </div>
        </div>
      </div>
    );
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
  
  const templatesByType = {
    invoice: templates.filter(t => t.templateType === 'invoice'),
    credit_note: templates.filter(t => t.templateType === 'credit_note'),
    statement: templates.filter(t => t.templateType === 'statement')
  };
  
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
            {/* Left Column - Supplier Details */}
            <div className="col-12 col-lg-8">
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
            
            {/* Right Column - Templates */}
            <div className="col-12 col-lg-4">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Templates</h3>
                </div>
                <div className="card-body">
                  {templatesLoading ? (
                    <div className="text-center py-3">
                      <div className="spinner-border spinner-border-sm" role="status">
                        <span className="visually-hidden">Loading...</span>
                      </div>
                    </div>
                  ) : (
                    <div className="row">
                      {['invoice', 'credit_note', 'statement'].map(type => {
                        const typeTemplates = templatesByType[type];
                        return (
                          <div key={type} className="col-12 mb-3">
                            <div className="card card-sm">
                              <div className="card-header">
                                <h4 className="card-title text-capitalize" style={{ fontSize: '0.875rem' }}>
                                  {type.replace('_', ' ')} Templates
                                </h4>
                              </div>
                              <div className="card-body">
                                {typeTemplates.length === 0 ? (
                                  <p className="text-muted small mb-2">No templates yet</p>
                                ) : (
                                  <div className="list-group list-group-flush">
                                    {typeTemplates.map(template => (
                                      <div key={template.id} className="list-group-item px-0 py-2">
                                        <div className="d-flex justify-content-between align-items-start">
                                          <div className="flex-grow-1" style={{ minWidth: 0 }}>
                                            <div className="d-flex align-items-center gap-1 flex-wrap">
                                              <strong className="small">{template.name}</strong>
                                              {template.isDefault && (
                                                <span className="badge bg-success-lt" style={{ fontSize: '0.65rem' }} title="This is the default template for this type">
                                                  Default
                                                </span>
                                              )}
                                            </div>
                                            <div className="mt-1">
                                              <small className="text-muted">
                                                {template.fileType === 'pdf' 
                                                  ? `${Object.keys(template.coordinates || {}).length} regions mapped`
                                                  : `${Object.keys(template.excelCells || {}).length} cells mapped`}
                                                <span className={`badge ms-1 ${template.fileType === 'pdf' ? 'bg-primary-lt' : 'bg-secondary-lt'}`} style={{ fontSize: '0.65rem' }}>
                                                  {template.fileType === 'pdf' ? 'PDF' : 'Excel'}
                                                </span>
                                              </small>
                                            </div>
                                          </div>
                                          {isGlobalAdmin && (
                                            <div className="btn-group btn-group-sm ms-2">
                                              <button
                                                className="btn btn-outline-primary btn-sm"
                                                onClick={() => handleEditTemplate(template)}
                                                title="Edit"
                                                style={{ padding: '0.125rem 0.375rem', fontSize: '0.75rem' }}
                                              >
                                                Edit
                                              </button>
                                              <button
                                                className="btn btn-outline-danger btn-sm"
                                                onClick={() => handleDeleteTemplate(template.id)}
                                                title="Delete"
                                                style={{ padding: '0.125rem 0.375rem', fontSize: '0.75rem' }}
                                              >
                                                ×
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {isGlobalAdmin && (
                                  <div className="mt-2">
                                    {type === 'statement' ? (
                                      <div className="btn-group w-100" role="group">
                                        <button
                                          className="btn btn-sm btn-success"
                                          onClick={() => handleNewTemplate(type, 'excel')}
                                          style={{ flex: 1, fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                                        >
                                          + Excel
                                        </button>
                                        <button
                                          className="btn btn-sm btn-primary"
                                          onClick={() => handleNewTemplate(type, 'pdf')}
                                          style={{ flex: 1, fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                                        >
                                          + PDF
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        className="btn btn-sm btn-primary w-100"
                                        onClick={() => handleNewTemplate(type, 'pdf')}
                                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                                      >
                                        + PDF Template
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            
            {/* Recent Documents */}
            {supplier.documents && supplier.documents.length > 0 && (
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
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupplierView;
