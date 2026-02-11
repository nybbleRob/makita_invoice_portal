import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { getAvailableFields } from '../utils/fieldDiscovery';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ''}/pdf.worker.js`;

const CreditNoteEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const listPage = location.state?.listPage ?? 1;
  const { user: currentUser } = useAuth();
  const [creditNote, setCreditNote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pdfPages, setPdfPages] = useState([]);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const canvasContainerRef = useRef(null);
  const isRenderingRef = useRef(false);
  const pdfFetchedRef = useRef(false);
  const [editReason, setEditReason] = useState('');
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [pendingChanges, setPendingChanges] = useState(null);

  const [formData, setFormData] = useState({
    creditNoteNumber: '',
    issueDate: '',
    amount: '',
    taxAmount: '',
    documentStatus: 'ready',
    customFields: {}
  });

  const [availableFields, setAvailableFields] = useState([]);

  useEffect(() => {
    const loadFields = async () => {
      try {
        const fields = await getAvailableFields('credit_notes');
        setAvailableFields(fields);
      } catch (error) {
        console.error('Error loading available fields:', error);
      }
    };
    loadFields();
  }, []);

  useEffect(() => {
    setPdfPages([]);
    setLoadingPdf(false);
    isRenderingRef.current = false;
    pdfFetchedRef.current = false;
    if (canvasContainerRef.current) {
      canvasContainerRef.current.innerHTML = '';
    }
    fetchCreditNote();
    return () => {
      setPdfPages([]);
      setLoadingPdf(false);
      isRenderingRef.current = false;
      pdfFetchedRef.current = false;
      if (canvasContainerRef.current) {
        canvasContainerRef.current.innerHTML = '';
      }
    };
  }, [id]);

  const fetchCreditNote = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/api/credit-notes/${id}`);
      const cn = response.data;
      setCreditNote(cn);

      const customFields = {};
      if (cn.metadata?.parsedData) {
        const standardFields = ['creditNoteNumber', 'invoiceNumber', 'issueDate', 'amount', 'taxAmount', 'documentType', 'accountNumber', 'companyName', 'poNumber', 'customerPO', 'vatAmount', 'goodsAmount', 'totalAmount', 'invoiceTo', 'deliveryAddress'];
        const customFieldNames = Object.keys(cn.metadata.parsedData).filter(key => !standardFields.includes(key));
        customFieldNames.forEach(key => {
          customFields[key] = cn.metadata.parsedData[key];
        });
      }

      setFormData({
        creditNoteNumber: cn.creditNoteNumber || cn.creditNumber || '',
        issueDate: cn.issueDate ? new Date(cn.issueDate).toISOString().split('T')[0] : '',
        amount: cn.amount || '',
        taxAmount: cn.taxAmount || '',
        documentStatus: cn.documentStatus || 'ready',
        customFields
      });

      if (cn.fileUrl) {
        fetchPdfForPreview();
      }
    } catch (error) {
      console.error('Error fetching credit note:', error);
      toast.error('Error loading credit note: ' + (error.response?.data?.message || error.message));
      navigate('/credit-notes');
    } finally {
      setLoading(false);
    }
  };

  const fetchPdfForPreview = async () => {
    if (pdfFetchedRef.current || loadingPdf) return;
    try {
      pdfFetchedRef.current = true;
      setLoadingPdf(true);
      const token = localStorage.getItem('token');
      const url = `${API_BASE_URL}/api/credit-notes/${id}/view-pdf`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to load PDF');
      const arrayBuffer = await response.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages = [];
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        pages.push(page);
      }
      setPdfPages(pages);
      setLoadingPdf(false);
    } catch (error) {
      console.error('Error loading PDF for preview:', error);
      setLoadingPdf(false);
      pdfFetchedRef.current = false;
    }
  };

  useEffect(() => {
    if (pdfPages.length === 0 || !canvasContainerRef.current || isRenderingRef.current) return;
    isRenderingRef.current = true;
    const renderPages = async () => {
      if (!canvasContainerRef.current) {
        isRenderingRef.current = false;
        return;
      }
      canvasContainerRef.current.innerHTML = '';
      for (let i = 0; i < pdfPages.length; i++) {
        if (!canvasContainerRef.current) break;
        const page = pdfPages[i];
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        canvas.style.display = 'block';
        canvas.style.marginBottom = '20px';
        canvas.style.border = '1px solid #ddd';
        await page.render({ canvasContext: context, viewport }).promise;
        if (canvasContainerRef.current) canvasContainerRef.current.appendChild(canvas);
      }
      isRenderingRef.current = false;
    };
    renderPages();
    return () => {
      isRenderingRef.current = false;
      if (canvasContainerRef.current) canvasContainerRef.current.innerHTML = '';
    };
  }, [pdfPages]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    const currentCustomFields = creditNote.metadata?.parsedData || {};
    const formCustomFields = formData.customFields || {};
    const standardFields = ['creditNoteNumber', 'invoiceNumber', 'issueDate', 'amount', 'taxAmount', 'documentType', 'accountNumber', 'companyName', 'poNumber', 'customerPO', 'vatAmount', 'goodsAmount', 'totalAmount'];
    const customFieldsChanged = (() => {
      const allKeys = new Set([...Object.keys(currentCustomFields), ...Object.keys(formCustomFields)]);
      for (const fieldName of allKeys) {
        if (standardFields.includes(fieldName)) continue;
        if (String(currentCustomFields[fieldName] || '') !== String(formCustomFields[fieldName] || '')) return true;
      }
      return false;
    })();

    const cnNum = creditNote.creditNoteNumber || creditNote.creditNumber;
    const hasChanges =
      formData.creditNoteNumber !== cnNum ||
      formData.issueDate !== (creditNote.issueDate ? new Date(creditNote.issueDate).toISOString().split('T')[0] : '') ||
      parseFloat(formData.amount) !== parseFloat(creditNote.amount || 0) ||
      parseFloat(formData.taxAmount) !== parseFloat(creditNote.taxAmount || 0) ||
      formData.documentStatus !== (creditNote.documentStatus || 'ready') ||
      customFieldsChanged;

    if (!hasChanges) {
      toast.info('No changes to save');
      return;
    }
    setPendingChanges(formData);
    setShowReasonModal(true);
  };

  const confirmSave = async () => {
    if (!editReason || editReason.trim().length === 0) {
      toast.error('Please provide a reason for editing this credit note');
      return;
    }
    try {
      setSaving(true);
      setShowReasonModal(false);
      const parsedData = creditNote.metadata?.parsedData || {};
      const updatedParsedData = { ...parsedData, ...pendingChanges.customFields };
      const updateData = {
        creditNoteNumber: pendingChanges.creditNoteNumber,
        issueDate: pendingChanges.issueDate ? new Date(pendingChanges.issueDate).toISOString() : null,
        amount: parseFloat(pendingChanges.amount) || 0,
        taxAmount: parseFloat(pendingChanges.taxAmount) || 0,
        documentStatus: pendingChanges.documentStatus,
        editReason: editReason.trim(),
        metadata: { ...creditNote.metadata, parsedData: updatedParsedData }
      };
      await api.put(`/api/credit-notes/${id}`, updateData);
      toast.success('Credit note updated successfully');
      navigate(`/credit-notes/${id}/view`, { state: { listPage } });
    } catch (error) {
      console.error('Error saving credit note:', error);
      toast.error('Error saving credit note: ' + (error.response?.data?.message || error.message));
    } finally {
      setSaving(false);
      setEditReason('');
      setPendingChanges(null);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <div className="container-xl">
            <div className="row g-2 align-items-center">
              <div className="col">
                <h2 className="page-title">Edit Credit Note</h2>
              </div>
            </div>
          </div>
        </div>
        <div className="page-body">
          <div className="container-xl">
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

  if (!creditNote) {
    return (
      <div className="page">
        <div className="page-header">
          <div className="container-xl">
            <div className="row g-2 align-items-center">
              <div className="col">
                <h2 className="page-title">Credit Note Not Found</h2>
              </div>
            </div>
          </div>
        </div>
        <div className="page-body">
          <div className="container-xl">
            <div className="alert alert-warning">
              Credit note not found. <button className="btn btn-sm btn-link p-0" onClick={() => navigate(`/credit-notes?page=${listPage}`)}>Return to Credit Notes</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const displayNumber = creditNote.creditNoteNumber || creditNote.creditNumber || '-';

  return (
    <div className="page">
      <div className="page-header">
        <div className="container-xl">
          <div className="row g-2 align-items-center">
            <div className="col">
              <h2 className="page-title">Edit Credit Note: {displayNumber}</h2>
            </div>
            <div className="col-auto">
              <button className="btn btn-secondary" onClick={() => navigate(`/credit-notes/${id}/view`, { state: { listPage } })}>
                Back to View
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="container-xl">
          <div className="row">
            <div className="col-lg-8">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">PDF Preview</h3>
                </div>
                <div className="card-body">
                  {loadingPdf ? (
                    <div className="text-center py-5">
                      <div className="spinner-border" role="status">
                        <span className="visually-hidden">Loading PDF...</span>
                      </div>
                    </div>
                  ) : (
                    <div ref={canvasContainerRef} style={{ maxHeight: '80vh', overflowY: 'auto' }}></div>
                  )}
                </div>
              </div>
            </div>

            <div className="col-lg-4">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Credit Note Details</h3>
                </div>
                <div className="card-body">
                  <div className="mb-3">
                    <label className="form-label required">Credit Note Number</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.creditNoteNumber}
                      onChange={(e) => handleInputChange('creditNoteNumber', e.target.value)}
                      placeholder="Enter credit note number"
                    />
                  </div>

                  <div className="mb-3">
                    <label className="form-label required">Company</label>
                    <input
                      type="text"
                      className="form-control"
                      value={creditNote.company?.name || '-'}
                      disabled
                      readOnly
                    />
                    <small className="form-hint">Company cannot be changed from this page</small>
                  </div>

                  <div className="mb-3">
                    <label className="form-label required">Credit Note Date / Tax Point</label>
                    <input
                      type="date"
                      className="form-control"
                      value={formData.issueDate}
                      onChange={(e) => handleInputChange('issueDate', e.target.value)}
                    />
                  </div>

                  <div className="row">
                    <div className="col-12 mb-3">
                      <label className="form-label required">Credit Note Total</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-control"
                        value={formData.amount}
                        onChange={(e) => handleInputChange('amount', e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    <div className="col-12 mb-3">
                      <label className="form-label">VAT Amount</label>
                      <input
                        type="number"
                        step="0.01"
                        className="form-control"
                        value={formData.taxAmount}
                        onChange={(e) => handleInputChange('taxAmount', e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  {(currentUser?.role === 'global_admin' || currentUser?.role === 'administrator') && (
                    <div className="mb-3">
                      <label className="form-label">Document Status</label>
                      <select
                        className="form-select"
                        value={formData.documentStatus}
                        onChange={(e) => handleInputChange('documentStatus', e.target.value)}
                      >
                        <option value="ready">Ready (New)</option>
                        <option value="review">Review</option>
                        <option value="viewed">Viewed</option>
                        <option value="downloaded">Downloaded</option>
                        <option value="queried">Queried</option>
                      </select>
                      <small className="form-hint">Only Global Administrators and Administrators can change document status</small>
                    </div>
                  )}

                  <div className="border-top pt-3 mt-3">
                    <h5 className="mb-3">Address Information</h5>
                    <div className="row">
                      <div className="col-md-6 mb-3">
                        <label className="form-label">Invoice To</label>
                        <textarea
                          className="form-control"
                          rows="4"
                          value={formData.customFields?.invoiceTo || creditNote?.metadata?.parsedData?.invoiceTo || ''}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            customFields: { ...prev.customFields, invoiceTo: e.target.value }
                          }))}
                          placeholder="Invoice to address"
                        />
                      </div>
                      <div className="col-md-6 mb-3">
                        <label className="form-label">Delivery Address</label>
                        <textarea
                          className="form-control"
                          rows="4"
                          value={formData.customFields?.deliveryAddress || creditNote?.metadata?.parsedData?.deliveryAddress || ''}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            customFields: { ...prev.customFields, deliveryAddress: e.target.value }
                          }))}
                          placeholder="Delivery address"
                        />
                      </div>
                    </div>
                    <div className="row">
                      <div className="col-md-6 mb-3">
                        <label className="form-label">PO Number</label>
                        <input
                          type="text"
                          className="form-control"
                          value={formData.customFields?.customerPO || creditNote?.metadata?.parsedData?.customerPO || ''}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            customFields: { ...prev.customFields, customerPO: e.target.value }
                          }))}
                          placeholder="PO Number"
                        />
                      </div>
                      <div className="col-md-6 mb-3">
                        <label className="form-label">Goods Amount (Net)</label>
                        <input
                          type="number"
                          step="0.01"
                          className="form-control"
                          value={formData.customFields?.goodsAmount || creditNote?.metadata?.parsedData?.goodsAmount || ''}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            customFields: { ...prev.customFields, goodsAmount: e.target.value }
                          }))}
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  </div>

                  {availableFields.filter(f => f.isCustom).length > 0 && (
                    <div className="mb-3">
                      <div className="border-top pt-3 mt-3">
                        <h5 className="mb-3">Custom Fields</h5>
                        {availableFields.filter(f => f.isCustom).map(field => {
                          const value = formData.customFields[field.fieldName] || '';
                          return (
                            <div key={field.fieldName} className="mb-3">
                              <label className="form-label">{field.displayName}</label>
                              {field.dataType === 'date' ? (
                                <input
                                  type="date"
                                  className="form-control"
                                  value={value ? (typeof value === 'string' && value.includes('T') ? value.split('T')[0] : value) : ''}
                                  onChange={(e) => setFormData(prev => ({
                                    ...prev,
                                    customFields: { ...prev.customFields, [field.fieldName]: e.target.value }
                                  }))}
                                />
                              ) : field.dataType === 'number' || field.dataType === 'currency' ? (
                                <input
                                  type="number"
                                  step={field.dataType === 'currency' ? '0.01' : '1'}
                                  className="form-control"
                                  value={value}
                                  onChange={(e) => setFormData(prev => ({
                                    ...prev,
                                    customFields: { ...prev.customFields, [field.fieldName]: e.target.value }
                                  }))}
                                />
                              ) : (
                                <input
                                  type="text"
                                  className="form-control"
                                  value={value}
                                  onChange={(e) => setFormData(prev => ({
                                    ...prev,
                                    customFields: { ...prev.customFields, [field.fieldName]: e.target.value }
                                  }))}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="d-flex gap-2 mt-4">
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                      {saving ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                          Saving...
                        </>
                      ) : (
                        'Save Changes'
                      )}
                    </button>
                    <button className="btn btn-secondary" onClick={() => navigate(`/credit-notes/${id}/view`, { state: { listPage } })}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showReasonModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Edit Reason Required</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => { setShowReasonModal(false); setEditReason(''); setPendingChanges(null); }}
                ></button>
              </div>
              <div className="modal-body">
                <p>Please provide a reason for editing this credit note. This will be logged for auditing purposes.</p>
                <div className="mb-3">
                  <label className="form-label required">Reason for Edit</label>
                  <textarea
                    className="form-control"
                    rows="3"
                    value={editReason}
                    onChange={(e) => setEditReason(e.target.value)}
                    placeholder="Enter reason for editing this credit note..."
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-danger" onClick={() => { setShowReasonModal(false); setEditReason(''); setPendingChanges(null); }}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={confirmSave} disabled={!editReason || editReason.trim().length === 0}>
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CreditNoteEdit;
