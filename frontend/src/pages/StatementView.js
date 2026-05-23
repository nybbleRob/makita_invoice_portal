import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';
import { usePermissions } from '../context/PermissionContext';
import { useSettings } from '../context/SettingsContext';
import DocumentRetentionTimer from '../components/DocumentRetentionTimer';

pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ''}/pdf.worker.js`;

const StatementView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission } = usePermissions();
  const { settings } = useSettings();

  const canDownload = hasPermission('STATEMENTS_DOWNLOAD');
  const canEdit = hasPermission('STATEMENTS_EDIT');

  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [previewType, setPreviewType] = useState('pdf');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [downloading, setDownloading] = useState(false);

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

  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-GB');
  };

  const formatPeriod = (start, end) => {
    if (!start && !end) return '-';
    if (!start || !end) return formatDate(end || start);
    const s = formatDate(start);
    const e = formatDate(end);
    return s === e ? e : `${s} - ${e}`;
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount || 0);
  };

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

  const getDocumentStatus = () => {
    if (!statement) return 'ready_new';
    if (statement.documentStatus === 'downloaded') return 'downloaded';
    if (statement.documentStatus === 'viewed') return 'viewed';
    if (statement.documentStatus === 'queried') return 'queried';
    if (statement.documentStatus === 'review') return 'review';
    if (statement.documentStatus === 'ready' && !statement.viewedAt) return 'ready_new';
    if (statement.downloadedAt) return 'downloaded';
    if (statement.viewedAt) return 'viewed';
    return 'ready_new';
  };

  const getDocumentStatusBadgeClass = (status) => {
    const classes = {
      ready_new: 'bg-success-lt',
      new: 'bg-success-lt',
      ready: 'bg-success-lt',
      viewed: 'bg-orange-lt',
      downloaded: 'bg-primary-lt',
      review: 'bg-warning-lt',
      queried: 'bg-info-lt'
    };
    return classes[status] || 'bg-success-lt';
  };

  const getDocumentStatusLabel = (status) => {
    const labels = {
      ready_new: 'Ready (New)',
      new: 'Ready (New)',
      ready: 'Ready (New)',
      viewed: 'Viewed',
      downloaded: 'Downloaded',
      review: 'Review',
      queried: 'Queried'
    };
    return labels[status] || 'Ready (New)';
  };

  const handleDownload = async () => {
    const format = hasPdf ? 'pdf' : 'xls';
    try {
      setDownloading(true);
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
    } finally {
      setDownloading(false);
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

  const docStatus = getDocumentStatus();

  return (
    <div className="page">
      <div className="page-header">
        <div className="container-xl">
          <div className="row g-2 align-items-center">
            <div className="col">
              <h2 className="page-title">Statement Details</h2>
              <div className="text-muted mt-1">Statement for {statement.company?.name || statement.id}</div>
            </div>
            <div className="col-auto ms-auto">
              <button className="btn btn-secondary me-2" onClick={() => navigate(`/statements?${returnQuery}`)}>
                Back to Statements
              </button>
              {canDownload && (hasPdf || hasXls) && (
                <button className="btn btn-primary" onClick={handleDownload} disabled={downloading}>
                  {downloading ? 'Downloading...' : 'Download Statement'}
                </button>
              )}
              {canEdit && (
                <button
                  className="btn btn-info ms-2"
                  onClick={() => navigate(`/statements/${id}/edit?returnQuery=${encodeURIComponent(returnQuery)}`, { state: { returnQuery } })}
                >
                  Edit
                </button>
              )}
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
                  {hasPdf && previewType !== 'pdf' && (
                    <button className="btn btn-sm btn-outline-primary" onClick={() => setPreviewType('pdf')}>PDF</button>
                  )}
                </div>
                <div className="card-body p-0">
                  {loadingPreview ? (
                    <div className="text-center py-5">
                      <div className="spinner-border" role="status"><span className="visually-hidden">Loading...</span></div>
                    </div>
                  ) : previewType === 'pdf' ? (
                    <div style={{ padding: '20px', maxHeight: 'calc(100vh - 250px)', overflowY: 'auto', userSelect: 'none' }}>
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
                <div className="card-header d-flex justify-content-between align-items-center">
                  <h3 className="card-title">Statement Information</h3>
                  {settings?.documentRetentionPeriod && (
                    <DocumentRetentionTimer
                      expiryDate={statement.retentionExpiryDate}
                      startDate={statement.retentionStartDate}
                      retentionPeriod={settings?.documentRetentionPeriod}
                    />
                  )}
                </div>
                <div className="card-body">
                  <div className="list-group list-group-flush">
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-muted small" style={{ minWidth: '140px', flexShrink: 0 }}>Document Type</div>
                        <div className="text-end" style={{ flex: 1 }}>
                          <span className="badge bg-primary-lt">Statement</span>
                        </div>
                      </div>
                    </div>
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-muted small" style={{ minWidth: '140px', flexShrink: 0 }}>Company</div>
                        <div className="fw-semibold text-end" style={{ flex: 1 }}>{statement.company?.name || '-'}</div>
                      </div>
                    </div>
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-muted small" style={{ minWidth: '140px', flexShrink: 0 }}>Account / Customer Number</div>
                        <div className="fw-semibold text-end" style={{ flex: 1 }}>{statement.company?.referenceNo || '-'}</div>
                      </div>
                    </div>
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-muted small" style={{ minWidth: '140px', flexShrink: 0 }}>Period</div>
                        <div className="text-end" style={{ flex: 1 }}>{formatPeriod(statement.periodStart, statement.periodEnd)}</div>
                      </div>
                    </div>
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-danger small" style={{ minWidth: '140px', flexShrink: 0 }}>Opening Balance</div>
                        <div className="text-danger text-end" style={{ flex: 1 }}>{formatCurrency(statement.openingBalance)}</div>
                      </div>
                    </div>
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-danger small" style={{ minWidth: '140px', flexShrink: 0 }}>Closing Balance</div>
                        <div className="fw-semibold text-danger text-end" style={{ flex: 1 }}>{formatCurrency(statement.closingBalance)}</div>
                      </div>
                    </div>
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-muted small" style={{ minWidth: '140px', flexShrink: 0 }}>Total Debits</div>
                        <div className="text-end" style={{ flex: 1 }}>{formatCurrency(statement.totalDebits)}</div>
                      </div>
                    </div>
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-muted small" style={{ minWidth: '140px', flexShrink: 0 }}>Total Credits</div>
                        <div className="text-end" style={{ flex: 1 }}>{formatCurrency(statement.totalCredits)}</div>
                      </div>
                    </div>
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-muted small" style={{ minWidth: '140px', flexShrink: 0 }}>Files</div>
                        <div className="text-end" style={{ flex: 1 }}>
                          {hasPdf && <span className="badge bg-red-lt me-1">PDF</span>}
                          {hasXls && <span className="badge bg-green-lt">XLS</span>}
                          {!hasPdf && !hasXls && <span className="text-muted">-</span>}
                        </div>
                      </div>
                    </div>
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-muted small" style={{ minWidth: '140px', flexShrink: 0 }}>Document Status</div>
                        <div className="text-end" style={{ flex: 1 }}>
                          <span className={`badge ${getDocumentStatusBadgeClass(docStatus)}`}>{getDocumentStatusLabel(docStatus)}</span>
                        </div>
                      </div>
                    </div>
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

export default StatementView;

