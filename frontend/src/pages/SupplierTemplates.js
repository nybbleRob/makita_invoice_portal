import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import ExcelTemplateBuilder from '../components/ExcelTemplateBuilder';
import TemplateBuilder from '../components/TemplateBuilder';

const SupplierTemplates = () => {
  const navigate = useNavigate();
  const { id: supplierId } = useParams();
  const { user } = useAuth();
  const { settings } = useSettings();
  const [supplier, setSupplier] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [builderType, setBuilderType] = useState(null); // 'excel' or 'pdf'
  const [builderState, setBuilderState] = useState({ hasName: false, hasFields: false, isEditing: false });
  const templateBuilderRef = useRef(null);
  
  // Update builder state periodically when builder is shown
  const updateBuilderState = useCallback(() => {
    if (templateBuilderRef.current?.getState) {
      setBuilderState(templateBuilderRef.current.getState());
    }
  }, []);
  
  useEffect(() => {
    if (showBuilder) {
      const interval = setInterval(updateBuilderState, 500);
      return () => clearInterval(interval);
    }
  }, [showBuilder, updateBuilderState]);
  
  const isGlobalAdmin = user?.role === 'global_admin' || user?.role === 'administrator';
  const suppliersEnabled = settings?.suppliersEnabled !== false;
  
  const fetchSupplier = async () => {
    try {
      const response = await api.get(`/api/suppliers/${supplierId}`);
      setSupplier(response.data);
    } catch (error) {
      console.error('Error fetching supplier:', error);
      toast.error('Error fetching supplier');
      navigate('/suppliers');
    }
  };
  
  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const response = await api.get('/api/supplier-templates', {
        params: { supplierId }
      });
      const templatesData = response.data || [];
      setTemplates(Array.isArray(templatesData) ? templatesData : []);
    } catch (error) {
      console.error('Error fetching templates:', error);
      toast.error('Error fetching supplier templates');
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    if (!suppliersEnabled) {
      navigate('/dashboard');
      return;
    }
    if (!isGlobalAdmin) {
      navigate('/suppliers');
      return;
    }
    if (supplierId) {
      fetchSupplier();
      fetchTemplates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, suppliersEnabled, isGlobalAdmin, navigate]);
  
  const handleDelete = async (templateId) => {
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
  
  const handleEdit = (template) => {
    setEditingTemplate(template);
    setBuilderType(template.fileType || 'pdf');
    setShowBuilder(true);
  };
  
  const handleNewTemplate = (type, fileType = 'pdf') => {
    setEditingTemplate({ 
      templateType: type, 
      fileType: fileType,
      supplierId: supplierId 
    });
    setBuilderType(fileType);
    setShowBuilder(true);
  };
  
  const handleBuilderClose = () => {
    setShowBuilder(false);
    setEditingTemplate(null);
    fetchTemplates();
  };
  
  if (!suppliersEnabled || !isGlobalAdmin) {
    return null;
  }
  
  if (showBuilder) {
    return (
      <>
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
              <div className="col-auto ms-auto d-flex gap-2">
                <button 
                  className="btn btn-info" 
                  onClick={() => templateBuilderRef.current?.handleTestParse()}
                  disabled={!builderState.hasFields}
                  title="Test the template against the uploaded PDF"
                >
                  Test Parse
                </button>
                <button
                  className="btn btn-success"
                  onClick={() => templateBuilderRef.current?.handleSave()}
                  disabled={!builderState.hasName || !builderState.hasFields}
                >
                  {builderState.isEditing ? 'Update Template' : 'Save Template'}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={handleBuilderClose}
                >
                  Back to Templates
                </button>
                <button
                  className="btn btn-danger"
                  onClick={handleBuilderClose}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="page-body">
          <div className="container-fluid">
            {builderType === 'pdf' ? (
              <TemplateBuilder
                ref={templateBuilderRef}
                template={editingTemplate}
                supplierId={supplierId}
                onSave={handleBuilderClose}
                onCancel={handleBuilderClose}
              />
            ) : (
              <ExcelTemplateBuilder
                template={editingTemplate}
                supplierId={supplierId}
                onSave={handleBuilderClose}
                onCancel={handleBuilderClose}
              />
            )}
          </div>
        </div>
      </>
    );
  }
  
  const templatesByType = {
    invoice: templates.filter(t => t.templateType === 'invoice'),
    credit_note: templates.filter(t => t.templateType === 'credit_note'),
    statement: templates.filter(t => t.templateType === 'statement')
  };
  
  return (
    <div className="page-header d-print-none">
      <div className="container-fluid">
        <div className="row g-2 align-items-center">
          <div className="col">
            <div className="page-pretitle">Suppliers</div>
            <h2 className="page-title">
              Templates
              {supplier && ` - ${supplier.name}`}
            </h2>
          </div>
          <div className="col-auto ms-auto">
            <button
              className="btn btn-secondary"
              onClick={() => navigate(`/suppliers/${supplierId}`)}
            >
              Back to Supplier
            </button>
          </div>
        </div>
      </div>
      <div className="page-body">
        <div className="container-fluid">
          <div className="mb-4">
            <p className="text-muted">Manage parsing templates for this supplier's invoices, credit notes, and statements</p>
          </div>
          
          {loading ? (
            <div className="text-center p-5">
              <div className="spinner-border" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
            </div>
          ) : (
            <div className="row">
              {['invoice', 'credit_note', 'statement'].map(type => {
                const typeTemplates = templatesByType[type];
                
                return (
                  <div key={type} className="col-md-4 mb-4">
                    <div className="card">
                      <div className="card-header">
                        <h3 className="card-title text-capitalize">
                          {type.replace('_', ' ')} Templates
                        </h3>
                      </div>
                      <div className="card-body">
                        {typeTemplates.length === 0 ? (
                          <p className="text-muted">No templates yet</p>
                        ) : (
                          <div className="list-group list-group-flush">
                            {typeTemplates.map(template => (
                              <div key={template.id} className="list-group-item px-0">
                                <div className="d-flex justify-content-between align-items-start">
                                  <div>
                                    <div className="d-flex align-items-center gap-2">
                                      <strong>{template.name}</strong>
                                      {template.isDefault && (
                                        <span className="badge bg-success-lt" title="This is the default template for this type">
                                          Default
                                        </span>
                                      )}
                                    </div>
                                    <br />
                                    <small className="text-muted">
                                      {template.fileType === 'pdf' 
                                        ? `${Object.keys(template.coordinates || {}).length} regions mapped`
                                        : `${Object.keys(template.excelCells || {}).length} cells mapped`}
                                      <span className={`badge ms-2 ${template.fileType === 'pdf' ? 'bg-primary-lt' : 'bg-secondary-lt'}`}>
                                        {template.fileType === 'pdf' ? 'PDF' : 'Excel'}
                                      </span>
                                    </small>
                                  </div>
                                  <div className="btn-group btn-group-sm">
                                    <button
                                      className="btn btn-outline-primary"
                                      onClick={() => handleEdit(template)}
                                      title="Edit"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      className="btn btn-outline-danger"
                                      onClick={() => handleDelete(template.id)}
                                      title="Delete"
                                    >
                                      ×
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="mt-3">
                          {type === 'statement' ? (
                            <div className="btn-group w-100" role="group">
                              <button
                                className="btn btn-sm btn-success"
                                onClick={() => handleNewTemplate(type, 'excel')}
                                style={{ flex: 1 }}
                              >
                                + Excel Template
                              </button>
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={() => handleNewTemplate(type, 'pdf')}
                                style={{ flex: 1 }}
                              >
                                + PDF Template
                              </button>
                            </div>
                          ) : (
                            <button
                              className="btn btn-sm btn-primary w-100"
                              onClick={() => handleNewTemplate(type, 'pdf')}
                            >
                              + PDF Template
                            </button>
                          )}
                        </div>
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
  );
};

export default SupplierTemplates;
