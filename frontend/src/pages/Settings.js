import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api, { API_URL } from '../services/api';
import toast from '../utils/toast';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { STANDARD_FIELDS } from '../utils/standardFields';

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
  const [testingImportLogic, setTestingImportLogic] = useState(false);
  const [testImportData, setTestImportData] = useState({
    fileName: '',
    fileType: 'invoice',
    accountNumber: '',
    invoiceNumber: '',
    amount: '',
    date: ''
  });
  const [testImportResult, setTestImportResult] = useState(null);
  const [testingDocumentAI, setTestingDocumentAI] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [activeParsingTab, setActiveParsingTab] = useState('documentai'); // 'documentai'
  const [activeParsingSection, setActiveParsingSection] = useState('configuration'); // 'configuration', 'testing'
  const [emailTemplates, setEmailTemplates] = useState([]);
  const [selectedEmailTemplate, setSelectedEmailTemplate] = useState('welcome');
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  
  // Parser Test state
  const [testFile, setTestFile] = useState(null);
  const [testFiles, setTestFiles] = useState([]); // For bulk uploads
  const [testParser, setTestParser] = useState('local');
  const [testingParser, setTestingParser] = useState(false);
  const [testResults, setTestResults] = useState(null);
  const [testError, setTestError] = useState(null);
  
  // Bulk test state
  const [bulkTestId, setBulkTestId] = useState(null);
  const [bulkTestStatus, setBulkTestStatus] = useState(null);
  const [bulkTestResults, setBulkTestResults] = useState(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  
  // Admin Tools state
  const [showPurgeDocumentsModal, setShowPurgeDocumentsModal] = useState(false);
  const [showPurgeCustomersModal, setShowPurgeCustomersModal] = useState(false);
  const [purgeReason, setPurgeReason] = useState('');
  const [purgingDocuments, setPurgingDocuments] = useState(false);
  const [purgingCustomers, setPurgingCustomers] = useState(false);
  const [purgeStats, setPurgeStats] = useState(null);
  const [bulkTestSource, setBulkTestSource] = useState('upload'); // 'upload' or 'ftp'
  const [bulkTestFileType, setBulkTestFileType] = useState('pdf'); // 'pdf' or 'excel' - for current bulk test
  const [showFTPPreviewModal, setShowFTPPreviewModal] = useState(false);
  const [ftpPreviewData, setFtpPreviewData] = useState(null);
  const [connectingFTP, setConnectingFTP] = useState(false);
  const [ftpParseType, setFtpParseType] = useState('pdf'); // 'pdf' or 'excel'
  const [selectedResultFile, setSelectedResultFile] = useState(null);
  const [bulkTestPollingInterval, setBulkTestPollingInterval] = useState(null);
  const [showCleanTempModal, setShowCleanTempModal] = useState(false);
  const [cleanTempResult, setCleanTempResult] = useState(null);
  

  useEffect(() => {
    if (user?.role === 'global_admin') {
      fetchSettings();
    }
  }, [user]);


  // Fetch email templates
  useEffect(() => {
    const fetchEmailTemplates = async () => {
      setLoadingTemplates(true);
      try {
        const response = await api.get('/api/email-templates');
        const activeTemplates = response.data.filter(t => t.isActive);
        // Add bulk email test as a special test option
        const bulkTestOption = {
          id: 'bulk-email-test',
          name: 'bulk-email-test',
          description: 'Bulk Email Test (1 email every 10s for 10 mins)',
          isActive: true
        };
        setEmailTemplates([...activeTemplates, bulkTestOption]);
      } catch (error) {
        console.error('Error fetching email templates:', error);
      } finally {
        setLoadingTemplates(false);
      }
    };
    fetchEmailTemplates();
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

  const handleSecondaryColourChange = (colour) => {
    handleInputChange('secondaryColor', colour);
    // Colour shades will be auto-generated on save
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await api.put('/api/settings', settings);
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
        'logo-dark': 'logoDark',
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
        'logo-dark': 'logoDark',
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

  const handleTestImportLogic = async () => {
    if (!testImportData.accountNumber && !testImportData.invoiceNumber) {
      toast.error('Please provide at least an account number or invoice number');
      return;
    }

    setTestingImportLogic(true);
    setTestImportResult(null);
    
    try {
      const payload = {
        fileName: testImportData.fileName || undefined,
        fileType: testImportData.fileType,
        accountNumber: testImportData.accountNumber || undefined,
        invoiceNumber: testImportData.invoiceNumber || undefined,
        amount: testImportData.amount ? parseFloat(testImportData.amount) : undefined,
        date: testImportData.date || undefined
      };

      const response = await api.post('/api/files/test-import', payload);
      
      if (response.data.success) {
        setTestImportResult(response.data);
        toast.success(response.data.message);
      } else {
        toast.error(response.data.message || 'Test import failed');
      }
    } catch (error) {
      console.error('Error testing import logic:', error);
      toast.error('Error testing import logic: ' + (error.response?.data?.message || error.message));
    } finally {
      setTestingImportLogic(false);
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

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  };

  // Parser Test functions
  const handleTestParser = async () => {
    // Bulk upload
    if (testFiles.length > 0) {
      await handleBulkTest();
      return;
    }
    
    // Single file upload
    if (!testFile) {
      toast.error('Please select a PDF file to test');
      return;
    }

    setTestingParser(true);
    setTestError(null);
    setTestResults(null);

    try {
      const formData = new FormData();
      formData.append('file', testFile);
      formData.append('parser', testParser);

      const response = await api.post('/api/parsing/test-parse', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      if (response.data.success) {
        setTestResults(response.data.results);
        toast.success(response.data.message, 5000);
      } else {
        setTestError(response.data.message || 'Failed to parse PDF');
        toast.error(response.data.message || 'Failed to parse PDF', 8000);
      }
    } catch (error) {
      console.error('Error testing parser:', error);
      const errorMessage = error.response?.data?.message || error.message;
      setTestError(errorMessage);
      toast.error('Error testing parser: ' + errorMessage, 8000);
    } finally {
      setTestingParser(false);
    }
  };

  const handleBulkTest = async () => {
    if (testFiles.length === 0) {
      toast.error('Please select at least one file');
      return;
    }

    if (testFiles.length > 100) {
      toast.error('Maximum 100 files allowed');
      return;
    }

    setTestingParser(true);
    setTestError(null);
    setBulkTestResults(null);
    setShowBulkModal(true);
    setBulkTestSource('upload');

    try {
      const formData = new FormData();
      testFiles.forEach(file => {
        formData.append('files', file);
      });
      formData.append('parser', testParser);

      const response = await api.post('/api/parsing/test-parse-bulk', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      setBulkTestId(response.data.testId);
      
      // Start polling for status
      pollBulkTestStatus(response.data.testId);
    } catch (error) {
      console.error('Error starting bulk test:', error);
      const errorMessage = error.response?.data?.message || error.message;
      setTestError(errorMessage);
      toast.error('Error starting bulk test: ' + errorMessage, 8000);
      setShowBulkModal(false);
      setTestingParser(false);
    }
  };

  const handleConnectFTP = async () => {
    setConnectingFTP(true);
    setTestError(null);
    setFtpPreviewData(null);

    try {
      const response = await api.post('/api/parsing/test-ftp-connect', {
        fileType: ftpParseType // 'pdf' or 'excel'
      });
      
      if (response.data.success) {
        setFtpPreviewData({
          ...response.data,
          fileType: ftpParseType // Store the file type for later use
        });
        setShowFTPPreviewModal(true);
      } else {
        setTestError(response.data.message || 'Failed to connect to FTP');
        toast.error(response.data.message || 'Failed to connect to FTP', 8000);
      }
    } catch (error) {
      console.error('Error connecting to FTP:', error);
      const errorMessage = error.response?.data?.message || error.message;
      setTestError(errorMessage);
      toast.error('Error connecting to FTP: ' + errorMessage, 8000);
    } finally {
      setConnectingFTP(false);
    }
  };

  const handleConfirmFTPParse = async () => {
    const fileCount = ftpParseType === 'pdf' 
      ? (ftpPreviewData?.totalPdfFiles || 0)
      : (ftpPreviewData?.totalExcelFiles || 0);
    
    if (!ftpPreviewData || fileCount === 0) {
      toast.error(`No ${ftpParseType === 'pdf' ? 'PDF' : 'Excel'} files available to parse`, 5000);
      return;
    }

    setShowFTPPreviewModal(false);
    setTestingParser(true);
    setTestError(null);
    setBulkTestResults(null);
    setShowBulkModal(true);
    setBulkTestSource('ftp');
    setBulkTestFileType(ftpParseType); // Store file type for display

    try {
      const response = await api.post('/api/parsing/test-parse-bulk-ftp', {
        parser: testParser,
        maxFiles: Math.min(fileCount, 100),
        fileType: ftpParseType // Pass the file type
      });

      setBulkTestId(response.data.testId);
      
      // Start polling for status
      const intervalId = pollBulkTestStatus(response.data.testId);
      setBulkTestPollingInterval(intervalId);
    } catch (error) {
      console.error('Error starting FTP bulk test:', error);
      const errorMessage = error.response?.data?.message || error.message;
      setTestError(errorMessage);
      toast.error('Error starting FTP bulk test: ' + errorMessage, 8000);
      setShowBulkModal(false);
      setTestingParser(false);
    }
  };

  const pollBulkTestStatus = async (testId) => {
    // Poll immediately first time
    const pollOnce = async () => {
      try {
        const statusResponse = await api.get(`/api/parsing/test-parse-bulk/${testId}`);
        const test = statusResponse.data.test;
        
        setBulkTestStatus(test);
        
        if (test.status === 'completed' || test.status === 'failed') {
          // Fetch full results
          const resultsResponse = await api.get(`/api/parsing/test-parse-bulk/${testId}/results`);
          const testData = resultsResponse.data.test;
          setBulkTestResults(testData);
          setBulkTestSource(testData.source || 'upload'); // Store source from results
          setShowBulkModal(false);
          setTestingParser(false);
          
          const sourceLabel = testData.source === 'ftp' ? 'FTP ' : '';
          const message = test.status === 'completed' 
            ? `${sourceLabel}Bulk test completed! Processed ${test.processedFiles} of ${test.totalFiles} files. Check your email for a summary.`
            : `${sourceLabel}Bulk test failed. Processed ${test.processedFiles} of ${test.totalFiles} files.`;
          
          toast.success(message, 5000);
          return true; // Signal to stop polling
        }
        return false; // Continue polling
      } catch (error) {
        console.error('Error polling bulk test status:', error);
        setShowBulkModal(false);
        setTestingParser(false);
        setBulkTestPollingInterval(null); // Clear interval reference
        toast.error('Error checking test status', 8000);
        return true; // Stop polling on error
      }
    };
    
    // Poll immediately
    const shouldStop = await pollOnce();
    if (shouldStop) return;
    
    // Then poll every 2 seconds
    const pollInterval = setInterval(async () => {
      const shouldStop = await pollOnce();
      if (shouldStop) {
        clearInterval(pollInterval);
        setBulkTestPollingInterval(null);
      }
    }, 2000);
    
    // Store interval ID so it can be cancelled
    setBulkTestPollingInterval(pollInterval);
    
    // Return interval ID for reference
    return pollInterval;
  };

  const handleCancelBulkTest = async () => {
    // Stop polling if active
    if (bulkTestPollingInterval) {
      clearInterval(bulkTestPollingInterval);
      setBulkTestPollingInterval(null);
    }
    
    // If there's a test ID, clean up the files on the backend
    if (bulkTestId) {
      try {
        await api.delete(`/api/parsing/test-parse-bulk/${bulkTestId}`);
        console.log('✅ Cancelled bulk test and cleaned up temp files');
      } catch (error) {
        console.error('Error cleaning up cancelled test:', error);
        // Continue with cancel even if cleanup fails
      }
    }
    
    // Close modal and reset state
    setShowBulkModal(false);
    setTestingParser(false);
    setBulkTestStatus(null);
    setBulkTestId(null);
    setBulkTestResults(null);
    toast.info('Bulk test cancelled. Temp files cleaned up.', 3000);
  };

  const handleFinishBulkTest = async () => {
    if (!bulkTestId) return;

    try {
      await api.delete(`/api/parsing/test-parse-bulk/${bulkTestId}`);
      setBulkTestId(null);
      setBulkTestStatus(null);
      setBulkTestResults(null);
      setTestFiles([]);
      setSelectedResultFile(null);
      toast.success('Bulk test finished and files cleaned up', 5000);
    } catch (error) {
      console.error('Error finishing bulk test:', error);
      const errorMessage = error.response?.data?.message || error.message;
      toast.error('Error finishing test: ' + errorMessage, 8000);
    }
  };

  const handleCleanTempFolder = async () => {
    if (!window.confirm('Are you sure you want to delete all files in the temp folder? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await api.delete('/api/parsing/clean-temp-folder');
      
      if (response.data.success) {
        setCleanTempResult({
          success: true,
          deletedFiles: response.data.deletedFiles || 0,
          errorCount: response.data.errorCount || 0,
          message: response.data.message
        });
        setShowCleanTempModal(true);
      } else {
        setCleanTempResult({
          success: false,
          deletedFiles: 0,
          errorCount: 0,
          message: response.data.message || 'Failed to clean temp folder'
        });
        setShowCleanTempModal(true);
      }
    } catch (error) {
      console.error('Error cleaning temp folder:', error);
      const errorMessage = error.response?.data?.message || error.message;
      setCleanTempResult({
        success: false,
        deletedFiles: 0,
        errorCount: 0,
        message: 'Error cleaning temp folder: ' + errorMessage
      });
      setShowCleanTempModal(true);
    }
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    
    // Single file upload
    if (files.length === 1) {
      const file = files[0];
      if (file.type !== 'application/pdf') {
        toast.error('Please select a PDF file');
        e.target.value = '';
        return;
      }
      setTestFile(file);
      setTestFiles([]);
      setTestResults(null);
      setTestError(null);
      setBulkTestId(null);
      setBulkTestResults(null);
    } else {
      // Bulk upload (max 100)
      if (files.length > 100) {
        toast.error('Maximum 100 files allowed for bulk testing');
        e.target.value = '';
        return;
      }
      // Validate all files are PDFs
      const invalidFiles = files.filter(f => f.type !== 'application/pdf');
      if (invalidFiles.length > 0) {
        toast.error('All files must be PDFs');
        e.target.value = '';
        return;
      }
      setTestFile(null);
      setTestFiles(files);
      setTestResults(null);
      setTestError(null);
      setBulkTestId(null);
      setBulkTestResults(null);
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
                                When enabled, only external users (customers) can change document status automatically (viewed/downloaded). 
                                Internal staff activity will not update document status automatically. 
                                <strong>Note:</strong> Global Administrators are always exempt from this restriction and can change document status at any time.
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

                      {/* Test Import Logic Section */}
                      <div className="card mt-4">
                        <div className="card-header">
                          <h3 className="card-title">Test Import Logic (Without Parser)</h3>
                          <p className="card-subtitle text-muted">Test the import logic with mock data - bypasses FTP and parsing</p>
                        </div>
                        <div className="card-body">
                          <div className="alert alert-info">
                            <strong>Note:</strong> This creates a test file with mock parsed data to test company matching and document creation. No actual PDF or FTP is needed.
                          </div>
                          
                          <div className="row g-3">
                            <div className="col-md-6">
                              <label className="form-label">File Name (optional)</label>
                              <input
                                type="text"
                                className="form-control"
                                value={testImportData.fileName}
                                onChange={(e) => setTestImportData(prev => ({ ...prev, fileName: e.target.value }))}
                                placeholder="test-invoice-123.pdf"
                              />
                            </div>
                            <div className="col-md-6">
                              <label className="form-label">Document Type</label>
                              <select
                                className="form-select"
                                value={testImportData.fileType}
                                onChange={(e) => setTestImportData(prev => ({ ...prev, fileType: e.target.value }))}
                              >
                                <option value="invoice">Invoice</option>
                                <option value="credit_note">Credit Note</option>
                                <option value="statement">Statement</option>
                              </select>
                            </div>
                            <div className="col-md-6">
                              <label className="form-label">Account Number / Company Number *</label>
                              <input
                                type="text"
                                className="form-control"
                                value={testImportData.accountNumber}
                                onChange={(e) => setTestImportData(prev => ({ ...prev, accountNumber: e.target.value }))}
                                placeholder="12345"
                              />
                              <small className="form-hint">Will try to match to a company</small>
                            </div>
                            <div className="col-md-6">
                              <label className="form-label">Invoice/Document Number</label>
                              <input
                                type="text"
                                className="form-control"
                                value={testImportData.invoiceNumber}
                                onChange={(e) => setTestImportData(prev => ({ ...prev, invoiceNumber: e.target.value }))}
                                placeholder="INV-001"
                              />
                            </div>
                            <div className="col-md-6">
                              <label className="form-label">Amount</label>
                              <input
                                type="number"
                                step="0.01"
                                className="form-control"
                                value={testImportData.amount}
                                onChange={(e) => setTestImportData(prev => ({ ...prev, amount: e.target.value }))}
                                placeholder="1500.00"
                              />
                            </div>
                            <div className="col-md-6">
                              <label className="form-label">Date</label>
                              <input
                                type="date"
                                className="form-control"
                                value={testImportData.date}
                                onChange={(e) => setTestImportData(prev => ({ ...prev, date: e.target.value }))}
                              />
                            </div>
                          </div>

                          <div className="mt-3">
                            <button
                              className="btn btn-primary"
                              onClick={handleTestImportLogic}
                              disabled={testingImportLogic || (!testImportData.accountNumber && !testImportData.invoiceNumber)}
                            >
                              {testingImportLogic ? (
                                <>
                                  <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                                  Testing...
                                </>
                              ) : (
                                'Test Import Logic'
                              )}
                            </button>
                            <button
                              className="btn btn-outline-secondary ms-2"
                              onClick={() => {
                                setTestImportData({
                                  fileName: '',
                                  fileType: 'invoice',
                                  accountNumber: '',
                                  invoiceNumber: '',
                                  amount: '',
                                  date: ''
                                });
                                setTestImportResult(null);
                              }}
                              disabled={testingImportLogic}
                            >
                              Clear
                            </button>
                          </div>

                          {testImportResult && (
                            <div className="card mt-3">
                              <div className="card-body">
                                <h4 className="card-title">Test Result</h4>
                                <div className="mb-2">
                                  <strong>Status:</strong>{' '}
                                  <span className={`badge ${testImportResult.file.status === 'parsed' ? 'bg-success-lt' : 'bg-warning-lt'}`}>
                                    {testImportResult.file.status}
                                  </span>
                                </div>
                                <div className="mb-2">
                                  <strong>File ID:</strong> {testImportResult.file.id}
                                </div>
                                <div className="mb-2">
                                  <strong>File Name:</strong> {testImportResult.file.fileName}
                                </div>
                                {testImportResult.file.failureReason && (
                                  <div className="mb-2">
                                    <strong>Failure Reason:</strong>{' '}
                                    <span className="badge bg-warning-lt">{testImportResult.file.failureReason}</span>
                                  </div>
                                )}
                                <div className="mb-2">
                                  <strong>Company Match:</strong>{' '}
                                  {testImportResult.company.matched ? (
                                    <span className="badge bg-success-lt">Matched (ID: {testImportResult.company.id})</span>
                                  ) : (
                                    <span className="badge bg-warning-lt">Not Matched - {testImportResult.company.reason}</span>
                                  )}
                                </div>
                                {testImportResult.document && (
                                  <div className="mb-2">
                                    <strong>Document Created:</strong>{' '}
                                    <span className="badge bg-success-lt">{testImportResult.document.type} (ID: {testImportResult.document.id})</span>
                                  </div>
                                )}
                                <div className="mt-3">
                                  <strong>Parsed Data:</strong>
                                  <pre className="bg-light p-2 rounded mt-2" style={{ fontSize: '0.85rem' }}>
                                    {JSON.stringify(testImportResult.parsedData, null, 2)}
                                  </pre>
                                </div>
                                <div className="mt-3">
                                  <a href="/unallocated" className="btn btn-sm btn-outline-primary">
                                    View in Unallocated
                                  </a>
                                  {testImportResult.file.status === 'parsed' && (
                                    <>
                                      {testImportResult.document?.type === 'invoice' && (
                                        <a href="/invoices" className="btn btn-sm btn-outline-primary ms-2">
                                          View Invoice
                                        </a>
                                      )}
                                      {testImportResult.document?.type === 'credit_note' && (
                                        <a href="/credit-notes" className="btn btn-sm btn-outline-primary ms-2">
                                          View Credit Note
                                        </a>
                                      )}
                                      {testImportResult.document?.type === 'statement' && (
                                        <a href="/statements" className="btn btn-sm btn-outline-primary ms-2">
                                          View Statement
                                        </a>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {activeSection === 'parsing' && (
                    <>
                      <h2 className="mb-4">Parsing Provider</h2>
                      <p className="card-subtitle mb-4">Configure and test your PDF parsing providers. You can use Google Document AI or local coordinate-based parsing.</p>
                      
                      {/* Main Tabs: Configuration and Testing */}
                      <div className="card mb-4">
                        <div className="card-header">
                          <ul className="nav nav-tabs card-header-tabs" data-bs-toggle="tabs">
                            <li className="nav-item">
                              <a 
                                href="#parsing-config-tab" 
                                className={`nav-link ${activeParsingSection === 'configuration' ? 'active' : ''}`}
                                onClick={(e) => { e.preventDefault(); setActiveParsingSection('configuration'); }}
                              >
                                Configuration
                              </a>
                            </li>
                            <li className="nav-item">
                              <a 
                                href="#parsing-test-tab" 
                                className={`nav-link ${activeParsingSection === 'testing' ? 'active' : ''}`}
                                onClick={(e) => { e.preventDefault(); setActiveParsingSection('testing'); }}
                              >
                                Testing
                              </a>
                            </li>
                          </ul>
                        </div>
                        <div className="card-body">
                          <div className="tab-content">
                            {/* Configuration Tab */}
                            <div className={`tab-pane ${activeParsingSection === 'configuration' ? 'active show' : ''}`} id="parsing-config-tab">
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

                            {/* Testing Tab */}
                            <div className={`tab-pane ${activeParsingSection === 'testing' ? 'active show' : ''}`} id="parsing-test-tab">
                              <h3 className="mb-3">Parser Testing</h3>
                              <p className="text-muted mb-4">Upload a PDF to test the parsing capabilities and see extracted text.</p>
                      
                      <div className="card mb-3">
                        <div className="card-body">
                          <div className="row g-3">
                            <div className="col-md-6">
                              <label className="form-label">
                                {testFiles.length > 0 ? 'Select PDF Files (Bulk Test)' : 'Select PDF File'}
                              </label>
                              <input
                                type="file"
                                className="form-control"
                                accept=".pdf,application/pdf"
                                onChange={handleFileSelect}
                                disabled={testingParser}
                                multiple
                              />
                              {testFile && (
                                <small className="text-muted d-block mt-1">
                                  Selected: {testFile.name} ({(testFile.size / 1024).toFixed(2)} KB)
                                </small>
                              )}
                              {testFiles.length > 0 && (
                                <small className="text-muted d-block mt-1">
                                  Selected: {testFiles.length} file(s) (Bulk Test Mode)
                                  {testFiles.length > 0 && (
                                    <ul className="mt-2 mb-0" style={{ fontSize: '0.85em' }}>
                                      {testFiles.slice(0, 5).map((file, idx) => (
                                        <li key={idx}>{file.name} ({(file.size / 1024).toFixed(2)} KB)</li>
                                      ))}
                                      {testFiles.length > 5 && <li>... and {testFiles.length - 5} more</li>}
                                    </ul>
                                  )}
                                </small>
                              )}
                            </div>
                            <div className="col-md-6">
                              <label className="form-label">Parser</label>
                              <select
                                className="form-select"
                                value={testParser}
                                onChange={(e) => setTestParser(e.target.value)}
                                disabled={testingParser}
                              >
                                <option value="local">Local PDF Extraction (Recommended - No Cloud Costs)</option>
                                <option value="auto">Auto (Local first, fallback to cloud)</option>
                                <option value="vision">Google Vision API (Images, PDFs with GCS)</option>
                                <option value="documentai">Google Document AI (PDFs & Documents)</option>
                              </select>
                              <small className="text-muted d-block mt-1">
                                Note: Vision API can process PDFs but requires Google Cloud Storage setup. Document AI is simpler and recommended for PDFs.
                              </small>
                            </div>
                          </div>
                          
                          <div className="mt-3">
                            <button
                              className="btn btn-primary"
                              onClick={handleTestParser}
                              disabled={(!testFile && testFiles.length === 0) || testingParser}
                            >
                              {testingParser ? (
                                <>
                                  <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                                  {testFiles.length > 0 ? 'Starting Bulk Test...' : 'Parsing...'}
                                </>
                              ) : (
                                testFiles.length > 0 ? `Test ${testFiles.length} File(s)` : 'Test Parser'
                              )}
                            </button>
                            
                            <div className="d-inline-block ms-3">
                              <select
                                className="form-select d-inline-block"
                                style={{ width: 'auto', marginRight: '8px' }}
                                value={ftpParseType}
                                onChange={(e) => setFtpParseType(e.target.value)}
                                disabled={connectingFTP || testingParser}
                              >
                                <option value="pdf">Test PDF Parse</option>
                                <option value="excel">Test Excel Parse</option>
                              </select>
                              <button
                                className="btn btn-info"
                                onClick={handleConnectFTP}
                                disabled={connectingFTP || testingParser}
                              >
                                {connectingFTP ? (
                                  <>
                                    <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                                    Connecting to FTP...
                                  </>
                                ) : (
                                  'Connect and Test FTP'
                                )}
                              </button>
                              <button 
                                className="btn btn-warning ms-2"
                                onClick={handleCleanTempFolder}
                                title="Manually clean all files in temp folder"
                                disabled={connectingFTP || testingParser}
                              >
                                <i className="fas fa-broom me-1"></i>
                                Clean Temp Folder
                              </button>
                            </div>
                            {(testFile || testFiles.length > 0) && (
                              <button
                                className="btn btn-outline-secondary ms-2"
                                onClick={() => {
                                  setTestFile(null);
                                  setTestFiles([]);
                                  setTestResults(null);
                                  setTestError(null);
                                  setBulkTestId(null);
                                  setBulkTestResults(null);
                                }}
                                disabled={testingParser}
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {testError && (
                        <div className="alert alert-danger">
                          <strong>Error:</strong> {testError}
                        </div>
                      )}

                      {testResults && (
                        <div className="card">
                          <div className="card-header">
                            <h3 className="card-title">Parsing Results</h3>
                          </div>
                          <div className="card-body">
                            <div className="row mb-3">
                              <div className="col-md-4">
                                <div className="card">
                                  <div className="card-body">
                                    <div className="d-flex align-items-center">
                                      <div className="subheader">Confidence Score</div>
                                    </div>
                                    <div className="h1 mb-3">
                                      <span className={testResults.confidence >= 70 ? 'text-green' : testResults.confidence >= 50 ? 'text-yellow' : 'text-red'}>
                                        {testResults.confidence}%
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="col-md-4">
                                <div className="card">
                                  <div className="card-body">
                                    <div className="d-flex align-items-center">
                                      <div className="subheader">Parser Used</div>
                                    </div>
                                    <div className="h1 mb-3">
                                      <span className="badge bg-info-lt">
                                        {testResults.processingMethod === 'vision_api' || testResults.processingMethod === 'vision' ? 'Vision API' : 
                                         testResults.processingMethod === 'document_ai' || testResults.processingMethod === 'documentai' ? 'Document AI' :
                                         testResults.processingMethod?.startsWith('local_coordinates') ? 'Local Template Extraction' :
                                         testResults.processingMethod === 'local_basic' ? 'Local Basic Extraction' :
                                         testResults.processingMethod || 'Unknown'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="col-md-4">
                                <div className="card">
                                  <div className="card-body">
                                    <div className="d-flex align-items-center">
                                      <div className="subheader">Template Used</div>
                                    </div>
                                    <div className="h1 mb-3">
                                      {testResults.templateName ? (
                                        <>
                                          <div className="text-truncate" title={testResults.templateName}>
                                            {testResults.templateName}
                                          </div>
                                          {testResults.templateId && (
                                            <small className="text-muted d-block mt-1">
                                              ID: {testResults.templateId.substring(0, 8)}...
                                            </small>
                                          )}
                                        </>
                                      ) : (
                                        <span className="text-muted">No template</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="row mb-3">
                              <div className="col-md-6">
                                <div className="card">
                                  <div className="card-body">
                                    <div className="d-flex align-items-center">
                                      <div className="subheader">Text Length</div>
                                    </div>
                                    <div className="h1 mb-3">{testResults.textLength.toLocaleString()} characters</div>
                                  </div>
                                </div>
                              </div>
                              <div className="col-md-6">
                                <div className="card">
                                  <div className="card-body">
                                    <div className="d-flex align-items-center">
                                      <div className="subheader">Word Count</div>
                                    </div>
                                    <div className="h1 mb-3">{testResults.wordCount.toLocaleString()} words</div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <h4 className="mt-4 mb-3">Extracted Fields</h4>
                            <div className="table-responsive">
                              <table className="table table-vcenter">
                                <thead>
                                  <tr>
                                    <th>Field</th>
                                    <th>Value</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(() => {
                                    // Get extracted fields and field labels from template
                                    const extractedFields = testResults.extractedFields || {};
                                    const fieldLabels = testResults.fieldLabels || {};
                                    const parsedData = testResults.parsedData || {};
                                    
                                    // Map common field name aliases to standard names
                                    const fieldNameMap = {
                                      'date': 'invoiceDate',
                                      'amount': 'totalAmount',
                                      'invoice_date': 'invoiceDate',
                                      'total': 'totalAmount'
                                    };
                                    
                                    // Build a map of all possible field names to their standard names
                                    const allFieldNames = new Map();
                                    Object.values(STANDARD_FIELDS).forEach(field => {
                                      // Add standard name
                                      allFieldNames.set(field.standardName, field.standardName);
                                      // Add aliases
                                      if (field.aliases) {
                                        field.aliases.forEach(alias => {
                                          allFieldNames.set(alias, field.standardName);
                                        });
                                      }
                                    });
                                    // Add explicit mappings
                                    Object.entries(fieldNameMap).forEach(([alias, standardName]) => {
                                      allFieldNames.set(alias, standardName);
                                    });
                                    
                                    // CRITICAL: Only show fields that are defined in the template (fieldLabels)
                                    // fieldLabels contains ALL fields that are in the template, regardless of extraction success
                                    // Exclude pageNo as it's auto-extracted from the file
                                    const templateFieldNames = Object.keys(fieldLabels).filter(name => name !== 'pageNo');
                                    
                                    if (templateFieldNames.length === 0) {
                                      return (
                                        <tr>
                                          <td colSpan="2" className="text-center text-muted">
                                            No template fields defined. Please create a template first.
                                          </td>
                                        </tr>
                                      );
                                    }
                                    
                                    // Build list of fields to show - ONLY template-defined fields, in template order
                                    const fieldsToShow = templateFieldNames
                                      .map(standardName => {
                                        // Get field definition for parsing order
                                        const fieldDef = STANDARD_FIELDS[standardName];
                                        const displayName = fieldLabels[standardName] || fieldDef?.displayName || standardName;
                                        
                                        // Get value from multiple sources, checking aliases too
                                        let value = null;
                                        
                                        // First check extractedFields with standard name
                                        if (extractedFields[standardName] !== undefined) {
                                          value = extractedFields[standardName];
                                        }
                                        // Then check extractedFields with aliases
                                        else {
                                          for (const [key, val] of Object.entries(extractedFields)) {
                                            if (allFieldNames.get(key) === standardName) {
                                              value = val;
                                              break;
                                            }
                                          }
                                        }
                                        
                                        // If still not found, check parsedData with standard name
                                        if (value === null && parsedData[standardName] !== undefined) {
                                          value = parsedData[standardName];
                                        }
                                        // Finally check parsedData with aliases
                                        else if (value === null) {
                                          for (const [key, val] of Object.entries(parsedData)) {
                                            if (allFieldNames.get(key) === standardName) {
                                              value = val;
                                              break;
                                            }
                                          }
                                        }
                                        
                                        return {
                                          key: standardName,
                                          displayName,
                                          value,
                                          parsingOrder: fieldDef?.parsingOrder || 999
                                        };
                                      })
                                      .sort((a, b) => a.parsingOrder - b.parsingOrder);
                                    
                                    // If no fields extracted, show message
                                    if (fieldsToShow.length === 0) {
                                      return (
                                        <tr>
                                          <td colSpan="2" className="text-center text-muted">
                                            No fields extracted from template
                                          </td>
                                        </tr>
                                      );
                                    }
                                    
                                    // Display fields in template order (already sorted by parsingOrder)
                                    return fieldsToShow.map(({ key, displayName, value }) => {
                                      // Format monetary values
                                      let displayValue = value;
                                      
                                      // Handle different value types
                                      if (value === null || value === undefined || value === '') {
                                        displayValue = <span className="text-muted">Not found</span>;
                                      } else if (typeof value === 'object') {
                                        // If it's an object, stringify it
                                        displayValue = JSON.stringify(value, null, 2);
                                      } else if (Array.isArray(value)) {
                                        // If it's an array, join it or stringify
                                        displayValue = value.length > 0 ? value.join(', ') : <span className="text-muted">Empty</span>;
                                      } else if (key === 'totalAmount' || key === 'goodsAmount' || key === 'vatAmount' || key === 'amount' || key === 'total') {
                                        // Format monetary values
                                        const numValue = parseFloat(value);
                                        if (!isNaN(numValue)) {
                                          displayValue = `£${numValue.toFixed(2)}`;
                                        }
                                      } else {
                                        // Convert to string for display
                                        displayValue = String(value);
                                      }
                                      
                                      return (
                                        <tr key={key}>
                                          <td><strong>{displayName}</strong></td>
                                          <td>{displayValue}</td>
                                        </tr>
                                      );
                                    });
                                  })()}
                                </tbody>
                              </table>
                            </div>

                            <h4 className="mt-4 mb-3">Extracted JSON</h4>
                            <div className="card">
                              <div className="card-body">
                                <pre className="bg-light p-3 rounded text-dark" style={{ maxHeight: '500px', overflow: 'auto', whiteSpace: 'pre-wrap', wordWrap: 'break-word', color: '#212529', fontSize: '0.875rem' }}>
                                  {JSON.stringify(testResults.parsedData || {}, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Bulk Test Results */}
                      {bulkTestResults && (
                        <div className="card mt-4">
                          <div className="card-header d-flex justify-content-between align-items-center">
                            <h3 className="card-title">
                              {bulkTestSource === 'ftp' ? 'FTP Parsing Test Results' : 'Bulk Test Results'}
                              {bulkTestSource === 'ftp' && (
                                <span className="badge bg-info-lt ms-2">FTP Import</span>
                              )}
                            </h3>
                            <div>
                              <button
                                className="btn btn-warning btn-sm me-2"
                                onClick={handleCleanTempFolder}
                                title="Manually clean all files in temp folder"
                              >
                                <i className="fas fa-broom me-1"></i>
                                Clean Temp Folder
                              </button>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={handleFinishBulkTest}
                              >
                                Finish Test
                              </button>
                            </div>
                          </div>
                          <div className="card-body">
                            {/* Summary Stats */}
                            <div className="row mb-4">
                              <div className="col-md-3">
                                <div className="card">
                                  <div className="card-body">
                                    <div className="subheader">Files Imported</div>
                                    <div className="h1 mb-0">{bulkTestResults.summary?.filesImported || 0}</div>
                                  </div>
                                </div>
                              </div>
                              <div className="col-md-3">
                                <div className="card">
                                  <div className="card-body">
                                    <div className="subheader">Files Parsed</div>
                                    <div className="h1 mb-0 text-success">{bulkTestResults.summary?.filesParsed || 0}</div>
                                  </div>
                                </div>
                              </div>
                              <div className="col-md-3">
                                <div className="card">
                                  <div className="card-body">
                                    <div className="subheader">Files Completed</div>
                                    <div className="h1 mb-0">{bulkTestResults.summary?.filesCompleted || 0}</div>
                                  </div>
                                </div>
                              </div>
                              <div className="col-md-3">
                                <div className="card">
                                  <div className="card-body">
                                    <div className="subheader">Avg Confidence</div>
                                    <div className="h1 mb-0">{bulkTestResults.summary?.avgConfidence || 0}%</div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="row mb-4">
                              <div className="col-md-6">
                                <div className="card">
                                  <div className="card-body">
                                    <div className="subheader">Avg Processing Time</div>
                                    <div className="h1 mb-0">{(bulkTestResults.summary?.avgProcessingTime / 1000).toFixed(2)}s</div>
                                  </div>
                                </div>
                              </div>
                              <div className="col-md-6">
                                <div className="card">
                                  <div className="card-body">
                                    <div className="subheader">Total Processing Time</div>
                                    <div className="h1 mb-0">{(bulkTestResults.summary?.totalProcessingTime / 1000).toFixed(2)}s</div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Results Table */}
                            <h4 className="mt-4 mb-3">File Results</h4>
                            <div className="table-responsive">
                              <table className="table table-vcenter">
                                <thead>
                                  <tr>
                                    <th>File Name</th>
                                    <th>Status</th>
                                    <th>Confidence</th>
                                    <th>Processing Time</th>
                                    <th>Timestamp</th>
                                    <th>Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {bulkTestResults.results?.map((result, idx) => (
                                    <tr key={idx}>
                                      <td>
                                        <strong>{result.fileName}</strong>
                                        {result.error && (
                                          <div className="text-danger small mt-1">{result.error}</div>
                                        )}
                                      </td>
                                      <td>
                                        {result.success ? (
                                          <span className="badge bg-success-lt">Success</span>
                                        ) : (
                                          <span className="badge bg-danger-lt">Failed</span>
                                        )}
                                      </td>
                                      <td>
                                        <span className={result.confidence >= 70 ? 'text-green' : result.confidence >= 50 ? 'text-yellow' : 'text-red'}>
                                          {result.confidence}%
                                        </span>
                                      </td>
                                      <td>{(result.processingTime / 1000).toFixed(2)}s</td>
                                      <td>{new Date(result.timestamp).toLocaleString()}</td>
                                      <td>
                                        <button
                                          className="btn btn-sm btn-primary"
                                          onClick={() => setSelectedResultFile(result)}
                                        >
                                          View Details
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Individual File Details Modal */}
                      {selectedResultFile && (
                        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
                          <div className="modal-dialog modal-xl">
                            <div className="modal-content">
                              <div className="modal-header">
                                <h5 className="modal-title">File Details: {selectedResultFile.fileName}</h5>
                                <button
                                  type="button"
                                  className="btn-close"
                                  onClick={() => setSelectedResultFile(null)}
                                ></button>
                              </div>
                              <div className="modal-body">
                                <div className="row mb-3">
                                  <div className="col-md-6">
                                    <strong>Confidence:</strong> {selectedResultFile.confidence}%
                                  </div>
                                  <div className="col-md-6">
                                    <strong>Processing Time:</strong> {(selectedResultFile.processingTime / 1000).toFixed(2)}s
                                  </div>
                                </div>

                                <h5 className="mt-4 mb-3">Extracted Fields</h5>
                                <div className="table-responsive">
                                  <table className="table table-sm">
                                    <thead>
                                      <tr>
                                        <th>Field</th>
                                        <th>Value</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {(() => {
                                        const extractedFields = selectedResultFile.extractedFields || {};
                                        const fieldLabels = selectedResultFile.fieldLabels || {};
                                        const defaultFieldNames = {
                                          documentType: 'Document Type',
                                          accountNumber: 'Account No',
                                          invoiceNumber: 'Invoice No',
                                          date: 'Date',
                                          customerPO: 'Customer PO',
                                          goodsAmount: 'Goods',
                                          vatAmount: 'VAT Amount',
                                          amount: 'Total',
                                          customerName: 'Customer Name'
                                        };
                                        
                                        // Filter out metadata fields and only show fields that were actually extracted
                                        const fieldsToShow = Object.keys(extractedFields).filter(key => 
                                          key !== 'templateId' && 
                                          key !== 'templateName' && 
                                          key !== 'fieldLabels' &&
                                          key !== 'fullText' &&
                                          extractedFields[key] !== null &&
                                          extractedFields[key] !== undefined &&
                                          extractedFields[key] !== ''
                                        );
                                        
                                        if (fieldsToShow.length === 0) {
                                          return (
                                            <tr>
                                              <td colSpan="2" className="text-center text-muted">
                                                No fields extracted from template
                                              </td>
                                            </tr>
                                          );
                                        }
                                        
                                        // Sort fields by display name for better readability
                                        return fieldsToShow
                                          .map(key => ({
                                            key,
                                            displayName: fieldLabels[key] || defaultFieldNames[key] || key,
                                            value: extractedFields[key]
                                          }))
                                          .sort((a, b) => a.displayName.localeCompare(b.displayName))
                                          .map(({ key, displayName, value }) => {
                                            let displayValue = value;
                                            
                                            if (value && (key === 'totalAmount' || key === 'goodsAmount' || key === 'vatAmount' || key === 'amount' || key === 'total')) {
                                              const numValue = parseFloat(value);
                                              if (!isNaN(numValue)) {
                                                displayValue = `£${numValue.toFixed(2)}`;
                                              }
                                            }
                                          
                                          return (
                                            <tr key={key}>
                                              <td><strong>{displayName}</strong></td>
                                              <td>{displayValue || <span className="text-muted">Not found</span>}</td>
                                            </tr>
                                          );
                                        });
                                      })()}
                                    </tbody>
                                  </table>
                                </div>

                                <h5 className="mt-4 mb-3">Full Extracted Text</h5>
                                <div className="card">
                                  <div className="card-body">
                                    <pre className="bg-light p-3 rounded text-dark" style={{ maxHeight: '300px', overflow: 'auto', whiteSpace: 'pre-wrap', wordWrap: 'break-word', fontSize: '0.85em' }}>
                                      {(() => {
                                        // If fullText is already formatted with display names, use it as-is
                                        // Otherwise, format it using fieldLabels
                                        const fullText = selectedResultFile.fullText || 'No text extracted';
                                        const fieldLabels = selectedResultFile.fieldLabels || {};
                                        
                                        // If fullText contains raw field names, replace them with display names
                                        let formattedText = fullText;
                                        if (fieldLabels && Object.keys(fieldLabels).length > 0) {
                                          Object.entries(fieldLabels).forEach(([fieldName, displayName]) => {
                                            // Replace fieldName: value with displayName: value
                                            const regex = new RegExp(`\\b${fieldName}:`, 'gi');
                                            formattedText = formattedText.replace(regex, `${displayName}:`);
                                          });
                                        }
                                        
                                        return formattedText;
                                      })()}
                                    </pre>
                                  </div>
                                </div>
                              </div>
                              <div className="modal-footer">
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={() => setSelectedResultFile(null)}
                                >
                                  Close
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Bulk Processing Modal */}
                      {showBulkModal && (
                        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
                          <div className="modal-dialog">
                            <div className="modal-content">
                              <div className="modal-header">
                                <h5 className="modal-title">
                                  {bulkTestSource === 'ftp' ? 'FTP Parsing Test' : 'Processing Bulk Test'}
                                </h5>
                                <button
                                  type="button"
                                  className="btn-close"
                                  onClick={handleCancelBulkTest}
                                  aria-label="Cancel"
                                ></button>
                              </div>
                              <div className="modal-body text-center">
                                <div className="spinner-border text-primary mb-3" role="status" style={{ width: '3rem', height: '3rem' }}>
                                  <span className="visually-hidden">Loading...</span>
                                </div>
                                <h5>
                                  {bulkTestSource === 'ftp' ? 'FTP ' : ''}Processing {bulkTestStatus ? `${bulkTestStatus.processedFiles} of ${bulkTestStatus.totalFiles}` : (bulkTestSource === 'ftp' ? 'files from FTP' : testFiles.length)} {bulkTestSource === 'ftp' ? (bulkTestFileType === 'excel' ? 'Excel' : 'PDF') : 'PDF'}(s)
                                </h5>
                                <p className="text-muted">
                                  {bulkTestSource === 'ftp' 
                                    ? `Downloading and parsing ${bulkTestFileType === 'excel' ? 'Excel' : 'PDF'} files from FTP server...`
                                    : 'Please wait...'}
                                </p>
                                {bulkTestStatus && (
                                  <div className="mt-3">
                                    <div className="progress" style={{ height: '20px' }}>
                                      <div
                                        className="progress-bar progress-bar-striped progress-bar-animated"
                                        role="progressbar"
                                        style={{ width: `${bulkTestStatus.progress || 0}%` }}
                                        aria-valuenow={bulkTestStatus.progress || 0}
                                        aria-valuemin="0"
                                        aria-valuemax="100"
                                      >
                                        {bulkTestStatus.progress || 0}%
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* FTP Preview Modal */}
                      {showFTPPreviewModal && ftpPreviewData && (
                        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
                          <div className="modal-dialog modal-xl">
                            <div className="modal-content">
                              <div className="modal-header">
                                <h5 className="modal-title">
                                  <i className="fas fa-check-circle text-success me-2"></i>
                                  Connected to FTP Server
                                </h5>
                                <button
                                  type="button"
                                  className="btn-close"
                                  onClick={() => {
                                    setShowFTPPreviewModal(false);
                                    setFtpPreviewData(null);
                                  }}
                                ></button>
                              </div>
                              <div className="modal-body">
                                <div className="alert alert-success">
                                  <i className="fas fa-check-circle me-2"></i>
                                  <strong>Connection Successful!</strong>
                                  <p className="mb-0 mt-2">{ftpPreviewData.message}</p>
                                </div>

                                <div className="card mb-3">
                                  <div className="card-body">
                                    <h6 className="card-title">
                                      <i className={`fas ${ftpPreviewData.fileType === 'excel' ? 'fa-file-excel text-success' : 'fa-file-pdf text-danger'} me-2`}></i>
                                      {ftpPreviewData.fileType === 'excel' ? 'Excel Files Found' : 'PDF Files Found'}
                                    </h6>
                                    <div className="d-flex align-items-center">
                                      <h2 className="mb-0 me-3">
                                        {ftpPreviewData.fileType === 'excel' 
                                          ? (ftpPreviewData.totalExcelFiles || 0)
                                          : (ftpPreviewData.totalPdfFiles || 0)
                                        }
                                      </h2>
                                      <span className="text-muted">
                                        {ftpPreviewData.fileType === 'excel' 
                                          ? `${ftpPreviewData.totalExcelFiles === 1 ? 'Excel file' : 'Excel files'} available`
                                          : `${ftpPreviewData.totalPdfFiles === 1 ? 'PDF file' : 'PDF files'} available`
                                        }
                                        {(ftpPreviewData.fileType === 'excel' ? ftpPreviewData.totalExcelFiles : ftpPreviewData.totalPdfFiles) > 100 && ' (will process first 100)'}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {((ftpPreviewData.fileType === 'excel' && ftpPreviewData.excelFiles) || (ftpPreviewData.fileType === 'pdf' && ftpPreviewData.pdfFiles)) && 
                                 ((ftpPreviewData.fileType === 'excel' ? ftpPreviewData.excelFiles : ftpPreviewData.pdfFiles).length > 0) && (
                                  <div className="card">
                                    <div className="card-header">
                                      <h6 className="card-title mb-0">
                                        Sample Files (showing first {Math.min((ftpPreviewData.fileType === 'excel' ? ftpPreviewData.excelFiles : ftpPreviewData.pdfFiles).length, 10)})
                                      </h6>
                                    </div>
                                    <div className="card-body">
                                      <div className="table-responsive" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                        <table className="table table-sm table-hover">
                                          <thead>
                                            <tr>
                                              <th>File Name</th>
                                              <th>Size</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {(ftpPreviewData.fileType === 'excel' ? ftpPreviewData.excelFiles : ftpPreviewData.pdfFiles).slice(0, 10).map((file, index) => (
                                              <tr key={index}>
                                                <td>
                                                  <i className={`fas ${ftpPreviewData.fileType === 'excel' ? 'fa-file-excel text-success' : 'fa-file-pdf text-danger'} me-2`}></i>
                                                  {file.name}
                                                </td>
                                                <td>
                                                  {file.size > 0 ? (
                                                    (file.size / 1024).toFixed(2) + ' KB'
                                                  ) : (
                                                    <span className="text-muted">Unknown</span>
                                                  )}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                      {(ftpPreviewData.fileType === 'excel' ? ftpPreviewData.excelFiles : ftpPreviewData.pdfFiles).length > 10 && (
                                        <p className="text-muted text-center mt-2 mb-0">
                                          ... and {(ftpPreviewData.fileType === 'excel' ? ftpPreviewData.excelFiles : ftpPreviewData.pdfFiles).length - 10} more files
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {((ftpPreviewData.fileType === 'excel' && ftpPreviewData.totalExcelFiles === 0) || 
                                  (ftpPreviewData.fileType === 'pdf' && ftpPreviewData.totalPdfFiles === 0)) && (
                                  <div className="alert alert-warning">
                                    <i className="fas fa-exclamation-triangle me-2"></i>
                                    No {ftpPreviewData.fileType === 'excel' ? 'Excel' : 'PDF'} files found on the FTP server.
                                  </div>
                                )}
                              </div>
                              <div className="modal-footer">
                                <button
                                  type="button"
                                  className="btn btn-danger"
                                  onClick={() => {
                                    setShowFTPPreviewModal(false);
                                    setFtpPreviewData(null);
                                  }}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  onClick={handleConfirmFTPParse}
                                  disabled={
                                    (ftpPreviewData.fileType === 'excel' && ftpPreviewData.totalExcelFiles === 0) ||
                                    (ftpPreviewData.fileType === 'pdf' && ftpPreviewData.totalPdfFiles === 0)
                                  }
                                >
                                  <i className="fas fa-play me-2"></i>
                                  Confirm and Parse
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
                        <div className="col-md-6">
                          <label className="form-label">Secondary Colour</label>
                          <div className="input-group">
                            <input
                              type="color"
                              className="form-control form-control-color"
                              value={settings.secondaryColor || '#6c757d'}
                              onChange={(e) => handleSecondaryColourChange(e.target.value)}
                            />
                            <input
                              type="text"
                              className="form-control"
                              value={settings.secondaryColor || '#6c757d'}
                              onChange={(e) => handleSecondaryColourChange(e.target.value)}
                              placeholder="#6c757d"
                            />
                          </div>
                          {settings.secondaryColorShades && (
                            <div className="mt-2">
                              <small className="text-muted">Shades: </small>
                              <span className="badge bg-light-lt" style={{ backgroundColor: settings.secondaryColorShades.light }}>Light</span>
                              <span className="badge bg-light-lt" style={{ backgroundColor: settings.secondaryColorShades.lighter }}>Lighter</span>
                              <span className="badge bg-light-lt" style={{ backgroundColor: settings.secondaryColorShades.dark }}>Dark</span>
                              <span className="badge bg-light-lt" style={{ backgroundColor: settings.secondaryColorShades.darker }}>Darker</span>
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
                              <img src={`${API_URL}${settings.logoLight}`} alt="Light logo" style={{ maxHeight: '50px', display: 'block', marginBottom: '0.5rem' }} />
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
                        <div className="col-md-6">
                          <label className="form-label">Dark Logo</label>
                          <input
                            type="file"
                            className="form-control"
                            accept="image/*"
                            onChange={(e) => handleFileUpload('logo-dark', e.target.files[0])}
                            disabled={uploading['logo-dark']}
                          />
                          {settings.logoDark && (
                            <div className="mt-2">
                              <img src={`${API_URL}${settings.logoDark}`} alt="Dark logo" style={{ maxHeight: '50px', display: 'block', marginBottom: '0.5rem' }} />
                              <button
                                type="button"
                                className="btn btn-ghost-danger btn-sm"
                                onClick={() => handleImageDelete('logo-dark')}
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
                              <img src={`${API_URL}${settings.favicon}`} alt="Favicon" style={{ width: '24px', height: '24px', display: 'block', marginBottom: '0.5rem' }} />
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
                              <img src={`${API_URL}${settings.loginBackgroundImage}`} alt="Background" style={{ maxHeight: '100px', width: 'auto', display: 'block', marginBottom: '0.5rem' }} />
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
                          value={settings.twoFactorAuth?.issuer || 'eInvoice Portal'}
                          onChange={(e) => handleNestedChange('twoFactorAuth', 'issuer', e.target.value)}
                          placeholder="eInvoice Portal"
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
                                  value={settings.emailProvider?.smtp?.fromName || 'eInvoice Portal'}
                                  onChange={(e) => handleEmailProviderNestedChange('smtp', 'fromName', e.target.value)}
                                  placeholder="eInvoice Portal"
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
                                value={settings.emailProvider?.resend?.fromName || 'eInvoice Portal'}
                                onChange={(e) => handleEmailProviderNestedChange('resend', 'fromName', e.target.value)}
                                placeholder="eInvoice Portal"
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
                                value={settings.emailProvider?.smtp2go?.fromName || 'eInvoice Portal'}
                                onChange={(e) => handleEmailProviderNestedChange('smtp2go', 'fromName', e.target.value)}
                                placeholder="eInvoice Portal"
                                disabled={!settings.emailProvider?.enabled}
                              />
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
                  <h4 className="alert-title">⚠️ Warning: This action cannot be undone!</h4>
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

      {/* Clean Temp Folder Result Modal */}
      {showCleanTempModal && cleanTempResult && (
        <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} tabIndex="-1">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className={`fas ${cleanTempResult.success ? 'fa-check-circle text-success' : 'fa-exclamation-triangle text-danger'} me-2`}></i>
                  Clean Temp Folder
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => {
                    setShowCleanTempModal(false);
                    setCleanTempResult(null);
                  }}
                ></button>
              </div>
              <div className="modal-body text-center">
                {cleanTempResult.success ? (
                  <>
                    {cleanTempResult.deletedFiles > 0 ? (
                      <>
                        <div className="mb-3">
                          <i className="fas fa-check-circle text-success" style={{ fontSize: '3rem' }}></i>
                        </div>
                        <h5 className="text-success mb-3">Cleanse Complete</h5>
                        <p className="mb-0">
                          Removed <strong>{cleanTempResult.deletedFiles}</strong> file{cleanTempResult.deletedFiles !== 1 ? 's' : ''}
                          {cleanTempResult.errorCount > 0 && (
                            <span className="text-warning d-block mt-2">
                              <i className="fas fa-exclamation-triangle me-1"></i>
                              {cleanTempResult.errorCount} file{cleanTempResult.errorCount !== 1 ? 's' : ''} could not be deleted
                            </span>
                          )}
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="mb-3">
                          <i className="fas fa-info-circle text-info" style={{ fontSize: '3rem' }}></i>
                        </div>
                        <h5 className="text-info mb-3">Temp Folder Empty</h5>
                        <p className="mb-0">No files found. Temp folder is already empty.</p>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <div className="mb-3">
                      <i className="fas fa-exclamation-triangle text-danger" style={{ fontSize: '3rem' }}></i>
                    </div>
                    <h5 className="text-danger mb-3">Error</h5>
                    <p className="mb-0">{cleanTempResult.message}</p>
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setShowCleanTempModal(false);
                    setCleanTempResult(null);
                  }}
                >
                  Close
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
