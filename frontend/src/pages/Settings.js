import React, { useState, useEffect } from 'react';
import api, { API_BASE_URL } from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';

const Settings = () => {
  const { user } = useAuth();
  const { refreshSettings } = useSettings();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState({});
  const [activeSection, setActiveSection] = useState('company');
  const [testingConnection, setTestingConnection] = useState(false);
  const [testingImport, setTestingImport] = useState(false);
  const [queueStatus, setQueueStatus] = useState(null);
  const [testingEmail, setTestingEmail] = useState(false);
  const [emailTemplates, setEmailTemplates] = useState([]);
  const [selectedEmailTemplate, setSelectedEmailTemplate] = useState('welcome');
  // loadingTemplates no longer needed - using static template list
  
  // Admin Tools state
  const [showPurgeDocumentsModal, setShowPurgeDocumentsModal] = useState(false);
  const [showPurgeCustomersModal, setShowPurgeCustomersModal] = useState(false);
  const [showClearImportHistoryModal, setShowClearImportHistoryModal] = useState(false);
  const [purgeReason, setPurgeReason] = useState('');
  const [clearHistoryReason, setClearHistoryReason] = useState('');
  const [purgingDocuments, setPurgingDocuments] = useState(false);
  const [purgingCustomers, setPurgingCustomers] = useState(false);
  const [clearingImportHistory, setClearingImportHistory] = useState(false);
  const [purgeStats, setPurgeStats] = useState(null);
  const [importHistoryCount, setImportHistoryCount] = useState(0);
  const [updatingGlobalEDI, setUpdatingGlobalEDI] = useState(false);
  const [updatingGlobalEmail, setUpdatingGlobalEmail] = useState(false);

  // Statement Generator Sandbox state. This is the admin-only test harness for
  // the ACR11P (.TXT) generate path. The backend enforces silent=true, so no
  // customer emails will ever fire from here - it's purely "did the file parse,
  // did the workers generate PDFs/XLSXs, and where did each customer land".
  const [sandboxFile, setSandboxFile] = useState(null);
  const [sandboxForceOverwrite, setSandboxForceOverwrite] = useState(false);
  const [sandboxRunning, setSandboxRunning] = useState(false);
  const [sandboxStatus, setSandboxStatus] = useState(null);
  const [sandboxResults, setSandboxResults] = useState(null);
  const [sandboxError, setSandboxError] = useState(null);
  
  // Import Settings state
  const [importSettings, setImportSettings] = useState(null);
  const [importLogs, setImportLogs] = useState([]);
  const [loadingImportSettings, setLoadingImportSettings] = useState(false);
  const [loadingImportLogs, setLoadingImportLogs] = useState(false);
  const [triggeringImport, setTriggeringImport] = useState(false);
  const [savingImportSettings, setSavingImportSettings] = useState(false);
  const [failedCount, setFailedCount] = useState(0);
  const [retryingFailed, setRetryingFailed] = useState(false);
  
  // Companies for test mode default company dropdown
  const [companies, setCompanies] = useState([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);
  
  // Email logs state
  const [emailLogs, setEmailLogs] = useState([]);
  const [loadingEmailLogs, setLoadingEmailLogs] = useState(false);
  const [emailQueueStatus, setEmailQueueStatus] = useState(null);
  const [emailPerformance, setEmailPerformance] = useState(null);
  const [clearingLogs, setClearingLogs] = useState(false);

  // "Clear Email Logs" confirmation modal state. This wipes the entire email
  // audit trail (the email_logs table is TRUNCATE'd server-side), which is
  // why we now gate it behind a modal that requires typing the exact phrase
  // "CLEAR" plus a reason — a stray click here previously nuked ~4 months
  // of send history in a single command.
  const [showClearEmailLogsModal, setShowClearEmailLogsModal] = useState(false);
  const [clearEmailLogsConfirmation, setClearEmailLogsConfirmation] = useState('');
  const [clearEmailLogsReason, setClearEmailLogsReason] = useState('');

  useEffect(() => {
    if (user?.role === 'global_admin') {
      fetchSettings();
      fetchCompanies();
    }
  }, [user]);
  
  const fetchCompanies = async () => {
    setLoadingCompanies(true);
    try {
      // Fetch all companies with pagination params (page AND limit required)
      const response = await api.get('/api/companies?page=1&limit=10000');
      const companiesData = response.data.data || response.data || [];
      // Sort alphabetically by name in case backend doesn't sort
      companiesData.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setCompanies(companiesData);
      console.log(`Loaded ${companiesData.length} companies for dropdown`);
    } catch (error) {
      console.error('Error fetching companies:', error);
    } finally {
      setLoadingCompanies(false);
    }
  };


  // Email templates are now HTML file-based, so we use a static list
  useEffect(() => {
    // Static list of available email templates (HTML file-based)
    const staticTemplates = [
      { id: 'welcome', name: 'welcome', description: 'Welcome Email', isActive: true },
      { id: 'password-reset', name: 'password-reset', description: 'Password Reset', isActive: true },
      { id: 'password-changed', name: 'password-changed', description: 'Password Changed Confirmation', isActive: true },
      { id: 'document-notification', name: 'document-notification', description: 'Document Notification (Individual)', isActive: true },
      { id: 'document-summary', name: 'document-summary', description: 'Document Summary (Batch)', isActive: true },
      { id: 'import-summary', name: 'import-summary', description: 'Import Summary (Admin)', isActive: true },
      { id: 'query-notification', name: 'query-notification', description: 'Query Notification', isActive: true },
      { id: 'document-deleted', name: 'document-deleted', description: 'Document Deleted (Retention)', isActive: true },
      { id: 'retention-cleanup-summary', name: 'retention-cleanup-summary', description: 'Retention Cleanup Summary (Admin)', isActive: true },
      { id: 'registration-request', name: 'registration-request', description: 'Registration Request (Admin)', isActive: true },
      { id: 'registration-approved', name: 'registration-approved', description: 'Registration Approved', isActive: true },
      { id: 'registration-rejected', name: 'registration-rejected', description: 'Registration Rejected', isActive: true },
      { id: 'registration-submitted', name: 'registration-submitted', description: 'Registration Submitted (User Confirmation)', isActive: true },
      { id: 'bulk-email-test', name: 'bulk-email-test', description: 'Bulk Email Test (60 emails over 10 mins)', isActive: true }
    ];
    setEmailTemplates(staticTemplates);
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await api.get('/api/settings');
      setSettings(response.data);
    } catch (error) {
      console.error('Error fetching settings:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch import settings when import-settings section is active
  const fetchImportSettings = async () => {
    setLoadingImportSettings(true);
    try {
      const response = await api.get('/api/import-settings');
      setImportSettings(response.data);
    } catch (error) {
      console.error('Error fetching import settings:', error);
    } finally {
      setLoadingImportSettings(false);
    }
  };

  // Fetch import logs
  const fetchImportLogs = async () => {
    setLoadingImportLogs(true);
    try {
      const response = await api.get('/api/import-settings/logs?count=100');
      setImportLogs(response.data.logs || []);
    } catch (error) {
      console.error('Error fetching import logs:', error);
    } finally {
      setLoadingImportLogs(false);
    }
  };

  // Fetch email logs for terminal viewer
  const fetchEmailLogs = async () => {
    setLoadingEmailLogs(true);
    try {
      const response = await api.get('/api/settings/email-logs?limit=100');
      // Sort newest first (by timestamp descending)
      const logs = (response.data.logs || []).sort((a, b) => {
        const timeA = new Date(a.timestamp || a.createdAt || 0).getTime();
        const timeB = new Date(b.timestamp || b.createdAt || 0).getTime();
        return timeB - timeA; // Newest first
      });
      setEmailLogs(logs);
      setEmailQueueStatus(response.data.queueStatus || null);
      setEmailPerformance(response.data.performance || null);
    } catch (error) {
      console.error('Error fetching email logs:', error);
      toast.error('Error fetching email logs: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoadingEmailLogs(false);
    }
  };

  // Clear email logs. The user must have typed the exact phrase "CLEAR"
  // and provided a non-empty reason in the confirmation modal — both are
  // also revalidated server-side; this UI check is just to fail fast and
  // give an obvious message.
  const handleClearEmailLogs = async () => {
    if (clearEmailLogsConfirmation.trim() !== 'CLEAR') {
      toast.error('Type CLEAR (in capitals) to confirm.');
      return;
    }
    if (!clearEmailLogsReason.trim()) {
      toast.error('Please provide a reason for clearing the email audit trail.');
      return;
    }

    setClearingLogs(true);
    try {
      const response = await api.delete('/api/settings/email-logs', {
        data: {
          confirmation: 'CLEAR',
          reason: clearEmailLogsReason.trim()
        }
      });
      toast.success(response.data?.message || 'Email logs cleared successfully');
      setEmailLogs([]);
      setShowClearEmailLogsModal(false);
      setClearEmailLogsConfirmation('');
      setClearEmailLogsReason('');
    } catch (error) {
      console.error('Error clearing email logs:', error);
      toast.error('Error clearing email logs: ' + (error.response?.data?.message || error.message));
    } finally {
      setClearingLogs(false);
    }
  };

  // Auto-refresh import logs every 30 seconds when on import settings section
  useEffect(() => {
    if (activeSection === 'import-settings') {
      fetchImportSettings();
      fetchImportLogs();
      fetchFailedCount();
      
      const logsInterval = setInterval(() => {
        fetchImportLogs();
        fetchFailedCount();
      }, 30000); // 30 seconds
      
      return () => clearInterval(logsInterval);
    }
  }, [activeSection]);

  // Auto-refresh email logs every 10 seconds when on SMTP settings section
  useEffect(() => {
    if (activeSection === 'smtp') {
      fetchEmailLogs();
      
      const emailLogsInterval = setInterval(() => {
        fetchEmailLogs();
      }, 10000); // 10 seconds
      
      return () => clearInterval(emailLogsInterval);
    }
  }, [activeSection]);

  // Fetch import history count when Admin Tools section is active (used by
  // the Clear Import History card).
  useEffect(() => {
    if (activeSection === 'admin-tools') {
      fetchImportHistoryCount();
    }
  }, [activeSection]);

  // Trigger manual import
  const handleTriggerImport = async () => {
    setTriggeringImport(true);
    try {
      const response = await api.post('/api/import-settings/trigger');
      toast.success(response.data.message || 'Import scan completed');
      fetchImportSettings();
      fetchImportLogs();
      fetchFailedCount();
    } catch (error) {
      console.error('Error triggering import:', error);
      toast.error('Error triggering import: ' + (error.response?.data?.message || error.message));
    } finally {
      setTriggeringImport(false);
    }
  };

  // Fetch count of failed files available for retry
  const fetchFailedCount = async () => {
    try {
      const response = await api.get('/api/import-settings/failed-count');
      setFailedCount(response.data.count || 0);
    } catch (error) {
      console.error('Error fetching failed count:', error);
    }
  };

  // Retry failed imports
  const handleRetryFailed = async () => {
    if (failedCount === 0) {
      toast.info('No failed files to retry');
      return;
    }
    
    if (!window.confirm(`Move ${failedCount} failed file(s) back to uploads and reprocess?`)) {
      return;
    }
    
    setRetryingFailed(true);
    try {
      const response = await api.post('/api/import-settings/retry-failed', { triggerScan: true });
      
      if (response.data.scanResults) {
        toast.success(`Moved ${response.data.moved} files. Scan queued ${response.data.scanResults.queued} for processing.`);
      } else {
        toast.success(response.data.message || `Moved ${response.data.moved} files for retry`);
      }
      
      fetchImportSettings();
      fetchImportLogs();
      fetchFailedCount();
    } catch (error) {
      console.error('Error retrying failed imports:', error);
      toast.error('Error retrying failed imports: ' + (error.response?.data?.message || error.message));
    } finally {
      setRetryingFailed(false);
    }
  };

  // Save import settings (frequency, enabled)
  const handleSaveImportSettings = async (updates) => {
    setSavingImportSettings(true);
    try {
      await api.put('/api/import-settings', updates);
      toast.success('Import settings updated');
      fetchImportSettings();
    } catch (error) {
      console.error('Error saving import settings:', error);
      toast.error('Error saving import settings: ' + (error.response?.data?.message || error.message));
    } finally {
      setSavingImportSettings(false);
    }
  };

  // Clear import logs
  const handleClearImportLogs = async () => {
    if (!window.confirm('Are you sure you want to clear all import logs?')) return;
    try {
      await api.delete('/api/import-settings/logs');
      toast.success('Import logs cleared');
      fetchImportLogs();
    } catch (error) {
      console.error('Error clearing import logs:', error);
      toast.error('Error clearing import logs');
    }
  };

  const handleInputChange = (field, value) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleNestedChange = (parent, field, value) => {
    setSettings(prev => ({
      ...prev,
      [parent]: {
        ...prev[parent],
        [field]: value
      }
    }));
  };

  const handleEmailProviderNestedChange = (provider, field, value) => {
    setSettings(prev => ({
      ...prev,
      emailProvider: {
        ...prev.emailProvider,
        [provider]: {
          ...prev.emailProvider?.[provider],
          [field]: value
        }
      }
    }));
  };

  const handleTestEmail = async () => {
    // Handle bulk email test separately
    if (selectedEmailTemplate === 'bulk-email-test') {
      setTestingEmail(true);
      try {
        const testEmail = settings.emailProvider?.testEmail || settings.systemEmail;
        if (!testEmail) {
          toast.error('Please set a test email address or system email');
          return;
        }

        const response = await api.post('/api/settings/email-templates/bulk-test', {
          testEmail
        });

        toast.success(response.data.message || 'Bulk email test queued successfully! 60 emails will be sent over 10 minutes (1 every 10 seconds).', 10000);
        console.log('Bulk email test response:', response.data);
      } catch (error) {
        console.error('Error queuing bulk email test:', error);
        toast.error('Error queuing bulk email test: ' + (error.response?.data?.message || error.message));
      } finally {
        setTestingEmail(false);
      }
      return;
    }

    // Regular email template test
    setTestingEmail(true);
    try {
      const testEmail = settings.emailProvider?.testEmail || settings.systemEmail;
      if (!testEmail) {
        toast.error('Please set a test email address or system email');
        return;
      }
      
      // Prepare test data based on template
      let testData = {
        userName: 'Test User',
        userEmail: testEmail
      };

      // Add template-specific test data
      if (selectedEmailTemplate === 'welcome') {
        testData.temporaryPassword = 'TempPass123!';
      } else if (selectedEmailTemplate === 'password-reset') {
        testData.resetUrl = `${window.location.origin}/reset-password?token=test-token-123`;
      } else if (selectedEmailTemplate === 'password-changed') {
        // No additional data needed for password-changed template
      }

        const response = await api.post(`/api/settings/email-templates/${selectedEmailTemplate}/test`, {
        testEmail,
        data: testData
      });
      
      if (response.data.success) {
        toast.success(response.data.message);
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.error('Error testing email:', error);
      toast.error('Error testing email: ' + (error.response?.data?.message || error.message));
    } finally {
      setTestingEmail(false);
    }
  };

  const handleColourChange = (colour) => {
    handleInputChange('primaryColor', colour);
    // Colour shades will be auto-generated on save
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Apply defaults for mailtrap if provider is mailtrap
      let settingsToSave = { ...settings };
      if (settings.emailProvider?.provider === 'mailtrap') {
        settingsToSave = {
          ...settings,
          emailProvider: {
            ...settings.emailProvider,
            mailtrap: {
              host: 'sandbox.smtp.mailtrap.io',
              port: 2525,
              secure: false,
              fromName: 'Makita EDI Portal',
              ...settings.emailProvider?.mailtrap, // User values override defaults
              // Ensure auth is preserved
              auth: settings.emailProvider?.mailtrap?.auth || {}
            }
          }
        };
      }
      const response = await api.put('/api/settings', settingsToSave);
      setSettings(response.data);
      refreshSettings();
      toast.success('Settings saved successfully!');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Error saving settings: ' + (error.response?.data?.message || error.message));
    } finally {
      setSaving(false);
    }
  };

  const handlePurgeDocuments = async () => {
    if (!purgeReason || purgeReason.trim().length === 0) {
      toast.error('Please provide a reason for purging documents');
      return;
    }

    setPurgingDocuments(true);
    try {
      const response = await api.post('/api/settings/purge-files', {
        reason: purgeReason.trim()
      });
      
      setPurgeStats(response.data);
      setShowPurgeDocumentsModal(false);
      setPurgeReason('');
      toast.success('All documents have been purged successfully');
    } catch (error) {
      console.error('Error purging documents:', error);
      toast.error('Error purging documents: ' + (error.response?.data?.message || error.message));
    } finally {
      setPurgingDocuments(false);
    }
  };

  const handlePurgeCustomers = async () => {
    if (!purgeReason || purgeReason.trim().length === 0) {
      toast.error('Please provide a reason for purging customers');
      return;
    }

    setPurgingCustomers(true);
    try {
      const response = await api.delete('/api/companies/purge-all', {
        data: { reason: purgeReason.trim() }
      });
      
      setPurgeStats({
        companiesDeleted: response.data.deleted,
        purgedAt: new Date().toISOString()
      });
      setShowPurgeCustomersModal(false);
      setPurgeReason('');
      toast.success(`Successfully purged ${response.data.deleted} companies from the system`);
    } catch (error) {
      console.error('Error purging customers:', error);
      toast.error('Error purging customers: ' + (error.response?.data?.message || error.message));
    } finally {
      setPurgingCustomers(false);
    }
  };

  // Fetch import history count
  const fetchImportHistoryCount = async () => {
    try {
      const response = await api.get('/api/settings/import-history-count');
      setImportHistoryCount(response.data.count || 0);
    } catch (error) {
      console.error('Error fetching import history count:', error);
    }
  };

  // Handle clearing import history
  const handleClearImportHistory = async () => {
    if (!clearHistoryReason || clearHistoryReason.trim().length < 5) {
      toast.error('Please provide a reason (at least 5 characters)');
      return;
    }

    setClearingImportHistory(true);
    try {
      const response = await api.post('/api/settings/clear-import-history', {
        reason: clearHistoryReason.trim()
      });
      
      setShowClearImportHistoryModal(false);
      setClearHistoryReason('');
      setImportHistoryCount(0);
      toast.success(response.data.message);
    } catch (error) {
      console.error('Error clearing import history:', error);
      toast.error('Error clearing import history: ' + (error.response?.data?.message || error.message));
    } finally {
      setClearingImportHistory(false);
    }
  };

  // Statement Generator Sandbox - admin-only, no-email .TXT test harness.
  // Backend enforces silent=true on /api/statements/generate, so even if this
  // handler somehow sent silent=false the server would override it. We still
  // pass silent=true explicitly as a defence-in-depth signal.
  const handleSandboxGenerate = async () => {
    if (!sandboxFile) {
      toast.error('Select an ACR11P .TXT (or .csv) file first.');
      return;
    }
    setSandboxRunning(true);
    setSandboxResults(null);
    setSandboxError(null);
    setSandboxStatus({ phase: 'uploading', processedFiles: 0, totalFiles: 1 });

    try {
      const formData = new FormData();
      formData.append('file', sandboxFile);
      formData.append('silent', 'true');
      if (sandboxForceOverwrite) formData.append('forceOverwrite', 'true');

      const response = await api.post('/api/statements/generate', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      const { importId, totalCustomers, validation, statementDate, isDuplicate } = response.data;
      setSandboxStatus({
        phase: 'processing',
        importId,
        processedFiles: 0,
        totalFiles: totalCustomers,
        meta: {
          statementDate,
          isDuplicate,
          parsedLines: validation?.parsedLines || 0,
          malformedLines: validation?.malformedLines || 0,
          unknownTerms: validation?.unknownTerms || 0
        }
      });

      const poll = async () => {
        try {
          const statusRes = await api.get(`/api/statements/import/${importId}`);
          const importSession = statusRes.data.import;
          if (!importSession) return;

          setSandboxStatus(prev => ({
            ...(prev || {}),
            phase: importSession.status === 'completed' ? 'fetching-results' : 'processing',
            processedFiles: importSession.processedFiles || 0,
            totalFiles: importSession.totalFiles || prev?.totalFiles || 0,
            status: importSession.status
          }));

          if (importSession.status === 'completed') {
            try {
              const resultsRes = await api.get(`/api/statements/import/${importId}/results`);
              setSandboxResults(resultsRes.data.import);
              setSandboxStatus(prev => ({ ...(prev || {}), phase: 'done' }));
            } catch (resultsErr) {
              setSandboxError(`Could not fetch results: ${resultsErr.response?.data?.message || resultsErr.message}`);
              setSandboxStatus(prev => ({ ...(prev || {}), phase: 'done' }));
            }
            setSandboxRunning(false);
            return;
          }
          if (importSession.status === 'failed' || importSession.cancelled) {
            setSandboxError('Import session reported failure / cancellation.');
            setSandboxStatus(prev => ({ ...(prev || {}), phase: 'done', status: importSession.status }));
            setSandboxRunning(false);
            return;
          }
          setTimeout(poll, 2000);
        } catch (pollErr) {
          setSandboxError(`Status poll failed: ${pollErr.response?.data?.message || pollErr.message}`);
          setSandboxRunning(false);
        }
      };
      setTimeout(poll, 1500);
    } catch (err) {
      const message = err.response?.data?.message || err.message;
      setSandboxError(message);
      setSandboxStatus(null);
      setSandboxRunning(false);
      toast.error(`Sandbox generation failed: ${message}`, 8000);
    }
  };

  const resetSandbox = () => {
    setSandboxFile(null);
    setSandboxStatus(null);
    setSandboxResults(null);
    setSandboxError(null);
    setSandboxForceOverwrite(false);
    const el = document.getElementById('statement-sandbox-file-input');
    if (el) el.value = '';
  };

  // Auth-protected file download for the sandbox results table. Same blob+anchor
  // pattern Statements.js / Invoices.js use, lifted inline because Settings.js
  // doesn't already pull it in. Hits the admin-only GET /api/files/:id/download
  // endpoint so it works for both matched (CORP) and unmatched customers.
  const downloadSandboxFile = async (fileId, suggestedName) => {
    if (!fileId) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_BASE_URL}/api/files/${fileId}/download`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Download failed' }));
        throw new Error(errorData.message || 'Download failed');
      }
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = suggestedName;
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
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 30 * 1000);
    } catch (error) {
      console.error('Sandbox download failed:', error);
      toast.error(`Download failed: ${error.message}`);
    }
  };

  // Map a sandbox result row into the right label + bootstrap badge class for
  // a single "what happened to this customer?" column. Lifted out of JSX to
  // keep the table render readable.
  const describeSandboxOutcome = (result) => {
    if (!result.success) return { label: 'failed', cls: 'bg-danger' };
    if (result.contentUnchanged) return { label: 'unchanged', cls: 'bg-secondary' };
    if (result.baselined) return { label: 'baselined', cls: 'bg-info' };
    if (!result.companyId) return { label: 'unmatched', cls: 'bg-warning' };
    if (result.isNew) return { label: 'new', cls: 'bg-success' };
    if (result.correction) return { label: 'correction', cls: 'bg-primary' };
    if (result.suppressedByAuthority) return { label: 'suppressed (manual upload)', cls: 'bg-dark' };
    return { label: 'regenerated', cls: 'bg-success' };
  };

  const handleGlobalEDIChange = async (enabled) => {
    const action = enabled ? 'enable' : 'disable';
    if (!window.confirm(`Are you sure you want to ${action} EDI for ALL companies? This will affect every company in the system.`)) {
      return;
    }

    setUpdatingGlobalEDI(true);
    try {
      const response = await api.put('/api/companies/bulk-update-all', {
        edi: enabled
      });
      
      toast.success(`EDI ${action}d for ${response.data.updated} companies`);
    } catch (error) {
      console.error('Error updating global EDI:', error);
      toast.error('Error updating EDI: ' + (error.response?.data?.message || error.message));
    } finally {
      setUpdatingGlobalEDI(false);
    }
  };

  const handleGlobalEmailNotificationsChange = async (enabled) => {
    const action = enabled ? 'enable' : 'disable';
    if (!window.confirm(`Are you sure you want to ${action} ALL email notifications for ALL companies? This will affect every company in the system.`)) {
      return;
    }

    setUpdatingGlobalEmail(true);
    try {
      const response = await api.put('/api/companies/bulk-update-all', {
        sendInvoiceEmail: enabled,
        sendInvoiceAttachment: enabled,
        sendStatementEmail: enabled,
        sendStatementPdfAttachment: enabled,
        sendStatementXlsAttachment: enabled
      });
      
      toast.success(`Email notifications ${action}d for ${response.data.updated} companies`);
    } catch (error) {
      console.error('Error updating global email notifications:', error);
      toast.error('Error updating email notifications: ' + (error.response?.data?.message || error.message));
    } finally {
      setUpdatingGlobalEmail(false);
    }
  };

  const handleFileUpload = async (type, file) => {
    if (!file) return;

    setUploading(prev => ({ ...prev, [type]: true }));
    const formData = new FormData();
    
    const fieldName = type === 'favicon' ? 'favicon' : type === 'login-background' ? 'background' : 'logo';
    formData.append(fieldName, file);

    try {
      const endpoint = `/api/settings/upload/${type}`;
      const response = await api.post(endpoint, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      // Update settings with new file path
      const fieldMap = {
        'logo-light': 'logoLight',
        'favicon': 'favicon',
        'login-background': 'loginBackgroundImage'
      };
      
      setSettings(prev => ({
        ...prev,
        [fieldMap[type]]: response.data.path
      }));
      refreshSettings(); // Re-fetch settings to ensure all contexts are updated
      toast.success(`${type} uploaded successfully!`);
    } catch (error) {
      console.error(`Error uploading ${type}:`, error);
      toast.error(`Error uploading ${type}: ` + (error.response?.data?.message || error.message));
    } finally {
      setUploading(prev => ({ ...prev, [type]: false }));
    }
  };

  const handleImageDelete = async (type) => {

    try {
      await api.delete(`/api/settings/upload/${type}`);
      const fieldMap = {
        'logo-light': 'logoLight',
        'favicon': 'favicon',
        'login-background': 'loginBackgroundImage'
      };
      setSettings(prev => ({
        ...prev,
        [fieldMap[type]]: null
      }));
      refreshSettings();
      toast.success(`${type} removed successfully!`);
    } catch (error) {
      console.error(`Error deleting ${type}:`, error);
      toast.error(`Failed to remove ${type}: ` + (error.response?.data?.message || error.message));
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    try {
      const response = await api.post('/api/ftp/test-connection');
      if (response.data.success) {
        toast.success(response.data.message);
      } else {
        // Show user-friendly error with suggestion if available
        let errorMessage = response.data.message;
        if (response.data.suggestion) {
          errorMessage += ` ${response.data.suggestion}`;
        }
        toast.error(errorMessage, 8000); // Show longer for helpful messages
      }
    } catch (error) {
      console.error('Error testing FTP connection:', error);
      const errorMessage = error.response?.data?.message || error.message;
      const suggestion = error.response?.data?.suggestion;
      
      let fullMessage = 'Error testing connection: ' + errorMessage;
      if (suggestion) {
        fullMessage += ` ${suggestion}`;
      }
      
      toast.error(fullMessage, 8000);
    } finally {
      setTestingConnection(false);
    }
  };

  const handleTestImport = async () => {
    setTestingImport(true);
    try {
      const response = await api.post('/api/ftp/test-import');
      if (response.data.success) {
        toast.success(response.data.message);
      } else {
        toast.error(response.data.message);
      }
    } catch (error) {
      console.error('Error testing FTP import:', error);
      toast.error('Error testing import: ' + (error.response?.data?.message || error.message));
    } finally {
      setTestingImport(false);
    }
  };

  const handleGetQueueStatus = async () => {
    try {
      const response = await api.get('/api/ftp/queue/status');
      setQueueStatus(response.data);
    } catch (error) {
      console.error('Error getting queue status:', error);
      toast.error('Error getting queue status: ' + (error.response?.data?.message || error.message));
    }
  };

  if (!user || user.role !== 'global_admin') {
    return (
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
    );
  }

  if (loading) {
    return <div className="loading">Loading settings...</div>;
  }

  if (!settings) {
    return <div className="empty">No settings found</div>;
  }

  return (
    <div>
      <div className="page-header d-print-none">
        <div className="container-fluid">
          <div className="row g-2 align-items-center">
            <div className="col">
              <h2 className="page-title">Account Settings</h2>
            </div>
          </div>
        </div>
      </div>

      <div className="page-body">
        <div className="container-xl">
          <div className="card">
            <div className="row g-0">
              {/* Sidebar Navigation */}
              <div className="col-12 col-md-3 border-end">
                <div className="card-body">
                  <h4 className="subheader">Global Settings</h4>
                  <div className="list-group list-group-transparent">
                    <button
                      className={`list-group-item list-group-item-action d-flex align-items-center ${activeSection === 'company' ? 'active' : ''}`}
                      onClick={() => setActiveSection('company')}
                    >
                      Company Settings
                    </button>
                    <button
                      className={`list-group-item list-group-item-action d-flex align-items-center ${activeSection === 'branding' ? 'active' : ''}`}
                      onClick={() => setActiveSection('branding')}
                    >
                      Branding
                    </button>
                    <button
                      className={`list-group-item list-group-item-action d-flex align-items-center ${activeSection === '2fa' ? 'active' : ''}`}
                      onClick={() => setActiveSection('2fa')}
                    >
                      Two-Factor Authentication
                    </button>
                    <button
                      className={`list-group-item list-group-item-action d-flex align-items-center ${activeSection === 'smtp' ? 'active' : ''}`}
                      onClick={() => setActiveSection('smtp')}
                    >
                      SMTP Settings
                    </button>
                    <button
                      className={`list-group-item list-group-item-action d-flex align-items-center ${activeSection === 'password-expiry' ? 'active' : ''}`}
                      onClick={() => setActiveSection('password-expiry')}
                    >
                      Password Expiry
                    </button>
                    <button
                      className={`list-group-item list-group-item-action d-flex align-items-center ${activeSection === 'ftp' ? 'active' : ''}`}
                      onClick={() => setActiveSection('ftp')}
                    >
                      FTP/SFTP Import
                    </button>
                    <button
                      className={`list-group-item list-group-item-action d-flex align-items-center ${activeSection === 'import-settings' ? 'active' : ''}`}
                      onClick={() => setActiveSection('import-settings')}
                    >
                      Import Settings
                    </button>
                    {user?.role === 'global_admin' && (
                      <button
                        className={`list-group-item list-group-item-action d-flex align-items-center ${activeSection === 'admin-tools' ? 'active' : ''}`}
                        onClick={() => setActiveSection('admin-tools')}
                      >
                        Admin Tools
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Main Content */}
              <div className="col-12 col-md-9 d-flex flex-column">
                <div className="card-body">
                  {activeSection === 'company' && (
                    <>
                      <h2 className="mb-4">Company Settings</h2>
                      <p className="card-subtitle mb-4">Configure your company details and system email settings.</p>
                      
                      <div className="row g-3">
                        <div className="col-md-6">
                          <label className="form-label">Site Title</label>
                          <input
                            type="text"
                            className="form-control"
                            value={settings.siteTitle || settings.siteName || ''}
                            onChange={(e) => {
                              handleInputChange('siteTitle', e.target.value);
                              // Keep siteName and companyName in sync for backward compatibility
                              handleInputChange('siteName', e.target.value);
                              handleInputChange('companyName', e.target.value);
                            }}
                            placeholder="Makita EDI Portal"
                          />
                          <small className="form-hint">The title displayed in the browser tab, emails, and throughout the application</small>
                        </div>
                        <div className="col-md-6">
                          <label className="form-label">System Email</label>
                          <input
                            type="email"
                            className="form-control"
                            value={settings.systemEmail || ''}
                            onChange={(e) => handleInputChange('systemEmail', e.target.value)}
                            placeholder="invoices@company.com"
                          />
                          <small className="form-hint">The email address used as the sender for system emails</small>
                        </div>
                      </div>
                      
                      <div className="row g-3 mt-3">
                        <div className="col-12">
                          <h3 className="mb-3">Invoice &amp; Credit Note Retention</h3>
                          <p className="text-muted mb-3">Configure automatic deletion of Invoices and Credit Notes after a retention period. Statements have their own override below.</p>
                        </div>
                        <div className="col-md-6">
                          <label className="form-label">Retention Period</label>
                          <select
                            className="form-select"
                            value={settings.documentRetentionPeriod || ''}
                            onChange={(e) => handleInputChange('documentRetentionPeriod', e.target.value === '' ? null : parseInt(e.target.value))}
                          >
                            <option value="">Disabled</option>
                            <option value="14">14 Days</option>
                            <option value="30">30 Days</option>
                            <option value="60">60 Days</option>
                            <option value="90">90 Days</option>
                          </select>
                          <small className="form-hint">Number of days to keep Invoices and Credit Notes before automatic deletion. Disabled means they are never automatically deleted.</small>
                        </div>
                        <div className="col-md-6">
                          <label className="form-label">Date Trigger</label>
                          <select
                            className="form-select"
                            value={settings.documentRetentionDateTrigger || 'upload_date'}
                            onChange={(e) => handleInputChange('documentRetentionDateTrigger', e.target.value)}
                            disabled={!settings.documentRetentionPeriod}
                          >
                            <option value="upload_date">Upload Date</option>
                            <option value="invoice_date">Invoice Date / Tax Point</option>
                          </select>
                          <small className="form-hint">
                            {settings.documentRetentionDateTrigger === 'upload_date' 
                              ? 'Retention countdown starts when document status becomes "Ready"'
                              : 'Retention countdown starts from the invoice/tax point date parsed from the document'}
                          </small>
                        </div>
                      </div>

                      <div className="row g-3 mt-3">
                        <div className="col-12">
                          <h3 className="mb-3">Statement Retention</h3>
                          <p className="text-muted mb-3">
                            Optional override for Statements. Leave fields blank to use the same policy as Invoices and Credit Notes above.
                          </p>
                        </div>
                        <div className="col-md-6">
                          <label className="form-label">Retention Period</label>
                          <select
                            className="form-select"
                            value={settings.statementRetentionPeriod ?? ''}
                            onChange={(e) => handleInputChange('statementRetentionPeriod', e.target.value === '' ? null : parseInt(e.target.value))}
                          >
                            <option value="">Use same as invoices/credit notes</option>
                            <option value="14">14 Days</option>
                            <option value="30">30 Days</option>
                            <option value="60">60 Days</option>
                            <option value="90">90 Days</option>
                          </select>
                          <small className="form-hint">
                            {settings.statementRetentionPeriod
                              ? `Statements use this override (${settings.statementRetentionPeriod} days), regardless of the invoice/credit-note setting above.`
                              : settings.documentRetentionPeriod
                                ? `Currently inheriting ${settings.documentRetentionPeriod} days from the invoice/credit-note policy above.`
                                : 'Retention is currently disabled for statements (and inherited policy is also disabled).'}
                          </small>
                        </div>
                        <div className="col-md-6">
                          <label className="form-label">Date Trigger</label>
                          <select
                            className="form-select"
                            value={settings.statementRetentionDateTrigger ?? ''}
                            onChange={(e) => handleInputChange('statementRetentionDateTrigger', e.target.value === '' ? null : e.target.value)}
                            disabled={!settings.statementRetentionPeriod && !settings.documentRetentionPeriod}
                          >
                            <option value="">Inherit (use invoice/credit-note trigger)</option>
                            <option value="upload_date">Upload Date</option>
                            <option value="invoice_date">Statement Date (Period End)</option>
                          </select>
                          <small className="form-hint">
                            {settings.statementRetentionDateTrigger
                              ? (settings.statementRetentionDateTrigger === 'upload_date'
                                  ? 'Statement countdown starts when the statement is generated/uploaded.'
                                  : 'Statement countdown starts from the statement period-end date.')
                              : `Inheriting "${settings.documentRetentionDateTrigger === 'invoice_date' ? 'Invoice Date / Tax Point' : 'Upload Date'}" from the invoice/credit-note policy.`}
                          </small>
                        </div>
                      </div>

                      <div className="row g-3 mt-3">
                        <div className="col-12">
                          <h3 className="mb-3">Activity Log Retention</h3>
                          <p className="text-muted mb-3">
                            The scheduled auto-prune keeps the last N days of activity logs
                            (login events, email sends, file operations, etc.). It no longer
                            wipes everything — only entries older than the retention window
                            are removed. Manual "clear all" from the log viewer remains
                            available.
                          </p>
                        </div>
                        <div className="col-md-4">
                          <label className="form-label">Prune schedule</label>
                          <select
                            className="form-select"
                            value={settings.activityLogPurgeSchedule || 'off'}
                            onChange={(e) => handleInputChange('activityLogPurgeSchedule', e.target.value || 'off')}
                          >
                            <option value="off">Off</option>
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                            <option value="quarterly">Every 3 months</option>
                          </select>
                          <small className="form-hint">How often the prune job runs (at midnight). Off = no automatic prune.</small>
                        </div>
                        <div className="col-md-4">
                          <label className="form-label">Retention (days)</label>
                          <input
                            type="number"
                            className="form-control"
                            min="1"
                            max="3650"
                            value={settings.activityLogRetentionDays ?? 14}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === '') {
                                handleInputChange('activityLogRetentionDays', 14);
                                return;
                              }
                              const parsed = parseInt(raw, 10);
                              if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 3650) {
                                handleInputChange('activityLogRetentionDays', parsed);
                              }
                            }}
                            disabled={(settings.activityLogPurgeSchedule || 'off') === 'off'}
                          />
                          <small className="form-hint">
                            Keep entries newer than this. Older entries are pruned when the
                            job runs. Default: 14 days.
                          </small>
                        </div>
                      </div>
                      
                      <div className="row g-3 mt-3">
                        <div className="col-12">
                          <h3 className="mb-3">Session Timeout (Inactivity)</h3>
                          <p className="text-muted mb-3">Log users out after a period of no activity (mouse, keyboard, touch). When enabled, users are logged out after the chosen idle time.</p>
                        </div>
                        <div className="col-md-6">
                          <label className="form-label">Inactivity timeout</label>
                          <div className="form-check form-switch mb-2">
                            <input
                              className="form-check-input"
                              type="checkbox"
                              id="inactivityTimeoutEnabled"
                              checked={!!(settings.inactivityTimeoutMinutes != null && settings.inactivityTimeoutMinutes > 0)}
                              onChange={(e) => handleInputChange('inactivityTimeoutMinutes', e.target.checked ? (settings.inactivityTimeoutMinutes && [15, 30, 45, 60, 120].includes(settings.inactivityTimeoutMinutes) ? settings.inactivityTimeoutMinutes : 30) : null)}
                            />
                            <label className="form-check-label" htmlFor="inactivityTimeoutEnabled">
                              Enable inactivity logout
                            </label>
                          </div>
                          {(settings.inactivityTimeoutMinutes != null && settings.inactivityTimeoutMinutes > 0) && (
                            <select
                              className="form-select mt-2"
                              value={settings.inactivityTimeoutMinutes}
                              onChange={(e) => handleInputChange('inactivityTimeoutMinutes', parseInt(e.target.value, 10))}
                            >
                              <option value={15}>15 minutes</option>
                              <option value={30}>30 minutes</option>
                              <option value={45}>45 minutes</option>
                              <option value={60}>60 minutes</option>
                              <option value={120}>120 minutes</option>
                            </select>
                          )}
                          <small className="form-hint d-block mt-2">When on, users are logged out after this many minutes with no activity. Off = no automatic logout.</small>
                        </div>
                      </div>
                      
                      <div className="row g-3 mt-3">
                        <div className="col-12">
                          <div className="card">
                            <div className="card-body">
                              <h3 className="card-title">Document Status Control</h3>
                              <div className="form-check form-switch">
                                <input
                                  className="form-check-input"
                                  type="checkbox"
                                  id="onlyExternalUsersChangeDocumentStatus"
                                  checked={settings.onlyExternalUsersChangeDocumentStatus || false}
                                  onChange={(e) => handleInputChange('onlyExternalUsersChangeDocumentStatus', e.target.checked)}
                                />
                                <label className="form-check-label" htmlFor="onlyExternalUsersChangeDocumentStatus">
                                  Only External Users Can Change Document Status
                                </label>
                              </div>
                              <small className="form-hint d-block mt-2">
                                When enabled, <strong>only external users (customers)</strong> can change document status automatically (viewed/downloaded). 
                                All internal staff activity (including Global Administrators) will not update document status automatically.
                              </small>
                              
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {activeSection === 'ftp' && (
                    <>
                      <h2 className="mb-4">FTP/SFTP Import Settings</h2>
                      <p className="card-subtitle mb-4">Configure FTP/SFTP connection for automatic invoice import.</p>
                      
                      <div className="mb-3">
                        <label className="form-check form-switch">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={settings.ftp?.enabled || false}
                            onChange={(e) => handleNestedChange('ftp', 'enabled', e.target.checked)}
                          />
                          <span className="form-check-label">Enable FTP/SFTP Import</span>
                        </label>
                      </div>

                      <div className="row g-3">
                        <div className="col-md-6">
                          <label className="form-label">Connection Type</label>
                          <select
                            className="form-select"
                            value={settings.ftp?.type || 'ftp'}
                            onChange={(e) => handleNestedChange('ftp', 'type', e.target.value)}
                            disabled={!settings.ftp?.enabled}
                          >
                            <option value="ftp">FTP</option>
                            <option value="sftp">SFTP</option>
                          </select>
                        </div>
                        <div className="col-md-6">
                          <label className="form-label">Host</label>
                          <input
                            type="text"
                            className="form-control"
                            value={settings.ftp?.host || ''}
                            onChange={(e) => handleNestedChange('ftp', 'host', e.target.value)}
                            placeholder="ftp.example.com"
                            disabled={!settings.ftp?.enabled}
                          />
                        </div>
                      </div>

                      <div className="row g-3 mt-0">
                        <div className="col-md-6">
                          <label className="form-label">Port</label>
                          <input
                            type="number"
                            className="form-control"
                            value={settings.ftp?.port || (settings.ftp?.type === 'sftp' ? 22 : 21)}
                            onChange={(e) => handleNestedChange('ftp', 'port', parseInt(e.target.value) || (settings.ftp?.type === 'sftp' ? 22 : 21))}
                            placeholder={settings.ftp?.type === 'sftp' ? '22' : '21'}
                            disabled={!settings.ftp?.enabled}
                          />
                        </div>
                        <div className="col-md-6">
                          <label className="form-label">Directory</label>
                          <input
                            type="text"
                            className="form-control"
                            value={settings.ftp?.directory || '/'}
                            onChange={(e) => handleNestedChange('ftp', 'directory', e.target.value)}
                            placeholder="/invoices"
                            disabled={!settings.ftp?.enabled}
                          />
                        </div>
                      </div>

                      <div className="row g-3 mt-0">
                        <div className="col-md-6">
                          <label className="form-label">Username</label>
                          <input
                            type="text"
                            className="form-control"
                            value={settings.ftp?.username || ''}
                            onChange={(e) => handleNestedChange('ftp', 'username', e.target.value)}
                            placeholder="ftpuser"
                            disabled={!settings.ftp?.enabled}
                          />
                        </div>
                        <div className="col-md-6">
                          <label className="form-label">Password</label>
                          <input
                            type="password"
                            className="form-control"
                            value={settings.ftp?.password || ''}
                            onChange={(e) => handleNestedChange('ftp', 'password', e.target.value)}
                            placeholder="••••••••"
                            autoComplete="new-password"
                            disabled={!settings.ftp?.enabled}
                          />
                        </div>
                      </div>

                      {settings.ftp?.type === 'ftp' && (
                        <div className="row g-3 mt-0">
                          <div className="col-md-6">
                            <label className="form-check form-switch mt-3">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                checked={settings.ftp?.secure || false}
                                onChange={(e) => handleNestedChange('ftp', 'secure', e.target.checked)}
                                disabled={!settings.ftp?.enabled}
                              />
                              <span className="form-check-label">Use FTPS (FTP over TLS)</span>
                            </label>
                            {settings.ftp?.secure && (
                              <label className="form-check form-switch mt-2 ms-3">
                                <input
                                  className="form-check-input"
                                  type="checkbox"
                                  checked={settings.ftp?.allowSelfSignedCert || false}
                                  onChange={(e) => handleNestedChange('ftp', 'allowSelfSignedCert', e.target.checked)}
                                  disabled={!settings.ftp?.enabled}
                                />
                                <span className="form-check-label text-warning">
                                  Allow self-signed certificate <small>(reduces security)</small>
                                </span>
                              </label>
                            )}
                          </div>
                          <div className="col-md-6">
                            <label className="form-check form-switch mt-3">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                checked={settings.ftp?.passive !== false}
                                onChange={(e) => handleNestedChange('ftp', 'passive', e.target.checked)}
                                disabled={!settings.ftp?.enabled}
                              />
                              <span className="form-check-label">Passive Mode</span>
                            </label>
                          </div>
                        </div>
                      )}

                      <div className="row g-3 mt-2">
                        <div className="col-md-12">
                          <label className="form-label">Test File Name</label>
                          <input
                            type="text"
                            className="form-control"
                            value={settings.ftp?.testFileName || ''}
                            onChange={(e) => handleNestedChange('ftp', 'testFileName', e.target.value)}
                            placeholder="test-invoice.pdf"
                            disabled={!settings.ftp?.enabled}
                          />
                          <small className="form-hint">Name of a test PDF file to use for test import. Upload this file to your FTP server first.</small>
                        </div>
                      </div>

                      <div className="row g-3 mt-4">
                        <div className="col-md-12">
                          <div className="btn-list">
                            <button
                              className="btn btn-outline-primary"
                              onClick={handleTestConnection}
                              disabled={!settings.ftp?.enabled || testingConnection}
                            >
                              {testingConnection ? 'Testing...' : 'Test Connection'}
                            </button>
                            <button
                              className="btn btn-outline-success"
                              onClick={handleTestImport}
                              disabled={!settings.ftp?.enabled || testingImport || !settings.ftp?.testFileName}
                            >
                              {testingImport ? 'Testing Import...' : 'Test Import'}
                            </button>
                            <button
                              className="btn btn-outline-info"
                              onClick={handleGetQueueStatus}
                              disabled={!settings.ftp?.enabled}
                            >
                              Queue Status
                            </button>
                          </div>
                        </div>
                      </div>

                      {queueStatus && (
                        <div className="row g-3 mt-3">
                          <div className="col-md-12">
                            <div className="card">
                              <div className="card-body">
                                <h4 className="card-title">Queue Status</h4>
                                <div className="row">
                                  <div className="col-md-3">
                                    <div className="text-muted">Waiting</div>
                                    <div className="h3">{queueStatus.waiting}</div>
                                  </div>
                                  <div className="col-md-3">
                                    <div className="text-muted">Active</div>
                                    <div className="h3">{queueStatus.active}</div>
                                  </div>
                                  <div className="col-md-3">
                                    <div className="text-muted">Completed</div>
                                    <div className="h3">{queueStatus.completed}</div>
                                  </div>
                                  <div className="col-md-3">
                                    <div className="text-muted">Failed</div>
                                    <div className="h3">{queueStatus.failed}</div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {activeSection === 'import-settings' && (
                    <>
                      <h2 className="mb-4">Import Settings</h2>
                      <p className="card-subtitle mb-4">Configure the automated import scheduler and view import logs.</p>
                      
                      {loadingImportSettings ? (
                        <div className="text-center py-4">
                          <div className="spinner-border text-primary" role="status">
                            <span className="visually-hidden">Loading...</span>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Scheduler Configuration */}
                          <div className="card mb-4">
                            <div className="card-header">
                              <h3 className="card-title mb-0">Scheduler Configuration</h3>
                            </div>
                            <div className="card-body">
                              <div className="row g-3">
                                <div className="col-md-6">
                                  <label className="form-label">Import Frequency</label>
                                  <select
                                    className="form-select"
                                    value={importSettings?.frequency || 60}
                                    onChange={(e) => handleSaveImportSettings({ frequency: parseInt(e.target.value) })}
                                    disabled={savingImportSettings}
                                  >
                                    {importSettings?.validFrequencies?.map(freq => (
                                      <option key={freq.value} value={freq.value}>{freq.label}</option>
                                    )) || (
                                      <>
                                        <option value={15}>15 minutes</option>
                                        <option value={30}>30 minutes</option>
                                        <option value={60}>1 hour</option>
                                        <option value={120}>2 hours</option>
                                        <option value={240}>4 hours</option>
                                        <option value={360}>6 hours</option>
                                        <option value={720}>12 hours</option>
                                        <option value={1440}>24 hours</option>
                                      </>
                                    )}
                                  </select>
                                </div>
                                <div className="col-md-6">
                                  <label className="form-label">Status</label>
                                  <div className="form-check form-switch mt-2">
                                    <input
                                      className="form-check-input"
                                      type="checkbox"
                                      checked={importSettings?.enabled !== false}
                                      onChange={(e) => handleSaveImportSettings({ enabled: e.target.checked })}
                                      disabled={savingImportSettings}
                                    />
                                    <span className="form-check-label">
                                      {importSettings?.enabled !== false ? 'Enabled' : 'Disabled'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              
                              <div className="row g-3 mt-3">
                                <div className="col-md-6">
                                  <div className="d-flex align-items-center">
                                    <span className="text-muted me-2">Next scheduled run:</span>
                                    <strong>
                                      {importSettings?.nextScheduledRun 
                                        ? new Date(importSettings.nextScheduledRun).toLocaleString()
                                        : 'Not scheduled'}
                                    </strong>
                                  </div>
                                </div>
                                <div className="col-md-6">
                                  <div className="d-flex gap-2">
                                    <button
                                      className="btn btn-primary"
                                      onClick={handleTriggerImport}
                                      disabled={triggeringImport || retryingFailed}
                                    >
                                      {triggeringImport ? (
                                        <>
                                          <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                                          Running...
                                        </>
                                      ) : (
                                        'Run Import Now'
                                      )}
                                    </button>
                                    <button
                                      className="btn btn-warning"
                                      onClick={handleRetryFailed}
                                      disabled={retryingFailed || triggeringImport || failedCount === 0}
                                      title={failedCount > 0 ? `${failedCount} failed file(s) available for retry` : 'No failed files to retry'}
                                    >
                                      {retryingFailed ? (
                                        <>
                                          <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                                          Retrying...
                                        </>
                                      ) : (
                                        <>
                                          Retry Failed
                                          {failedCount > 0 && <span className="badge bg-dark ms-2">{failedCount}</span>}
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Terminal-Style Log Viewer */}
                          <div className="card">
                            <div className="card-header d-flex justify-content-between align-items-center">
                              <h3 className="card-title mb-0">Import Logs</h3>
                              <div className="btn-list">
                                <button
                                  className="btn btn-sm btn-outline-secondary"
                                  onClick={fetchImportLogs}
                                  disabled={loadingImportLogs}
                                >
                                  {loadingImportLogs ? (
                                    <span className="spinner-border spinner-border-sm" role="status"></span>
                                  ) : (
                                    'Refresh'
                                  )}
                                </button>
                                <button
                                  className="btn btn-sm btn-outline-danger"
                                  onClick={handleClearImportLogs}
                                >
                                  Clear Logs
                                </button>
                              </div>
                            </div>
                            <div 
                              className="card-body p-0"
                              style={{
                                backgroundColor: '#1a1a2e',
                                fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                                fontSize: '13px',
                                maxHeight: '400px',
                                overflowY: 'auto'
                              }}
                            >
                              {importLogs.length === 0 ? (
                                <div className="p-3 text-center" style={{ color: '#6c757d' }}>
                                  No import logs available. Logs will appear here when imports run.
                                </div>
                              ) : (
                                <div className="p-2">
                                  {importLogs.map((log, index) => {
                                    const color = log.level === 'success' ? '#00ff88' :
                                                  log.level === 'error' ? '#ff4444' :
                                                  log.level === 'warning' ? '#ffaa00' :
                                                  log.level === 'debug' ? '#888888' : '#ffffff';
                                    const icon = log.level === 'success' ? '✓' :
                                                 log.level === 'error' ? '✗' :
                                                 log.level === 'warning' ? '⚠' :
                                                 log.level === 'debug' ? '…' : '›';
                                    return (
                                      <div 
                                        key={log.id || index} 
                                        style={{ 
                                          color, 
                                          padding: '2px 8px',
                                          borderBottom: '1px solid #2a2a4e'
                                        }}
                                      >
                                        <span style={{ color: '#666', marginRight: '8px' }}>
                                          {(() => {
                                            const logDate = new Date(log.timestamp);
                                            const now = new Date();
                                            const isToday = logDate.toDateString() === now.toDateString();
                                            const isYesterday = logDate.toDateString() === new Date(now.getTime() - 24*60*60*1000).toDateString();
                                            
                                            if (isToday) {
                                              return logDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                                            } else if (isYesterday) {
                                              return `Yesterday ${logDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
                                            } else {
                                              return logDate.toLocaleString('en-GB', { 
                                                day: '2-digit', 
                                                month: '2-digit', 
                                                year: 'numeric',
                                                hour: '2-digit', 
                                                minute: '2-digit', 
                                                second: '2-digit'
                                              });
                                            }
                                          })()}
                                        </span>
                                        <span style={{ marginRight: '8px' }}>{icon}</span>
                                        {log.message}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            <div className="card-footer" style={{ backgroundColor: '#1a1a2e', borderTop: '1px solid #2a2a4e' }}>
                              <small style={{ color: '#666' }}>
                                Auto-refreshes every 30 seconds • Showing last {importLogs.length} entries
                              </small>
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}

                  {activeSection === 'admin-tools' && (
                    <>
                      <h2 className="mb-4">Admin Tools</h2>
                      <p className="card-subtitle mb-4">Administrative tools for system maintenance. These actions cannot be undone.</p>
                      
                      {/* Global Settings Section */}
                      <h4 className="mb-3">Global Company Settings</h4>
                      <p className="text-muted mb-3">These settings affect ALL companies in the system at once.</p>
                      
                      {/* Global EDI Toggle */}
                      <div className="card mb-3">
                        <div className="card-header">
                          <h3 className="card-title">Global EDI Control</h3>
                        </div>
                        <div className="card-body">
                          <p className="text-muted mb-3">
                            Enable or disable EDI for all companies in the system. This is useful for quickly toggling EDI functionality across the entire platform.
                          </p>
                          <div className="btn-group">
                            <button
                              className="btn btn-success"
                              onClick={() => handleGlobalEDIChange(true)}
                              disabled={updatingGlobalEDI || updatingGlobalEmail}
                            >
                              {updatingGlobalEDI ? (
                                <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                              ) : null}
                              Enable EDI Globally
                            </button>
                            <button
                              className="btn btn-warning"
                              onClick={() => handleGlobalEDIChange(false)}
                              disabled={updatingGlobalEDI || updatingGlobalEmail}
                            >
                              {updatingGlobalEDI ? (
                                <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                              ) : null}
                              Disable EDI Globally
                            </button>
                          </div>
                        </div>
                      </div>
                      
                      {/* Global Email Notifications Toggle */}
                      <div className="card mb-3">
                        <div className="card-header">
                          <h3 className="card-title">Global Email Notifications Control</h3>
                        </div>
                        <div className="card-body">
                          <p className="text-muted mb-3">
                            Enable or disable all email notifications for all companies in the system. This affects:
                          </p>
                          <ul className="mb-3">
                            <li>Invoice Email Notifications</li>
                            <li>Invoice Email Attachments</li>
                            <li>Statement Email Notifications</li>
                            <li>Statement Email Attachments</li>
                          </ul>
                          <div className="btn-group">
                            <button
                              className="btn btn-success"
                              onClick={() => handleGlobalEmailNotificationsChange(true)}
                              disabled={updatingGlobalEDI || updatingGlobalEmail}
                            >
                              {updatingGlobalEmail ? (
                                <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                              ) : null}
                              Enable All Email Notifications
                            </button>
                            <button
                              className="btn btn-warning"
                              onClick={() => handleGlobalEmailNotificationsChange(false)}
                              disabled={updatingGlobalEDI || updatingGlobalEmail}
                            >
                              {updatingGlobalEmail ? (
                                <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                              ) : null}
                              Disable All Email Notifications
                            </button>
                          </div>
                        </div>
                      </div>
                      
                      <hr className="my-4" />

                      {/* Testing & Diagnostics */}
                      <h4 className="mb-3">Testing &amp; Diagnostics</h4>
                      <p className="text-muted mb-3">Admin-only tools for validating internal pipelines. None of these tools send customer emails.</p>

                      {/* Statement Generator Sandbox */}
                      <div className="card mb-3">
                        <div className="card-header">
                          <h3 className="card-title">Statement Generator Sandbox</h3>
                        </div>
                        <div className="card-body">
                          <div className="alert alert-info mb-3">
                            <strong>Sandbox / test only.</strong> Upload an ACR11P export (.TXT or .csv) to check that it parses cleanly and that PDF + Excel statements render correctly per customer. Generated files are stored against matched companies for inspection, but <strong>no customer emails are sent</strong> from this tool. The production path (FTP / scheduled import of .TXT) will fire notifications normally once we wire it up.
                          </div>

                          <div className="row g-3 align-items-end mb-3">
                            <div className="col-md-7">
                              <label className="form-label" htmlFor="statement-sandbox-file-input">ACR11P export file</label>
                              <input
                                id="statement-sandbox-file-input"
                                type="file"
                                className="form-control"
                                accept=".txt,.csv"
                                onChange={(e) => setSandboxFile((e.target.files || [])[0] || null)}
                                disabled={sandboxRunning}
                              />
                              <small className="form-hint">Tab-delimited ACR11P export. One file at a time.</small>
                            </div>
                            <div className="col-md-5">
                              <div className="form-check mb-2">
                                <input
                                  id="statement-sandbox-force-overwrite"
                                  className="form-check-input"
                                  type="checkbox"
                                  checked={sandboxForceOverwrite}
                                  onChange={(e) => setSandboxForceOverwrite(e.target.checked)}
                                  disabled={sandboxRunning}
                                />
                                <label className="form-check-label" htmlFor="statement-sandbox-force-overwrite">
                                  Force overwrite existing statements
                                </label>
                                <div className="form-hint small">Bypasses content-hash short-circuit so every customer regenerates, useful when re-testing the same export.</div>
                              </div>
                            </div>
                          </div>

                          <div className="d-flex gap-2">
                            <button
                              className="btn btn-primary"
                              onClick={handleSandboxGenerate}
                              disabled={!sandboxFile || sandboxRunning}
                            >
                              {sandboxRunning ? (
                                <>
                                  <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                                  Running sandbox…
                                </>
                              ) : (
                                <>
                                  <i className="fas fa-flask me-2"></i>
                                  Run Sandbox (no emails)
                                </>
                              )}
                            </button>
                            <button
                              className="btn btn-outline-secondary"
                              onClick={resetSandbox}
                              disabled={sandboxRunning}
                            >
                              Reset
                            </button>
                          </div>

                          {sandboxError && (
                            <div className="alert alert-danger mt-3 mb-0">
                              <strong>Error:</strong> {sandboxError}
                            </div>
                          )}

                          {sandboxStatus && sandboxStatus.phase !== 'done' && (
                            <div className="mt-3">
                              <div className="d-flex justify-content-between mb-1">
                                <span className="small">
                                  {sandboxStatus.phase === 'uploading' && 'Uploading and parsing…'}
                                  {sandboxStatus.phase === 'processing' && `Processing ${sandboxStatus.processedFiles} of ${sandboxStatus.totalFiles} customers…`}
                                  {sandboxStatus.phase === 'fetching-results' && 'Fetching results…'}
                                </span>
                                {sandboxStatus.totalFiles > 0 && (
                                  <span className="small text-muted">
                                    {Math.round(((sandboxStatus.processedFiles || 0) / sandboxStatus.totalFiles) * 100)}%
                                  </span>
                                )}
                              </div>
                              {sandboxStatus.totalFiles > 0 && (
                                <div className="progress" style={{ height: '8px' }}>
                                  <div
                                    className="progress-bar progress-bar-striped progress-bar-animated"
                                    role="progressbar"
                                    style={{ width: `${((sandboxStatus.processedFiles || 0) / sandboxStatus.totalFiles) * 100}%` }}
                                  />
                                </div>
                              )}
                              {sandboxStatus.meta && (
                                <div className="text-muted small mt-2">
                                  Statement date: <strong>{sandboxStatus.meta.statementDate || 'unknown'}</strong>
                                  {' · '}Parsed: <strong>{sandboxStatus.meta.parsedLines}</strong>
                                  {' · '}Malformed: <strong>{sandboxStatus.meta.malformedLines}</strong>
                                  {sandboxStatus.meta.unknownTerms > 0 && <> {' · '}Unknown terms: <strong>{sandboxStatus.meta.unknownTerms}</strong></>}
                                </div>
                              )}
                            </div>
                          )}

                          {sandboxResults && (() => {
                            const results = sandboxResults.results || [];
                            const successCount = results.filter(r => r.success).length;
                            const failedCount = results.filter(r => !r.success).length;
                            const unmatchedCount = results.filter(r => r.success && !r.companyId).length;
                            const unchangedCount = results.filter(r => r.contentUnchanged).length;
                            const baselinedCount = results.filter(r => r.baselined).length;
                            const sortedResults = [...results].sort((a, b) => {
                              const aNum = parseInt(a.accountNumber, 10);
                              const bNum = parseInt(b.accountNumber, 10);
                              if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
                              return String(a.accountNumber || '').localeCompare(String(b.accountNumber || ''));
                            });
                            return (
                              <div className="mt-3">
                                <h4 className="mb-2">Results</h4>
                                <div className="row g-2 mb-3">
                                  <div className="col-md-2">
                                    <div className="card card-sm bg-success-subtle">
                                      <div className="card-body text-center py-2">
                                        <div className="h4 mb-0 text-success">{successCount}</div>
                                        <div className="text-muted small">OK</div>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="col-md-2">
                                    <div className="card card-sm bg-warning-subtle">
                                      <div className="card-body text-center py-2">
                                        <div className="h4 mb-0 text-warning">{unmatchedCount}</div>
                                        <div className="text-muted small">Unmatched</div>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="col-md-2">
                                    <div className="card card-sm bg-danger-subtle">
                                      <div className="card-body text-center py-2">
                                        <div className="h4 mb-0 text-danger">{failedCount}</div>
                                        <div className="text-muted small">Failed</div>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="col-md-2">
                                    <div className="card card-sm bg-secondary-subtle">
                                      <div className="card-body text-center py-2">
                                        <div className="h4 mb-0 text-secondary">{unchangedCount}</div>
                                        <div className="text-muted small">Unchanged</div>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="col-md-2">
                                    <div className="card card-sm bg-info-subtle">
                                      <div className="card-body text-center py-2">
                                        <div className="h4 mb-0 text-info">{baselinedCount}</div>
                                        <div className="text-muted small">Baselined</div>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="col-md-2">
                                    <div className="card card-sm">
                                      <div className="card-body text-center py-2">
                                        <div className="h4 mb-0">{results.length}</div>
                                        <div className="text-muted small">Total</div>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                <div className="alert alert-success mb-3">
                                  <i className="fas fa-shield-alt me-2"></i>
                                  <strong>No customer emails were sent.</strong> Generated files are stored against matched companies and listed below for inspection.
                                </div>

                                <div className="table-responsive" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                                  <table className="table table-sm table-vcenter">
                                    <thead className="sticky-top bg-white">
                                      <tr>
                                        <th>Cust #</th>
                                        <th>Customer</th>
                                        <th className="text-end">Pages</th>
                                        <th>Outcome</th>
                                        <th>Company match</th>
                                        <th className="text-end">Time</th>
                                        <th className="text-center" style={{ minWidth: '140px' }}>Files</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {sortedResults.map((r, idx) => {
                                        const outcome = describeSandboxOutcome(r);
                                        const pdfName = `${r.accountNumber}_Statement.pdf`;
                                        const xlsxName = `${r.accountNumber}_Statement.xlsx`;
                                        const hasFreshFiles = r.success && r.fileId && r.xlsFileId;
                                        return (
                                          <tr key={`${r.accountNumber}-${idx}`}>
                                            <td><code>{r.accountNumber}</code></td>
                                            <td className="text-truncate" style={{ maxWidth: '220px' }} title={r.customerName || ''}>
                                              {r.customerName || <span className="text-muted">—</span>}
                                            </td>
                                            <td className="text-end">{r.pages ?? '—'}</td>
                                            <td><span className={`badge ${outcome.cls}`}>{outcome.label}</span></td>
                                            <td className="text-truncate" style={{ maxWidth: '180px' }} title={r.companyName || ''}>
                                              {r.companyName || (r.success ? <span className="text-muted small">{r.specificFailureReason || 'unmatched'}</span> : <span className="text-danger small">—</span>)}
                                            </td>
                                            <td className="text-end text-muted small">
                                              {Number.isFinite(r.processingTime) ? `${(r.processingTime / 1000).toFixed(1)}s` : '—'}
                                            </td>
                                            <td className="text-center">
                                              {hasFreshFiles ? (
                                                <div className="btn-group btn-group-sm" role="group">
                                                  <button
                                                    type="button"
                                                    className="btn btn-outline-primary btn-sm"
                                                    onClick={() => downloadSandboxFile(r.fileId, pdfName)}
                                                    title="Download generated PDF"
                                                  >
                                                    PDF
                                                  </button>
                                                  <button
                                                    type="button"
                                                    className="btn btn-outline-success btn-sm"
                                                    onClick={() => downloadSandboxFile(r.xlsFileId, xlsxName)}
                                                    title="Download generated XLSX"
                                                  >
                                                    XLSX
                                                  </button>
                                                </div>
                                              ) : !r.success ? (
                                                <span className="text-danger small" title={r.error || ''}>error</span>
                                              ) : (r.contentUnchanged || r.baselined) ? (
                                                <span className="text-muted small" title="No new files were generated for this customer">no new files</span>
                                              ) : (
                                                <span className="text-muted small">—</span>
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>

                                {failedCount > 0 && (
                                  <div className="alert alert-warning mt-3 mb-0">
                                    <strong>{failedCount} customer(s) failed.</strong>{' '}
                                    Hover the error indicator above for the message, or check{' '}
                                    <code>pm2 logs invoice-portal-queue-worker</code> for the full stack.
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </div>

                      <hr className="my-4" />

                      {/* Danger Zone */}
                      <h4 className="mb-3 text-danger">Danger Zone</h4>
                      <div className="alert alert-danger">
                        <i className="fas fa-exclamation-triangle me-2"></i>
                        <strong>Warning:</strong> These tools will permanently delete data from the system. Use with extreme caution. All actions are logged and cannot be undone.
                      </div>
                      
                      {/* Purge All Documents */}
                      <div className="card mb-3">
                        <div className="card-header">
                          <h3 className="card-title">Purge All Documents</h3>
                        </div>
                        <div className="card-body">
                          <p className="text-muted mb-3">
                            This will permanently delete:
                          </p>
                          <ul className="mb-3">
                            <li>All invoices and their PDF files</li>
                            <li>All credit notes and their PDF files</li>
                            <li>All statements and their PDF files</li>
                            <li>All associated database records</li>
                          </ul>
                          <button
                            className="btn btn-danger"
                            onClick={() => setShowPurgeDocumentsModal(true)}
                            disabled={purgingDocuments || purgingCustomers}
                          >
                            <i className="fas fa-trash me-2"></i>
                            Purge All Documents
                          </button>
                        </div>
                      </div>
                      
                      {/* Purge All Customers */}
                      <div className="card mb-3">
                        <div className="card-header">
                          <h3 className="card-title">Purge All Customers</h3>
                        </div>
                        <div className="card-body">
                          <p className="text-muted mb-3">
                            This will permanently delete:
                          </p>
                          <ul className="mb-3">
                            <li>All companies (Corporate, Subsidiary, Branch)</li>
                            <li>All company relationships and hierarchy</li>
                            <li>All associated database records</li>
                          </ul>
                          <button
                            className="btn btn-danger"
                            onClick={() => setShowPurgeCustomersModal(true)}
                            disabled={purgingDocuments || purgingCustomers}
                          >
                            <i className="fas fa-trash me-2"></i>
                            Purge All Customers
                          </button>
                        </div>
                      </div>
                      
                      {/* Clear Import History */}
                      <div className="card mb-3">
                        <div className="card-header d-flex justify-content-between align-items-center">
                          <h3 className="card-title mb-0">Clear Import History</h3>
                          <button 
                            className="btn btn-sm btn-outline-secondary"
                            onClick={fetchImportHistoryCount}
                            title="Refresh count"
                          >
                            <i className="fas fa-sync-alt"></i>
                          </button>
                        </div>
                        <div className="card-body">
                          <p className="text-muted mb-3">
                            This will delete all file hash records from the import history, allowing you to re-import files that were previously imported.
                          </p>
                          <div className="alert alert-info mb-3">
                            <strong>Current file records:</strong> {importHistoryCount.toLocaleString()}
                            <br />
                            <small>These records track which files have been imported to prevent duplicates. Clearing them allows re-importing the same files.</small>
                          </div>
                          <button
                            className="btn btn-warning"
                            onClick={() => setShowClearImportHistoryModal(true)}
                            disabled={clearingImportHistory || importHistoryCount === 0}
                          >
                            <i className="fas fa-eraser me-2"></i>
                            Clear Import History
                          </button>
                        </div>
                      </div>
                      
                      {purgeStats && (
                        <div className="card">
                          <div className="card-header">
                            <h3 className="card-title">Last Purge Results</h3>
                          </div>
                          <div className="card-body">
                            <div className="row">
                              {purgeStats.invoicesDeleted !== undefined && (
                                <>
                                  <div className="col-md-4">
                                    <div className="mb-3">
                                      <strong>Invoices Deleted:</strong> {purgeStats.invoicesDeleted || 0}
                                    </div>
                                  </div>
                                  <div className="col-md-4">
                                    <div className="mb-3">
                                      <strong>Credit Notes Deleted:</strong> {purgeStats.creditNotesDeleted || 0}
                                    </div>
                                  </div>
                                  <div className="col-md-4">
                                    <div className="mb-3">
                                      <strong>Statements Deleted:</strong> {purgeStats.statementsDeleted || 0}
                                    </div>
                                  </div>
                                  <div className="col-md-12">
                                    <div className="mb-3">
                                      <strong>Files Deleted:</strong> {purgeStats.filesDeleted || 0}
                                    </div>
                                  </div>
                                </>
                              )}
                              {purgeStats.companiesDeleted !== undefined && (
                                <div className="col-md-12">
                                  <div className="mb-3">
                                    <strong>Companies Deleted:</strong> {purgeStats.companiesDeleted || 0}
                                  </div>
                                </div>
                              )}
                              <div className="col-md-12">
                                <div className="mb-3">
                                  <strong>Purged At:</strong> {purgeStats.purgedAt ? new Date(purgeStats.purgedAt).toLocaleString() : '-'}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {activeSection === 'branding' && (
                    <>
                      <h2 className="mb-4">Branding</h2>
                      
                      <h3 className="card-title">Colours</h3>
                      <div className="row g-3">
                        <div className="col-md-6">
                          <label className="form-label">Primary Colour</label>
                          <div className="input-group">
                            <input
                              type="color"
                              className="form-control form-control-color"
                              value={settings.primaryColor || '#066fd1'}
                              onChange={(e) => handleColourChange(e.target.value)}
                            />
                            <input
                              type="text"
                              className="form-control"
                              value={settings.primaryColor || '#066fd1'}
                              onChange={(e) => handleColourChange(e.target.value)}
                              placeholder="#066fd1"
                            />
                          </div>
                          {settings.primaryColorShades && (
                            <div className="mt-2">
                              <small className="text-muted">Shades: </small>
                              <span className="badge bg-light-lt" style={{ backgroundColor: settings.primaryColorShades.light }}>Light</span>
                              <span className="badge bg-light-lt" style={{ backgroundColor: settings.primaryColorShades.lighter }}>Lighter</span>
                              <span className="badge bg-light-lt" style={{ backgroundColor: settings.primaryColorShades.dark }}>Dark</span>
                              <span className="badge bg-light-lt" style={{ backgroundColor: settings.primaryColorShades.darker }}>Darker</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <h3 className="card-title mt-4">Logos</h3>
                      <div className="row g-3">
                        <div className="col-md-6">
                          <label className="form-label">Light Logo</label>
                          <input
                            type="file"
                            className="form-control"
                            accept="image/*"
                            onChange={(e) => handleFileUpload('logo-light', e.target.files[0])}
                            disabled={uploading['logo-light']}
                          />
                          {settings.logoLight && (
                            <div className="mt-2">
                              <img src={`${API_BASE_URL}${settings.logoLight}`} alt="Light logo" style={{ maxHeight: '50px', display: 'block', marginBottom: '0.5rem' }} />
                              <button
                                type="button"
                                className="btn btn-ghost-danger btn-sm"
                                onClick={() => handleImageDelete('logo-light')}
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <h3 className="card-title mt-4">Favicon</h3>
                      <div className="row g-3">
                        <div className="col-md-6">
                          <label className="form-label">Favicon</label>
                          <input
                            type="file"
                            className="form-control"
                            accept="image/*"
                            onChange={(e) => handleFileUpload('favicon', e.target.files[0])}
                            disabled={uploading.favicon}
                          />
                          <small className="form-hint">Will be automatically resized to 24x24px</small>
                          {settings.favicon && (
                            <div className="mt-2">
                              <img src={`${API_BASE_URL}${settings.favicon}`} alt="Favicon" style={{ width: '24px', height: '24px', display: 'block', marginBottom: '0.5rem' }} />
                              <span className="d-block text-muted mb-2">24x24px</span>
                              <button
                                type="button"
                                className="btn btn-ghost-danger btn-sm"
                                onClick={() => handleImageDelete('favicon')}
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="col-md-6">
                          <label className="form-label">Login Background Image</label>
                          <input
                            type="file"
                            className="form-control"
                            accept="image/*"
                            onChange={(e) => handleFileUpload('login-background', e.target.files[0])}
                            disabled={uploading['login-background']}
                          />
                          {settings.loginBackgroundImage && (
                            <div className="mt-2">
                              <img src={`${API_BASE_URL}${settings.loginBackgroundImage}`} alt="Background" style={{ maxHeight: '100px', width: 'auto', display: 'block', marginBottom: '0.5rem' }} />
                              <button
                                type="button"
                                className="btn btn-ghost-danger btn-sm"
                                onClick={() => handleImageDelete('login-background')}
                              >
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {activeSection === '2fa' && (
                    <>
                      <h2 className="mb-4">Two-Factor Authentication</h2>
                      <h3 className="card-title">2FA Settings</h3>
                      <p className="card-subtitle">Configure two-factor authentication for your application.</p>
                      <div className="mb-3">
                        <label className="form-check form-switch">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={settings.twoFactorAuth?.enabled || false}
                            onChange={(e) => handleNestedChange('twoFactorAuth', 'enabled', e.target.checked)}
                          />
                          <span className="form-check-label">Enable Two-Factor Authentication</span>
                        </label>
                      </div>
                      <div className="mb-3">
                        <label className="form-check form-switch">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={settings.twoFactorAuth?.required || false}
                            onChange={(e) => handleNestedChange('twoFactorAuth', 'required', e.target.checked)}
                            disabled={!settings.twoFactorAuth?.enabled}
                          />
                          <span className="form-check-label">Require 2FA for all users</span>
                        </label>
                      </div>
                      <div className="mb-3">
                        <label className="form-label">Issuer Name</label>
                        <input
                          type="text"
                          className="form-control"
                          value={settings.twoFactorAuth?.issuer || 'Makita EDI Portal'}
                          onChange={(e) => handleNestedChange('twoFactorAuth', 'issuer', e.target.value)}
                          placeholder="Makita EDI Portal"
                        />
                        <small className="form-hint">This name will appear in authenticator apps</small>
                      </div>
                    </>
                  )}

                  {activeSection === 'password-expiry' && (
                    <>
                      <h2 className="mb-4">Password Expiry</h2>
                      <h3 className="card-title">Password Expiry Settings</h3>
                      <p className="card-subtitle">Configure how long passwords remain valid before users must change them.</p>
                      <div className="mb-3">
                        <label className="form-label">Password Expiry Period</label>
                        <select
                          className="form-select"
                          value={settings.passwordExpiryDays === null || settings.passwordExpiryDays === undefined ? '' : settings.passwordExpiryDays}
                          onChange={(e) => handleInputChange('passwordExpiryDays', e.target.value === '' ? null : parseInt(e.target.value))}
                        >
                          <option value="">No Expiry (Disabled)</option>
                          <option value="14">14 Days</option>
                          <option value="30">30 Days</option>
                          <option value="60">60 Days</option>
                          <option value="90">90 Days</option>
                        </select>
                        <small className="form-hint">
                          {settings.passwordExpiryDays && settings.passwordExpiryDays > 0
                            ? `Passwords will expire after ${settings.passwordExpiryDays} days. Users will be required to change their password when it expires.`
                            : 'Password expiry is disabled. Users can keep their passwords indefinitely.'}
                        </small>
                      </div>
                    </>
                  )}

                  {activeSection === 'smtp' && (
                    <>
                      <h2 className="mb-4">Email Provider Settings</h2>
                      <h3 className="card-title">Email Configuration</h3>
                      <p className="card-subtitle">Configure email provider for sending emails. Choose from SMTP, Office 365, Resend, or SMTP2Go.</p>
                      
                      <div className="mb-3">
                        <label className="form-check form-switch">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={settings.emailProvider?.enabled || false}
                            onChange={(e) => handleNestedChange('emailProvider', 'enabled', e.target.checked)}
                          />
                          <span className="form-check-label">Enable Email Provider</span>
                        </label>
                      </div>

                      <div className="mb-3">
                        <label className="form-label">Email Provider</label>
                        <select
                          className="form-select"
                          value={settings.emailProvider?.provider || 'smtp'}
                          onChange={(e) => handleNestedChange('emailProvider', 'provider', e.target.value)}
                          disabled={!settings.emailProvider?.enabled}
                        >
                          <option value="smtp">SMTP (Standard)</option>
                          <option value="office365">Office 365 (Microsoft Graph)</option>
                          <option value="resend">Resend</option>
                          <option value="smtp2go">SMTP2Go</option>
                          <option value="mailtrap">Mailtrap (Testing)</option>
                        </select>
                      </div>

                      <div className="mb-3">
                        <label className="form-label">Test Email Address</label>
                        <input
                          type="email"
                          className="form-control"
                          value={settings.emailProvider?.testEmail || settings.systemEmail || ''}
                          onChange={(e) => handleNestedChange('emailProvider', 'testEmail', e.target.value)}
                          placeholder="test@example.com"
                          disabled={!settings.emailProvider?.enabled}
                        />
                        <small className="form-hint">Email address to use for test emails</small>
                      </div>

                      {/* Email Test Mode */}
                      <div className={`card mb-3 ${settings.emailProvider?.testMode?.enabled ? 'border-warning' : ''}`} style={settings.emailProvider?.testMode?.enabled ? { backgroundColor: '#fff3cd' } : {}}>
                        <div className="card-body">
                          <h4 className="card-title d-flex align-items-center gap-2">
                            Email Test Mode
                            {settings.emailProvider?.testMode?.enabled && (
                              <span className="badge bg-warning text-dark">ACTIVE</span>
                            )}
                          </h4>
                          <p className="text-muted small mb-3">
                            When enabled, ALL system emails (notifications, password resets, summaries, etc.) will be redirected to a single email address. 
                            The original recipient will be shown in the subject line.
                          </p>
                          
                          {settings.emailProvider?.testMode?.enabled && (
                            <div className="alert alert-warning mb-3">
                              <strong>Test Mode is ACTIVE!</strong><br />
                              All emails are being redirected to: <strong>{settings.emailProvider?.testMode?.redirectEmail || 'Not Set'}</strong>
                            </div>
                          )}
                          
                          <div className="mb-3">
                            <label className="form-check form-switch">
                              <input
                                className="form-check-input"
                                type="checkbox"
                                checked={settings.emailProvider?.testMode?.enabled || false}
                                onChange={(e) => setSettings(prev => ({
                                  ...prev,
                                  emailProvider: {
                                    ...prev.emailProvider,
                                    testMode: {
                                      ...prev.emailProvider?.testMode,
                                      enabled: e.target.checked
                                    }
                                  }
                                }))}
                              />
                              <span className="form-check-label">Enable Email Test Mode</span>
                            </label>
                          </div>
                          
                          <div className="mb-3">
                            <label className="form-label">Redirect All Emails To</label>
                            <input
                              type="email"
                              className="form-control"
                              value={settings.emailProvider?.testMode?.redirectEmail || ''}
                              onChange={(e) => setSettings(prev => ({
                                ...prev,
                                emailProvider: {
                                  ...prev.emailProvider,
                                  testMode: {
                                    ...prev.emailProvider?.testMode,
                                    redirectEmail: e.target.value
                                  }
                                }
                              }))}
                              placeholder="your-test-email@example.com"
                              disabled={!settings.emailProvider?.testMode?.enabled}
                            />
                            <small className="form-hint">All system emails will be sent to this address with [TEST -&gt; original@recipient.com] in the subject</small>
                          </div>
                          
                          <div className="mb-0">
                            <label className="form-label">Default Company for Unallocated Documents</label>
                            <select
                              className="form-select"
                              value={settings.testModeDefaultCompanyId || ''}
                              onChange={(e) => handleInputChange('testModeDefaultCompanyId', e.target.value || null)}
                              disabled={!settings.emailProvider?.testMode?.enabled || loadingCompanies}
                            >
                              <option value="">-- No Default (Skip Unallocated) --</option>
                              {companies.map(company => (
                                <option key={company.id} value={company.id}>
                                  {company.name} {company.referenceNo ? `(${company.referenceNo})` : ''}
                                </option>
                              ))}
                            </select>
                            <small className="form-hint">
                              When set, unallocated documents (those without a company) will use this company's notification recipients during test mode. 
                              This allows testing email notifications for ALL imported documents, not just allocated ones.
                            </small>
                          </div>
                        </div>
                      </div>

                      {/* SMTP Configuration */}
                      {settings.emailProvider?.provider === 'smtp' && (
                        <div className="card mt-3">
                          <div className="card-body">
                            <h4 className="card-title">SMTP Configuration</h4>
                            <div className="row g-3">
                              <div className="col-md-6">
                                <label className="form-label">SMTP Host</label>
                                <input
                                  type="text"
                                  className="form-control"
                                  value={settings.emailProvider?.smtp?.host || ''}
                                  onChange={(e) => handleEmailProviderNestedChange('smtp', 'host', e.target.value)}
                                  placeholder="smtp.example.com"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                              </div>
                              <div className="col-md-6">
                                <label className="form-label">SMTP Port</label>
                                <input
                                  type="number"
                                  className="form-control"
                                  value={settings.emailProvider?.smtp?.port || 587}
                                  onChange={(e) => handleEmailProviderNestedChange('smtp', 'port', parseInt(e.target.value))}
                                  disabled={!settings.emailProvider?.enabled}
                                />
                                <small className="form-hint">Common ports: 25 (unencrypted), 587 (STARTTLS), 465 (SSL/TLS)</small>
                              </div>
                            </div>
                            <div className="row g-3 mt-0">
                              <div className="col-md-6">
                                <label className="form-label">Username <span className="text-muted">(Optional)</span></label>
                                <input
                                  type="text"
                                  className="form-control"
                                  value={settings.emailProvider?.smtp?.auth?.user || ''}
                                  onChange={(e) => handleEmailProviderNestedChange('smtp', 'auth', { ...settings.emailProvider?.smtp?.auth, user: e.target.value })}
                                  placeholder="your-email@example.com"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                                <small className="form-hint">Leave blank if your SMTP server doesn't require authentication</small>
                              </div>
                              <div className="col-md-6">
                                <label className="form-label">Password <span className="text-muted">(Optional)</span></label>
                                <input
                                  type="password"
                                  className="form-control"
                                  value={settings.emailProvider?.smtp?.auth?.password || ''}
                                  onChange={(e) => handleEmailProviderNestedChange('smtp', 'auth', { ...settings.emailProvider?.smtp?.auth, password: e.target.value })}
                                  placeholder="••••••••"
                                  autoComplete="new-password"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                                <small className="form-hint">Leave blank if your SMTP server doesn't require authentication</small>
                              </div>
                            </div>
                            <div className="row g-3 mt-0">
                              <div className="col-md-6">
                                <label className="form-label">From Email</label>
                                <input
                                  type="email"
                                  className="form-control"
                                  value={settings.emailProvider?.smtp?.fromEmail || ''}
                                  onChange={(e) => handleEmailProviderNestedChange('smtp', 'fromEmail', e.target.value)}
                                  placeholder="noreply@example.com"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                              </div>
                              <div className="col-md-6">
                                <label className="form-label">From Name</label>
                                <input
                                  type="text"
                                  className="form-control"
                                  value={settings.emailProvider?.smtp?.fromName || 'Makita EDI Portal'}
                                  onChange={(e) => handleEmailProviderNestedChange('smtp', 'fromName', e.target.value)}
                                  placeholder="Makita EDI Portal"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                              </div>
                            </div>
                            <div className="mb-3 mt-3">
                              <label className="form-check form-switch">
                                <input
                                  className="form-check-input"
                                  type="checkbox"
                                  checked={settings.emailProvider?.smtp?.secure || false}
                                  onChange={(e) => handleEmailProviderNestedChange('smtp', 'secure', e.target.checked)}
                                  disabled={!settings.emailProvider?.enabled}
                                />
                                <span className="form-check-label">Use SSL/TLS (Required for port 465, not needed for port 25)</span>
                              </label>
                              <small className="form-hint d-block mt-1">Port 25 is standard unencrypted SMTP. Port 465 requires SSL/TLS. Port 587 uses STARTTLS (handled automatically).</small>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Office 365 Configuration */}
                      {settings.emailProvider?.provider === 'office365' && (
                        <div className="card mt-3">
                          <div className="card-body">
                            <h4 className="card-title">Office 365 Configuration</h4>
                            <div className="alert alert-info">
                              <strong>Setup Instructions:</strong> You need to register an app in Azure AD and grant it Mail.Send permissions. See <a href="https://learn.microsoft.com/en-us/graph/outlook-mail-concept-overview" target="_blank" rel="noopener noreferrer">Microsoft Graph Documentation</a>.
                            </div>
                            <div className="row g-3">
                              <div className="col-md-6">
                                <label className="form-label">Tenant ID</label>
                                <input
                                  type="text"
                                  className="form-control"
                                  value={settings.emailProvider?.office365?.tenantId || ''}
                                  onChange={(e) => handleEmailProviderNestedChange('office365', 'tenantId', e.target.value)}
                                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                              </div>
                              <div className="col-md-6">
                                <label className="form-label">Client ID</label>
                                <input
                                  type="text"
                                  className="form-control"
                                  value={settings.emailProvider?.office365?.clientId || ''}
                                  onChange={(e) => handleEmailProviderNestedChange('office365', 'clientId', e.target.value)}
                                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                              </div>
                            </div>
                            <div className="row g-3 mt-0">
                              <div className="col-md-6">
                                <label className="form-label">Client Secret</label>
                                <input
                                  type="password"
                                  className="form-control"
                                  value={settings.emailProvider?.office365?.clientSecret || ''}
                                  onChange={(e) => handleEmailProviderNestedChange('office365', 'clientSecret', e.target.value)}
                                  placeholder="••••••••"
                                  autoComplete="new-password"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                              </div>
                              <div className="col-md-6">
                                <label className="form-label">From Email</label>
                                <input
                                  type="email"
                                  className="form-control"
                                  value={settings.emailProvider?.office365?.fromEmail || ''}
                                  onChange={(e) => handleEmailProviderNestedChange('office365', 'fromEmail', e.target.value)}
                                  placeholder="user@yourdomain.com"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                              </div>
                            </div>
                            <div className="mb-3 mt-3">
                              <label className="form-label">Send As User (Optional)</label>
                              <input
                                type="text"
                                className="form-control"
                                value={settings.emailProvider?.office365?.sendAsUser || ''}
                                onChange={(e) => handleEmailProviderNestedChange('office365', 'sendAsUser', e.target.value)}
                                placeholder="user@yourdomain.com or user ID"
                                disabled={!settings.emailProvider?.enabled}
                              />
                              <small className="form-hint">If different from From Email, specify the user ID or email to send as</small>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Resend Configuration */}
                      {settings.emailProvider?.provider === 'resend' && (
                        <div className="card mt-3">
                          <div className="card-body">
                            <h4 className="card-title">Resend Configuration</h4>
                            <div className="alert alert-info">
                              <strong>Setup Instructions:</strong> Get your API key from <a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer">Resend Dashboard</a> and verify your domain.
                            </div>
                            <div className="row g-3">
                              <div className="col-md-6">
                                <label className="form-label">API Key</label>
                                <input
                                  type="password"
                                  className="form-control"
                                  value={settings.emailProvider?.resend?.apiKey || ''}
                                  onChange={(e) => handleEmailProviderNestedChange('resend', 'apiKey', e.target.value)}
                                  placeholder="re_xxxxxxxxx"
                                  autoComplete="new-password"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                              </div>
                              <div className="col-md-6">
                                <label className="form-label">From Email</label>
                                <input
                                  type="email"
                                  className="form-control"
                                  value={settings.emailProvider?.resend?.fromEmail || ''}
                                  onChange={(e) => handleEmailProviderNestedChange('resend', 'fromEmail', e.target.value)}
                                  placeholder="noreply@yourdomain.com"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                                <small className="form-hint">Must be a verified sender in Resend</small>
                              </div>
                            </div>
                            <div className="mb-3 mt-3">
                              <label className="form-label">From Name</label>
                              <input
                                type="text"
                                className="form-control"
                                value={settings.emailProvider?.resend?.fromName || 'Makita EDI Portal'}
                                onChange={(e) => handleEmailProviderNestedChange('resend', 'fromName', e.target.value)}
                                placeholder="Makita EDI Portal"
                                disabled={!settings.emailProvider?.enabled}
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* SMTP2Go Configuration */}
                      {settings.emailProvider?.provider === 'smtp2go' && (
                        <div className="card mt-3">
                          <div className="card-body">
                            <h4 className="card-title">SMTP2Go Configuration</h4>
                            <div className="alert alert-info">
                              <strong>Setup Instructions:</strong> Get your API key from <a href="https://www.smtp2go.com/settings/api-keys/" target="_blank" rel="noopener noreferrer">SMTP2Go Settings</a> and verify your sender.
                            </div>
                            <div className="row g-3">
                              <div className="col-md-6">
                                <label className="form-label">API Key</label>
                                <input
                                  type="password"
                                  className="form-control"
                                  value={settings.emailProvider?.smtp2go?.apiKey || ''}
                                  onChange={(e) => handleEmailProviderNestedChange('smtp2go', 'apiKey', e.target.value)}
                                  placeholder="api-xxxxxxxxx"
                                  autoComplete="new-password"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                              </div>
                              <div className="col-md-6">
                                <label className="form-label">From Email</label>
                                <input
                                  type="email"
                                  className="form-control"
                                  value={settings.emailProvider?.smtp2go?.fromEmail || ''}
                                  onChange={(e) => handleEmailProviderNestedChange('smtp2go', 'fromEmail', e.target.value)}
                                  placeholder="noreply@yourdomain.com"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                                <small className="form-hint">Must be a verified sender in SMTP2Go</small>
                              </div>
                            </div>
                            <div className="mb-3 mt-3">
                              <label className="form-label">From Name</label>
                              <input
                                type="text"
                                className="form-control"
                                value={settings.emailProvider?.smtp2go?.fromName || 'Makita EDI Portal'}
                                onChange={(e) => handleEmailProviderNestedChange('smtp2go', 'fromName', e.target.value)}
                                placeholder="Makita EDI Portal"
                                disabled={!settings.emailProvider?.enabled}
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Mailtrap Configuration */}
                      {settings.emailProvider?.provider === 'mailtrap' && (
                        <div className="card mt-3">
                          <div className="card-body">
                            <h4 className="card-title">Mailtrap Configuration</h4>
                            <div className="alert alert-info">
                              <strong>Setup Instructions:</strong> Get your SMTP credentials from your <a href="https://mailtrap.io/inboxes" target="_blank" rel="noopener noreferrer">Mailtrap Inbox</a> → SMTP Settings. Emails are captured in Mailtrap's web UI for testing.
                            </div>
                            <div className="row g-3">
                              <div className="col-md-6">
                                <label className="form-label">SMTP Host</label>
                                <input
                                  type="text"
                                  className="form-control"
                                  value={settings.emailProvider?.mailtrap?.host || 'sandbox.smtp.mailtrap.io'}
                                  onChange={(e) => handleEmailProviderNestedChange('mailtrap', 'host', e.target.value)}
                                  placeholder="sandbox.smtp.mailtrap.io"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                                <small className="form-hint">Default: sandbox.smtp.mailtrap.io</small>
                              </div>
                              <div className="col-md-6">
                                <label className="form-label">Port</label>
                                <input
                                  type="number"
                                  className="form-control"
                                  value={settings.emailProvider?.mailtrap?.port || 2525}
                                  onChange={(e) => handleEmailProviderNestedChange('mailtrap', 'port', parseInt(e.target.value))}
                                  disabled={!settings.emailProvider?.enabled}
                                />
                                <small className="form-hint">Default: 2525 (or 587 with STARTTLS)</small>
                              </div>
                            </div>
                            <div className="row g-3 mt-2">
                              <div className="col-md-6">
                                <label className="form-label">Username</label>
                                <input
                                  type="text"
                                  className="form-control"
                                  value={settings.emailProvider?.mailtrap?.auth?.user || ''}
                                  onChange={(e) => handleEmailProviderNestedChange('mailtrap', 'auth', { ...settings.emailProvider?.mailtrap?.auth, user: e.target.value })}
                                  placeholder="From Mailtrap SMTP Settings"
                                  autoComplete="new-password"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                              </div>
                              <div className="col-md-6">
                                <label className="form-label">Password</label>
                                <input
                                  type="password"
                                  className="form-control"
                                  value={settings.emailProvider?.mailtrap?.auth?.password || ''}
                                  onChange={(e) => handleEmailProviderNestedChange('mailtrap', 'auth', { ...settings.emailProvider?.mailtrap?.auth, password: e.target.value })}
                                  placeholder="From Mailtrap SMTP Settings"
                                  autoComplete="new-password"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                              </div>
                            </div>
                            <div className="row g-3 mt-2">
                              <div className="col-md-6">
                                <label className="form-label">From Email</label>
                                <input
                                  type="email"
                                  className="form-control"
                                  value={settings.emailProvider?.mailtrap?.fromEmail || ''}
                                  onChange={(e) => handleEmailProviderNestedChange('mailtrap', 'fromEmail', e.target.value)}
                                  placeholder="noreply@example.com"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                                <small className="form-hint">Any email address works in sandbox mode</small>
                              </div>
                              <div className="col-md-6">
                                <label className="form-label">From Name</label>
                                <input
                                  type="text"
                                  className="form-control"
                                  value={settings.emailProvider?.mailtrap?.fromName || 'Makita EDI Portal'}
                                  onChange={(e) => handleEmailProviderNestedChange('mailtrap', 'fromName', e.target.value)}
                                  placeholder="Makita EDI Portal"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="mt-3">
                        <div className="row g-3">
                          <div className="col-md-6">
                            <label className="form-label">Test Email Template</label>
                            <select
                              className="form-select"
                              value={selectedEmailTemplate}
                              onChange={(e) => setSelectedEmailTemplate(e.target.value)}
                              disabled={testingEmail || !settings.emailProvider?.enabled}
                            >
                              {emailTemplates.length === 0 ? (
                                <option>No templates available</option>
                              ) : (
                                emailTemplates.map((template) => (
                                  <option key={template.id} value={template.name}>
                                    {template.description || template.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                  </option>
                                ))
                              )}
                            </select>
                            <small className="form-hint">Select which email template to test</small>
                          </div>
                        </div>
                        <div className="mt-3">
                          <button
                            type="button"
                            className="btn btn-outline-primary"
                            onClick={handleTestEmail}
                            disabled={testingEmail || !settings.emailProvider?.enabled}
                          >
                            {testingEmail ? 'Sending Test Email...' : 'Send Test Email'}
                          </button>
                        </div>
                      </div>

                      {/* Email Logs Table */}
                      <div className="card mt-4">
                        <div className="card-header">
                          <h3 className="card-title">Email Activity Logs</h3>
                          <div className="card-actions">
                            <button
                              className="btn btn-outline-danger btn-sm"
                              onClick={() => {
                                setClearEmailLogsConfirmation('');
                                setClearEmailLogsReason('');
                                setShowClearEmailLogsModal(true);
                              }}
                              disabled={clearingLogs || emailLogs.length === 0}
                              title="Wipes the entire email audit trail — requires typing CLEAR to confirm"
                            >
                              {clearingLogs ? (
                                <>
                                  <span className="spinner-border spinner-border-sm me-1" role="status"></span>
                                  Clearing...
                                </>
                              ) : (
                                'Clear Logs'
                              )}
                            </button>
                            <button
                              className="btn btn-outline-secondary btn-sm"
                              onClick={fetchEmailLogs}
                              disabled={loadingEmailLogs}
                            >
                              {loadingEmailLogs ? (
                                <span className="spinner-border spinner-border-sm" role="status"></span>
                              ) : (
                                'Refresh'
                              )}
                            </button>
                          </div>
                        </div>
                        
                        {/* Queue Status & Performance */}
                        {(emailQueueStatus || emailPerformance) && (
                          <div className="card-body border-bottom">
                            {emailQueueStatus && (
                              <div className="row g-2 mb-3">
                                <div className="col-3">
                                  <div className="text-muted small">Waiting</div>
                                  <div className="h3 mb-0 text-warning">{emailQueueStatus.waiting || 0}</div>
                                </div>
                                <div className="col-3">
                                  <div className="text-muted small">Active</div>
                                  <div className="h3 mb-0 text-info">{emailQueueStatus.active || 0}</div>
                                </div>
                                <div className="col-3">
                                  <div className="text-muted small">Completed</div>
                                  <div className="h3 mb-0 text-success">{emailQueueStatus.completed || 0}</div>
                                </div>
                                <div className="col-3">
                                  <div className="text-muted small">Failed</div>
                                  <div className="h3 mb-0 text-danger">{emailQueueStatus.failed || 0}</div>
                                </div>
                              </div>
                            )}
                            {emailPerformance && emailPerformance.totalSent > 0 && (
                              <div className="row g-2 border-top pt-3">
                                <div className="col-12">
                                  <div className="text-muted small mb-2">Email Performance (Last 100)</div>
                                </div>
                                <div className="col-4">
                                  <div className="text-muted small">Avg Send Time</div>
                                  <div className="h4 mb-0 text-primary">{emailPerformance.avgSendTimeDisplay || 'N/A'}</div>
                                </div>
                                <div className="col-4">
                                  <div className="text-muted small">Fastest</div>
                                  <div className="h4 mb-0 text-success">
                                    {emailPerformance.minSendTimeMs < 1000 
                                      ? `${emailPerformance.minSendTimeMs}ms`
                                      : `${(emailPerformance.minSendTimeMs / 1000).toFixed(1)}s`}
                                  </div>
                                </div>
                                <div className="col-4">
                                  <div className="text-muted small">Slowest</div>
                                  <div className="h4 mb-0 text-warning">
                                    {emailPerformance.maxSendTimeMs < 1000 
                                      ? `${emailPerformance.maxSendTimeMs}ms`
                                      : emailPerformance.maxSendTimeMs < 60000
                                        ? `${(emailPerformance.maxSendTimeMs / 1000).toFixed(1)}s`
                                        : `${Math.floor(emailPerformance.maxSendTimeMs / 60000)}m ${Math.floor((emailPerformance.maxSendTimeMs % 60000) / 1000)}s`}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="table-responsive">
                          <table className="table table-vcenter card-table">
                            <thead>
                              <tr>
                                <th>Date & Time</th>
                                <th>Status</th>
                                <th>Recipient</th>
                                <th>Subject</th>
                                <th>Provider</th>
                                <th>Send Time</th>
                                <th>Message ID</th>
                              </tr>
                            </thead>
                            <tbody>
                              {loadingEmailLogs ? (
                                <tr>
                                  <td colSpan="7" className="text-center py-4">
                                    <div className="spinner-border spinner-border-sm" role="status">
                                      <span className="visually-hidden">Loading...</span>
                                    </div>
                                  </td>
                                </tr>
                              ) : emailLogs.length === 0 ? (
                                <tr>
                                  <td colSpan="7" className="text-center text-muted py-4">
                                    No email logs available. Logs will appear here when emails are sent.
                                  </td>
                                </tr>
                              ) : (
                                emailLogs.map((log) => {
                                  const logDate = new Date(log.timestamp || log.createdAt);
                                  const dateTimeStr = logDate.toLocaleString('en-GB', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    year: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit'
                                  });

                                  // Status badge color
                                  let statusBadgeClass = 'bg-yellow-lt';
                                  let statusText = log.status || 'QUEUED';
                                  if (log.status === 'SENT') {
                                    statusBadgeClass = 'bg-success-lt';
                                  } else if (log.status === 'SENDING') {
                                    statusBadgeClass = 'bg-info-lt';
                                  } else if (log.status === 'FAILED_PERMANENT') {
                                    statusBadgeClass = 'bg-danger-lt';
                                  } else if (log.status === 'DEFERRED') {
                                    statusBadgeClass = 'bg-secondary-lt';
                                  }

                                  return (
                                    <tr key={log.id}>
                                      <td>
                                        <div className="text-secondary">{dateTimeStr}</div>
                                      </td>
                                      <td>
                                        <span className={`badge ${statusBadgeClass}`}>
                                          {statusText}
                                        </span>
                                      </td>
                                      <td>
                                        <div className="text-truncate" style={{ maxWidth: '200px' }} title={log.to}>
                                          {log.isBatch ? (
                                            <span className="badge bg-primary-lt">{log.recipientCount || 1} recipients</span>
                                          ) : (
                                            <span className="text-secondary">{log.to || 'N/A'}</span>
                                          )}
                                        </div>
                                      </td>
                                      <td>
                                        <div className="text-truncate" style={{ maxWidth: '300px' }} title={log.subject}>
                                          <span className="text-secondary">{log.subject || 'N/A'}</span>
                                        </div>
                                      </td>
                                      <td>
                                        <span className="badge bg-secondary-lt">{log.provider || 'N/A'}</span>
                                      </td>
                                      <td>
                                        {log.sendTimeDisplay ? (
                                          <span className="text-secondary">{log.sendTimeDisplay}</span>
                                        ) : (
                                          <span className="text-muted">-</span>
                                        )}
                                      </td>
                                      <td>
                                        {log.messageId ? (
                                          <code className="text-muted" style={{ fontSize: '0.75rem' }}>
                                            {log.messageId.length > 25 
                                              ? `${log.messageId.substring(0, 25)}...` 
                                              : log.messageId}
                                          </code>
                                        ) : (
                                          <span className="text-muted">-</span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                        <div className="card-footer">
                          <div className="text-muted small">
                            Auto-refreshes every 10 seconds • Showing {emailLogs.length} entries (newest first)
                            {' • '}
                            Current Time: {new Date().toLocaleString('en-GB', { 
                              day: '2-digit', 
                              month: '2-digit', 
                              year: 'numeric',
                              hour: '2-digit', 
                              minute: '2-digit', 
                              second: '2-digit',
                              timeZoneName: 'short'
                            })}
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div className="card-footer bg-transparent mt-auto">
                  <div className="btn-list justify-content-end">
                    <button onClick={handleSave} className="btn btn-primary" disabled={saving}>
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Clear Email Logs Confirmation Modal.
          Wipes the entire email_logs table server-side. Requires typing CLEAR
          verbatim and providing a reason — both are also enforced by the
          backend, this UI is defence in depth. */}
      {showClearEmailLogsModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header bg-danger text-white">
                <h5 className="modal-title">
                  <i className="fas fa-exclamation-triangle me-2"></i>
                  Clear Email Audit Trail
                </h5>
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  onClick={() => {
                    setShowClearEmailLogsModal(false);
                    setClearEmailLogsConfirmation('');
                    setClearEmailLogsReason('');
                  }}
                  disabled={clearingLogs}
                ></button>
              </div>
              <div className="modal-body">
                <div className="alert alert-danger">
                  <strong>This permanently deletes every row in <code>email_logs</code>.</strong>{' '}
                  You will lose all delivery status, SMTP Message-IDs, error
                  history, and bounce diagnostics for every email the portal
                  has ever sent. This cannot be undone.
                </div>
                <p className="mb-2">You almost certainly do not want this. Consider first:</p>
                <ul className="mb-3">
                  <li>Individual failed emails can be inspected and retried without wiping the whole table.</li>
                  <li>Search/filter the log viewer above instead of clearing it.</li>
                  <li>Customer support queries ("did we email invoice X?") rely on this data.</li>
                </ul>
                <div className="mb-3">
                  <label className="form-label">
                    <strong>Type <code>CLEAR</code> (in capitals) to confirm <span className="text-danger">*</span></strong>
                  </label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="CLEAR"
                    value={clearEmailLogsConfirmation}
                    onChange={(e) => setClearEmailLogsConfirmation(e.target.value)}
                    disabled={clearingLogs}
                    autoComplete="off"
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">
                    <strong>Reason <span className="text-danger">*</span></strong>
                  </label>
                  <textarea
                    className="form-control"
                    rows="3"
                    placeholder="Why is this being cleared? Stored in the activity log for audit."
                    value={clearEmailLogsReason}
                    onChange={(e) => setClearEmailLogsReason(e.target.value)}
                    disabled={clearingLogs}
                  />
                  <small className="form-hint">The reason is written to the activity log stream so we can trace who wiped the table and why after the fact.</small>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowClearEmailLogsModal(false);
                    setClearEmailLogsConfirmation('');
                    setClearEmailLogsReason('');
                  }}
                  disabled={clearingLogs}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleClearEmailLogs}
                  disabled={
                    clearingLogs ||
                    clearEmailLogsConfirmation.trim() !== 'CLEAR' ||
                    !clearEmailLogsReason.trim()
                  }
                >
                  {clearingLogs ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                      Clearing...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-trash me-2"></i>
                      Permanently Clear Email Logs
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Purge Documents Confirmation Modal */}
      {showPurgeDocumentsModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
          <div className="modal-dialog modal-xl">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="fas fa-exclamation-triangle text-danger me-2"></i>
                  Confirm Document Purge
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowPurgeDocumentsModal(false);
                    setPurgeReason('');
                  }}
                  disabled={purgingDocuments}
                ></button>
              </div>
              <div className="modal-body">
                <div className="alert alert-danger">
                  <strong>Warning:</strong> This action will permanently delete ALL invoices, credit notes, and statements from the system. This cannot be undone!
                </div>
                <p>The following will be deleted:</p>
                <ul>
                  <li>All invoices and their PDF files</li>
                  <li>All credit notes and their PDF files</li>
                  <li>All statements and their PDF files</li>
                  <li>All associated database records</li>
                </ul>
                <div className="mb-3">
                  <label className="form-label">
                    <strong>Reason for purging documents <span className="text-danger">*</span></strong>
                  </label>
                  <textarea
                    className="form-control"
                    rows="4"
                    placeholder="Please provide a reason for this action..."
                    value={purgeReason}
                    onChange={(e) => setPurgeReason(e.target.value)}
                    disabled={purgingDocuments}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowPurgeDocumentsModal(false);
                    setPurgeReason('');
                  }}
                  disabled={purgingDocuments}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handlePurgeDocuments}
                  disabled={purgingDocuments || !purgeReason || purgeReason.trim().length === 0}
                >
                  {purgingDocuments ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                      Purging...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-trash me-2"></i>
                      Confirm Purge
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Purge Customers Confirmation Modal */}
      {showPurgeCustomersModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
          <div className="modal-dialog modal-xl">
            <div className="modal-content">
              <div className="modal-header bg-danger text-white">
                <h5 className="modal-title">
                  <i className="fas fa-exclamation-triangle me-2"></i>
                  Confirm Customer Purge
                </h5>
                <button
                  type="button"
                  className="btn-close btn-close-white"
                  onClick={() => {
                    setShowPurgeCustomersModal(false);
                    setPurgeReason('');
                  }}
                  disabled={purgingCustomers}
                ></button>
              </div>
              <div className="modal-body">
                <div className="alert alert-danger">
                  <h4 className="alert-title">Warning: This action cannot be undone!</h4>
                  <p className="mb-0">
                    This will permanently delete <strong>ALL</strong> companies from the system. 
                    This includes all related data and cannot be reversed.
                  </p>
                </div>
                <p>The following will be deleted:</p>
                <ul>
                  <li>All companies (Corporate, Subsidiary, Branch)</li>
                  <li>All company relationships and hierarchy</li>
                  <li>All associated database records</li>
                </ul>
                <div className="mb-3">
                  <label className="form-label required">
                    <strong>Reason for purging customers <span className="text-danger">*</span></strong>
                  </label>
                  <textarea
                    className="form-control"
                    rows="4"
                    placeholder="Please provide a reason for purging all companies..."
                    value={purgeReason}
                    onChange={(e) => setPurgeReason(e.target.value)}
                    disabled={purgingCustomers}
                  />
                  <small className="form-hint">
                    A reason is required to proceed with this action.
                  </small>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowPurgeCustomersModal(false);
                    setPurgeReason('');
                  }}
                  disabled={purgingCustomers}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handlePurgeCustomers}
                  disabled={purgingCustomers || !purgeReason || purgeReason.trim().length === 0}
                >
                  {purgingCustomers ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                      Purging...
                    </>
                  ) : (
                    'Purge All Customers'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clear Import History Modal */}
      {showClearImportHistoryModal && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header bg-warning">
                <h5 className="modal-title">
                  <i className="fas fa-eraser me-2"></i>
                  Clear Import History
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowClearImportHistoryModal(false);
                    setClearHistoryReason('');
                  }}
                  disabled={clearingImportHistory}
                ></button>
              </div>
              <div className="modal-body">
                <div className="alert alert-warning">
                  <h4 className="alert-title">Confirm Action</h4>
                  <p className="mb-0">
                    This will delete <strong>{importHistoryCount.toLocaleString()}</strong> file hash records, 
                    allowing you to re-import files that were previously imported.
                  </p>
                </div>
                <p>This action:</p>
                <ul>
                  <li>Removes duplicate detection for previously imported files</li>
                  <li>Does NOT delete any documents (invoices, credit notes, etc.)</li>
                  <li>Allows the same files to be imported again</li>
                </ul>
                <div className="mb-3">
                  <label className="form-label required">
                    <strong>Reason <span className="text-danger">*</span></strong>
                  </label>
                  <textarea
                    className="form-control"
                    rows="3"
                    placeholder="e.g., Re-importing files after system purge..."
                    value={clearHistoryReason}
                    onChange={(e) => setClearHistoryReason(e.target.value)}
                    disabled={clearingImportHistory}
                  />
                  <small className="form-hint">
                    Minimum 5 characters required.
                  </small>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowClearImportHistoryModal(false);
                    setClearHistoryReason('');
                  }}
                  disabled={clearingImportHistory}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-warning"
                  onClick={handleClearImportHistory}
                  disabled={clearingImportHistory || !clearHistoryReason || clearHistoryReason.trim().length < 5}
                >
                  {clearingImportHistory ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                      Clearing...
                    </>
                  ) : (
                    'Clear Import History'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;
