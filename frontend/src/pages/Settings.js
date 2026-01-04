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
  const [testingDocumentAI, setTestingDocumentAI] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [emailTemplates, setEmailTemplates] = useState([]);
  const [selectedEmailTemplate, setSelectedEmailTemplate] = useState('welcome');
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  
  // Admin Tools state
  const [showPurgeDocumentsModal, setShowPurgeDocumentsModal] = useState(false);
  const [showPurgeCustomersModal, setShowPurgeCustomersModal] = useState(false);
  const [testingRetention, setTestingRetention] = useState(false);
  const [retentionStatus, setRetentionStatus] = useState(null);
  const [purgeReason, setPurgeReason] = useState('');
  const [purgingDocuments, setPurgingDocuments] = useState(false);
  const [purgingCustomers, setPurgingCustomers] = useState(false);
  const [purgeStats, setPurgeStats] = useState(null);
  const [updatingGlobalEDI, setUpdatingGlobalEDI] = useState(false);
  const [updatingGlobalEmail, setUpdatingGlobalEmail] = useState(false);
  
  // Email Stress Test state
  const [stressTestCount, setStressTestCount] = useState(10);
  const [stressTestAttachment, setStressTestAttachment] = useState(true);
  const [stressTestDocType, setStressTestDocType] = useState('invoice');
  const [runningStressTest, setRunningStressTest] = useState(false);
  const [stressTestResult, setStressTestResult] = useState(null);
  
  // Import Settings state
  const [importSettings, setImportSettings] = useState(null);
  const [importLogs, setImportLogs] = useState([]);
  const [loadingImportSettings, setLoadingImportSettings] = useState(false);
  const [loadingImportLogs, setLoadingImportLogs] = useState(false);
  const [triggeringImport, setTriggeringImport] = useState(false);
  const [savingImportSettings, setSavingImportSettings] = useState(false);
  const [failedCount, setFailedCount] = useState(0);
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [resettingStats, setResettingStats] = useState(false);
  
  // Companies for test mode default company dropdown
  const [companies, setCompanies] = useState([]);
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  useEffect(() => {
    if (user?.role === 'global_admin') {
      fetchSettings();
      fetchCompanies();
    }
  }, [user]);
  
  const fetchCompanies = async () => {
    setLoadingCompanies(true);
    try {
      const response = await api.get('/api/companies?limit=1000');
      setCompanies(response.data.data || response.data || []);
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
      { id: 'document-notification', name: 'document-notification', description: 'Document Notification', isActive: true },
      { id: 'document-summary', name: 'document-summary', description: 'Document Summary', isActive: true },
      { id: 'registration-request', name: 'registration-request', description: 'Registration Request (Admin)', isActive: true },
      { id: 'registration-approved', name: 'registration-approved', description: 'Registration Approved', isActive: true },
      { id: 'registration-rejected', name: 'registration-rejected', description: 'Registration Rejected', isActive: true },
      { id: 'bulk-email-test', name: 'bulk-email-test', description: 'Bulk Email Test (1 email every 10s for 10 mins)', isActive: true }
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

  // Fetch retention status when Admin Tools section is active
  useEffect(() => {
    if (activeSection === 'admin-tools') {
      fetchRetentionStatus();
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

  // Reset import statistics
  const handleResetStatistics = async () => {
    if (!window.confirm('Are you sure you want to reset all import statistics? This cannot be undone.')) {
      return;
    }
    
    setResettingStats(true);
    try {
      await api.post('/api/import-settings/reset-statistics');
      toast.success('Import statistics have been reset');
      fetchImportSettings();
    } catch (error) {
      console.error('Error resetting statistics:', error);
      toast.error('Error resetting statistics: ' + (error.response?.data?.message || error.message));
    } finally {
      setResettingStats(false);
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

        const response = await api.post('/api/email-templates/bulk-test', {
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

      const response = await api.post(`/api/email-templates/${selectedEmailTemplate}/test`, {
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
              fromName: 'Makita Invoice Portal',
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

  // Fetch retention status
  const fetchRetentionStatus = async () => {
    try {
      const response = await api.get('/api/settings/retention-status');
      setRetentionStatus(response.data);
    } catch (error) {
      console.error('Error fetching retention status:', error);
    }
  };

  // Test retention cleanup
  const handleTestRetention = async () => {
    if (!window.confirm('This will run the retention cleanup job and DELETE any expired documents. Continue?')) {
      return;
    }

    setTestingRetention(true);
    try {
      const response = await api.post('/api/settings/test-retention');
      
      if (response.data.result?.deleted > 0) {
        toast.success(`Retention cleanup completed. ${response.data.result.deleted} documents deleted.`);
      } else if (!response.data.retentionEnabled) {
        toast.info('Document retention is disabled. Set a retention period in settings first.');
      } else {
        toast.info('No expired documents found to delete.');
      }
      
      fetchRetentionStatus();
    } catch (error) {
      console.error('Error testing retention:', error);
      toast.error('Error testing retention: ' + (error.response?.data?.message || error.message));
    } finally {
      setTestingRetention(false);
    }
  };

  // Email stress test
  const handleEmailStressTest = async () => {
    setRunningStressTest(true);
    setStressTestResult(null);
    
    try {
      const response = await api.post('/api/settings/email-stress-test', {
        count: stressTestCount,
        includeAttachment: stressTestAttachment,
        documentType: stressTestDocType
      });
      
      setStressTestResult(response.data);
      toast.success(`Queued ${response.data.emailCount} test emails to ${response.data.recipientEmail}`);
    } catch (error) {
      console.error('Error running email stress test:', error);
      toast.error('Error running stress test: ' + (error.response?.data?.message || error.message));
    } finally {
      setRunningStressTest(false);
    }
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
        sendStatementAttachment: enabled
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

  const handleTestDocumentAI = async () => {
    setTestingDocumentAI(true);
    try {
      const response = await api.post('/api/parsing/test-documentai');
      if (response.data.success) {
        toast.success(response.data.message, 5000);
        if (response.data.details) {
          console.log('Document AI Details:', response.data.details);
        }
      } else {
        const errorMessage = response.data.message;
        const suggestion = response.data.suggestion;
        let fullMessage = errorMessage;
        if (suggestion) {
          fullMessage += ` ${suggestion}`;
        }
        toast.error(fullMessage, 8000);
      }
    } catch (error) {
      console.error('Error testing Document AI:', error);
      const errorMessage = error.response?.data?.message || error.message;
      const suggestion = error.response?.data?.suggestion;
      let fullMessage = 'Error testing Document AI: ' + errorMessage;
      if (suggestion) {
        fullMessage += ` ${suggestion}`;
      }
      toast.error(fullMessage, 8000);
    } finally {
      setTestingDocumentAI(false);
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
                      Company Information
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
                    <button
                      className={`list-group-item list-group-item-action d-flex align-items-center ${activeSection === 'parsing' ? 'active' : ''}`}
                      onClick={() => setActiveSection('parsing')}
                    >
                      Parsing Provider
                    </button>
                    {user?.role === 'global_admin' && (
                      <button
                        className={`list-group-item list-group-item-action d-flex align-items-center ${activeSection === 'modules' ? 'active' : ''}`}
                        onClick={() => setActiveSection('modules')}
                      >
                        Modules
                      </button>
                    )}
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
                      <h2 className="mb-4">Company Information</h2>
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
                            placeholder="Makita Invoice Portal"
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
                          <h3 className="mb-3">Document Retention</h3>
                          <p className="text-muted mb-3">Configure automatic deletion of documents (Invoices, Credit Notes, Statements) after a retention period.</p>
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
                          <small className="form-hint">Number of days to keep documents before automatic deletion. Disabled means documents are never automatically deleted.</small>
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

                          {/* Import Statistics */}
                          <div className="card mb-4">
                            <div className="card-header d-flex justify-content-between align-items-center">
                              <h3 className="card-title mb-0">Import Statistics</h3>
                              <button
                                type="button"
                                className="btn btn-outline-secondary btn-sm"
                                onClick={handleResetStatistics}
                                disabled={resettingStats}
                              >
                                {resettingStats ? 'Resetting...' : 'Reset Statistics'}
                              </button>
                            </div>
                            <div className="card-body">
                              <div className="row g-4">
                                <div className="col-sm-6 col-lg-3">
                                  <div className="card card-sm">
                                    <div className="card-body">
                                      <div className="d-flex align-items-center">
                                        <div>
                                          <div className="subheader">Total Scans</div>
                                          <div className="h3 mb-0">{importSettings?.stats?.totalScans || 0}</div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <div className="col-sm-6 col-lg-3">
                                  <div className="card card-sm">
                                    <div className="card-body">
                                      <div className="d-flex align-items-center">
                                        <div>
                                          <div className="subheader">Files Processed</div>
                                          <div className="h3 mb-0 text-success">{importSettings?.stats?.totalSuccessful || 0}</div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <div className="col-sm-6 col-lg-3">
                                  <div className="card card-sm">
                                    <div className="card-body">
                                      <div className="d-flex align-items-center">
                                        <div>
                                          <div className="subheader">Failed</div>
                                          <div className="h3 mb-0 text-danger">{importSettings?.stats?.totalFailed || 0}</div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <div className="col-sm-6 col-lg-3">
                                  <div className="card card-sm">
                                    <div className="card-body">
                                      <div className="d-flex align-items-center">
                                        <div>
                                          <div className="subheader">Last Run</div>
                                          <div className="h5 mb-0">
                                            {importSettings?.stats?.lastRunAt 
                                              ? new Date(importSettings.stats.lastRunAt).toLocaleString()
                                              : 'Never'}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              
                              {importSettings?.lastRun && (
                                <div className="mt-3 p-3 bg-light rounded">
                                  <h4 className="mb-2">Last Run Details</h4>
                                  <div className="row">
                                    <div className="col-md-3">
                                      <small className="text-muted">Duration:</small><br/>
                                      <strong>{importSettings.lastRun.duration ? `${(importSettings.lastRun.duration / 1000).toFixed(1)}s` : 'N/A'}</strong>
                                    </div>
                                    <div className="col-md-3">
                                      <small className="text-muted">Files Scanned:</small><br/>
                                      <strong>{importSettings.lastRun.results?.scanned || 0}</strong>
                                    </div>
                                    <div className="col-md-3">
                                      <small className="text-muted">Files Queued:</small><br/>
                                      <strong className="text-success">{importSettings.lastRun.results?.queued || 0}</strong>
                                    </div>
                                    <div className="col-md-3">
                                      <small className="text-muted">Errors:</small><br/>
                                      <strong className={importSettings.lastRun.results?.errors?.length ? 'text-danger' : ''}>
                                        {importSettings.lastRun.results?.errors?.length || 0}
                                      </strong>
                                    </div>
                                  </div>
                                </div>
                              )}
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
                                          {new Date(log.timestamp).toLocaleTimeString()}
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

                  {activeSection === 'parsing' && (
                    <>
                      <h2 className="mb-4">Parsing Provider</h2>
                      <p className="card-subtitle mb-4">Configure and test your PDF parsing providers. You can use Google Document AI or local coordinate-based parsing.</p>
                      
                      {/* Main Tabs: Configuration and Testing */}
                      <div className="card mb-4">
                        <div className="card-header">
                          <h3 className="card-title mb-0">Configuration</h3>
                        </div>
                        <div className="card-body">
                              <div className="mb-3">
                                <label className="form-check form-switch">
                                  <input
                                    className="form-check-input"
                                    type="checkbox"
                                    checked={settings.parsingProvider?.enabled || false}
                                    onChange={(e) => handleNestedChange('parsingProvider', 'enabled', e.target.checked)}
                                  />
                                  <span className="form-check-label">Enable Parsing Provider</span>
                                </label>
                                <small className="form-hint d-block mt-2">
                                  When enabled, the system will use cloud-based parsing providers. When disabled, only local parsing is available.
                                </small>
                              </div>

                              {/* Document AI Configuration */}
                              <div className="card mt-3">
                                <div className="card-header">
                                  <h3 className="card-title mb-0">Google Document AI</h3>
                                </div>
                                <div className="card-body">
                              <div className="alert alert-info mb-3 d-flex flex-column">
                                <strong>Credentials Options:</strong> You can provide credentials in three ways (in order of priority):
                                <ol className="mb-0 mt-2">
                                  <li>Upload or paste JSON credentials below (stored in database)</li>
                                  <li>Set <code>GOOGLE_APPLICATION_CREDENTIALS</code> environment variable with file path</li>
                                  <li>Set <code>GOOGLE_APPLICATION_CREDENTIALS_JSON</code> environment variable with JSON content</li>
                                </ol>
                                <small className="d-block mt-2">For production, environment variables are recommended for better security.</small>
                              </div>
                              <div className="mb-3">
                                <label className="form-check form-switch">
                                  <input
                                    className="form-check-input"
                                    type="checkbox"
                                    checked={settings.parsingProvider?.documentai?.enabled || false}
                                    onChange={(e) => handleNestedChange('parsingProvider', 'documentai', { 
                                      ...settings.parsingProvider?.documentai, 
                                      enabled: e.target.checked 
                                    })}
                                    disabled={!settings.parsingProvider?.enabled}
                                  />
                                  <span className="form-check-label">Enable Google Document AI</span>
                                </label>
                                <small className="form-hint d-block">Fallback parsing method. More accurate but requires processor setup.</small>
                              </div>

                              <div className="row g-3">
                                <div className="col-md-6">
                                  <label className="form-label">Project ID</label>
                                  <input
                                    type="text"
                                    className="form-control"
                                    value={settings.parsingProvider?.documentai?.projectId || ''}
                                    onChange={(e) => handleNestedChange('parsingProvider', 'documentai', { 
                                      ...settings.parsingProvider?.documentai, 
                                      projectId: e.target.value 
                                    })}
                                    placeholder="your-project-id"
                                    disabled={!settings.parsingProvider?.enabled}
                                  />
                                  <small className="form-hint">Your Google Cloud Project ID</small>
                                </div>
                                <div className="col-md-6">
                                  <label className="form-label">Location</label>
                                  <input
                                    type="text"
                                    className="form-control"
                                    value={settings.parsingProvider?.documentai?.location || 'us'}
                                    onChange={(e) => handleNestedChange('parsingProvider', 'documentai', { 
                                      ...settings.parsingProvider?.documentai, 
                                      location: e.target.value 
                                    })}
                                    placeholder="us"
                                    disabled={!settings.parsingProvider?.enabled}
                                  />
                                  <small className="form-hint">Google Cloud region</small>
                                </div>
                              </div>

                              <div className="row g-3 mt-0">
                                <div className="col-md-6">
                                  <label className="form-label">Processor ID</label>
                                  <input
                                    type="text"
                                    className="form-control"
                                    value={settings.parsingProvider?.documentai?.processorId || ''}
                                    onChange={(e) => handleNestedChange('parsingProvider', 'documentai', { 
                                      ...settings.parsingProvider?.documentai, 
                                      processorId: e.target.value 
                                    })}
                                    placeholder="abc123def456"
                                    disabled={!settings.parsingProvider?.enabled}
                                  />
                                  <small className="form-hint">Document AI Processor ID (create in Google Cloud Console)</small>
                                </div>
                              </div>

                              <div className="row g-3 mt-2">
                                <div className="col-md-12">
                                  <label className="form-label">Service Account Credentials</label>
                                  <div className="mb-2">
                                    <div className="btn-group" role="group">
                                      <button
                                        type="button"
                                        className="btn btn-outline-primary btn-sm"
                                        onClick={() => {
                                          const input = document.createElement('input');
                                          input.type = 'file';
                                          input.accept = '.json';
                                          input.onchange = (e) => {
                                            const file = e.target.files[0];
                                            if (file) {
                                              const reader = new FileReader();
                                              reader.onload = (event) => {
                                                try {
                                                  const json = event.target.result;
                                                  JSON.parse(json);
                                                  handleNestedChange('parsingProvider', 'documentai', {
                                                    ...settings.parsingProvider?.documentai,
                                                    credentialsJson: json
                                                  });
                                                  toast.success('Credentials file loaded successfully');
                                                } catch (error) {
                                                  toast.error('Invalid JSON file: ' + error.message);
                                                }
                                              };
                                              reader.readAsText(file);
                                            }
                                          };
                                          input.click();
                                        }}
                                        disabled={!settings.parsingProvider?.enabled}
                                      >
                                        Upload JSON File
                                      </button>
                                    </div>
                                  </div>
                                  <textarea
                                    className="form-control font-monospace"
                                    rows="8"
                                    value={settings.parsingProvider?.documentai?.credentialsJson === '***' 
                                      ? '' 
                                      : (settings.parsingProvider?.documentai?.credentialsJson || '')}
                                    onChange={(e) => {
                                      const value = e.target.value;
                                      if (value !== '***') {
                                        handleNestedChange('parsingProvider', 'documentai', {
                                          ...settings.parsingProvider?.documentai,
                                          credentialsJson: value
                                        });
                                      }
                                    }}
                                    placeholder='Paste your service account JSON here, or upload a file above...'
                                    disabled={!settings.parsingProvider?.enabled}
                                    style={{ fontSize: '0.875rem' }}
                                  />
                                  <small className="form-hint d-block mt-1">
                                    Paste your Google Cloud service account JSON credentials here, or upload the file. 
                                    This will be stored securely in the database.
                                    <br />
                                    <strong>Note:</strong> If not set, will use the same credentials as Vision API.
                                  </small>
                                </div>
                              </div>
                              
                              <div className="row g-3 mt-2">
                                <div className="col-md-12">
                                  <label className="form-label">Service Account JSON Path (Alternative)</label>
                                  <input
                                    type="text"
                                    className="form-control"
                                    value={settings.parsingProvider?.documentai?.credentialsPath || ''}
                                    onChange={(e) => handleNestedChange('parsingProvider', 'documentai', { 
                                      ...settings.parsingProvider?.documentai, 
                                      credentialsPath: e.target.value 
                                    })}
                                    placeholder="/path/to/service-account.json"
                                    disabled={!settings.parsingProvider?.enabled}
                                  />
                                  <small className="form-hint">Alternative: Path to service account JSON file on the server. Takes precedence over JSON above if both are set.</small>
                                </div>
                              </div>

                              <div className="row g-3 mt-3">
                                <div className="col-md-12">
                                  <button
                                    className="btn btn-outline-primary"
                                    onClick={handleTestDocumentAI}
                                    disabled={!settings.parsingProvider?.enabled || !settings.parsingProvider?.documentai?.enabled || testingDocumentAI}
                                  >
                                    {testingDocumentAI ? (
                                      <>
                                        <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                                        Testing...
                                      </>
                                    ) : (
                                      'Test Document AI Connection'
                                    )}
                                  </button>
                                </div>
                              </div>
                                </div>
                              </div>
                        </div>
                      </div>
                    </>
                  )}

                  {activeSection === 'modules' && user?.role === 'global_admin' && (
                    <>
                      <h2 className="mb-4">System Modules</h2>
                      <p className="card-subtitle mb-4">
                        Enable or disable system-wide features. Only Global Administrators can modify module settings.
                        When a module is disabled, all related features are hidden from all screens and API endpoints are disabled.
                      </p>
                      
                      <div className="alert alert-info">
                        <i className="fas fa-info-circle me-2"></i>
                        <strong>Note:</strong> Module settings are system-wide and affect all users. Changes take effect immediately after saving.
                      </div>
                      
                      <div className="card">
                        <div className="card-header">
                          <h3 className="card-title">Available Modules</h3>
                        </div>
                        <div className="card-body">
                          <div className="list-group list-group-flush">
                            {/* Document Queries Module */}
                            <div className="list-group-item">
                              <div className="d-flex justify-content-between align-items-center">
                                <div className="flex-grow-1">
                                  <h4 className="mb-1">Document Queries</h4>
                                  <p className="text-muted mb-0 small">
                                    Allows users to send queries about documents. When enabled, users can communicate with staff about invoices, credit notes, and statements.
                                    When disabled, all query features are hidden and API endpoints are disabled.
                                  </p>
                                </div>
                                <div className="ms-3">
                                  <div className="form-check form-switch">
                                    <input
                                      className="form-check-input"
                                      type="checkbox"
                                      id="module-queriesEnabled"
                                      checked={settings.queriesEnabled !== false}
                                      onChange={(e) => handleInputChange('queriesEnabled', e.target.checked)}
                                    />
                                    <label className="form-check-label" htmlFor="module-queriesEnabled">
                                      {settings.queriesEnabled !== false ? 'Enabled' : 'Disabled'}
                                    </label>
                                  </div>
                                </div>
                              </div>
                            </div>
                            
                            {/* Add more modules here as needed */}
                            {/* Example:
                            <div className="list-group-item">
                              <div className="d-flex justify-content-between align-items-center">
                                <div className="flex-grow-1">
                                  <h4 className="mb-1">Future Module</h4>
                                  <p className="text-muted mb-0 small">
                                    Description of the module.
                                  </p>
                                </div>
                                <div className="ms-3">
                                  <div className="form-check form-switch">
                                    <input
                                      className="form-check-input"
                                      type="checkbox"
                                      id="module-futureModule"
                                      checked={settings.futureModule || false}
                                      onChange={(e) => handleInputChange('futureModule', e.target.checked)}
                                    />
                                    <label className="form-check-label" htmlFor="module-futureModule">
                                      {settings.futureModule ? 'Enabled' : 'Disabled'}
                                    </label>
                                  </div>
                                </div>
                              </div>
                            </div>
                            */}
                          </div>
                        </div>
                      </div>
                      
                      <div className="mt-4">
                        <button
                          className="btn btn-primary"
                          onClick={handleSave}
                          disabled={saving}
                        >
                          {saving ? 'Saving...' : 'Save Module Settings'}
                        </button>
                      </div>
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
                      
                      {/* Danger Zone */}
                      <h4 className="mb-3 text-danger">Danger Zone</h4>
                      <div className="alert alert-danger">
                        <i className="fas fa-exclamation-triangle me-2"></i>
                        <strong>Warning:</strong> These tools will permanently delete data from the system. Use with extreme caution. All actions are logged and cannot be undone.
                      </div>
                      
                      {/* Test Document Retention */}
                      <div className="card mb-3">
                        <div className="card-header d-flex justify-content-between align-items-center">
                          <h3 className="card-title mb-0">Test Document Retention</h3>
                          <button 
                            className="btn btn-sm btn-outline-secondary"
                            onClick={fetchRetentionStatus}
                            title="Refresh status"
                          >
                            <i className="fas fa-sync-alt"></i>
                          </button>
                        </div>
                        <div className="card-body">
                          <p className="text-muted mb-3">
                            Manually trigger the document retention cleanup job. This will delete documents that have passed their retention expiry date.
                          </p>
                          
                          {retentionStatus && (
                            <div className="mb-3">
                              {retentionStatus.retentionEnabled ? (
                                <div className="row g-3 mb-3">
                                  <div className="col-md-4">
                                    <div className="card card-sm bg-danger-subtle">
                                      <div className="card-body text-center">
                                        <div className="h3 mb-0 text-danger">{retentionStatus.expired?.total || 0}</div>
                                        <div className="text-muted small">Expired (ready to delete)</div>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="col-md-4">
                                    <div className="card card-sm bg-warning-subtle">
                                      <div className="card-body text-center">
                                        <div className="h3 mb-0 text-warning">{retentionStatus.expiringIn7Days?.total || 0}</div>
                                        <div className="text-muted small">Expiring in 7 days</div>
                                      </div>
                                    </div>
                                  </div>
                                  <div className="col-md-4">
                                    <div className="card card-sm bg-info-subtle">
                                      <div className="card-body text-center">
                                        <div className="h3 mb-0 text-info">{retentionStatus.retentionPeriodDays}</div>
                                        <div className="text-muted small">Retention Period (days)</div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="alert alert-info mb-3">
                                  <strong>Retention Disabled:</strong> Set a document retention period in the main settings to enable automatic document cleanup.
                                </div>
                              )}
                            </div>
                          )}
                          
                          <button
                            className="btn btn-warning"
                            onClick={handleTestRetention}
                            disabled={testingRetention}
                          >
                            {testingRetention ? (
                              <>
                                <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                                Running Cleanup...
                              </>
                            ) : (
                              <>
                                <i className="fas fa-clock me-2"></i>
                                Run Retention Cleanup Now
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                      
                      {/* Email Queue Stress Test */}
                      <div className="card mb-3">
                        <div className="card-header">
                          <h3 className="card-title">Email Queue Stress Test</h3>
                        </div>
                        <div className="card-body">
                          <p className="text-muted mb-3">
                            Queue test notification emails to yourself to verify email deliverability and attachments.
                            Emails will be sent to: <strong>{user?.email}</strong>
                          </p>
                          
                          <div className="row g-3 mb-3">
                            <div className="col-md-4">
                              <label className="form-label">Number of Emails</label>
                              <input
                                type="number"
                                className="form-control"
                                min="1"
                                max="100"
                                value={stressTestCount}
                                onChange={(e) => setStressTestCount(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                              />
                              <small className="form-hint">1-100 emails (conserves Mailtrap credits)</small>
                            </div>
                            
                            <div className="col-md-4">
                              <label className="form-label">Document Type</label>
                              <select
                                className="form-select"
                                value={stressTestDocType}
                                onChange={(e) => setStressTestDocType(e.target.value)}
                              >
                                <option value="invoice">Invoice</option>
                                <option value="credit_note">Credit Note</option>
                              </select>
                            </div>
                            
                            <div className="col-md-4">
                              <label className="form-label">Include PDF Attachment</label>
                              <div className="form-check form-switch mt-2">
                                <input
                                  type="checkbox"
                                  className="form-check-input"
                                  checked={stressTestAttachment}
                                  onChange={(e) => setStressTestAttachment(e.target.checked)}
                                />
                                <label className="form-check-label">
                                  {stressTestAttachment ? 'Yes (uses sample PDF)' : 'No'}
                                </label>
                              </div>
                            </div>
                          </div>
                          
                          <div className="alert alert-info mb-3">
                            <strong>Mailtrap Limits:</strong> 10 emails per 10 seconds, 500/month on free tier.
                            {stressTestCount > 1 && (
                              <span> Estimated delivery: ~{Math.ceil(stressTestCount)} seconds</span>
                            )}
                          </div>
                          
                          <button
                            className="btn btn-primary"
                            onClick={handleEmailStressTest}
                            disabled={runningStressTest}
                          >
                            {runningStressTest ? (
                              <>
                                <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                                Queuing Emails...
                              </>
                            ) : (
                              <>
                                <i className="fas fa-paper-plane me-2"></i>
                                Run Stress Test
                              </>
                            )}
                          </button>
                          
                          {stressTestResult && (
                            <div className="alert alert-success mt-3">
                              <strong>Test Queued Successfully!</strong>
                              <ul className="mb-0 mt-2">
                                <li>Emails queued: {stressTestResult.emailCount}</li>
                                <li>Recipient: {stressTestResult.recipientEmail}</li>
                                <li>Document type: {stressTestResult.documentType}</li>
                                <li>With attachments: {stressTestResult.emailsWithAttachment || 0} ({stressTestResult.attachmentSource || 'N/A'})</li>
                                <li>Without attachments: {stressTestResult.emailsWithoutAttachment || stressTestResult.emailCount}</li>
                                <li>Estimated delivery: ~{stressTestResult.estimatedDeliverySeconds || stressTestResult.emailCount} seconds</li>
                              </ul>
                            </div>
                          )}
                        </div>
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
                          value={settings.twoFactorAuth?.issuer || 'Makita Invoice Portal'}
                          onChange={(e) => handleNestedChange('twoFactorAuth', 'issuer', e.target.value)}
                          placeholder="Makita Invoice Portal"
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
                              </div>
                            </div>
                            <div className="row g-3 mt-0">
                              <div className="col-md-6">
                                <label className="form-label">Username</label>
                                <input
                                  type="text"
                                  className="form-control"
                                  value={settings.emailProvider?.smtp?.auth?.user || ''}
                                  onChange={(e) => handleEmailProviderNestedChange('smtp', 'auth', { ...settings.emailProvider?.smtp?.auth, user: e.target.value })}
                                  placeholder="your-email@example.com"
                                  disabled={!settings.emailProvider?.enabled}
                                />
                              </div>
                              <div className="col-md-6">
                                <label className="form-label">Password</label>
                                <input
                                  type="password"
                                  className="form-control"
                                  value={settings.emailProvider?.smtp?.auth?.password || ''}
                                  onChange={(e) => handleEmailProviderNestedChange('smtp', 'auth', { ...settings.emailProvider?.smtp?.auth, password: e.target.value })}
                                  placeholder="••••••••"
                                  autoComplete="new-password"
                                  disabled={!settings.emailProvider?.enabled}
                                />
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
                                  value={settings.emailProvider?.smtp?.fromName || 'Makita Invoice Portal'}
                                  onChange={(e) => handleEmailProviderNestedChange('smtp', 'fromName', e.target.value)}
                                  placeholder="Makita Invoice Portal"
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
                                <span className="form-check-label">Use SSL/TLS (Port 465)</span>
                              </label>
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
                                value={settings.emailProvider?.resend?.fromName || 'Makita Invoice Portal'}
                                onChange={(e) => handleEmailProviderNestedChange('resend', 'fromName', e.target.value)}
                                placeholder="Makita Invoice Portal"
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
                                value={settings.emailProvider?.smtp2go?.fromName || 'Makita Invoice Portal'}
                                onChange={(e) => handleEmailProviderNestedChange('smtp2go', 'fromName', e.target.value)}
                                placeholder="Makita Invoice Portal"
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
                                  value={settings.emailProvider?.mailtrap?.fromName || 'Makita Invoice Portal'}
                                  onChange={(e) => handleEmailProviderNestedChange('mailtrap', 'fromName', e.target.value)}
                                  placeholder="Makita Invoice Portal"
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
                              disabled={testingEmail || !settings.emailProvider?.enabled || loadingTemplates}
                            >
                              {loadingTemplates ? (
                                <option>Loading templates...</option>
                              ) : emailTemplates.length === 0 ? (
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
                            disabled={testingEmail || !settings.emailProvider?.enabled || loadingTemplates}
                          >
                            {testingEmail ? 'Sending Test Email...' : 'Send Test Email'}
                          </button>
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
    </div>
  );
};

export default Settings;
