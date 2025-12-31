const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PendingRegistration = sequelize.define('PendingRegistration', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    firstName: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true
      }
    },
    lastName: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true
      }
    },
    companyName: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true
      }
    },
    accountNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Account number or company reference number'
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isEmail: true,
        notEmpty: true
      }
    },
    customFields: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Custom form field values submitted by the user'
    },
    status: {
      type: DataTypes.ENUM('pending', 'approved', 'rejected'),
      defaultValue: 'pending'
    },
    reviewedById: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'User ID of admin who reviewed this registration'
    },
    reviewedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    rejectionReason: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Reason for rejection if status is rejected'
    },
    createdUserId: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'User ID created from this registration (if approved)'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Additional metadata about the registration'
    }
  }, {
    tableName: 'pending_registrations',
    timestamps: true
  });

  return PendingRegistration;
};

