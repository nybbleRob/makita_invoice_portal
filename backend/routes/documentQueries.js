const express = require('express');
const { DocumentQuery, Invoice, CreditNote, Statement, Company, User, UserCompany, Settings, Sequelize } = require('../models');
const { Op } = Sequelize;
const auth = require('../middleware/auth');
const { sendEmail, isEmailEnabled } = require('../utils/emailService');
const { renderTemplate } = require('../utils/tablerEmailRenderer');
const { logActivity, ActivityType } = require('../services/activityLogger');
const { requirePermission } = require('../middleware/permissions');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// Middleware to check if queries are enabled
const checkQueriesEnabled = async (req, res, next) => {
  try {
    const settings = await Settings.getSettings();
    // Default to true if not set (backwards compatibility)
    if (settings.queriesEnabled === false) {
      return res.status(403).json({ message: 'Document queries feature is currently disabled' });
    }
    next();
  } catch (error) {
    console.error('Error checking queries enabled:', error);
    // If settings can't be loaded, allow access (fail open for backwards compatibility)
    next();
  }
};

// Apply auth, permission check, and queries enabled check to all routes
// Document Queries is GA only for now as the module is disabled
router.use(auth);
router.use(requirePermission('QUERIES_VIEW'));
router.use(checkQueriesEnabled);

// Get query history for a document
router.get('/:documentType/:documentId', async (req, res) => {
  try {
    const { documentType, documentId } = req.params;
    
    // Validate document type
    if (!['invoice', 'credit_note', 'statement'].includes(documentType)) {
      return res.status(400).json({ message: 'Invalid document type' });
    }

    // Find the query thread
    const query = await DocumentQuery.findOne({
      where: {
        documentType,
        documentId
      },
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name']
      }]
    });

    if (!query) {
      return res.json({ query: null, messages: [] });
    }

    res.json({
      query: {
        id: query.id,
        documentType: query.documentType,
        documentId: query.documentId,
        documentNumber: query.documentNumber,
        companyId: query.companyId,
      companyName: query.company?.name,
      status: query.status,
      resolvedAt: query.resolvedAt,
      resolvedBy: query.resolvedBy,
      resolutionReason: query.resolutionReason,
      lastMessageAt: query.lastMessageAt,
      createdAt: query.createdAt
    },
    messages: query.messages || []
  });
  } catch (error) {
    console.error('Error fetching query:', error);
    res.status(500).json({ message: error.message });
  }
});

