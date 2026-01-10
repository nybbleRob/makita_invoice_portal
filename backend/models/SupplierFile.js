const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SupplierFile = sequelize.define('SupplierFile', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    fileName: {
      type: DataTypes.STRING(500),
      allowNull: false,
      comment: 'Filename after upload'
    },
    originalName: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Original filename before upload'
    },
    filePath: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Temporary file path before processing'
    },
    fileUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Final file URL after processing'
    },
    fileHash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: 'SHA256 hash for duplicate detection'
    },
    fileSize: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'File size in bytes'
    },
    mimeType: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'MIME type of file'
    },
    supplierId: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Supplier this file belongs to (if known)'
    },
    templateId: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Template to use for parsing (if known)'
    },
    supplierDocumentId: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Supplier document created from this file (after processing)'
    },
    status: {
      type: DataTypes.STRING(50),
      defaultValue: 'uploaded',
      validate: {
        isIn: [['uploaded', 'processing', 'processed', 'failed']]
      },
      comment: 'File status: uploaded, processing, processed, failed'
    },
    processingErrors: {
      type: DataTypes.JSONB,
      defaultValue: [],
      comment: 'Any processing errors'
    },
    source: {
      type: DataTypes.STRING(50),
      defaultValue: 'manual',
      validate: {
        isIn: [['manual', 'ftp', 'email', 'api']]
      },
      comment: 'File source: manual, ftp, email, api'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Additional flexible data'
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date when file was deleted'
    }
  }, {
    tableName: 'supplier_files',
    timestamps: true,
    paranoid: false,
    indexes: [
      {
        fields: ['fileHash']
      },
      {
        fields: ['supplierId']
      },
      {
        fields: ['templateId']
      },
      {
        fields: ['supplierDocumentId']
      },
      {
        fields: ['status']
      },
      {
        fields: ['source']
      },
      {
        fields: ['createdAt']
      },
      {
        fields: ['deletedAt'],
        where: {
          deletedAt: null
        }
      }
    ]
  });

  return SupplierFile;
};
