import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import DocumentRetentionTimer from '../components/DocumentRetentionTimer';
import { getAvailableFields } from '../utils/fieldDiscovery';
import * as pdfjsLib from 'pdfjs-dist';

// Set worker path for PDF.js - use local worker file from public folder
pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ''}/pdf.worker.min.js`;

// Suppress font warnings from pdfjs (harmless but annoying)
if (typeof window !== 'undefined') {
  const originalWarn = console.warn;
  console.warn = (...args) => {
    if (args[0] && typeof args[0] === 'string' && args[0].includes('TT: undefined function')) {
      return; // Suppress font warnings
    }
    originalWarn.apply(console, args);
  };
}

const InvoiceView = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const { settings } = useSettings();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [pdfPages, setPdfPages] = useState([]);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const canvasContainerRef = useRef(null);
  const isRenderingRef = useRef(false);
  const pdfFetchedRef = useRef(false);
  
  // Query states
  const [queryMessages, setQueryMessages] = useState([]);
  const [queryThread, setQueryThread] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [loadingQuery, setLoadingQuery] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null); // Message ID being replied to
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolutionReason, setResolutionReason] = useState('');
  const [resolving, setResolving] = useState(false);
  
  // Check if queries are enabled
  const queriesEnabled = settings?.queriesEnabled !== false; // Default to true if not set

  // Custom fields state
  const [availableFields, setAvailableFields] = useState([]);
  
  // Load available fields on mount
  useEffect(() => {
    const loadFields = async () => {
      try {
        const fields = await getAvailableFields('invoices');
        setAvailableFields(fields);
      } catch (error) {
        console.error('Error loading available fields:', error);
      }
    };
    loadFields();
  }, []);

  useEffect(() => {
    // Reset PDF state when id changes
    setPdfPages([]);
    setLoadingPdf(false);
    isRenderingRef.current = false;
    pdfFetchedRef.current = false;
    if (canvasContainerRef.current) {
      canvasContainerRef.current.innerHTML = '';
    }
    
    fetchInvoice();
    
    // Cleanup: reset PDF state when component unmounts
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

  // Load query history when component loads (only if queries enabled)
  useEffect(() => {
    if (id && queriesEnabled) {
      fetchQueryHistory();
    }
  }, [id, queriesEnabled]);

  const fetchInvoice = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/api/invoices/${id}`);
      setInvoice(response.data);
      // Invoice is automatically marked as viewed by the backend
      
      // Fetch PDF for preview if file exists
      if (response.data.fileUrl) {
        fetchPdfForPreview();
      }
    } catch (error) {
      console.error('Error fetching invoice:', error);
      toast.error('Error loading invoice: ' + (error.response?.data?.message || error.message));
      navigate('/invoices');
    } finally {
      setLoading(false);
    }
  };

  const fetchPdfForPreview = async () => {
    // Prevent fetching multiple times
    if (pdfFetchedRef.current || loadingPdf) {
      return;
    }
    
    try {
      pdfFetchedRef.current = true;
      setLoadingPdf(true);
      const token = localStorage.getItem('token');
      const baseUrl = API_BASE_URL;
      const url = `${baseUrl}/api/invoices/${id}/view-pdf`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to load PDF');
      }

      const arrayBuffer = await response.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages = [];
      
      // Render all pages
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        pages.push(page);
      }
      
      setPdfPages(pages);
      setLoadingPdf(false);
    } catch (error) {
      console.error('Error loading PDF for preview:', error);
      setLoadingPdf(false);
      pdfFetchedRef.current = false; // Reset on error so it can retry
      // Don't show error toast, just don't display PDF
    }
  };

  // Render PDF pages to canvas
  useEffect(() => {
    if (pdfPages.length === 0 || !canvasContainerRef.current || isRenderingRef.current) {
      return;
    }
    
    isRenderingRef.current = true;
    
    const renderPages = async () => {
      // Check if container still exists
      if (!canvasContainerRef.current) {
        isRenderingRef.current = false;
        return;
      }
      
      // Clear previous content
      canvasContainerRef.current.innerHTML = '';
      
      for (let i = 0; i < pdfPages.length; i++) {
        // Check if container still exists before each iteration
        if (!canvasContainerRef.current) {
          break; // Component unmounted
        }
        
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
        
        const renderContext = {
          canvasContext: context,
          viewport: viewport
        };
        
        await page.render(renderContext).promise;
        
        // Final check before appending
        if (canvasContainerRef.current) {
          canvasContainerRef.current.appendChild(canvas);
        } else {
          break; // Component unmounted during render
        }
      }
      
      isRenderingRef.current = false;
    };
    
    renderPages();
    
    // Cleanup function
    return () => {
      isRenderingRef.current = false;
      if (canvasContainerRef.current) {
        canvasContainerRef.current.innerHTML = '';
      }
    };
  }, [pdfPages]);


  const handleDownload = async () => {
    try {
      setDownloading(true);
      const token = localStorage.getItem('token');
      const baseUrl = API_BASE_URL;
      const url = `${baseUrl}/api/invoices/${id}/download`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Download failed' }));
        throw new Error(errorData.message || 'Download failed');
      }

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `invoice-${id}.pdf`;
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (filenameMatch && filenameMatch[1]) {
          filename = filenameMatch[1].replace(/['"]/g, '');
        }
      }
      
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
      
      // Refresh invoice to update status
      fetchInvoice();
      toast.success('Invoice downloaded');
    } catch (error) {
      console.error('Error downloading invoice:', error);
      toast.error('Error downloading invoice: ' + (error.message || 'Unknown error'));
    } finally {
      setDownloading(false);
    }
  };

  const formatCurrency = (amount) => {
    const numAmount = typeof amount === 'number' ? amount : parseFloat(amount) || 0;
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP'
    }).format(numAmount);
  };

  const formatDate = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('en-GB');
  };

  const getDocumentStatus = () => {
    if (!invoice) return 'new';
    if (invoice.downloadedAt) return 'downloaded';
    if (invoice.viewedAt) return 'viewed';
    return 'new';
  };

  const getDocumentStatusBadge = (status) => {
    const badges = {
      new: <span className="badge bg-success-lt">Ready (New)</span>,
      ready_new: <span className="badge bg-success-lt">Ready (New)</span>,
      viewed: <span className="badge bg-orange-lt">Viewed</span>,
      downloaded: <span className="badge bg-primary-lt">Downloaded</span>,
      queried: <span className="badge bg-warning-lt">Queried</span>
    };
    return badges[status] || badges.new;
  };

  // Query functions
  const fetchQueryHistory = async () => {
    try {
      setLoadingQuery(true);
      const response = await api.get(`/api/document-queries/invoice/${id}`);
      if (response.data.query) {
        setQueryThread(response.data.query);
        const messages = response.data.messages || [];
        setQueryMessages(messages);
        // Scroll to bottom after messages load
        setTimeout(() => {
          const container = document.getElementById('query-messages-container');
          if (container) {
            container.scrollTop = container.scrollHeight;
          }
        }, 100);
      } else {
        setQueryThread(null);
        setQueryMessages([]);
      }
    } catch (error) {
      console.error('Error fetching query history:', error);
      // Don't show error if queries are disabled
      if (error.response?.status !== 403 || error.response?.data?.message?.includes('disabled')) {
        toast.error('Error loading query history');
      }
    } finally {
      setLoadingQuery(false);
    }
  };

  const handleSendQuery = async () => {
    if (!newMessage.trim()) {
      toast.error('Please enter a message');
      return;
    }

    try {
      setSendingMessage(true);
      const response = await api.post(`/api/document-queries/invoice/${id}`, {
        message: newMessage.trim(),
        replyTo: replyingTo || null
      });

      if (response.data.success) {
        toast.success('Message sent successfully');
        setNewMessage('');
        setReplyingTo(null);
        // Refresh query history with a small delay to ensure backend has saved
        setTimeout(async () => {
          await fetchQueryHistory();
        }, 100);
        // Refresh invoice to update status
        await fetchInvoice();
      }
    } catch (error) {
      console.error('Error sending query:', error);
      toast.error('Error sending message: ' + (error.response?.data?.message || error.message));
    } finally {
      setSendingMessage(false);
    }
  };

  const handleReplyToQuery = async () => {
    if (!newMessage.trim()) {
      toast.error('Please enter a message');
      return;
    }

    try {
      setSendingMessage(true);
      const response = await api.post(`/api/document-queries/invoice/${id}/reply`, {
        message: newMessage.trim(),
        replyTo: replyingTo || null
      });

      if (response.data.success) {
        toast.success('Reply sent successfully');
        setNewMessage('');
        setReplyingTo(null);
        // Refresh query history with a small delay to ensure backend has saved
        setTimeout(async () => {
          await fetchQueryHistory();
        }, 100);
      }
    } catch (error) {
      console.error('Error replying to query:', error);
      toast.error('Error replying to query: ' + (error.response?.data?.message || error.message));
    } finally {
      setSendingMessage(false);
    }
  };

  const handleResolveQuery = async () => {
    if (!resolutionReason.trim()) {
      toast.error('Please provide a resolution reason');
      return;
    }

    try {
      setResolving(true);
      const response = await api.post(`/api/document-queries/invoice/${id}/resolve`, {
        resolutionReason: resolutionReason.trim()
      });

      if (response.data.success) {
        toast.success('Query resolved successfully');
        setShowResolveModal(false);
        setResolutionReason('');
        await fetchQueryHistory();
      }
    } catch (error) {
      console.error('Error resolving query:', error);
      toast.error('Error resolving query: ' + (error.response?.data?.message || error.message));
    } finally {
      setResolving(false);
    }
  };

  // Helper to find message by ID (for threading display)
  const findMessageById = (messageId) => {
    return queryMessages.find(m => m.id === messageId);
  };

  const formatMessageTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };


  if (loading) {
    return (
      <div className="page">
        <div className="page-body">
          <div className="container-xl">
            <div className="card">
              <div className="card-body text-center py-5">
                <div className="spinner-border" role="status">
                  <span className="visually-hidden">Loading...</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="page">
        <div className="page-body">
          <div className="container-xl">
            <div className="card">
              <div className="card-body text-center py-5">
                <p className="text-muted">Invoice not found</p>
                <button className="btn btn-primary" onClick={() => navigate('/invoices')}>
                  Back to Invoices
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const docStatus = getDocumentStatus();



  return (
    <div className="page">
      <div className="page-header">
        <div className="container-xl">
          <div className="row g-2 align-items-center">
            <div className="col">
              <h2 className="page-title">Invoice Details</h2>
              <div className="text-muted mt-1">Invoice #{invoice.invoiceNumber}</div>
            </div>
            <div className="col-auto ms-auto">
              <button 
                className="btn btn-secondary me-2"
                onClick={() => navigate('/invoices')}
              >
                Back to Invoices
              </button>
              <button 
                className="btn btn-primary"
                onClick={handleDownload}
                disabled={downloading}
              >
                {downloading ? 'Downloading...' : 'Download Invoice'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="container-xl">
          <div className="row">
            {/* PDF Preview - Left Side (66%) */}
            <div className="col-lg-8">
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">PDF Preview</h3>
                </div>
                <div className="card-body p-0">
                  {loadingPdf ? (
                    <div className="text-center py-5">
                      <div className="spinner-border" role="status">
                        <span className="visually-hidden">Loading PDF...</span>
                      </div>
                      <p className="text-muted mt-2">Loading PDF preview...</p>
                    </div>
                  ) : pdfPages.length > 0 ? (
                    <div 
                      ref={canvasContainerRef}
                      style={{ 
                        padding: '20px',
                        maxHeight: 'calc(100vh - 250px)',
                        overflowY: 'auto',
                        userSelect: 'none'
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      onDragStart={(e) => e.preventDefault()}
                    />
                  ) : invoice?.fileUrl ? (
                    <div className="text-center py-5">
                      <p className="text-muted">Failed to load PDF preview</p>
                    </div>
                  ) : (
                    <div className="text-center py-5">
                      <p className="text-muted">No PDF file available for this invoice</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Invoice Information - Right Side (33%) */}
            <div className="col-lg-4">
              <div className="card">
                <div className="card-header d-flex justify-content-between align-items-center">
                  <h3 className="card-title">Invoice Information</h3>
                  {invoice && settings?.documentRetentionPeriod && (
                    <DocumentRetentionTimer
                      expiryDate={invoice.retentionExpiryDate}
                      startDate={invoice.retentionStartDate}
                      retentionPeriod={settings?.documentRetentionPeriod}
                    />
                  )}
                </div>
                <div className="card-body">
                  <div className="list-group list-group-flush">
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-muted small" style={{ minWidth: '140px', flexShrink: 0 }}>
                          Document Type
                        </div>
                        <div className="text-end" style={{ flex: 1 }}>
                          <span className="badge bg-primary-lt">Invoice</span>
                        </div>
                      </div>
                    </div>
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-muted small" style={{ minWidth: '140px', flexShrink: 0 }}>
                          Customer Name
                        </div>
                        <div className="fw-semibold text-end" style={{ flex: 1 }}>
                          {invoice.company ? invoice.company.name : '-'}
                        </div>
                      </div>
                    </div>
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-muted small" style={{ minWidth: '140px', flexShrink: 0 }}>
                          Account / Customer Number
                        </div>
                        <div className="fw-semibold text-end" style={{ flex: 1 }}>
                          {invoice.company?.referenceNo || '-'}
                        </div>
                      </div>
                    </div>
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-muted small" style={{ minWidth: '140px', flexShrink: 0 }}>
                          Invoice Number
                        </div>
                        <div className="fw-semibold text-end" style={{ flex: 1 }}>
                          {invoice.invoiceNumber}
                        </div>
                      </div>
                    </div>
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-muted small" style={{ minWidth: '140px', flexShrink: 0 }}>
                          Invoice Date / Tax Point
                        </div>
                        <div className="text-end" style={{ flex: 1 }}>
                          {formatDate(invoice.issueDate)}
                        </div>
                      </div>
                    </div>
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-muted small" style={{ minWidth: '140px', flexShrink: 0 }}>
                          Total
                        </div>
                        <div className="fw-semibold text-end" style={{ flex: 1 }}>
                          {formatCurrency(invoice.amount)}
                        </div>
                      </div>
                    </div>
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-muted small" style={{ minWidth: '140px', flexShrink: 0 }}>
                          Document Status
                        </div>
                        <div className="text-end" style={{ flex: 1 }}>
                          {getDocumentStatusBadge(docStatus)}
                        </div>
                      </div>
                    </div>
                    {queriesEnabled && (
                    <div className="list-group-item px-0 py-2">
                      <div className="d-flex flex-row align-items-center justify-content-between">
                        <div className="text-muted small" style={{ minWidth: '140px', flexShrink: 0 }}>
                          Queried Status
                        </div>
                        <div className="text-end" style={{ flex: 1 }}>
                          {(() => {
                            if (loadingQuery) {
                              return <span className="text-muted">Loading...</span>;
                            }
                            if (!queryThread || queryMessages.length === 0) {
                              return (
                                <span className="text-danger" title="No queries">
                                  ✗ No
                                </span>
                              );
                            }
                            
                            // Determine status based on who sent the last message
                            const lastMessage = queryMessages[queryMessages.length - 1];
                            const isCurrentUserLastSender = lastMessage?.userId === currentUser?.id;
                            const statusText = isCurrentUserLastSender 
                              ? 'Awaiting Reply' 
                              : 'Message Received';
                            
                            return (
                              <span 
                                className="text-success" 
                                title={`Queried - ${statusText}`}
                                style={{ cursor: 'help' }}
                              >
                                ✓ {statusText}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                    )}
                    {/* Custom Fields Section */}
                    {invoice?.metadata?.parsedData && availableFields.length > 0 && (() => {
                      const customFields = availableFields.filter(f => f.isCustom);
                      const customFieldValues = customFields
                        .filter(f => invoice.metadata.parsedData[f.fieldName] !== undefined && invoice.metadata.parsedData[f.fieldName] !== null && invoice.metadata.parsedData[f.fieldName] !== '')
                        .map(f => ({
                          field: f,
                          value: invoice.metadata.parsedData[f.fieldName]
                        }));
                      
                      if (customFieldValues.length === 0) return null;
                      
                      return (
                        <>
                          <div className="list-group-item px-0 py-2 border-top">
                            <div className="text-muted small mb-2">
                              <strong>Custom Fields</strong>
                            </div>
                          </div>
                          {customFieldValues.map(({ field, value }) => (
                            <div key={field.fieldName} className="list-group-item px-0 py-2">
                              <div className="d-flex flex-row align-items-center justify-content-between">
                                <div className="text-muted small" style={{ minWidth: '140px', flexShrink: 0 }}>
                                  {field.displayName}
                                </div>
                                <div className="fw-semibold text-end" style={{ flex: 1 }}>
                                  {field.dataType === 'currency' || field.dataType === 'number' 
                                    ? (typeof value === 'number' ? formatCurrency(value) : value)
                                    : field.dataType === 'date'
                                    ? formatDate(value)
                                    : String(value)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Query Section - Below Invoice Information (only if enabled) */}
              {queriesEnabled && (
              <div className="card mt-3">
                <div className="card-header d-flex justify-content-between align-items-center">
                  <h3 className="card-title">Queries</h3>
                  {queryThread?.status === 'resolved' && (
                    <span className="badge bg-success">Resolved</span>
                  )}
                  {queryThread && queryThread.status !== 'resolved' && 
                   ['administrator', 'global_admin'].includes(currentUser?.role) && (
                    <button
                      className="btn btn-sm btn-success"
                      onClick={() => setShowResolveModal(true)}
                    >
                      Resolve Query
                    </button>
                  )}
                </div>
                <div className="card-body">
                  {loadingQuery ? (
                    <div className="text-center py-4">
                      <div className="spinner-border spinner-border-sm" role="status">
                        <span className="visually-hidden">Loading...</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div 
                        className="chat-bubbles" 
                        id="query-messages-container"
                        style={{ maxHeight: '400px', overflowY: 'auto', padding: '1rem', marginBottom: '1rem' }}
                      >
                        {queryThread?.status === 'resolved' && (
                          <div className="alert alert-info mb-3">
                            <strong>This query has been resolved.</strong>
                            {queryThread.resolutionReason && (
                              <div className="mt-2">
                                <strong>Resolution:</strong> {queryThread.resolutionReason}
                              </div>
                            )}
                            {queryThread.resolvedAt && (
                              <div className="mt-1 text-muted" style={{ fontSize: '0.875rem' }}>
                                Resolved on {formatMessageTime(queryThread.resolvedAt)}
                              </div>
                            )}
                            {currentUser?.role === 'external_user' && (
                              <div className="mt-2">
                                <em>This conversation is closed. For further questions, please contact support via email.</em>
                              </div>
                            )}
                          </div>
                        )}
                        {queryMessages.length === 0 ? (
                          <div className="text-center text-muted py-4">
                            {currentUser?.role === 'external_user' ? (
                              <p>No queries yet. Start a conversation below.</p>
                            ) : (
                              <p>No queries yet. You can start a conversation with the customer below.</p>
                            )}
                          </div>
                        ) : (
                          queryMessages.map((msg) => {
                            const isCurrentUser = msg.userId === currentUser?.id;
                            const repliedToMessage = msg.replyTo ? findMessageById(msg.replyTo) : null;
                            return (
                              <div key={msg.id} className="chat-item mb-3">
                                <div className={`row align-items-end ${isCurrentUser ? 'justify-content-end' : ''}`}>
                                  <div className={`col col-lg-8 ${isCurrentUser ? 'order-2' : ''}`}>
                                    {repliedToMessage && (
                                      <div className="mb-1" style={{ fontSize: '0.875rem', opacity: 0.7, paddingLeft: '1rem', borderLeft: '2px solid #ccc' }}>
                                        <em>Replying to: {repliedToMessage.userName || repliedToMessage.userEmail}</em>
                                        <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                                          {repliedToMessage.message.substring(0, 100)}{repliedToMessage.message.length > 100 ? '...' : ''}
                                        </div>
                                      </div>
                                    )}
                                    <div className={`chat-bubble ${isCurrentUser ? 'chat-bubble-me' : ''}`}>
                                      <div className="chat-bubble-title">
                                        <div className="row">
                                          <div className="col chat-bubble-author">
                                            {msg.userName || msg.userEmail || 'Unknown User'}
                                            {msg.userRole && (
                                              <span className="badge bg-secondary-lt ms-2" style={{ fontSize: '0.7rem' }}>
                                                {msg.userRole === 'external_user' ? 'Customer' : 'Staff'}
                                              </span>
                                            )}
                                          </div>
                                          <div className="col-auto chat-bubble-date">
                                            {formatMessageTime(msg.createdAt)}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="chat-bubble-body">
                                        <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{msg.message}</p>
                                      </div>
                                    </div>
                                    {!isCurrentUser && queryThread?.status !== 'resolved' && (
                                      <button
                                        className="btn btn-sm btn-link p-0 mt-1"
                                        style={{ fontSize: '0.75rem' }}
                                        onClick={() => {
                                          setReplyingTo(msg.id);
                                          document.getElementById('query-message-input')?.focus();
                                        }}
                                      >
                                        Reply
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                      {queryThread?.status !== 'resolved' && (
                      <div className="border-top pt-3">
                        {replyingTo && (
                          <div className="alert alert-info mb-2 py-2">
                            <div className="d-flex justify-content-between align-items-center">
                              <small>
                                <strong>Replying to:</strong> {findMessageById(replyingTo)?.userName || findMessageById(replyingTo)?.userEmail}
                                <button
                                  className="btn btn-sm btn-link p-0 ms-2"
                                  onClick={() => setReplyingTo(null)}
                                >
                                  Cancel
                                </button>
                              </small>
                            </div>
                          </div>
                        )}
                        <div className="mb-2">
                          <label className="form-label">
                            {queryMessages.length === 0 
                              ? (currentUser?.role === 'external_user' ? 'Send a query about this invoice' : 'Send a query to customer')
                              : replyingTo ? 'Reply to message' : 'Send a message'}
                          </label>
                          <textarea
                            id="query-message-input"
                            className="form-control"
                            rows="3"
                            placeholder={queryMessages.length === 0
                              ? (currentUser?.role === 'external_user' 
                                ? 'Enter your question or concern about this invoice...'
                                : 'Enter your question for the customer...')
                              : replyingTo ? 'Enter your reply...' : 'Enter your message...'}
                            value={newMessage}
                            onChange={(e) => setNewMessage(e.target.value)}
                            disabled={sendingMessage}
                          />
                        </div>
                        <div className="d-flex justify-content-end">
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => {
                              // Both customers and staff can send messages (creates or adds to thread)
                              // Use handleSendQuery for new messages, handleReplyToQuery for replies
                              if (queryThread && replyingTo) {
                                handleReplyToQuery();
                              } else {
                                handleSendQuery();
                              }
                            }}
                            disabled={sendingMessage || !newMessage.trim()}
                          >
                            {sendingMessage 
                              ? 'Sending...' 
                              : (queryMessages.length === 0 ? 'Send Query' : replyingTo ? 'Reply' : 'Send Message')}
                          </button>
                        </div>
                      </div>
                      )}
                      {queryThread?.status === 'resolved' && currentUser?.role === 'external_user' && (
                        <div className="border-top pt-3">
                          <div className="alert alert-warning mb-0">
                            <em>This query has been resolved and is closed. For further questions, please contact support via email.</em>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
              )}

              {/* Resolve Query Modal */}
              {showResolveModal && (
                <div className="modal show d-block" tabIndex="-1" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                  <div className="modal-dialog">
                    <div className="modal-content">
                      <div className="modal-header">
                        <h5 className="modal-title">Resolve Query</h5>
                        <button
                          type="button"
                          className="btn-close"
                          onClick={() => {
                            setShowResolveModal(false);
                            setResolutionReason('');
                          }}
                        ></button>
                      </div>
                      <div className="modal-body">
                        <p>Please provide a reason for resolving this query. Once resolved, external users will not be able to reply.</p>
                        <div className="mb-3">
                          <label className="form-label">Resolution Reason *</label>
                          <textarea
                            className="form-control"
                            rows="4"
                            placeholder="Enter the reason for resolving this query..."
                            value={resolutionReason}
                            onChange={(e) => setResolutionReason(e.target.value)}
                            disabled={resolving}
                          />
                        </div>
                      </div>
                      <div className="modal-footer">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            setShowResolveModal(false);
                            setResolutionReason('');
                          }}
                          disabled={resolving}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn btn-success"
                          onClick={handleResolveQuery}
                          disabled={resolving || !resolutionReason.trim()}
                        >
                          {resolving ? 'Resolving...' : 'Resolve Query'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default InvoiceView;

