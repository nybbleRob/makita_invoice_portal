import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';
import { usePermissions } from '../context/PermissionContext';

pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ''}/pdf.worker.js`;

const StatementView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission } = usePermissions();

  const canDownload = hasPermission('STATEMENTS_DOWNLOAD');
  const canEdit = hasPermission('STATEMENTS_EDIT');

  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [previewType, setPreviewType] = useState('pdf');
  const [loadingPreview, setLoadingPreview] = useState(false);

  const [pdfPages, setPdfPages] = useState([]);
  const [xlsSheets, setXlsSheets] = useState([]);
  const [activeXlsSheet, setActiveXlsSheet] = useState('');

  const canvasContainerRef = useRef(null);
  const isRenderingRef = useRef(false);
  const returnQueryRef = useRef(null);

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

  const statusBadgeClass = (status) => {
    const map = {
      draft: 'bg-secondary-lt',
      sent: 'bg-info-lt',
      acknowledged: 'bg-success-lt',
      disputed: 'bg-warning-lt'
    };
    return map[status] || 'bg-secondary-lt';
  };

  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-GB');
  };

  const formatPeriod = (start, end) => {
    if (!start || !end) return formatDate(end);
    return `${formatDate(start)} - ${formatDate(end)}`;
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount || 0);
  };

  const handleDownload = async (format) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/api/statements/${id}/download?format=${format}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Download failed' }));
        throw new Error(errorData.message || 'Download failed');
      }
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `statement-${statement?.statementNumber || id}.${format === 'pdf' ? 'pdf' : 'xlsx'}`;
      if (contentDisposition) {
        const m = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (m && m[1]) filename = m[1].replace(/['"]/g, '');
      }
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
      toast.success('Statement downloaded');
    } catch (error) {
      console.error('Error downloading statement:', error);
      toast.error(`Error downloading statement: ${error.message}`);
    }
  };

  useEffect(() => {
    const fetchStatement = async () => {
      try {
        setLoading(true);
        const response = await api.get(`/api/statements/${id}`);
        const doc = response.data;
        setStatement(doc);
        if (doc?.pdfFileUrl || (doc?.fileUrl && /\.pdf$/i.test(doc.fileUrl))) {
          setPreviewType('pdf');
        } else if (doc?.xlsFileUrl || (doc?.fileUrl && /\.(xls|xlsx)$/i.test(doc.fileUrl))) {
          setPreviewType('xls');
        }
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
            html: XLSX.utils.sheet_to_html(workbook.Sheets[name], { editable: false })
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
    const renderPages = async () => {
      if (!canvasContainerRef.current) return;
      canvasContainerRef.current.innerHTML = '';
      for (const page of pdfPages) {
        if (!canvasContainerRef.current) break;
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
        if (canvasContainerRef.current) canvasContainerRef.current.appendChild(canvas);
      }
      isRenderingRef.current = false;
    };
    renderPages();
    return () => {
      isRenderingRef.current = false;
      if (canvasContainerRef.current) canvasContainerRef.current.innerHTML = '';
    };
  }, [pdfPages, previewType]);

  if (loading) {
    return (
      <div className="page">
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

  if (!statement) return null;

  return (
    <div className="page">
      <div className="page-header">
        <div className="container-xl">
          <div className="row g-2 align-items-center">
            <div className="col">
              <h2 className="page-title">Statement {statement.statementNumber || statement.id}</h2>
            </div>
            <div className="col-auto d-flex gap-2">
              {canDownload && hasPdf && (
                <button className="btn btn-sm btn-success" onClick={() => handleDownload('pdf')}>Download PDF</button>
              )}
              {canDownload && hasXls && (
                <button className="btn btn-sm btn-success" onClick={() => handleDownload('xls')}>Download XLS</button>
              )}
              {canEdit && (
                <button
                  className="btn btn-sm btn-info"
                  onClick={() => navigate(`/statements/${statement.id}/edit?returnQuery=${encodeURIComponent(returnQuery)}`, { state: { returnQuery } })}
                >
                  Edit
                </button>
              )}
              <button className="btn btn-sm btn-secondary" onClick={() => navigate(`/statements?${returnQuery}`)}>Back</button>
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
                  <h3 className="card-title mb-0">{previewType === 'xls' ? 'XLS Preview' : 'PDF Preview'}</h3>
                  <div className="btn-list">
                    {hasPdf && (
                      <button className={`btn btn-sm ${previewType === 'pdf' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setPreviewType('pdf')}>PDF</button>
                    )}
                    {hasXls && (
                      <button className={`btn btn-sm ${previewType === 'xls' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setPreviewType('xls')}>XLS</button>
                    )}
                  </div>
                </div>
                <div className="card-body">
                  {loadingPreview ? (
                    <div className="text-center py-5">
                      <div className="spinner-border" role="status"><span className="visually-hidden">Loading...</span></div>
                    </div>
                  ) : previewType === 'pdf' ? (
                    <div ref={canvasContainerRef} style={{ maxHeight: '80vh', overflowY: 'auto' }} />
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
                <div className="card-header"><h3 className="card-title mb-0">Details</h3></div>
                <div className="card-body">
                  <div className="mb-2"><strong>Company:</strong> {statement.company?.name || '-'}</div>
                  <div className="mb-2"><strong>Account No.:</strong> {statement.company?.referenceNo || '-'}</div>
                  <div className="mb-2"><strong>Period:</strong> {formatPeriod(statement.periodStart, statement.periodEnd)}</div>
                  <div className="mb-2"><strong>Opening:</strong> {formatCurrency(statement.openingBalance)}</div>
                  <div className="mb-2"><strong>Closing:</strong> {formatCurrency(statement.closingBalance)}</div>
                  <div className="mb-2"><strong>Total Debits:</strong> {formatCurrency(statement.totalDebits)}</div>
                  <div className="mb-2"><strong>Total Credits:</strong> {formatCurrency(statement.totalCredits)}</div>
                  <div className="mb-2">
                    <strong>Status:</strong>{' '}
                    <span className={`badge ${statusBadgeClass(statement.status)}`}>{statement.status}</span>
                  </div>
                  <div className="mb-0"><strong>Files:</strong> {hasPdf ? 'PDF ' : ''}{hasXls ? 'XLS' : '' || '-'}</div>
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

export default StatementView;

