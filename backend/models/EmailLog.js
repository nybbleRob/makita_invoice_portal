/**
 * EmailLog Model
 * Tracks email delivery status for idempotency and monitoring
 * 
 * Status values:
 * - QUEUED: Email added to queue, not yet processed
 * - SENDING: Currently being processed by worker
 * - SENT: Successfully delivered to SMTP server
 * - DEFERRED: Temporary failure, will retry
 * - FAILED_PERMANENT: Permanent failure, no more retries
 */

module.exports = (sequelize, DataTypes) => {
  const EmailLog = sequelize.define('EmailLog', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    
    // Job tracking
    jobId: {
      type: DataTypes.STRING(100),
      allowNull: true,
      unique: true,
      comment: 'BullMQ job ID for deduplication'
    },
    
    // Email details (no body stored for privacy)
    to: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        isEmail: true
      }
    },
    subject: {
      type: DataTypes.STRING(500),
      allowNull: false
    },
    templateName: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Name of email template used, if any'
    },
    
    // Delivery status
    status: {
      type: DataTypes.ENUM('QUEUED', 'SENDING', 'SENT', 'DEFERRED', 'FAILED_PERMANENT'),
      defaultValue: 'QUEUED',
      allowNull: false
    },
    
    // Success tracking
    messageId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'SMTP message ID returned on successful send'
    },
    sentAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    
    // Retry tracking
    attempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Number of send attempts made'
    },
    maxAttempts: {
      type: DataTypes.INTEGER,
      defaultValue: 10,
      comment: 'Maximum retry attempts configured'
    },
    nextRetryAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Scheduled time for next retry attempt'
    },
    
    // Error tracking
    lastError: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Most recent error message'
    },
    errorCode: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'SMTP response code or error code (e.g., 450, 550, ETIMEDOUT)'
    },
    errorType: {
      type: DataTypes.ENUM('TEMPORARY', 'PERMANENT', 'RATE_LIMITED', 'UNKNOWN'),
      allowNull: true,
      comment: 'Classification of the error'
    },
    
    // Metadata for attribution
    userId: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'User who triggered this email (null for system emails)'
    },
    userEmail: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Email of user who triggered this (for logging)'
    },
    companyId: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Related company ID if applicable'
    },
    companyName: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Related company name (for logging)'
    },
    
    // Email provider info
    provider: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Email provider used (smtp, sendgrid, etc.)'
    }
  }, {
    tableName: 'email_logs',
    timestamps: true,
    indexes: [
      {
        fields: ['status']
      },
      {
        fields: ['to']
      },
      {
        fields: ['createdAt']
      },
      {
        fields: ['userId']
      },
      {
        fields: ['companyId']
      },
      {
        fields: ['jobId'],
        unique: true
      }
    ]
  });

  return EmailLog;
};