// Create a new query or add message to existing query
router.post('/:documentType/:documentId', async (req, res) => {
  try {
    const { documentType, documentId } = req.params;
    const { message, replyTo } = req.body; // replyTo is optional message ID for threading

    if (!message || !message.trim()) {
      return res.status(400).json({ message: 'Message is required' });
    }

    // Validate document type
    if (!['invoice', 'credit_note', 'statement'].includes(documentType)) {
      return res.status(400).json({ message: 'Invalid document type' });
    }

    // Find the document
    let document = null;
    let documentNumber = null;
    let companyId = null;
    let company = null;

    if (documentType === 'invoice') {
      document = await Invoice.findByPk(documentId, {
        include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }]
      });
      if (document) {
        documentNumber = document.invoiceNumber;
        companyId = document.companyId;
        company = document.company;
      }
    } else if (documentType === 'credit_note') {
      document = await CreditNote.findByPk(documentId, {
        include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }]
      });
      if (document) {
        documentNumber = document.creditNoteNumber;
        companyId = document.companyId;
        company = document.company;
      }
    } else if (documentType === 'statement') {
      document = await Statement.findByPk(documentId, {
        include: [{ model: Company, as: 'company', attributes: ['id', 'name'] }]
      });
      if (document) {
        documentNumber = document.statementNumber || document.id;
        companyId = document.companyId;
        company = document.company;
      }
    }

    if (!document) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Both customers and staff can create queries
    // Customers create queries about their documents
    // Staff can proactively query customers about documents
    const isCustomer = req.user.role === 'external_user';
    const isStaff = ['staff', 'manager', 'administrator', 'global_admin'].includes(req.user.role);
    
    if (!isCustomer && !isStaff) {
      return res.status(403).json({ message: 'Only customers and staff can create queries' });
    }

    // Check if user has access to this company's documents
    const userWithCompanies = await User.findByPk(req.user.userId, {
      include: [{
        model: Company,
        as: 'companies',
        through: { attributes: [] }
      }]
    });

    // For customers, check company access
    // For staff, check if they're assigned to the company (or global admin)
    const hasAccess = isCustomer
      ? (userWithCompanies.allCompanies || 
         (userWithCompanies.companies && userWithCompanies.companies.some(c => c.id === companyId)))
      : (req.user.role === 'global_admin' ||
         userWithCompanies.allCompanies || 
         (userWithCompanies.companies && userWithCompanies.companies.some(c => c.id === companyId)));

    if (!hasAccess) {
      return res.status(403).json({ message: 'You do not have access to this document' });
    }

    // Find or create query thread
    let query = await DocumentQuery.findOne({
      where: {
        documentType,
        documentId
      }
    });

    // If query exists and is resolved, prevent external users from adding messages
    if (query && query.status === 'resolved' && isCustomer) {
      return res.status(403).json({ 
        message: 'This query has been resolved and is closed. Please contact support via email for further assistance.' 
      });
    }

    // Fetch user details from database (JWT only has userId and role)
    const userDetails = await User.findByPk(req.user.userId, {
      attributes: ['id', 'name', 'email', 'role']
    });

    const messageData = {
      id: uuidv4(),
      userId: req.user.userId,
      userName: userDetails?.name || userDetails?.email || 'Unknown User',
      userEmail: userDetails?.email || 'unknown@example.com',
      userRole: req.user.role,
      message: message.trim(),
      createdAt: new Date().toISOString(),
      isCustomer: isCustomer,
      replyTo: replyTo || null // Optional: ID of message being replied to
    };

    if (!query) {
      // Create new query thread
      query = await DocumentQuery.create({
        documentType,
        documentId,
        documentNumber,
        companyId,
        messages: [messageData],
        status: 'open',
        lastMessageAt: new Date(),
        lastMessageBy: req.user.userId
      });

      // Log activity for query message sent
      await logActivity({
        type: ActivityType.DOCUMENT_QUERIED,
        userId: req.user.userId,
        userEmail: userDetails?.email,
        userRole: req.user.role,
        action: `Sent query message for ${documentType} ${documentNumber}`,
        details: { 
          documentType, 
          documentId, 
          documentNumber, 
          companyId,
          queryId: query.id,
          messageId: messageData.id,
          message: messageData.message.substring(0, 100) // First 100 chars
        },
        companyId: companyId,
        companyName: company?.name,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });
    } else {
      // Add message to existing thread (even if there are messages awaiting reply)
      const messages = query.messages || [];
      messages.push(messageData);
      query.messages = messages;
      query.lastMessageAt = new Date();
      query.lastMessageBy = req.user.userId;
      // Only reopen if it was closed, not if it was resolved
      if (query.status === 'closed') {
        query.status = 'open';
      }
      await query.save();

      // Log activity for query message sent (reply)
      await logActivity({
        type: ActivityType.DOCUMENT_QUERIED,
        userId: req.user.userId,
        userEmail: userDetails?.email,
        userRole: req.user.role,
        action: `Sent query message for ${documentType} ${query.documentNumber}`,
        details: { 
          documentType, 
          documentId, 
          documentNumber: query.documentNumber, 
          companyId: query.companyId || companyId,
          queryId: query.id,
          messageId: messageData.id,
          message: messageData.message.substring(0, 100) // First 100 chars
        },
        companyId: query.companyId || companyId,
        companyName: company?.name,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });
    }

    // Send email notifications
    const documentTypeLabel = documentType === 'invoice' ? 'Invoice' : 
                              documentType === 'credit_note' ? 'Credit Note' : 'Statement';
    
    const queryUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/${documentType}s/${documentId}/view`;
    
    // Get settings for email branding
    const settings = await Settings.getSettings();
    
    if (isCustomer) {
      // Check if company has EDI enabled - if so, skip email notifications
      if (company?.edi) {
        console.log('[Query] Company has EDI enabled, skipping email notifications');
      } else {
        // Customer created query - notify all staff assigned to this company
        const staffUsers = await User.findAll({
          include: [{
            model: Company,
            as: 'companies',
            through: { attributes: [] },
            where: { id: companyId }
          }],
          where: {
            role: { [Op.in]: ['staff', 'manager', 'administrator', 'global_admin'] }
          }
        });

        for (const staffUser of staffUsers) {
          if (staffUser.email) {
            try {
              const html = renderTemplate('query-notification', {
                emailTitle: 'New Document Query',
                preheaderText: `Query from ${company?.name || 'Unknown Company'} about ${documentTypeLabel} ${documentNumber}`,
                greeting: `Hello ${staffUser.name || 'Team'},`,
                introText: `${req.user.name || req.user.email} from ${company?.name || 'Unknown Company'} has sent a query regarding ${documentTypeLabel} ${documentNumber}.`,
                documentTypeName: documentTypeLabel,
                documentNumber,
                senderName: req.user.name || req.user.email,
                messageContent: message.trim().replace(/\n/g, '<br>'),
                queryUrl,
                buttonText: 'View and Reply',
                iconColor: settings?.primaryColor || '#066FD1'
              }, settings);
              
              await sendEmail({
                to: staffUser.email,
                subject: `Query regarding ${documentTypeLabel} ${documentNumber}`,
                html
              }, settings);
            } catch (emailError) {
              console.error(`Failed to send email to ${staffUser.email}:`, emailError);
            }
          }
        }
      }
    } else if (isStaff) {
      // Staff created query - notify all customers assigned to this company
      const customerUsers = await User.findAll({
        include: [{
          model: Company,
          as: 'companies',
          through: { attributes: [] },
          where: { id: companyId }
        }],
        where: {
          role: 'external_user'
        }
      });

      for (const customerUser of customerUsers) {
        if (customerUser.email) {
          try {
            const html = renderTemplate('query-notification', {
              emailTitle: 'Query from Staff',
              preheaderText: `Staff query about your ${documentTypeLabel} ${documentNumber}`,
              greeting: `Hello ${customerUser.name || 'Customer'},`,
              introText: `${req.user.name || req.user.email} has sent a query regarding your ${documentTypeLabel} ${documentNumber}.`,
              documentTypeName: documentTypeLabel,
              documentNumber,
              senderName: req.user.name || req.user.email,
              messageContent: message.trim().replace(/\n/g, '<br>'),
              queryUrl,
              buttonText: 'View and Reply',
              iconColor: settings?.primaryColor || '#066FD1'
            }, settings);
            
            await sendEmail({
              to: customerUser.email,
              subject: `Query regarding ${documentTypeLabel} ${documentNumber}`,
              html
            }, settings);
          } catch (emailError) {
            console.error(`Failed to send email to ${customerUser.email}:`, emailError);
          }
        }
      }
    }

    res.json({
      success: true,
      query: {
        id: query.id,
        documentType: query.documentType,
        documentId: query.documentId,
        documentNumber: query.documentNumber,
        status: query.status,
        lastMessageAt: query.lastMessageAt
      },
      message: messageData
    });
  } catch (error) {
    console.error('Error creating query:', error);
    res.status(500).json({ message: error.message });
  }
});

// Reply to a query (staff only, or customer if query is open)
router.post('/:documentType/:documentId/reply', async (req, res) => {
  try {
    const { documentType, documentId } = req.params;
    const { message, replyTo } = req.body; // replyTo is optional message ID for threading

    if (!message || !message.trim()) {
      return res.status(400).json({ message: 'Message is required' });
    }

    // Validate document type
    if (!['invoice', 'credit_note', 'statement'].includes(documentType)) {
      return res.status(400).json({ message: 'Invalid document type' });
    }

    // Both staff and customers can reply (but customers can't reply to resolved queries)
    const isCustomer = req.user.role === 'external_user';
    const isStaff = ['staff', 'manager', 'administrator', 'global_admin'].includes(req.user.role);
    
    if (!isCustomer && !isStaff) {
      return res.status(403).json({ message: 'Only customers and staff can reply to queries' });
    }

    // Find the query thread
    const query = await DocumentQuery.findOne({
      where: {
        documentType,
        documentId
      },
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name']
      }]
    });

    if (!query) {
      return res.status(404).json({ message: 'Query thread not found' });
    }

    // Prevent replying to resolved queries (customers cannot, staff can reopen by resolving)
    if (query.status === 'resolved' && isCustomer) {
      return res.status(403).json({ 
        message: 'This query has been resolved and is closed. Please contact support via email for further assistance.' 
      });
    }

    // Check if user has access to this company
    const userWithCompanies = await User.findByPk(req.user.userId, {
      include: [{
        model: Company,
        as: 'companies',
        through: { attributes: [] }
      }]
    });

    const hasAccess = req.user.role === 'global_admin' || 
      userWithCompanies.allCompanies || 
      (userWithCompanies.companies && userWithCompanies.companies.some(c => c.id === query.companyId));

    if (!hasAccess) {
      return res.status(403).json({ message: 'You do not have access to this company' });
    }

    // Fetch user details from database (JWT only has userId and role)
    const userDetails = await User.findByPk(req.user.userId, {
      attributes: ['id', 'name', 'email', 'role']
    });

    // Add reply message
    const messageData = {
      id: uuidv4(),
      userId: req.user.userId,
      userName: userDetails?.name || userDetails?.email || 'Unknown User',
      userEmail: userDetails?.email || 'unknown@example.com',
      userRole: req.user.role,
      message: message.trim(),
      createdAt: new Date().toISOString(),
      isCustomer: isCustomer,
      replyTo: replyTo || null // Optional: ID of message being replied to
    };

    const messages = query.messages || [];
    messages.push(messageData);
    query.messages = messages;
    query.lastMessageAt = new Date();
    query.lastMessageBy = req.user.userId;
    await query.save();

    // Find the customer who created the query (first message sender)
    const firstMessage = messages.find(m => m.isCustomer);
    if (firstMessage) {
      // Check if company has EDI enabled - if so, skip email notifications
      if (query.company?.edi) {
        console.log('[Query Reply] Company has EDI enabled, skipping email notifications');
      } else {
        const customer = await User.findByPk(firstMessage.userId);
        if (customer && customer.email) {
          // Send email to customer
          const documentTypeLabel = documentType === 'invoice' ? 'Invoice' : 
                                    documentType === 'credit_note' ? 'Credit Note' : 'Statement';
          
          const queryUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/${documentType}s/${documentId}/view`;
          
          // Get settings for email branding
          const settings = await Settings.getSettings();
          
          try {
            const html = renderTemplate('query-notification', {
              emailTitle: 'Reply to Your Query',
              preheaderText: `Reply received for your ${documentTypeLabel} ${query.documentNumber} query`,
              greeting: `Hello ${customer.name || 'Customer'},`,
              introText: `${req.user.name || req.user.email} has replied to your query regarding ${documentTypeLabel} ${query.documentNumber}.`,
              documentTypeName: documentTypeLabel,
              documentNumber: query.documentNumber,
              senderName: req.user.name || req.user.email,
              messageContent: message.trim().replace(/\n/g, '<br>'),
              queryUrl,
              buttonText: 'View Document',
              iconColor: settings?.primaryColor || '#066FD1'
            }, settings);
            
            await sendEmail({
              to: customer.email,
              subject: `Reply to your query regarding ${documentTypeLabel} ${query.documentNumber}`,
              html
            }, settings);
          } catch (emailError) {
            console.error(`Failed to send email to ${customer.email}:`, emailError);
          }
        }
      }
    }

    // Log activity
    await logActivity({
      type: ActivityType.DOCUMENT_QUERY_REPLIED,
      userId: req.user.userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: `Replied to query for ${documentType} ${query.documentNumber}`,
      details: { documentType, documentId, documentNumber: query.documentNumber, companyId: query.companyId },
      companyId: query.companyId,
      companyName: query.company?.name,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      message: messageData
    });
  } catch (error) {
    console.error('Error replying to query:', error);
    res.status(500).json({ message: error.message });
  }
});

