const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Invoice = sequelize.define('Invoice', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    invoiceNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      comment: 'Unique invoice number/identifier'
    },
    companyId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'Company this invoice belongs to'
    },
    issueDate: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Date invoice was issued'
    },
    dueDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date invoice is due'
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: 'Total invoice amount'
    },
    taxAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 0,
      comment: 'Tax amount'
    },
    status: {
      type: DataTypes.ENUM('draft', 'ready', 'sent', 'paid', 'overdue', 'cancelled'),
      defaultValue: 'draft',
      comment: 'Invoice status (ready = successfully parsed and ready for review)'
    },
    items: {
      type: DataTypes.JSONB,
      defaultValue: [],
      comment: 'Invoice line items'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Additional notes or comments'
    },
    fileUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'URL to invoice PDF/document'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Additional flexible data'
    },
    createdById: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'User who created this invoice'
    },
    viewedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date when document was first viewed by customer'
    },
    downloadedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date when document was first downloaded by customer'
    },
    deletedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'User who deleted this invoice'
    },
    deletedReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Reason for deletion (required for accountability)'
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date when invoice was deleted'
    },
    documentStatus: {
      type: DataTypes.ENUM('ready', 'review', 'viewed', 'downloaded', 'queried'),
      defaultValue: 'ready',
      allowNull: true,
      comment: 'Document status: ready (no issues), review (error/alert), viewed, downloaded, queried'
    },
    queriedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date when document was queried by customer'
    },
    editedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'User who last edited this invoice'
    },
    editReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Reason for last edit (required for accountability)'
    },
    editHistory: {
      type: DataTypes.JSONB,
      defaultValue: [],
      allowNull: true,
      comment: 'History of all edits made to this invoice'
    },
    retentionStartDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date when retention countdown begins (based on date trigger setting)'
    },
    retentionExpiryDate: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Calculated date when document will be deleted due to retention policy'
    },
    retentionDeletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date when document was deleted due to retention policy (for audit trail)'
    }
  }, {
    tableName: 'invoices',
    timestamps: true,
    paranoid: false, // We track deletion manually with deletedAt, deletedBy, deletedReason
    indexes: [
      {
        fields: ['companyId']
      },
      {
        fields: ['invoiceNumber'],
        unique: true
      },
      {
        fields: ['issueDate']
      },
      {
        fields: ['status']
      }
    ]
  });

  return Invoice;
};

