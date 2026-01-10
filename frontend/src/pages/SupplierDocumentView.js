import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from '../utils/toast';
import { useSettings } from '../context/SettingsContext';

const SupplierDocumentView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const suppliersEnabled = settings?.suppliersEnabled !== false;
  
  useEffect(() => {
    if (!suppliersEnabled) {
      navigate('/dashboard');
      return;
    }
    fetchDocument();
  }, [id, suppliersEnabled, navigate]);
  
  const fetchDocument = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/supplier-documents/${id}`);
      setDocument(response.data);
    } catch (error) {
      console.error('Error fetching document:', error);
      toast.error('Error fetching document details');
      navigate('/supplier-documents');
    } finally {
      setLoading(false);
    }
  };
  
  if (!suppliersEnabled) {
    return null;
  }
  
  if (loading || !document) {
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
  
  return (
    <div className="page">
      <div className="page-header">
        <div className="container-fluid">
          <div className="row g-2 align-items-center">
            <div className="col">
              <div className="page-pretitle">
                <a href="#" onClick={(e) => { e.preventDefault(); navigate('/supplier-documents'); }}>Supplier Documents</a>
              </div>
              <h2 className="page-title">
                {document.invoiceNumber || `Document ${id.substring(0, 8)}`}
              </h2>
            </div>
            <div className="col-auto ms-auto">
              <button
                className="btn btn-outline-primary"
                onClick={() => navigate('/supplier-documents')}
              >
                <i className="ti ti-arrow-left me-1"></i>
                Back
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div className="page-body">
        <div className="container-fluid">
          <div className="row row-cards">
            <div className="col-12 col-lg-6">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Document Information</h3>
                </div>
                <div className="card-body">
                  <dl className="row">
                    <dt className="col-sm-4">Supplier</dt>
                    <dd className="col-sm-8">
                      {document.supplier ? (
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            navigate(`/suppliers/${document.supplier.id}`);
                          }}
                        >
                          {document.supplier.name}
                        </a>
                      ) : (
                        '-'
                      )}
                    </dd>
                    
                    <dt className="col-sm-4">Document Type</dt>
                    <dd className="col-sm-8">
                      <span className={`badge ${
                        document.documentType === 'invoice' ? 'bg-primary' :
                        document.documentType === 'credit_note' ? 'bg-warning' :
                        'bg-info'
                      }`}>
                        {document.documentType}
                      </span>
                    </dd>
                    
                    {document.invoiceNumber && (
                      <>
                        <dt className="col-sm-4">Invoice Number</dt>
                        <dd className="col-sm-8">{document.invoiceNumber}</dd>
                      </>
                    )}
                    
                    {document.poNumber && (
                      <>
                        <dt className="col-sm-4">PO Number</dt>
                        <dd className="col-sm-8">{document.poNumber}</dd>
                      </>
                    )}
                    
                    <dt className="col-sm-4">Document Date</dt>
                    <dd className="col-sm-8">
                      {document.documentDate ? new Date(document.documentDate).toLocaleDateString() : '-'}
                    </dd>
                    
                    {document.dueDate && (
                      <>
                        <dt className="col-sm-4">Due Date</dt>
                        <dd className="col-sm-8">
                          {new Date(document.dueDate).toLocaleDateString()}
                        </dd>
                      </>
                    )}
                    
                    <dt className="col-sm-4">Amount</dt>
                    <dd className="col-sm-8">
                      {document.amount ? `£${parseFloat(document.amount).toFixed(2)}` : '-'}
                    </dd>
                    
                    {document.taxAmount > 0 && (
                      <>
                        <dt className="col-sm-4">Tax Amount</dt>
                        <dd className="col-sm-8">£{parseFloat(document.taxAmount).toFixed(2)}</dd>
                      </>
                    )}
                    
                    {document.vatAmount > 0 && (
                      <>
                        <dt className="col-sm-4">VAT Amount</dt>
                        <dd className="col-sm-8">£{parseFloat(document.vatAmount).toFixed(2)}</dd>
                      </>
                    )}
                    
                    <dt className="col-sm-4">Status</dt>
                    <dd className="col-sm-8">
                      <span className={`badge ${
                        document.status === 'ready' ? 'bg-success' :
                        document.status === 'processed' ? 'bg-primary' :
                        document.status === 'failed' ? 'bg-danger' :
                        'bg-secondary'
                      }`}>
                        {document.status}
                      </span>
                    </dd>
                    
                    {document.notes && (
                      <>
                        <dt className="col-sm-4">Notes</dt>
                        <dd className="col-sm-8">{document.notes}</dd>
                      </>
                    )}
                  </dl>
                </div>
                <div className="card-footer">
                  <div className="btn-list">
                    <a
                      href={`/api/supplier-documents/${id}/download`}
                      className="btn btn-primary"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <i className="ti ti-download me-1"></i>
                      Download
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupplierDocumentView;
