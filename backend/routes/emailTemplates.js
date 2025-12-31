const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const globalAdmin = require('../middleware/globalAdmin');
const { EmailTemplate } = require('../models');
const { renderEmailTemplate } = require('../utils/emailTemplateRenderer');

// Get all email templates
router.get('/', auth, async (req, res) => {
  try {
    const templates = await EmailTemplate.findAll({
      order: [['category', 'ASC'], ['name', 'ASC']]
    });
    res.json(templates);
  } catch (error) {
    console.error('Error fetching email templates:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get single email template
router.get('/:name', auth, async (req, res) => {
  try {
    const template = await EmailTemplate.findOne({
      where: { name: req.params.name }
    });
    
    if (!template) {
      return res.status(404).json({ message: 'Email template not found' });
    }
    
    res.json(template);
  } catch (error) {
    console.error('Error fetching email template:', error);
    res.status(500).json({ message: error.message });
  }
});

// Create email template (admin only)
router.post('/', globalAdmin, async (req, res) => {
  try {
    const { name, subject, htmlBody, textBody, description, variables, category, isActive } = req.body;

    if (!name || !subject || !htmlBody) {
      return res.status(400).json({ message: 'Name, subject, and HTML body are required' });
    }

    // Check if template with this name already exists
    const existing = await EmailTemplate.findOne({ where: { name } });
    if (existing) {
      return res.status(400).json({ message: 'Template with this name already exists' });
    }

    const template = await EmailTemplate.create({
      name,
      subject,
      htmlBody,
      textBody: textBody || null,
      description: description || null,
      variables: variables || [],
      category: category || 'system',
      isActive: isActive !== undefined ? isActive : true
    });

    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating email template:', error);
    res.status(500).json({ message: error.message });
  }
});

// Update email template (admin only)
router.put('/:id', globalAdmin, async (req, res) => {
  try {
    const template = await EmailTemplate.findByPk(req.params.id);
    
    if (!template) {
      return res.status(404).json({ message: 'Email template not found' });
    }

    const { subject, htmlBody, textBody, description, variables, category, isActive } = req.body;

    // Update fields
    if (subject !== undefined) template.subject = subject;
    if (htmlBody !== undefined) template.htmlBody = htmlBody;
    if (textBody !== undefined) template.textBody = textBody;
    if (description !== undefined) template.description = description;
    if (variables !== undefined) template.variables = variables;
    if (category !== undefined) template.category = category;
    if (isActive !== undefined) template.isActive = isActive;

    await template.save();
    res.json(template);
  } catch (error) {
    console.error('Error updating email template:', error);
    res.status(500).json({ message: error.message });
  }
});

// Delete email template (admin only)
router.delete('/:id', globalAdmin, async (req, res) => {
  try {
    const template = await EmailTemplate.findByPk(req.params.id);
    
    if (!template) {
      return res.status(404).json({ message: 'Email template not found' });
    }

    await template.destroy();
    res.json({ message: 'Email template deleted successfully' });
  } catch (error) {
    console.error('Error deleting email template:', error);
    res.status(500).json({ message: error.message });
  }
});

// Preview email template (render with sample data)
router.post('/:name/preview', auth, async (req, res) => {
  try {
    const { data = {} } = req.body;
    const { Settings } = require('../models');
    
    // Get settings for theming
    const settings = await Settings.getSettings();
    
    const rendered = await renderEmailTemplate(req.params.name, data, EmailTemplate, settings);
    res.json(rendered);
  } catch (error) {
    console.error('Error previewing email template:', error);
    res.status(500).json({ message: error.message });
  }
});

// Bulk email test (send 1 email every 10s for 10 mins - 60 emails total)
router.post('/bulk-test', globalAdmin, async (req, res) => {
  try {
    const { testEmail } = req.body;
    const { Settings } = require('../models');
    const { emailQueue } = require('../config/queue');
    
    if (!testEmail) {
      return res.status(400).json({ message: 'Test email address is required' });
    }
    
    if (!emailQueue) {
      return res.status(500).json({ message: 'Email queue is not available. Redis must be configured.' });
    }
    
    const settings = await Settings.getSettings();
    if (!settings.emailProvider?.enabled && !settings.smtp?.enabled) {
      return res.status(400).json({ message: 'Email provider is not configured or enabled' });
    }
    
    // Queue 60 emails (1 every 10 seconds for 10 minutes)
    const totalEmails = 60;
    const intervalSeconds = 10;
    const totalDurationMinutes = 10;
    
    const emailSubject = 'Bulk Email Test';
    const emailContent = `
      <h2>Bulk Email Test</h2>
      <p>This is a test email sent as part of a bulk email test.</p>
      <p><strong>Email Number:</strong> {{emailNumber}} of ${totalEmails}</p>
      <p><strong>Sent At:</strong> {{sentAt}}</p>
      <p><strong>Test Duration:</strong> ${totalDurationMinutes} minutes (1 email every ${intervalSeconds} seconds)</p>
      <p>This test helps verify that your email provider can handle the rate of emails without triggering spam filters or rate limits.</p>
    `;
    
    const jobs = [];
    const startTime = Date.now();
    
    for (let i = 1; i <= totalEmails; i++) {
      const delay = (i - 1) * intervalSeconds * 1000; // Delay in milliseconds
      const sentAt = new Date(startTime + delay).toISOString();
      
      // Use emailQueue directly to schedule with delay (BullMQ format: name, data, options)
      const job = await emailQueue.add('bulk-test-email', {
        to: testEmail,
        subject: `${emailSubject} - Email ${i} of ${totalEmails}`,
        html: emailContent
          .replace('{{emailNumber}}', i)
          .replace('{{sentAt}}', new Date(sentAt).toLocaleString()),
        settings,
        metadata: {
          type: 'bulk_test',
          emailNumber: i,
          totalEmails: totalEmails,
          sentAt: sentAt
        }
      }, {
        delay: delay, // Schedule email to be sent after delay
        priority: 0, // Normal priority
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 5000
        }
      });
      
      jobs.push({
        id: job.id,
        emailNumber: i,
        scheduledAt: sentAt
      });
    }
    
    res.json({
      success: true,
      message: `Queued ${totalEmails} test emails to ${testEmail}. Emails will be sent 1 every ${intervalSeconds} seconds over ${totalDurationMinutes} minutes.`,
      totalEmails,
      intervalSeconds,
      totalDurationMinutes,
      testEmail,
      jobs: jobs.slice(0, 10), // Return first 10 job IDs for reference
      note: 'Check the email queue statistics to monitor progress. Failed emails will be automatically retried.'
    });
  } catch (error) {
    console.error('Error queuing bulk email test:', error);
    res.status(500).json({ message: 'Error queuing bulk email test: ' + error.message });
  }
});

// Test email template (send test email)
router.post('/:name/test', globalAdmin, async (req, res) => {
  try {
    const { testEmail, data = {} } = req.body;
    
    if (!testEmail) {
      return res.status(400).json({ message: 'Test email address is required' });
    }

    const { Settings } = require('../models');
    const settings = await Settings.getSettings();
    
    // Check if email provider is enabled
    if (!settings.emailProvider?.enabled && !settings.smtp?.enabled) {
      return res.status(400).json({ message: 'Email provider is not configured or enabled' });
    }

    // Use new emailProvider if available, otherwise fall back to legacy smtp
    const emailSettings = settings.emailProvider?.enabled 
      ? settings 
      : { ...settings, emailProvider: { ...settings.smtp, provider: 'smtp', enabled: settings.smtp.enabled } };

    // Special handling for document notification templates
    const documentNotificationTemplates = ['invoice-notification', 'invoice-summary', 'statement-notification', 'statement-summary'];
    
    if (documentNotificationTemplates.includes(req.params.name)) {
      const { sendEmail } = require('../utils/emailService');
      const { wrapEmailContent } = require('../utils/emailTheme');
      const primaryColor = settings.primaryColor || '#066fd1';
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      
      let emailContent = '';
      let emailSubject = '';
      
      if (req.params.name === 'invoice-notification') {
        // Individual invoice notification
        emailSubject = data.subject || `New Invoices Available - ${data.companyName || 'Test Company'}`;
        emailContent = `
          <h2>New Invoices Available</h2>
          <p>Dear ${data.userName || 'Test User'},</p>
          <p>3 new documents have been processed for <strong>${data.companyName || 'Test Company'}</strong> (Account: ${data.companyReference || '12345'}).</p>
          
          <h3>Invoices (2)</h3>
          <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Invoice Number</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Date</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">INV-2024-001</td>
                <td style="padding: 8px; border: 1px solid #ddd;">01/12/2024</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">£1,250.00</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">INV-2024-002</td>
                <td style="padding: 8px; border: 1px solid #ddd;">02/12/2024</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">£850.50</td>
              </tr>
            </tbody>
          </table>
          
          <h3>Credit Notes (1)</h3>
          <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Credit Note Number</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Date</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">CN-2024-001</td>
                <td style="padding: 8px; border: 1px solid #ddd;">03/12/2024</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">£150.00</td>
              </tr>
            </tbody>
          </table>
          
          <p style="margin-top: 20px;">
            <a href="${frontendUrl}/invoices" style="background-color: ${primaryColor}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
              View Documents
            </a>
          </p>
        `;
      } else if (req.params.name === 'invoice-summary') {
        // Summary invoice notification
        emailSubject = data.subject || 'Document Import Summary - 5 new documents available';
        emailContent = `
          <h2>Document Import Summary</h2>
          <p>Dear ${data.userName || 'Test User'},</p>
          <p>5 new documents have been processed across 2 companies.</p>
          
          <h3>Invoices (3)</h3>
          <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Company</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Invoice Number</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Date</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">Test Company A (12345)</td>
                <td style="padding: 8px; border: 1px solid #ddd;">INV-2024-001</td>
                <td style="padding: 8px; border: 1px solid #ddd;">01/12/2024</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">£1,250.00</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">Test Company A (12345)</td>
                <td style="padding: 8px; border: 1px solid #ddd;">INV-2024-002</td>
                <td style="padding: 8px; border: 1px solid #ddd;">02/12/2024</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">£850.50</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">Test Company B (67890)</td>
                <td style="padding: 8px; border: 1px solid #ddd;">INV-2024-003</td>
                <td style="padding: 8px; border: 1px solid #ddd;">03/12/2024</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">£2,100.00</td>
              </tr>
            </tbody>
          </table>
          
          <h3>Credit Notes (2)</h3>
          <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Company</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Credit Note Number</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Date</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">Test Company A (12345)</td>
                <td style="padding: 8px; border: 1px solid #ddd;">CN-2024-001</td>
                <td style="padding: 8px; border: 1px solid #ddd;">04/12/2024</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">£150.00</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">Test Company B (67890)</td>
                <td style="padding: 8px; border: 1px solid #ddd;">CN-2024-002</td>
                <td style="padding: 8px; border: 1px solid #ddd;">05/12/2024</td>
                <td style="padding: 8px; border: 1px solid #ddd; text-align: right;">£75.00</td>
              </tr>
            </tbody>
          </table>
          
          <p style="margin-top: 20px;">
            <a href="${frontendUrl}/invoices" style="background-color: ${primaryColor}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
              View All Documents
            </a>
          </p>
        `;
      } else if (req.params.name === 'statement-notification') {
        // Individual statement notification
        emailSubject = data.subject || 'New Statements Available - Test Company';
        emailContent = `
          <h2>New Statements Available</h2>
          <p>Dear ${data.userName || 'Test User'},</p>
          <p>2 new statements have been processed for <strong>${data.companyName || 'Test Company'}</strong> (Account: ${data.companyReference || '12345'}).</p>
          <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Statement Number</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Period</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">STMT-2024-11</td>
                <td style="padding: 8px; border: 1px solid #ddd;">01/11/2024 - 30/11/2024</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">STMT-2024-12</td>
                <td style="padding: 8px; border: 1px solid #ddd;">01/12/2024 - 31/12/2024</td>
              </tr>
            </tbody>
          </table>
          <p style="margin-top: 20px;">
            <a href="${frontendUrl}/statements" style="background-color: ${primaryColor}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
              View Statements
            </a>
          </p>
        `;
      } else if (req.params.name === 'statement-summary') {
        // Summary statement notification
        emailSubject = data.subject || 'Statement Import Summary - 3 new statements available';
        emailContent = `
          <h2>Statement Import Summary</h2>
          <p>Dear ${data.userName || 'Test User'},</p>
          <p>3 new statements have been processed across 2 companies.</p>
          <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Company</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Statement Number</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Period</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">Test Company A (12345)</td>
                <td style="padding: 8px; border: 1px solid #ddd;">STMT-2024-11</td>
                <td style="padding: 8px; border: 1px solid #ddd;">01/11/2024 - 30/11/2024</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">Test Company A (12345)</td>
                <td style="padding: 8px; border: 1px solid #ddd;">STMT-2024-12</td>
                <td style="padding: 8px; border: 1px solid #ddd;">01/12/2024 - 31/12/2024</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;">Test Company B (67890)</td>
                <td style="padding: 8px; border: 1px solid #ddd;">STMT-2024-11</td>
                <td style="padding: 8px; border: 1px solid #ddd;">01/11/2024 - 30/11/2024</td>
              </tr>
            </tbody>
          </table>
          <p style="margin-top: 20px;">
            <a href="${frontendUrl}/statements" style="background-color: ${primaryColor}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
              View All Statements
            </a>
          </p>
        `;
      }
      
      // Wrap content in themed template (same as other emails)
      const html = wrapEmailContent(emailContent, settings);
      
      const text = emailContent
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      const emailResult = await sendEmail({
        to: testEmail,
        subject: emailSubject,
        html: html,
        text: text
      }, emailSettings);
      
      if (emailResult.success) {
        res.json({
          success: true,
          message: `Test ${req.params.name} email sent successfully to ${testEmail}`
        });
      } else {
        res.status(500).json({
          success: false,
          message: emailResult.message || 'Failed to send test email'
        });
      }
      return;
    }
    
    // Special handling for bulk test completion email
    if (req.params.name === 'bulk-test-completion') {
      const { sendEmail } = require('../utils/emailService');
      const { wrapEmailContent } = require('../utils/emailTheme');
      
      // Create sample test data
      const sampleTest = {
        testId: 'test-' + Date.now(),
        totalFiles: data.totalFiles || 10,
        processedFiles: data.totalFiles || 10,
        source: data.source || 'upload', // 'upload' or 'ftp'
        status: 'completed',
        completedAt: new Date().toISOString(),
        results: Array.from({ length: data.totalFiles || 10 }, (_, i) => ({
          success: i < (data.successful || 8),
          fileName: `test-invoice-${i + 1}.pdf`,
          confidence: Math.floor(Math.random() * 30) + 70, // 70-100%
          processingTime: Math.floor(Math.random() * 2000) + 1000 // 1-3 seconds
        }))
      };
      
      const successful = sampleTest.results.filter(r => r.success).length;
      const failed = sampleTest.results.filter(r => !r.success).length;
      const totalProcessingTime = sampleTest.results.reduce((sum, r) => sum + (r.processingTime || 0), 0);
      const avgProcessingTime = sampleTest.results.length > 0 ? totalProcessingTime / sampleTest.results.length : 0;
      const avgConfidence = sampleTest.results.length > 0 && successful > 0
        ? sampleTest.results.filter(r => r.success).reduce((sum, r) => sum + (r.confidence || 0), 0) / successful
        : 0;
      
      const sourceLabel = sampleTest.source === 'ftp' ? 'FTP ' : '';
      const subject = `${sourceLabel}Bulk Parsing Test Complete - ${successful}/${sampleTest.totalFiles} Files Processed`;
      
      // Build email content using the same theming system as other emails
      const primaryColor = settings.primaryColor || '#066fd1';
      
      // Create the email content (will be wrapped in theme)
      const emailContent = `
        <h2 style="color: ${primaryColor}; margin-top: 0;">${sourceLabel}Bulk Parsing Test Complete</h2>
        <p>Your ${sourceLabel.toLowerCase()}bulk parsing test has completed successfully.${sampleTest.source === 'ftp' ? ' Files were downloaded from FTP server and processed.' : ''}</p>
        
        <div style="background-color: #f9f9f9; padding: 20px; margin: 20px 0; border-radius: 4px; border-left: 4px solid ${primaryColor};">
          <h3 style="margin-top: 0; color: #333;">Test Summary</h3>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width: 100%;">
            <tr>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;">
                <strong>Files Imported:</strong>
              </td>
              <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0; text-align: right; color: ${primaryColor};">
                ${sampleTest.totalFiles}
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
                ${new Date(sampleTest.completedAt).toLocaleString()}
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
- Files Imported: ${sampleTest.totalFiles}
- Files Parsed Successfully: ${successful}
- Files Failed: ${failed}
- Average Confidence: ${Math.round(avgConfidence)}%
- Average Processing Time: ${(avgProcessingTime / 1000).toFixed(2)}s
- Total Processing Time: ${(totalProcessingTime / 1000).toFixed(2)}s
- Test Completed: ${new Date(sampleTest.completedAt).toLocaleString()}

You can view the detailed results in the Parser Test section of the portal.

This is an automated notification from ${settings.siteTitle || settings.companyName || 'eInvoice Portal'}
      `;
      
      const emailResult = await sendEmail({
        to: testEmail,
        subject: subject,
        html: html,
        text: text
      }, emailSettings);
      
      if (emailResult.success) {
        res.json({
          success: true,
          message: `Test bulk test completion email sent successfully to ${testEmail}`
        });
      } else {
        res.status(500).json({
          success: false,
          message: emailResult.message || 'Failed to send test email'
        });
      }
      return;
    }

    // Regular email template handling
    const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
    
    // Send test email using template
    await sendTemplatedEmail(
      req.params.name,
      testEmail,
      {
        userName: data.userName || 'Test User',
        userEmail: testEmail,
        companyName: settings.companyName || 'eInvoice Portal',
        loginUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
        resetUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=test-token-123`,
        temporaryPassword: data.temporaryPassword || 'TempPass123!',
        ...data
      },
      emailSettings
    );

    res.json({
      success: true,
      message: `Test email sent successfully to ${testEmail} using template '${req.params.name}'`
    });
  } catch (error) {
    console.error('Error testing email template:', error);
    res.status(500).json({ 
      success: false,
      message: error.message || 'Failed to send test email' 
    });
  }
});

module.exports = router;

