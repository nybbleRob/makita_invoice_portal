const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const DocumentQuery = sequelize.define('DocumentQuery', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    documentType: {
      type: DataTypes.ENUM('invoice', 'credit_note', 'statement'),
      allowNull: false,
      comment: 'Type of document being queried'
    },
    documentId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'ID of the document (Invoice, CreditNote, or Statement)'
    },
    documentNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Document number (invoiceNumber, creditNoteNumber, etc.) for reference'
    },
    companyId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'Company that owns the document'
    },
    messages: {
      type: DataTypes.JSONB,
      defaultValue: [],
      comment: 'Array of messages in the query thread. Each message has: { id, userId, userName, userEmail, userRole, message, createdAt, isCustomer, replyTo (optional message id for threading) }'
    },
    status: {
      type: DataTypes.ENUM('open', 'resolved', 'closed'),
      defaultValue: 'open',
      comment: 'Query status: open (active), resolved (answered by admin), closed (archived)'
    },
    resolvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Timestamp when the query was resolved'
    },
    resolvedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'User ID who resolved the query (admin/global_admin only)'
    },
    resolutionReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Reason provided when resolving the query'
    },
    lastMessageAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Timestamp of the last message in the thread'
    },
    lastMessageBy: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'User ID who sent the last message'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Additional metadata'
    }
  }, {
    tableName: 'document_queries',
    timestamps: true,
    indexes: [
      {
        fields: ['documentType', 'documentId']
      },
      {
        fields: ['companyId']
      },
      {
        fields: ['status']
      },
      {
        fields: ['lastMessageAt']
      }
    ]
  });

  return DocumentQuery;
};

