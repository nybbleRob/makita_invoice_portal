import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import ExcelTemplateBuilder from '../components/ExcelTemplateBuilder';
import TemplateBuilder from '../components/TemplateBuilder';

const Templates = () => {
  const { user } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState('all');
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
    if (showBuilder && builderType === 'pdf') {
      const interval = setInterval(updateBuilderState, 500);
      return () => clearInterval(interval);
    }
  }, [showBuilder, builderType, updateBuilderState]);

  useEffect(() => {
    if (user?.role === 'global_admin') {
      fetchTemplates();
    }
  }, [user]);

  const fetchTemplates = async () => {
    try {
      // Fetch both Excel and PDF templates
      const [excelResponse, pdfResponse] = await Promise.all([
        api.get('/api/templates?fileType=excel'),
        api.get('/api/templates?fileType=pdf')
      ]);
      setTemplates([...excelResponse.data, ...pdfResponse.data]);
    } catch (error) {
      console.error('Error fetching templates:', error);
      toast.error('Failed to fetch templates: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this template?')) {
      return;
    }
    
    try {
      await api.delete(`/api/templates/${id}`);
      toast.success('Template deleted successfully');
      fetchTemplates();
    } catch (error) {
      toast.error('Failed to delete template: ' + (error.response?.data?.message || error.message));
    }
  };

  const handleEdit = (template) => {
    setEditingTemplate(template);
    setBuilderType(template.fileType || 'excel');
    setShowBuilder(true);
  };

  const handleNewTemplate = (type, fileType = 'excel') => {
    setEditingTemplate({ templateType: type, fileType: fileType });
    setBuilderType(fileType);
    setShowBuilder(true);
  };

  const handleBuilderClose = () => {
    setShowBuilder(false);
    setEditingTemplate(null);
    fetchTemplates();
  };

  if (!user || user.role !== 'global_admin') {
    return (
      <div className="page-header d-print-none">
        <div className="container-fluid">
          <div className="row g-2 align-items-center">
            <div className="col">
              <div className="page-pretitle">Access Denied</div>
              <h2 className="page-title">Customer Templates</h2>
            </div>
          </div>
        </div>
        <div className="page-body">
          <div className="container-fluid">
            <div className="card">
              <div className="card-body">
                <div className="empty">
                  <div className="empty-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" className="icon" width="24" height="24" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round">
                      <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                      <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
                      <path d="M12 8v4" />
                      <path d="M12 16h.01" />
                    </svg>
                  </div>
                  <p className="empty-title">Access Denied</p>
                  <p className="empty-text">Global Admin privileges required.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (showBuilder) {
    return (
      <div className="page-header d-print-none">
        <div className="container-fluid">
          <div className="row g-2 align-items-center">
            <div className="col">
              <div className="page-pretitle">Customer Templates</div>
              <h2 className="page-title">
                {editingTemplate?.id ? 'Edit Template' : 'Create Template'}
              </h2>
            </div>
            <div className="col-auto ms-auto d-flex gap-2">
              {builderType === 'pdf' && (
                <>
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
                </>
              )}
              <button
                className="btn btn-secondary"
                onClick={handleBuilderClose}
              >
                Back to Customer Templates
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
        <div className="page-body">
          <div className="container-fluid">
            {builderType === 'pdf' ? (
              <TemplateBuilder
                ref={templateBuilderRef}
                template={editingTemplate}
                onSave={handleBuilderClose}
                onCancel={handleBuilderClose}
              />
            ) : (
              <ExcelTemplateBuilder
                template={editingTemplate}
                onSave={handleBuilderClose}
                onCancel={handleBuilderClose}
              />
            )}
          </div>
        </div>
      </div>
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
            <div className="page-pretitle">Document Parsing</div>
            <h2 className="page-title">Customer Templates</h2>
          </div>
        </div>
      </div>
      <div className="page-body">
        <div className="container-fluid">
          <div className="mb-4">
            <p className="text-muted">Manage parsing templates for invoices, credit notes, and statements</p>
          </div>
          
          <div className="mb-3">
            <select
              className="form-select"
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              style={{ maxWidth: '200px' }}
            >
              <option value="all">All Types</option>
              <option value="invoice">Invoices</option>
              <option value="credit_note">Credit Notes</option>
              <option value="statement">Statements</option>
            </select>
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
                if (selectedType !== 'all' && selectedType !== type) return null;
                
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

export default Templates;

