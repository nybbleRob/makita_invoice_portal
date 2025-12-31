const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const EmailTemplate = sequelize.define('EmailTemplate', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      comment: 'Unique template identifier (e.g., welcome, password-reset)'
    },
    subject: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Email subject line (supports variables like {{userName}})'
    },
    htmlBody: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'HTML email body (supports variables)'
    },
    textBody: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Plain text email body (optional, auto-generated from HTML if not provided)'
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Description of when this template is used'
    },
    variables: {
      type: DataTypes.JSONB,
      defaultValue: [],
      comment: 'Array of available variables for this template (e.g., ["userName", "resetUrl"])'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    category: {
      type: DataTypes.ENUM('auth', 'notification', 'document', 'system'),
      defaultValue: 'system',
      comment: 'Template category for organization'
    }
  }, {
    tableName: 'email_templates',
    timestamps: true
  });

  return EmailTemplate;
};

