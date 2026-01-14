const { DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

module.exports = (sequelize) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true
      }
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
        notEmpty: true
      }
    },
    password: {
      type: DataTypes.STRING,
      allowNull: true, // Allow null for bulk imports - password will be set later
      validate: {
        // Validate password strength if password is provided (not null)
        isStrongPassword: function(value) {
          if (value === null || value === undefined || value.length === 0) {
            return; // Allow null passwords for bulk imports
          }
          
          // Minimum 8 characters
          if (value.length < 8) {
            throw new Error('Password must be at least 8 characters long');
          }
          
          // At least one uppercase letter
          if (!/[A-Z]/.test(value)) {
            throw new Error('Password must contain at least one uppercase letter');
          }
          
          // At least one lowercase letter
          if (!/[a-z]/.test(value)) {
            throw new Error('Password must contain at least one lowercase letter');
          }
          
          // At least one number
          if (!/[0-9]/.test(value)) {
            throw new Error('Password must contain at least one number');
          }
        }
      }
    },
    mustChangePassword: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Flag to force password change on first login or after admin reset'
    },
    role: {
      type: DataTypes.ENUM('global_admin', 'administrator', 'manager', 'credit_senior', 'credit_controller', 'external_user', 'notification_contact'),
      defaultValue: 'external_user'
    },
    addedById: {
      type: DataTypes.UUID,
      allowNull: true
      // Foreign key handled by association in models/index.js
    },
    lastLogin: {
      type: DataTypes.DATE,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    avatar: {
      type: DataTypes.STRING,
      allowNull: true
    },
    resetPasswordToken: {
      type: DataTypes.STRING,
      allowNull: true
    },
    resetPasswordExpires: {
      type: DataTypes.DATE,
      allowNull: true
    },
    pendingEmail: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'New email address pending validation'
    },
    emailChangeToken: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Hashed token for email change validation'
    },
    emailChangeExpires: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Expiration timestamp for email change token (30 minutes)'
    },
    twoFactorSecret: {
      type: DataTypes.STRING,
      allowNull: true
    },
    twoFactorEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    twoFactorVerified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    passwordExpiryDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    allCompanies: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'If true, user can access all companies (for Staff/Manager/Administrator roles)'
    },
    sendInvoiceEmail: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Send invoice/credit note emails to this user'
    },
    sendInvoiceAttachment: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Include invoice/credit note attachments in emails (requires sendInvoiceEmail)'
    },
    sendStatementEmail: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Send statement emails to this user'
    },
    sendStatementAttachment: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Include statement attachments in emails (requires sendStatementEmail)'
    },
    sendEmailAsSummary: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Send one summary email per import instead of individual emails per document'
    },
    sendImportSummaryReport: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Receive import summary report emails (for Global Admins and Administrators only)'
    },
    failedLoginAttempts: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Number of consecutive failed login attempts'
    },
    accountLockedUntil: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Timestamp when account lockout expires (null if not locked)'
    },
    lastFailedLoginAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Timestamp of last failed login attempt'
    },
    lockedBy: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'Admin user ID who manually locked the account (null if auto-locked)'
    },
    lockReason: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Reason for lockout (e.g., "brute_force", "manual")'
    }
  }, {
    tableName: 'users',
    timestamps: true,
    indexes: [
      {
        fields: ['email'],
        unique: true
      },
      {
        fields: ['role']
      },
      {
        fields: ['isActive']
      },
      {
        fields: ['createdAt']
      },
      {
        fields: ['addedById']
      },
      {
        fields: ['accountLockedUntil']
      },
      {
        fields: ['failedLoginAttempts']
      }
    ],
    hooks: {
      beforeCreate: async (user) => {
        if (user.password) {
          user.password = await bcrypt.hash(user.password, 10);
        }
        // If password is null or not provided, set mustChangePassword to true
        // Exception: notification_contact users never need a password
        if (!user.password && user.role !== 'notification_contact') {
          user.mustChangePassword = true;
        }
      },
      beforeUpdate: async (user) => {
        if (user.changed('password')) {
          // If password is being set (not null), hash it
          if (user.password) {
            user.password = await bcrypt.hash(user.password, 10);
          }
          
          // Set password expiry date if enabled
          try {
            const { Settings } = require('./index');
            const settings = await Settings.findOne();
            if (settings && settings.passwordExpiryDays && settings.passwordExpiryDays > 0) {
              const expiryDate = new Date();
              expiryDate.setDate(expiryDate.getDate() + settings.passwordExpiryDays);
              user.passwordExpiryDate = expiryDate;
            } else {
              user.passwordExpiryDate = null;
            }
          } catch (error) {
            user.passwordExpiryDate = null;
          }
        }
      }
    }
  });

  // Instance method to compare password
  User.prototype.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
  };

  // Instance method to get safe user object (without password)
  User.prototype.toSafeObject = function() {
    const user = this.toJSON();
    delete user.password;
    delete user.twoFactorSecret;
    delete user.resetPasswordToken;
    delete user.resetPasswordExpires;
    delete user.emailChangeToken;
    return user;
  };

  return User;
};