// Resolve a query (admin/global_admin only)
router.post('/:documentType/:documentId/resolve', async (req, res) => {
  try {
    const { documentType, documentId } = req.params;
    const { resolutionReason } = req.body;

    if (!resolutionReason || !resolutionReason.trim()) {
      return res.status(400).json({ message: 'Resolution reason is required' });
    }

    // Validate document type
    if (!['invoice', 'credit_note', 'statement'].includes(documentType)) {
      return res.status(400).json({ message: 'Invalid document type' });
    }

    // Only admins and global admins can resolve queries
    if (!['administrator', 'global_admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Only administrators can resolve queries' });
    }

    // Find the query thread
    const query = await DocumentQuery.findOne({
      where: {
        documentType,
        documentId
      },
      include: [{
        model: Company,
        as: 'company',
        attributes: ['id', 'name', 'edi']
      }]
    });

    if (!query) {
      return res.status(404).json({ message: 'Query thread not found' });
    }

    // Check if user has access to this company
    const userWithCompanies = await User.findByPk(req.user.userId, {
      include: [{
        model: Company,
        as: 'companies',
        through: { attributes: [] }
      }]
    });

    const hasAccess = req.user.role === 'global_admin' || 
      userWithCompanies.allCompanies || 
      (userWithCompanies.companies && userWithCompanies.companies.some(c => c.id === query.companyId));

    if (!hasAccess) {
      return res.status(403).json({ message: 'You do not have access to this company' });
    }

    // Fetch user details
    const userDetails = await User.findByPk(req.user.userId, {
      attributes: ['id', 'name', 'email', 'role']
    });

    // Resolve the query
    query.status = 'resolved';
    query.resolvedAt = new Date();
    query.resolvedBy = req.user.userId;
    query.resolutionReason = resolutionReason.trim();
    await query.save();

    // Log activity
    await logActivity({
      type: ActivityType.DOCUMENT_QUERY_RESOLVED,
      userId: req.user.userId,
      userEmail: userDetails?.email,
      userRole: req.user.role,
      action: `Resolved query for ${documentType} ${query.documentNumber}`,
      details: { 
        documentType, 
        documentId, 
        documentNumber: query.documentNumber, 
        companyId: query.companyId,
        queryId: query.id,
        resolutionReason: query.resolutionReason
      },
      companyId: query.companyId,
      companyName: query.company?.name,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    // Send email notification to customer (if not EDI)
    if (!query.company?.edi) {
      const messages = query.messages || [];
      const customerMessage = messages.find(m => m.isCustomer);
      if (customerMessage) {
        const customer = await User.findByPk(customerMessage.userId);
        if (customer && customer.email) {
          const documentTypeLabel = documentType === 'invoice' ? 'Invoice' : 
                                    documentType === 'credit_note' ? 'Credit Note' : 'Statement';
          
          const queryUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/${documentType}s/${documentId}/view`;
          
          // Get settings for email branding
          const settings = await Settings.getSettings();
          
          try {
            const html = renderTemplate('query-notification', {
              emailTitle: 'Query Resolved',
              preheaderText: `Your query about ${documentTypeLabel} ${query.documentNumber} has been resolved`,
              greeting: `Hello ${customer.name || 'Customer'},`,
              introText: `Your query regarding ${documentTypeLabel} ${query.documentNumber} has been resolved.`,
              documentTypeName: documentTypeLabel,
              documentNumber: query.documentNumber,
              queryStatus: 'Resolved',
              statusColor: '#d4edda',
              statusTextColor: '#155724',
              senderName: userDetails?.name || 'Support Team',
              messageContent: resolutionReason.trim().replace(/\n/g, '<br>'),
              queryUrl,
              buttonText: 'View Document',
              iconColor: '#2fb344'
            }, settings);
            
            await sendEmail({
              to: customer.email,
              subject: `Query resolved: ${documentTypeLabel} ${query.documentNumber}`,
              html
            }, settings);
          } catch (emailError) {
            console.error(`Failed to send email to ${customer.email}:`, emailError);
          }
        }
      }
    }

    res.json({
      success: true,
      query: {
        id: query.id,
        status: query.status,
        resolvedAt: query.resolvedAt,
        resolvedBy: query.resolvedBy,
        resolutionReason: query.resolutionReason
      }
    });
  } catch (error) {
    console.error('Error resolving query:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

