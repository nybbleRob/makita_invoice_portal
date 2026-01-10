const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SupplierDocument = sequelize.define('SupplierDocument', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    supplierId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'Supplier this document belongs to'
    },
    templateId: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Template used for parsing (optional)'
    },
    documentType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        isIn: [['invoice', 'credit_note', 'statement']]
      },
      comment: 'Type of document: invoice, credit_note, or statement'
    },
    invoiceNumber: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Invoice number (or creditNoteNumber/statementNumber)'
    },
    poNumber: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Purchase Order Number (if present)'
    },
    documentDate: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      comment: 'Date of document'
    },
    dueDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: 'Due date if applicable'
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
      comment: 'Total document amount'
    },
    taxAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 0,
      comment: 'Tax amount'
    },
    vatAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 0,
      comment: 'VAT amount'
    },
    extractedFields: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'All extracted fields from parsing'
    },
    items: {
      type: DataTypes.JSONB,
      defaultValue: [],
      comment: 'Line items if applicable'
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Additional notes or comments'
    },
    fileUrl: {
      type: DataTypes.STRING(500),
      allowNull: false,
      comment: 'Path to processed document'
    },
    originalName: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Original filename'
    },
    fileHash: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: 'SHA256 hash for duplicate detection'
    },
    status: {
      type: DataTypes.STRING(50),
      defaultValue: 'ready',
      validate: {
        isIn: [['ready', 'processed', 'archived', 'failed']]
      },
      comment: 'Document status: ready, processed, archived, failed'
    },
    documentStatus: {
      type: DataTypes.STRING(50),
      defaultValue: 'ready',
      validate: {
        isIn: [['ready', 'review', 'queried']]
      },
      comment: 'Document review status: ready, review, queried'
    },
    parsedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date when document was parsed'
    },
    parsedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'System user who processed it'
    },
    confidence: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      comment: 'Parsing confidence percentage'
    },
    parsingErrors: {
      type: DataTypes.JSONB,
      defaultValue: [],
      comment: 'Any parsing errors/warnings'
    },
    viewedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date when document was viewed'
    },
    viewedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'User who viewed the document'
    },
    queriedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date when document was queried'
    },
    queriedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'User who queried the document'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Additional flexible data'
    },
    createdById: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'User who created this document'
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date when document was deleted'
    }
  }, {
    tableName: 'supplier_documents',
    timestamps: true,
    paranoid: false,
    indexes: [
      {
        fields: ['supplierId']
      },
      {
        fields: ['templateId']
      },
      {
        fields: ['documentType']
      },
      {
        fields: ['documentDate']
      },
      {
        fields: ['status']
      },
      {
        fields: ['documentStatus']
      },
      {
        fields: ['fileHash']
      },
      {
        fields: ['invoiceNumber']
      },
      {
        fields: ['poNumber']
      },
      {
        fields: ['deletedAt'],
        where: {
          deletedAt: null
        }
      },
      {
        unique: true,
        fields: ['supplierId', 'invoiceNumber'],
        where: {
          invoiceNumber: { [sequelize.Sequelize.Op.ne]: null }
        }
      }
    ]
  });

  // Instance methods
  SupplierDocument.prototype.markAsViewed = async function(userId) {
    this.viewedAt = new Date();
    this.viewedBy = userId;
    if (this.documentStatus === 'ready') {
      this.documentStatus = 'viewed';
    }
    await this.save();
  };

  SupplierDocument.prototype.markAsQueried = async function(userId) {
    this.queriedAt = new Date();
    this.queriedBy = userId;
    this.documentStatus = 'queried';
    await this.save();
  };

  // Static methods
  SupplierDocument.findBySupplier = async function(supplierId, options = {}) {
    const { limit = 50, offset = 0, order = [['documentDate', 'DESC']] } = options;
    return await this.findAll({
      where: {
        supplierId,
        deletedAt: null
      },
      limit,
      offset,
      order
    });
  };

  SupplierDocument.findByDateRange = async function(startDate, endDate, supplierId = null) {
    const where = {
      documentDate: {
        [sequelize.Sequelize.Op.between]: [startDate, endDate]
      },
      deletedAt: null
    };
    
    if (supplierId) {
      where.supplierId = supplierId;
    }
    
    return await this.findAll({
      where,
      order: [['documentDate', 'DESC']]
    });
  };

  SupplierDocument.searchByInvoiceNumber = async function(invoiceNumber, supplierId = null) {
    const { Op } = require('sequelize');
    const where = {
      invoiceNumber: {
        [Op.iLike]: `%${invoiceNumber}%`
      },
      deletedAt: null
    };
    
    if (supplierId) {
      where.supplierId = supplierId;
    }
    
    return await this.findAll({
      where,
      order: [['documentDate', 'DESC']]
    });
  };

  return SupplierDocument;
};
