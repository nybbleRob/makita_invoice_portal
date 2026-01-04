const express = require('express');
const { Report, Sequelize } = require('../models');
const { Op } = Sequelize;
const auth = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const router = express.Router();

// All routes require GA only
router.use(auth);
router.use(requirePermission('REPORTS_VIEW'));

// Get all reports
router.get('/', async (req, res) => {
  try {
    const { User } = require('../models');
    const reports = await Report.findAll({
      include: [{
        model: User,
        as: 'createdBy',
        attributes: ['id', 'name', 'email']
      }],
      order: [['createdAt', 'DESC']]
    });
    res.json(reports);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single report
router.get('/:id', async (req, res) => {
  try {
    const { User } = require('../models');
    const report = await Report.findByPk(req.params.id, {
      include: [{
        model: User,
        as: 'createdBy',
        attributes: ['id', 'name', 'email']
      }]
    });
    
    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }
    
    res.json(report);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create report
router.post('/', async (req, res) => {
  try {
    const report = await Report.create({
      ...req.body,
      createdById: req.user.userId
    });
    res.status(201).json(report);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update report
router.put('/:id', async (req, res) => {
  try {
    const report = await Report.findByPk(req.params.id);
    
    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    // Check if user is the creator or admin
    if (report.createdById !== req.user.userId && req.user.role !== 'global_admin' && req.user.role !== 'administrator') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    await report.update(req.body);
    res.json(report);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete report
router.delete('/:id', async (req, res) => {
  try {
    const report = await Report.findByPk(req.params.id);
    
    if (!report) {
      return res.status(404).json({ message: 'Report not found' });
    }

    // Check if user is the creator or admin
    if (report.createdById !== req.user.userId && req.user.role !== 'global_admin' && req.user.role !== 'administrator') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    await report.destroy();
    res.json({ message: 'Report deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

