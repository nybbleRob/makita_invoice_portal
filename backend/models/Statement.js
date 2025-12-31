const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Statement = sequelize.define('Statement', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    statementNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      comment: 'Unique statement number/identifier'
    },
    companyId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'Company this statement belongs to'
    },
    periodStart: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Statement period start date'
    },
    periodEnd: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Statement period end date'
    },
    openingBalance: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: 'Opening balance for the period'
    },
    closingBalance: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: 'Closing balance for the period'
    },
    totalDebits: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: 'Total debits in the period'
    },
    totalCredits: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: 'Total credits in the period'
    },
    transactions: {
      type: DataTypes.JSONB,
      defaultValue: [],
      comment: 'List of transactions included in statement'
    },
    status: {
      type: DataTypes.ENUM('draft', 'sent', 'acknowledged', 'disputed'),
      defaultValue: 'draft',
      comment: 'Statement status'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Additional notes or comments'
    },
    fileUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'URL to statement PDF/document'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Additional flexible data'
    },
    createdById: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'User who created this statement'
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
      comment: 'User who last edited this statement'
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
      comment: 'History of all edits made to this statement'
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
    tableName: 'statements',
    timestamps: true,
    indexes: [
      {
        fields: ['companyId']
      },
      {
        fields: ['statementNumber'],
        unique: true
      },
      {
        fields: ['periodStart', 'periodEnd']
      },
      {
        fields: ['status']
      }
    ]
  });

  return Statement;
};

