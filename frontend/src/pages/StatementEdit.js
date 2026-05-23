import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';

pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ''}/pdf.worker.js`;

const StatementEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewType, setPreviewType] = useState('pdf');
  const [pdfPages, setPdfPages] = useState([]);
  const [xlsSheets, setXlsSheets] = useState([]);
  const [activeXlsSheet, setActiveXlsSheet] = useState('');
  const [statement, setStatement] = useState(null);
  const [form, setForm] = useState({
    periodStart: '',
    periodEnd: '',
    openingBalance: '',
    closingBalance: '',
    totalDebits: '',
    totalCredits: '',
    documentStatus: 'ready',
    notes: '',
    editReason: ''
  });

  const returnQueryRef = useRef(null);
  const canvasContainerRef = useRef(null);
  const isRenderingRef = useRef(false);
  if (returnQueryRef.current === null && typeof window !== 'undefined') {
    const q = new URLSearchParams(window.location.search).get('returnQuery');
    if (q) returnQueryRef.current = decodeURIComponent(q);
  }
  const returnQuery = (() => {
    const fromState = location.state?.returnQuery;
    if (fromState) return fromState;
    if (returnQueryRef.current) return returnQueryRef.current;
    try {
      const fromStorage = sessionStorage.getItem('statementsReturnQuery');
      if (fromStorage) return fromStorage;
    } catch (_) {}
    return 'page=1';
  })();

  const hasPdf = useMemo(() => {
    return !!(statement?.pdfFileUrl || (statement?.fileUrl && /\.pdf$/i.test(statement.fileUrl)));
  }, [statement]);

  const hasXls = useMemo(() => {
    return !!(statement?.xlsFileUrl || (statement?.fileUrl && /\.(xls|xlsx)$/i.test(statement.fileUrl)));
  }, [statement]);

  const sheetToPreviewHtml = (worksheet) => {
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      blankrows: false
    });
    const firstRow = rows[0] || [];
    const firstCell = (firstRow[0] || '').toString().trim().toUpperCase();
    const restEmpty = firstRow.slice(1).every((cell) => (cell || '').toString().trim() === '');
    const cleanedRows = (firstCell === 'STATEMENT' && restEmpty) ? rows.slice(1) : rows;
    const normalizedRows = cleanedRows.length > 0 ? cleanedRows : [['']];
    const cleanedSheet = XLSX.utils.aoa_to_sheet(normalizedRows);
    return XLSX.utils.sheet_to_html(cleanedSheet, { editable: false });
  };

  useEffect(() => {
    const fetchStatement = async () => {
      try {
        setLoading(true);
        const response = await api.get(`/api/statements/${id}`);
        const data = response.data;
        setStatement(data);
        if (data?.pdfFileUrl || (data?.fileUrl && /\.pdf$/i.test(data.fileUrl))) {
          setPreviewType('pdf');
        } else if (data?.xlsFileUrl || (data?.fileUrl && /\.(xls|xlsx)$/i.test(data.fileUrl))) {
          setPreviewType('xls');
        }
        setForm({
          periodStart: data.periodStart ? new Date(data.periodStart).toISOString().split('T')[0] : '',
          periodEnd: data.periodEnd ? new Date(data.periodEnd).toISOString().split('T')[0] : '',
          openingBalance: data.openingBalance != null ? String(data.openingBalance) : '',
          closingBalance: data.closingBalance != null ? String(data.closingBalance) : '',
          totalDebits: data.totalDebits != null ? String(data.totalDebits) : '',
          totalCredits: data.totalCredits != null ? String(data.totalCredits) : '',
          documentStatus: data.documentStatus || 'ready',
          notes: data.notes || '',
          editReason: ''
        });
      } catch (error) {
        console.error('Error fetching statement:', error);
        toast.error(`Error loading statement: ${error.response?.data?.message || error.message}`);
        navigate(`/statements?${returnQuery}`);
      } finally {
        setLoading(false);
      }
    };
    fetchStatement();
  }, [id, navigate, returnQuery]);

  useEffect(() => {
    const loadPreview = async () => {
      if (!statement) return;
      try {
        setLoadingPreview(true);
        if (previewType === 'pdf') {
          setXlsSheets([]);
          setActiveXlsSheet('');
          const token = localStorage.getItem('token');
          const response = await fetch(`${API_BASE_URL}/api/statements/${id}/view-pdf`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!response.ok) throw new Error('Failed to load PDF preview');
          const arrayBuffer = await response.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          const pages = [];
          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            pages.push(await pdf.getPage(pageNum));
          }
          setPdfPages(pages);
        } else {
          setPdfPages([]);
          const token = localStorage.getItem('token');
          const response = await fetch(`${API_BASE_URL}/api/statements/${id}/view-xls`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` }
          });
          if (!response.ok) throw new Error('Failed to load XLS preview');
          const arrayBuffer = await response.arrayBuffer();
          const workbook = XLSX.read(arrayBuffer, { type: 'array' });
          const sheetNames = workbook.SheetNames || [];
          const sheets = sheetNames.map((name) => ({
            name,
            html: sheetToPreviewHtml(workbook.Sheets[name])
          }));
          setXlsSheets(sheets);
          setActiveXlsSheet(sheets[0]?.name || '');
        }
      } catch (error) {
        console.error('Error loading statement preview:', error);
        toast.error(error.message || 'Failed to load preview');
      } finally {
        setLoadingPreview(false);
      }
    };
    loadPreview();
  }, [id, previewType, statement]);

  useEffect(() => {
    if (previewType !== 'pdf' || pdfPages.length === 0 || !canvasContainerRef.current || isRenderingRef.current) return;
    isRenderingRef.current = true;
    const container = canvasContainerRef.current;
    const renderPages = async () => {
      if (!container) return;
      container.innerHTML = '';
      for (const page of pdfPages) {
        if (!container) break;
        const viewport = page.getViewport({ scale: 1.4 });
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
        if (container) container.appendChild(canvas);
      }
      isRenderingRef.current = false;
    };
    renderPages();
    return () => {
      isRenderingRef.current = false;
      if (container) container.innerHTML = '';
    };
  }, [pdfPages, previewType]);

  const handleSave = async () => {
    if (!form.editReason.trim()) {
      toast.error('Please provide an edit reason');
      return;
    }
    try {
      setSaving(true);
      await api.put(`/api/statements/${id}`, {
        periodStart: form.periodStart || null,
        periodEnd: form.periodEnd || null,
        openingBalance: form.openingBalance === '' ? null : Number(form.openingBalance),
        closingBalance: form.closingBalance === '' ? null : Number(form.closingBalance),
        totalDebits: form.totalDebits === '' ? null : Number(form.totalDebits),
        totalCredits: form.totalCredits === '' ? null : Number(form.totalCredits),
        documentStatus: form.documentStatus,
        notes: form.notes || null,
        editReason: form.editReason.trim()
      });
      toast.success('Statement updated successfully');
      navigate(`/statements/${id}/view?returnQuery=${encodeURIComponent(returnQuery)}`, { state: { returnQuery } });
    } catch (error) {
      console.error('Error updating statement:', error);
      toast.error(`Error updating statement: ${error.response?.data?.message || error.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className="page-body">
          <div className="container-xl">
            <div className="text-center py-5">
              <div className="spinner-border" role="status"><span className="visually-hidden">Loading...</span></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!statement) return null;

  return (
    <div className="page">
      <div className="page-header">
        <div className="container-xl">
          <div className="row g-2 align-items-center">
            <div className="col">
              <h2 className="page-title">Edit Statement</h2>
            </div>
            <div className="col-auto">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate(`/statements/${id}/view?returnQuery=${encodeURIComponent(returnQuery)}`, { state: { returnQuery } })}
                disabled={saving}
              >
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
                <div className="card-header d-flex justify-content-between align-items-center">
                  <h3 className="card-title">{previewType === 'xls' ? 'XLS Preview' : 'PDF Preview'}</h3>
                  {hasPdf && previewType !== 'pdf' && (
                    <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setPreviewType('pdf')}>PDF</button>
                  )}
                </div>
                <div className="card-body">
                  {loadingPreview ? (
                    <div className="text-center py-5">
                      <div className="spinner-border" role="status"><span className="visually-hidden">Loading...</span></div>
                    </div>
                  ) : previewType === 'pdf' ? (
                    <div style={{ maxHeight: '80vh', overflowY: 'auto' }}>
                      <div ref={canvasContainerRef} />
                    </div>
                  ) : (
                    <>
                      {xlsSheets.length > 1 && (
                        <div className="mb-3 d-flex flex-wrap gap-2">
                          {xlsSheets.map((sheet) => (
                            <button
                              key={sheet.name}
                              type="button"
                              className={`btn btn-sm ${activeXlsSheet === sheet.name ? 'btn-primary' : 'btn-outline-primary'}`}
                              onClick={() => setActiveXlsSheet(sheet.name)}
                            >
                              {sheet.name}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="excel-preview-surface rounded p-2" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
                        <div
                          dangerouslySetInnerHTML={{
                            __html: xlsSheets.find((sheet) => sheet.name === activeXlsSheet)?.html || ''
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="col-lg-4">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Statement Details</h3>
                </div>
                <div className="card-body">
                  <div className="mb-3">
                    <label className="form-label required">Company</label>
                    <input type="text" className="form-control" value={statement.company?.name || '-'} disabled readOnly />
                    <small className="form-hint">Company cannot be changed from this page</small>
                  </div>

                  <div className="mb-3">
                    <label className="form-label required">Period Start</label>
                    <input type="date" className="form-control" value={form.periodStart} onChange={(e) => setForm((p) => ({ ...p, periodStart: e.target.value }))} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label required">Period End</label>
                    <input type="date" className="form-control" value={form.periodEnd} onChange={(e) => setForm((p) => ({ ...p, periodEnd: e.target.value }))} />
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Opening Balance</label>
                    <input type="number" step="0.01" className="form-control" value={form.openingBalance} onChange={(e) => setForm((p) => ({ ...p, openingBalance: e.target.value }))} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Closing Balance</label>
                    <input type="number" step="0.01" className="form-control" value={form.closingBalance} onChange={(e) => setForm((p) => ({ ...p, closingBalance: e.target.value }))} />
                  </div>
                  <div className="row">
                    <div className="col-12 mb-3">
                      <label className="form-label">Total Debits</label>
                      <input type="number" step="0.01" className="form-control" value={form.totalDebits} onChange={(e) => setForm((p) => ({ ...p, totalDebits: e.target.value }))} />
                    </div>
                    <div className="col-12 mb-3">
                      <label className="form-label">Total Credits</label>
                      <input type="number" step="0.01" className="form-control" value={form.totalCredits} onChange={(e) => setForm((p) => ({ ...p, totalCredits: e.target.value }))} />
                    </div>
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Document Status</label>
                    <select className="form-select" value={form.documentStatus} onChange={(e) => setForm((p) => ({ ...p, documentStatus: e.target.value }))}>
                      <option value="ready">Ready (New)</option>
                      <option value="review">Review</option>
                      <option value="viewed">Viewed</option>
                      <option value="downloaded">Downloaded</option>
                      <option value="queried">Queried</option>
                    </select>
                    <small className="form-hint">Only Global Administrators and Administrators can change document status</small>
                  </div>

                  <div className="mb-3">
                    <label className="form-label">Notes</label>
                    <textarea className="form-control" rows="3" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
                  </div>

                  <div className="mb-3">
                    <label className="form-label required">Edit Reason</label>
                    <textarea
                      className="form-control"
                      rows="2"
                      placeholder="Why are you editing this statement? (required for audit trail)"
                      value={form.editReason}
                      onChange={(e) => setForm((p) => ({ ...p, editReason: e.target.value }))}
                      required
                    />
                  </div>

                  <div className="d-flex gap-2 mt-4">
                    <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || !form.editReason.trim()}>
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => navigate(`/statements/${id}/view?returnQuery=${encodeURIComponent(returnQuery)}`, { state: { returnQuery } })}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <style>{`
        .excel-preview-surface {
          background: #f7f9fc;
          border: 1px solid #dce3ea;
        }
        .excel-preview-surface table {
          border-collapse: collapse !important;
          width: max-content;
          min-width: 100%;
          background: #ffffff;
          font-family: Calibri, "Segoe UI", Tahoma, Arial, sans-serif;
          font-size: 13px;
          color: #1f2937;
        }
        .excel-preview-surface td,
        .excel-preview-surface th {
          border: 1px solid #dbe1e8 !important;
          padding: 6px 10px !important;
          line-height: 1.25;
          white-space: nowrap;
        }
        .excel-preview-surface tr:first-child td,
        .excel-preview-surface tr:first-child th {
          position: sticky;
          top: 0;
          z-index: 2;
          background: #edf2f7;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
};

export default StatementEdit;

