const express = require('express');
const { File, Company, User, sequelize } = require('../models');
const { Op } = require('sequelize');
const auth = require('../middleware/auth');
const { fileImportQueue } = require('../config/queue');
const router = express.Router();

// Only staff, managers, admins can access
router.use(auth);

// Get all failed documents
router.get('/', async (req, res) => {
  try {
    // Only staff, managers, and admins can view failed documents
    if (req.user.role === 'external_user') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { page = 1, limit = 50, search = '', failureReason } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    const where = {
      status: 'failed',
      deletedAt: null
    };

    if (failureReason && failureReason !== 'all') {
      where.failureReason = failureReason;
    }

    if (search) {
      where[Op.or] = [
        { fileName: { [Op.iLike]: `%${search}%` } },
        { errorMessage: { [Op.iLike]: `%${search}%` } },
        sequelize.where(
          sequelize.cast(sequelize.col('File.parsedData'), 'text'),
          { [Op.iLike]: `%${search}%` }
        )
      ];
    }

    const { count, rows } = await File.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'uploadedBy',
          attributes: ['id', 'name', 'email'],
          required: false
        },
        {
          model: User,
          as: 'manuallyEditedBy',
          attributes: ['id', 'name', 'email'],
          required: false
        }
      ],
      order: [['uploadedAt', 'DESC']],
      limit: limitNum,
      offset: offset
    });

    res.json({
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count,
        pages: Math.ceil(count / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching failed documents:', error);
    res.status(500).json({ message: error.message });
  }
});

// Get single failed document
router.get('/:id', async (req, res) => {
  try {
    if (req.user.role === 'external_user') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const file = await File.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'uploadedBy',
          attributes: ['id', 'name', 'email'],
          required: false
        },
        {
          model: User,
          as: 'manuallyEditedBy',
          attributes: ['id', 'name', 'email'],
          required: false
        }
      ]
    });

    if (!file) {
      return res.status(404).json({ message: 'Document not found' });
    }

    if (file.status !== 'failed') {
      return res.status(400).json({ message: 'Document is not failed' });
    }

    res.json(file);
  } catch (error) {
    console.error('Error fetching failed document:', error);
    res.status(500).json({ message: error.message });
  }
});

// Update parsed data and requeue for processing
router.put('/:id', async (req, res) => {
  try {
    if (req.user.role === 'external_user') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const file = await File.findByPk(req.params.id);
    if (!file) {
      return res.status(404).json({ message: 'Document not found' });
    }

    if (file.status !== 'failed') {
      return res.status(400).json({ message: 'Document is not failed' });
    }

    const { parsedData, accountNumber, companyId } = req.body;
    const oldParsedData = JSON.parse(JSON.stringify(file.parsedData || {}));

    // Track what changed
    const changes = {};
    if (parsedData) {
      Object.keys(parsedData).forEach(key => {
        if (JSON.stringify(oldParsedData[key]) !== JSON.stringify(parsedData[key])) {
          changes[key] = {
            from: oldParsedData[key],
            to: parsedData[key]
          };
        }
      });
    }

    // Update parsed data
    if (parsedData) {
      file.parsedData = { ...oldParsedData, ...parsedData };
    }

    // Update account number in parsed data if provided
    if (accountNumber !== undefined) {
      file.parsedData = file.parsedData || {};
      file.parsedData.accountNumber = accountNumber;
    }

    // If companyId is provided, assign it
    if (companyId) {
      const company = await Company.findByPk(companyId);
      if (!company) {
        return res.status(400).json({ message: 'Company not found' });
      }
      // Note: File model uses customerId, but we're using Company now
      // We'll need to update this relationship
    }

    // Add edit log entry
    const editLog = file.editLog || [];
    editLog.push({
      editedBy: req.user.userId,
      editedByName: req.user.name || req.user.email,
      editedAt: new Date().toISOString(),
      changes: changes,
      accountNumber: accountNumber !== undefined ? { from: oldParsedData.accountNumber, to: accountNumber } : undefined
    });

    file.editLog = editLog;
    file.manuallyEditedById = req.user.userId;
    file.status = 'pending'; // Reset to pending for reprocessing
    file.failureReason = null;
    file.errorMessage = null;

    await file.save();

    // Requeue for processing
    if (fileImportQueue) {
      await fileImportQueue.add('process-file', {
        fileId: file.id,
        fileName: file.fileName,
        filePath: file.filePath,
        manuallyEdited: true
      }, {
        priority: 1 // Higher priority for manually edited files
      });
    }

    res.json({
      message: 'Document updated and queued for reprocessing',
      file: file.toJSON()
    });
  } catch (error) {
    console.error('Error updating failed document:', error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

