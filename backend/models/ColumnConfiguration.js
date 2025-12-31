const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ColumnConfiguration = sequelize.define('ColumnConfiguration', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    pageType: {
      type: DataTypes.ENUM('invoices', 'credit_notes'),
      allowNull: false,
      unique: true,
      comment: 'Type of page: invoices or credit_notes'
    },
    visibleColumns: {
      type: DataTypes.JSONB,
      defaultValue: [],
      comment: 'Array of field names that should be visible as columns'
    },
    columnOrder: {
      type: DataTypes.JSONB,
      defaultValue: [],
      comment: 'Array of field names in display order'
    },
    columnWidths: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Object mapping field names to column widths'
    }
  }, {
    tableName: 'column_configurations',
    timestamps: true,
    indexes: [
      { fields: ['pageType'] }
    ]
  });

  return ColumnConfiguration;
};

