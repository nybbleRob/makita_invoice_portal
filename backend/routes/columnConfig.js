const express = require('express');
const { ColumnConfiguration } = require('../models');
const globalAdmin = require('../middleware/globalAdmin');
const { getAllAvailableFields } = require('../utils/fieldDiscovery');
const router = express.Router();

/**
 * Get current column configuration for a page type
 * GET /api/column-config/:pageType
 */
router.get('/:pageType', async (req, res) => {
  try {
    const { pageType } = req.params;

    if (!['invoices', 'credit_notes'].includes(pageType)) {
      return res.status(400).json({ message: 'Invalid pageType. Must be "invoices" or "credit_notes"' });
    }

    let config = await ColumnConfiguration.findOne({
      where: { pageType }
    });

    // If no config exists, create default
    if (!config) {
      const defaultColumns = pageType === 'invoices' 
        ? ['type', 'accountNumber', 'companyName', 'invoiceNumber', 'poNumber', 'issueDate', 'amount', 'status']
        : ['type', 'accountNumber', 'companyName', 'creditNumber', 'issueDate', 'amount', 'status'];

      config = await ColumnConfiguration.create({
        pageType,
        visibleColumns: defaultColumns,
        columnOrder: defaultColumns,
        columnWidths: {}
      });
    }

    res.json(config);
  } catch (error) {
    console.error('Error fetching column configuration:', error);
    res.status(500).json({ message: 'Error fetching column configuration: ' + error.message });
  }
});

/**
 * Update column configuration for a page type
 * PUT /api/column-config/:pageType
 * Requires global admin
 */
router.put('/:pageType', globalAdmin, async (req, res) => {
  try {
    const { pageType } = req.params;
    const { visibleColumns, columnOrder, columnWidths } = req.body;

    if (!['invoices', 'credit_notes'].includes(pageType)) {
      return res.status(400).json({ message: 'Invalid pageType. Must be "invoices" or "credit_notes"' });
    }

    // Validate inputs
    if (visibleColumns && !Array.isArray(visibleColumns)) {
      return res.status(400).json({ message: 'visibleColumns must be an array' });
    }
    if (columnOrder && !Array.isArray(columnOrder)) {
      return res.status(400).json({ message: 'columnOrder must be an array' });
    }
    if (columnWidths && typeof columnWidths !== 'object') {
      return res.status(400).json({ message: 'columnWidths must be an object' });
    }

    let config = await ColumnConfiguration.findOne({
      where: { pageType }
    });

    if (!config) {
      // Create new config
      config = await ColumnConfiguration.create({
        pageType,
        visibleColumns: visibleColumns || [],
        columnOrder: columnOrder || [],
        columnWidths: columnWidths || {}
      });
    } else {
      // Update existing config
      if (visibleColumns !== undefined) config.visibleColumns = visibleColumns;
      if (columnOrder !== undefined) config.columnOrder = columnOrder;
      if (columnWidths !== undefined) config.columnWidths = columnWidths;
      await config.save();
    }

    res.json(config);
  } catch (error) {
    console.error('Error updating column configuration:', error);
    res.status(500).json({ message: 'Error updating column configuration: ' + error.message });
  }
});

/**
 * Get all available fields for a page type
 * GET /api/column-config/:pageType/available-fields
 */
router.get('/:pageType/available-fields', async (req, res) => {
  try {
    const { pageType } = req.params;

    if (!['invoices', 'credit_notes'].includes(pageType)) {
      return res.status(400).json({ message: 'Invalid pageType. Must be "invoices" or "credit_notes"' });
    }

    // Map pageType to templateType
    const templateType = pageType === 'credit_notes' ? 'credit_note' : 'invoice';
    
    const availableFields = await getAllAvailableFields(templateType);
    
    // Convert to array format for easier frontend consumption
    const fieldsArray = Object.values(availableFields).map(field => ({
      fieldName: field.fieldName,
      displayName: field.displayName,
      dataType: field.dataType,
      isStandard: field.isStandard,
      isCustom: field.isCustom,
      showInTable: field.showInTable,
      showInFilter: field.showInFilter,
      description: field.description
    }));

    res.json({ fields: fieldsArray });
  } catch (error) {
    console.error('Error fetching available fields:', error);
    res.status(500).json({ message: 'Error fetching available fields: ' + error.message });
  }
});

module.exports = router;

