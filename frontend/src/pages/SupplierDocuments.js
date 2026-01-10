import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';

const SupplierDocuments = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { settings } = useSettings();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [filters, setFilters] = useState({
    supplierId: location.state?.supplierId || '',
    documentType: '',
    status: '',
    search: ''
  });
  
  const suppliersEnabled = settings?.suppliersEnabled !== false;
  
  useEffect(() => {
    if (!suppliersEnabled) {
      navigate('/dashboard');
      return;
    }
    fetchDocuments();
  }, [pagination.page, filters, suppliersEnabled, navigate]);
  
  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const params = {
        page: pagination.page,
        limit: pagination.limit,
        ...filters
      };
      
      const response = await api.get('/supplier-documents', { params });
      setDocuments(response.data.documents || []);
      setPagination(response.data.pagination || { page: 1, limit: 50, total: 0, totalPages: 0 });
    } catch (error) {
      console.error('Error fetching documents:', error);
      toast.error('Error fetching supplier documents');
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
              <h2 className="page-title">Supplier Documents</h2>
            </div>
            <div className="col-auto ms-auto">
              <button
                className="btn btn-primary"
                onClick={() => navigate('/supplier-documents/upload')}
              >
                <i className="ti ti-upload me-1"></i>
                Upload Document
              </button>
            </div>
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
                        <th>Supplier</th>
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
                      {documents.map((doc) => (
                        <tr key={doc.id}>
                          <td>
                            {doc.supplier ? (
                              <a
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  navigate(`/suppliers/${doc.supplier.id}`);
                                }}
                              >
                                {doc.supplier.name}
                              </a>
                            ) : (
                              '-'
                            )}
                          </td>
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
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupplierDocuments;
