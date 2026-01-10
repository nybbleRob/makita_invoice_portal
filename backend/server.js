const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Validate required environment variables at startup
const requiredEnvVars = ['DB_HOST', 'DB_PASSWORD', 'JWT_SECRET'];
const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:', missingEnvVars.join(', '));
  console.error('   Please check your .env file');
  process.exit(1);
}

// Initialize storage configuration early (before routes)
const { ensureStorageDirs } = require('./config/storage');
ensureStorageDirs();

// PostgreSQL connection
const { sequelize, testConnection: testPostgresConnection, syncDatabase } = require('./config/database');

// Redis connection (optional - graceful degradation if not available)
const { redis, testConnection: testRedisConnection, closeConnection: closeRedisConnection } = require('./config/redis');

// Queue system (only for adding jobs, not processing)
const { fileImportQueue, bulkParsingQueue, invoiceImportQueue, connection } = require('./config/queue');

// For development: Also process bulk parsing jobs in the main server using BullMQ Workers
// In production, use a separate queue worker process
if (process.env.NODE_ENV !== 'production' && connection) {
  const { Worker } = require('bullmq');
  const IORedis = require('ioredis');
  const { processBulkParsingTest } = require('./jobs/bulkParsingTest');
  const { processInvoiceImport } = require('./jobs/invoiceImport');
  const bulkTestStore = require('./utils/bulkTestStore');
  const { sendEmail } = require('./utils/emailService');
  const { Settings } = require('./models');
  
  // Create Redis connection for workers
  const workerConnection = new IORedis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false
  });
  
  // Function to send bulk test completion email (with retry logic and theming)
  const sendBulkTestCompletionEmail = async (testId, test, userEmail, retryCount = 0) => {
    const maxRetries = 3;
    const retryDelay = 2000; // 2 seconds
    
    try {
      if (!userEmail) {
        console.log('⚠️  No user email provided for bulk test notification');
        return { success: false, message: 'No user email provided' };
      }
      
      const settings = await Settings.getSettings();
      const { isEmailEnabled } = require('./utils/emailService');
      
      // Check if email provider is enabled
      if (!isEmailEnabled(settings)) {
        console.log('[Server] Email not enabled, skipping bulk test notification');
        return { success: false, message: 'Email provider not enabled' };
      }
      
      // Calculate summary
      const successful = test.results.filter(r => r.success).length;
      const failed = test.results.filter(r => !r.success).length;
      const totalProcessingTime = test.results.reduce((sum, r) => sum + (r.processingTime || 0), 0);
      const avgProcessingTime = test.results.length > 0 ? totalProcessingTime / test.results.length : 0;
      const avgConfidence = test.results.length > 0 && successful > 0
        ? test.results.filter(r => r.success).reduce((sum, r) => sum + (r.confidence || 0), 0) / successful
        : 0;
      
      const sourceLabel = test.source === 'ftp' ? 'FTP ' : '';
      const subject = `${sourceLabel}Bulk Parsing Test Complete - ${successful}/${test.totalFiles} Files Processed`;
      
      // Build email content using the same theming system as other emails
      const { wrapEmailContent } = require('./utils/emailTheme');
      const primaryColor = settings.primaryColor || '#066fd1';
      
      // Create the email content (will be wrapped in theme)
      const emailContent = `
        <h2 style="color: ${primaryColor}; margin-top: 0;">${sourceLabel}Bulk Parsing Test Complete</h2>
        <p>Your ${sourceLabel.toLowerCase()}bulk parsing test has completed successfully.${test.source === 'ftp' ? ' Files were downloaded from FTP server and processed.' : ''}</p>
        
        <div style="background-color: #f9f9f9; padding: 20px; margin: 20px 0; border-radius: 4px; border-left: 4px solid ${primaryColor};">
          <h3 style="margin-top: 0; color: #333;">Test Summary</h3>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width: 100%;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                <strong>Files Imported:</strong>
              </td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0; text-align: right; color: ${primaryColor};">
                ${test.totalFiles}
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                <strong>Files Parsed Successfully:</strong>
              </td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0; text-align: right; color: #28a745;">
                ${successful}
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                <strong>Files Failed:</strong>
              </td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0; text-align: right; color: #dc3545;">
                ${failed}
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                <strong>Average Confidence:</strong>
              </td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0; text-align: right; color: ${primaryColor};">
                ${Math.round(avgConfidence)}%
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                <strong>Average Processing Time:</strong>
              </td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0; text-align: right; color: ${primaryColor};">
                ${(avgProcessingTime / 1000).toFixed(2)}s
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                <strong>Total Processing Time:</strong>
              </td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0; text-align: right; color: ${primaryColor};">
                ${(totalProcessingTime / 1000).toFixed(2)}s
              </td>
            </tr>
            <tr>
              <td style="padding: 8px 0;">
                <strong>Test Completed:</strong>
              </td>
              <td style="padding: 8px 0; text-align: right; color: ${primaryColor};">
                ${new Date(test.completedAt).toLocaleString()}
              </td>
            </tr>
          </table>
        </div>
        
        <p>You can view the detailed results in the Parser Test section of the portal.</p>
      `;
      
      // Wrap content in themed template (same as Welcome email)
      const html = wrapEmailContent(emailContent, settings);
      
      const text = `
Bulk Parsing Test Complete

Test Summary:
- Files Imported: ${test.totalFiles}
- Files Parsed Successfully: ${successful}
- Files Failed: ${failed}
- Average Confidence: ${Math.round(avgConfidence)}%
- Average Processing Time: ${(avgProcessingTime / 1000).toFixed(2)}s
- Total Processing Time: ${(totalProcessingTime / 1000).toFixed(2)}s
- Test Completed: ${new Date(test.completedAt).toLocaleString()}

You can view the detailed results in the Parser Test section of the portal.

This is an automated notification from ${settings.siteTitle || settings.companyName || 'Makita Invoice Portal'}
      `;
      
      // Send email using the same pattern as other emails
      const emailResult = await sendEmail({
        to: userEmail,
        subject: subject,
        html: html,
        text: text
      }, emailSettings);
      
      if (emailResult.success) {
        console.log(`✅ Bulk test completion email sent to ${userEmail}`);
        return { success: true };
      } else {
        throw new Error(emailResult.message || 'Failed to send email');
      }
    } catch (error) {
      console.error(`❌ Error sending bulk test completion email (attempt ${retryCount + 1}/${maxRetries + 1}):`, error.message);
      
      // Retry logic
      if (retryCount < maxRetries) {
        console.log(`⏳ Retrying in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        return await sendBulkTestCompletionEmail(testId, test, userEmail, retryCount + 1);
      } else {
        console.error(`❌ Failed to send bulk test completion email after ${maxRetries + 1} attempts`);
        return { success: false, message: error.message };
      }
    }
  };
  
  // BullMQ Worker for bulk parsing (development mode)
  const bulkParsingWorker = new Worker('bulk-parsing-test', async (job) => {
    console.log(`📥 [Dev] Processing bulk parsing test job ${job.id}: ${job.data.fileName || 'Unknown'}`);
    return await processBulkParsingTest(job);
  }, {
    connection: workerConnection,
    concurrency: 2
  });

  bulkParsingWorker.on('completed', async (job, result) => {
    console.log(`✅ [Dev] Bulk parsing test job ${job.id} completed:`, result?.fileName || 'Unknown');
    // Store result in bulk test store
    if (job.data.testId && result) {
      try {
        bulkTestStore.addResult(job.data.testId, result);
        
        // Check if test is complete and send email notification
        const test = bulkTestStore.getTest(job.data.testId);
        if (test && test.status === 'completed') {
          // Use a more reliable check - only send if emailSent is not already true
          if (!test.emailSent && job.data.userEmail) {
            console.log(`📧 Sending bulk test completion email for test ${job.data.testId} to ${job.data.userEmail}`);
            const emailResult = await sendBulkTestCompletionEmail(job.data.testId, test, job.data.userEmail);
            
            // Mark email as sent only if successful
            if (emailResult.success) {
              test.emailSent = true;
              console.log(`✅ Email sent successfully for test ${job.data.testId}`);
            } else {
              console.error(`❌ Email failed for test ${job.data.testId}: ${emailResult.message}`);
            }
          } else if (test.emailSent) {
            console.log(`ℹ️  Email already sent for test ${job.data.testId}, skipping`);
          } else if (!job.data.userEmail) {
            console.log(`⚠️  No user email provided for test ${job.data.testId}, skipping email notification`);
          }
        }
      } catch (error) {
        console.error(`Error storing result for test ${job.data.testId}:`, error.message);
      }
    }
  });

  bulkParsingWorker.on('failed', async (job, err) => {
    console.error(`❌ [Dev] Bulk parsing test job ${job.id} failed:`, err.message);
    // Store error result
    if (job.data.testId) {
      try {
        const errorResult = {
          success: false,
          fileName: job.data.fileName || 'Unknown',
          filePath: job.data.filePath || '',
          error: err.message || 'Unknown error',
          processingTime: 0,
          timestamp: new Date().toISOString(),
          confidence: 0,
          extractedFields: {},
          fieldLabels: {},
          fullText: '',
          textLength: 0,
          wordCount: 0
        };
        bulkTestStore.addResult(job.data.testId, errorResult);
      } catch (error) {
        console.error(`Error storing error result for test ${job.data.testId}:`, error.message);
      }
    }
  });

  bulkParsingWorker.on('active', (job) => {
    console.log(`🔄 [Dev] Bulk parsing job ${job.id} is now active`);
  });
  
  console.log('✅ Bulk parsing queue worker initialized (development mode)');
  
  // BullMQ Worker for invoice import (development mode)
  const invoiceImportWorker = new Worker('invoice-import', async (job) => {
    console.log(`📥 [Dev] Processing invoice import job ${job.id}: ${job.data.fileName || 'Unknown'}`);
    return await processInvoiceImport(job);
  }, {
    connection: workerConnection,
    concurrency: 2
  });
  
  invoiceImportWorker.on('completed', (job, result) => {
    console.log(`✅ [Dev] Invoice import job ${job.id} completed:`, result?.fileName || 'Unknown');
  });
  
  invoiceImportWorker.on('failed', (job, err) => {
    console.error(`❌ [Dev] Invoice import job ${job.id} failed:`, err.message);
  });
  
  invoiceImportWorker.on('active', (job) => {
    console.log(`🔄 [Dev] Invoice import job ${job.id} is now active`);
  });
  
  console.log('✅ Invoice import queue worker initialized (development mode)');
}

const app = express();

// Security middleware - Helmet for comprehensive security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Allow inline scripts for React
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"], // Allow inline styles and Google Fonts
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"], // Allow WebSocket connections
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false, // Disable for compatibility with external resources
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow cross-origin resource loading
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  }
}));

// CORS configuration - restrict to allowed origins
const corsOptions = {
  origin: process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
    : ['http://localhost:3000', 'http://localhost:5000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};
app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Additional security headers not covered by helmet
app.use((req, res, next) => {
  // Prevent caching of sensitive data
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  next();
});


// PostgreSQL Connection
const connectDB = async () => {
  try {
    const connected = await testPostgresConnection();
    if (!connected) {
      console.error('❌ Failed to connect to PostgreSQL');
      console.error('   Please check:');
      console.error('   1. PostgreSQL is running (sudo service postgresql start)');
      console.error('   2. Database exists (CREATE DATABASE invoice_portal;)');
      console.error('   3. .env file has correct DB_PASSWORD');
      throw new Error('PostgreSQL connection failed');
    }
    
    // Sync database (creates tables if they don't exist)
    // In production, use migrations instead
    if (process.env.NODE_ENV !== 'production') {
      // Import models first to register them
      require('./models');
      await syncDatabase(false); // false = don't drop existing tables
    }
  } catch (error) {
    console.error('❌ Database connection error:', error.message);
    if (error.original) {
      console.error('   Original error:', error.original.message);
    }
    throw error;
  }
};

// Initialize Redis (non-blocking - app works without it)
const initRedis = async () => {
  if (process.env.REDIS_HOST || process.env.REDIS_URL) {
    await testRedisConnection();
  } else {
    console.log('ℹ️  Redis: Not configured (optional - using in-memory fallback)');
  }
};
initRedis();

// Note: Queue processing is handled by a separate worker process (workers/queueWorker.js)
// This server only adds jobs to the queue
console.log('ℹ️  Queue system ready (processing handled by separate worker)');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  // Don't close queue here - it's managed by the queue worker
  await closeRedisConnection();
  await sequelize.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  // Don't close queue here - it's managed by the queue worker
  await closeRedisConnection();
  await sequelize.close();
  process.exit(0);
});

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'Makita Invoice Portal API is running',
    version: '1.0.0',
    endpoints: {
      api: '/api',
      health: '/api/health'
    }
  });
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  let redisStatus = 'Not Configured';
  if (process.env.REDIS_HOST || process.env.REDIS_URL) {
    try {
      await redis.ping();
      redisStatus = 'Connected';
    } catch (error) {
      redisStatus = 'Disconnected';
    }
  }
  
  let dbStatus = 'Disconnected';
  try {
    await sequelize.authenticate();
    dbStatus = 'Connected';
  } catch (error) {
    dbStatus = 'Disconnected';
  }
  
  res.json({ 
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: dbStatus,
    redis: redisStatus
  });
});

// Serve uploaded files (storage already initialized above)
const { STORAGE_BASE, getStorageDir } = require('./config/storage');
app.use('/uploads', express.static(STORAGE_BASE));
app.use('/uploads/avatars', express.static(getStorageDir('avatars')));

// Serve static files from React app build directory (production)
// Only serve if build directory exists
const frontendBuildPath = path.join(__dirname, '../frontend/build');
if (fs.existsSync(frontendBuildPath)) {
  app.use(express.static(frontendBuildPath));
  console.log('✅ Serving static files from frontend/build');
} else {
  console.log('⚠️  Frontend build directory not found. Run "npm run build" in frontend directory.');
}

// Rate limiting middleware
const { rateLimiters } = require('./middleware/rateLimiter');

// Apply rate limiting to API routes
app.use('/api', rateLimiters.api); // General API rate limiter

// API Routes
app.use('/api/auth', rateLimiters.auth, require('./routes/auth'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/companies', require('./routes/companies'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/credit-notes', require('./routes/creditNotes'));
app.use('/api/statements', require('./routes/statements'));
app.use('/api/document-queries', require('./routes/documentQueries'));
app.use('/api/unallocated', require('./routes/unallocated'));
app.use('/api/failed', require('./routes/failed'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/users', require('./routes/users'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/two-factor', require('./routes/twoFactor'));
app.use('/api/ftp', require('./routes/ftp'));
app.use('/api/parsing', require('./routes/parsing'));
app.use('/api/files', require('./routes/files'));
app.use('/api/templates', require('./routes/templates'));
// Email templates are now file-based in backend/templates/emails/
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/supplier-templates', require('./routes/supplierTemplates'));
app.use('/api/supplier-documents', require('./routes/supplierDocuments'));
app.use('/api/activity-logs', require('./routes/activityLogs'));
app.use('/api/registration', require('./routes/registration'));
app.use('/api/pending-registrations', require('./routes/pendingRegistrations'));
app.use('/api/users/import', require('./routes/userImport'));
app.use('/api/import-settings', require('./routes/importSettings'));
app.use('/api/column-config', require('./routes/columnConfig'));
app.use('/api/stats', require('./routes/stats'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    message: 'Something went wrong!', 
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// Serve React app for all non-API routes (React Router)
// This must be after all API routes but before 404 handler
if (fs.existsSync(frontendBuildPath)) {
  app.get('*', (req, res) => {
    // Don't serve frontend for API routes
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ message: 'Route not found' });
    }
    // Serve index.html for all other routes (React Router will handle routing)
    res.sendFile(path.join(frontendBuildPath, 'index.html'));
  });
} else {
  // 404 handler (only if frontend build doesn't exist)
  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ message: 'Route not found' });
    } else {
      res.status(404).send('Frontend not built. Run "npm run build" in frontend directory.');
    }
  });
}

// Start server after database connection
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // Wait for database connection
    await connectDB();
    
    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
      console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

