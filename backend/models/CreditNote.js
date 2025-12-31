const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CreditNote = sequelize.define('CreditNote', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    creditNoteNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      comment: 'Unique credit note number/identifier'
    },
    companyId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'Company this credit note belongs to'
    },
    invoiceId: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Related invoice if this credit note is for a specific invoice'
    },
    issueDate: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Date credit note was issued'
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: 'Credit note amount'
    },
    taxAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 0,
      comment: 'Tax amount'
    },
    status: {
      type: DataTypes.ENUM('draft', 'ready', 'sent', 'applied', 'cancelled'),
      defaultValue: 'draft',
      comment: 'Credit note status (ready = successfully parsed and ready for review)'
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Reason for credit note'
    },
    items: {
      type: DataTypes.JSONB,
      defaultValue: [],
      comment: 'Credit note line items'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Additional notes or comments'
    },
    fileUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'URL to credit note PDF/document'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Additional flexible data'
    },
    createdById: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'User who created this credit note'
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
      comment: 'User who last edited this credit note'
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
      comment: 'History of all edits made to this credit note'
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
    tableName: 'credit_notes',
    timestamps: true,
    indexes: [
      {
        fields: ['companyId']
      },
      {
        fields: ['invoiceId']
      },
      {
        fields: ['creditNoteNumber'],
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

  return CreditNote;
};

