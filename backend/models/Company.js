const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Company = sequelize.define('Company', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    parentId: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Parent company in hierarchy (null for CORP companies)'
    },
    left: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Nested set left boundary for hierarchy queries'
    },
    right: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Nested set right boundary for hierarchy queries'
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true
      }
    },
    type: {
      type: DataTypes.ENUM('CORP', 'SUB', 'BRANCH'),
      allowNull: true,
      comment: 'Company type: CORP (Corporate/Parent), SUB (Subsidiary), BRANCH (Branch)'
    },
    referenceNo: {
      type: DataTypes.INTEGER,
      allowNull: true,
      unique: true,
      comment: 'Unique reference number for company identification'
    },
    code: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
      comment: 'Unique company code/identifier (alternative to referenceNo)'
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isEmail: true
      }
    },
    globalSystemEmail: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'DEPRECATED: Use primaryContactId instead. Legacy global system email for notifications.'
    },
    primaryContactId: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Primary email contact (User ID) for notifications'
    },
    sendInvoiceEmail: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Send invoice/credit note upload notifications to primary contact'
    },
    sendInvoiceAttachment: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Include PDF attachment in invoice/credit note notifications'
    },
    sendStatementEmail: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Send statement upload notifications to primary contact'
    },
    sendStatementAttachment: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Include PDF attachment in statement notifications'
    },
    sendEmailAsSummary: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Send one summary email per import instead of individual emails per document'
    },
    sendBulkEmail: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Send one email to Primary Contact with CC to other notified users, instead of individual emails to each user'
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true
    },
    address: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
      comment: 'Company address (street, city, state, zip, country)'
    },
    taxId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Tax identification number'
    },
    vatNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'VAT registration number'
    },
    website: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isUrl: true
      }
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    edi: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Electronic Data Interchange - indicates if company uses EDI for invoice processing'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Additional flexible data'
    },
    createdById: {
      type: DataTypes.UUID,
      allowNull: true
      // Foreign key handled by association in models/index.js
    }
  }, {
    tableName: 'companies',
    timestamps: true,
    indexes: [
      {
        fields: ['parentId']
      },
      {
        fields: ['primaryContactId']
      },
      {
        fields: ['left', 'right']
      },
      {
        fields: ['referenceNo'],
        unique: true,
        where: {
          referenceNo: {
            [sequelize.Sequelize.Op.ne]: null
          }
        }
      },
      {
        fields: ['code'],
        unique: true,
        where: {
          code: {
            [sequelize.Sequelize.Op.ne]: null
          }
        }
      },
      {
        fields: ['name']
      },
      {
        fields: ['type']
      },
      {
        fields: ['isActive']
      }
    ]
  });

  return Company;
};

