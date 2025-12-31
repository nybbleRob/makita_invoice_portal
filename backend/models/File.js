const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const File = sequelize.define('File', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    fileName: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Original filename from FTP'
    },
    fileHash: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'SHA256 hash of file content to detect duplicates'
    },
    filePath: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Path to stored file on server'
    },
    fileSize: {
      type: DataTypes.BIGINT,
      allowNull: false,
      comment: 'File size in bytes'
    },
    mimeType: {
      type: DataTypes.STRING,
      defaultValue: 'application/pdf',
      comment: 'MIME type of file'
    },
    fileType: {
      type: DataTypes.ENUM('invoice', 'credit_note', 'statement', 'unknown'),
      defaultValue: 'unknown',
      comment: 'Type of document (invoice, credit note, statement)'
    },
    ftpFolder: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'FTP folder path where file was found'
    },
    customerId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'customers',
        key: 'id'
      },
      comment: 'Associated customer (if known from parsing)'
    },
    uploadedById: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      comment: 'User who uploaded/imported the file (system if from FTP)'
    },
    status: {
      type: DataTypes.ENUM('pending', 'processing', 'parsed', 'failed', 'duplicate', 'unallocated'),
      defaultValue: 'pending',
      comment: 'Processing status'
    },
    failureReason: {
      type: DataTypes.ENUM('unallocated', 'parsing_error', 'validation_error', 'duplicate', 'other'),
      allowNull: true,
      comment: 'Reason for failure (if status is failed or unallocated)'
    },
    editLog: {
      type: DataTypes.JSONB,
      defaultValue: [],
      comment: 'Log of manual edits (who, when, what changed)'
    },
    manuallyEditedById: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'User who last manually edited this file'
    },
    processingMethod: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Which method successfully parsed the file (e.g., local_coordinates_template_name, vision, documentai, manual)'
    },
    parsedData: {
      type: DataTypes.JSONB,
      allowNull: true,
      comment: 'Extracted data from PDF (invoice number, date, amount, etc.)'
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Error message if processing failed'
    },
    processedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'When file was successfully processed'
    },
    uploadedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      comment: 'When file was uploaded/imported'
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'When file was deleted (soft delete for retention)'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Additional metadata (FTP source, job ID, etc.)'
    }
  }, {
    tableName: 'files',
    timestamps: true,
    indexes: [
      {
        fields: ['fileHash'],
        unique: true
      },
      {
        fields: ['status']
      },
      {
        fields: ['customerId']
      },
      {
        fields: ['uploadedAt']
      },
      {
        fields: ['deletedAt']
      }
    ]
  });

  // Instance method to check if file is duplicate
  File.prototype.isDuplicate = async function() {
    const existing = await File.findOne({
      where: {
        fileHash: this.fileHash,
        id: { [sequelize.Sequelize.Op.ne]: this.id }
      }
    });
    return !!existing;
  };

  // Static method to find by hash
  File.findByHash = async function(hash) {
    return await this.findOne({ where: { fileHash: hash } });
  };

  return File;
};

