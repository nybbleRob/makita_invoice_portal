const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Settings = sequelize.define('Settings', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    companyName: {
      type: DataTypes.STRING,
      defaultValue: 'Makita Invoice Portal'
    },
    siteTitle: {
      type: DataTypes.STRING,
      defaultValue: 'Makita Invoice Portal',
      comment: 'Site title (e.g., Makita Invoice Portal) - previously siteName'
    },
    siteName: {
      type: DataTypes.STRING,
      defaultValue: 'Makita Invoice Portal',
      comment: 'Deprecated: Use siteTitle instead. Kept for backward compatibility.'
    },
    systemEmail: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isEmail: true
      },
      comment: 'Global email address the system uses to send emails'
    },
    primaryColor: {
      type: DataTypes.STRING,
      defaultValue: '#066fd1',
      validate: {
        is: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/
      }
    },
    primaryColorShades: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    secondaryColor: {
      type: DataTypes.STRING,
      defaultValue: '#6c757d',
      validate: {
        is: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/
      }
    },
    secondaryColorShades: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    logoLight: {
      type: DataTypes.STRING,
      allowNull: true
    },
    logoDark: {
      type: DataTypes.STRING,
      allowNull: true
    },
    favicon: {
      type: DataTypes.STRING,
      allowNull: true
    },
    loginBackgroundImage: {
      type: DataTypes.STRING,
      allowNull: true
    },
    twoFactorAuth: {
      type: DataTypes.JSONB,
      defaultValue: {
        enabled: false,
        required: false,
        issuer: 'Makita Invoice Portal'
      }
    },
    emailProvider: {
      type: DataTypes.JSONB,
      defaultValue: {
        enabled: false,
        provider: 'smtp', // 'smtp', 'office365', 'resend', 'smtp2go'
        testEmail: '', // Email address to use for test emails
        smtp: {
          host: '',
          port: 587,
          secure: false, // true for 465, false for other ports
          auth: {
            user: '',
            password: ''
          },
          fromEmail: '',
          fromName: 'Makita Invoice Portal',
          rejectUnauthorized: true // Reject unauthorized SSL certificates
        },
        office365: {
          tenantId: '',
          clientId: '',
          clientSecret: '',
          fromEmail: '', // Email address to send from
          sendAsUser: '' // Optional: User ID to send as (if different from fromEmail)
        },
        resend: {
          apiKey: '',
          fromEmail: '', // Must be verified in Resend
          fromName: 'Makita Invoice Portal'
        },
        smtp2go: {
          apiKey: '',
          fromEmail: '', // Must be verified sender
          fromName: 'Makita Invoice Portal'
        }
      }
    },
    // Legacy SMTP field for backward compatibility
    smtp: {
      type: DataTypes.JSONB,
      defaultValue: {
        enabled: false,
        host: '',
        port: 587,
        secure: false,
        auth: {
          user: '',
          password: ''
        },
        fromEmail: '',
        fromName: 'Makita Invoice Portal'
      }
    },
    passwordExpiryDays: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        isIn: [[null, 0, 14, 30, 60, 90]]
      }
    },
    ftp: {
      type: DataTypes.JSONB,
      defaultValue: {
        enabled: false,
        type: 'ftp', // 'ftp' or 'sftp'
        host: '',
        port: 21, // 21 for FTP, 22 for SFTP
        username: '',
        password: '',
        directory: '/InvoicePortal', // Base directory (recommended: /InvoicePortal or /Documents)
        secure: false, // Use FTPS (FTP over TLS)
        passive: true,
        testFileName: '', // File to use for test import
        folderStructure: {
          unprocessed: '/Unprocessed', // Where new files are placed by customers
          processed: '/Processed', // Where successfully processed files are moved
          failed: '/Failed' // Where failed files are moved
        },
        folders: [ // Folders to monitor for file imports
          {
            path: '/Unprocessed', // Main folder for all document types
            fileType: 'auto', // 'auto' = detect from filename/content, or 'invoice', 'credit_note', 'statement'
            enabled: true
          }
        ],
        // Alternative: single folder mode
        singleFolderMode: false, // If true, only monitor base directory
        singleFolderFileType: 'invoice' // Default file type for single folder mode
      }
    },
    fileRetentionDays: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 90,
      comment: 'Number of days to keep files before deletion (null = never delete)'
    },
    documentRetentionPeriod: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        isIn: [[null, 14, 30, 60, 90]]
      },
      comment: 'Document retention period in days (null = disabled, 14, 30, 60, or 90 days)'
    },
    documentRetentionDateTrigger: {
      type: DataTypes.ENUM('upload_date', 'invoice_date'),
      defaultValue: 'upload_date',
      comment: 'Date trigger for retention countdown: upload_date (when document becomes ready) or invoice_date (invoice/tax point date)'
    },
    parsingProvider: {
      type: DataTypes.JSONB,
      defaultValue: {
        enabled: false,
        provider: 'documentai', // 'documentai' or 'local'
        documentai: {
          enabled: false,
          credentialsPath: '', // Path to service account JSON (stored in env, this is just for reference)
          credentialsJson: '', // Service account JSON content (stored in database, masked in API)
          projectId: '',
          location: 'us',
          processorId: ''
        }
      }
    },
    mandatoryFields: {
      type: DataTypes.JSONB,
      defaultValue: {
        // Default mandatory fields for PDF templates
        pdf: [
          'document_type',
          'account_number',
          'invoice_number',
          'vat_amount',
          'customer_po',
          'amount', // invoice_total
          'date', // date_tax_point
          'page_no'
        ],
        // Default mandatory fields for Excel templates
        excel: [
          'document_type',
          'account_no',
          'invoice_number',
          'vat_amount',
          'invoice_total'
        ]
      },
      comment: 'Mandatory fields that must be present in templates (configured by Global Admins)'
    },
    onlyExternalUsersChangeDocumentStatus: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'If true, only external users (customers) can change document status (viewed/downloaded). If false, all users can change status (for testing).'
    },
    registrationFormFields: {
      type: DataTypes.JSONB,
      defaultValue: [],
      comment: 'Custom fields for user registration form. Each field has: id, label, type, required, placeholder, options (for select)'
    },
    queriesEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'Enable/disable the document queries feature system-wide. When disabled, all query features are hidden.'
    }
  }, {
    tableName: 'settings',
    timestamps: true
  });

  // Internal function to get settings from database
  async function getSettingsFromDb() {
    let settings;
    try {
      settings = await Settings.findOne();
    } catch (error) {
      // If query fails due to missing column, the backend server needs to be restarted
      // after running the migration to reload the model definitions
      if (error.message && error.message.includes('does not exist')) {
        console.error('❌ Database column missing. The migration was successful, but the backend server needs to be restarted.');
        console.error('   Please restart your backend server to reload the model definitions.');
        console.error('   Error:', error.message);
        throw new Error('Database schema mismatch. Please restart the backend server after running migrations.');
      }
      throw error;
    }
    
    if (!settings) {
      settings = await Settings.create({});
    }
    
    // Ensure mandatoryFields exists (for backward compatibility with existing databases)
    if (!settings.mandatoryFields) {
      settings.mandatoryFields = {
        pdf: [
          'document_type',
          'account_number',
          'invoice_number',
          'vat_amount',
          'customer_po',
          'amount',
          'date',
          'page_no'
        ],
        excel: [
          'document_type',
          'account_no',
          'invoice_number',
          'vat_amount',
          'invoice_total'
        ]
      };
      // Save the default if it doesn't exist (but don't block if column doesn't exist)
      try {
        await settings.save();
      } catch (error) {
        // Column might not exist yet - that's okay, we'll use the default
        console.warn('Could not save mandatoryFields default (column may not exist yet):', error.message);
      }
    }
    
    // Ensure onlyExternalUsersChangeDocumentStatus has a default value
    // Access via getDataValue to handle cases where column might not be loaded
    if (settings.onlyExternalUsersChangeDocumentStatus === undefined || 
        settings.onlyExternalUsersChangeDocumentStatus === null) {
      settings.onlyExternalUsersChangeDocumentStatus = false;
    }
    
    return settings;
  }

  // Static method to get or create settings (with Redis caching)
  Settings.getSettings = async function() {
    try {
      // Try to use cache if available
      const { getCachedSettings } = require('../utils/settingsCache');
      return await getCachedSettings(getSettingsFromDb);
    } catch (error) {
      // If cache utility fails, fall back to direct database access
      console.warn('⚠️  Cache error, falling back to database:', error.message);
      return await getSettingsFromDb();
    }
  };

  // Static method to invalidate settings cache (call after updates)
  Settings.invalidateCache = async function() {
    try {
      const { invalidateSettingsCache } = require('../utils/settingsCache');
      await invalidateSettingsCache();
    } catch (error) {
      console.warn('⚠️  Could not invalidate settings cache:', error.message);
    }
  };

  // Static method to get settings for update (bypasses cache, returns Sequelize instance)
  // Use this when you need to modify and save settings
  Settings.getSettingsForUpdate = async function() {
    return await getSettingsFromDb();
  };

  return Settings;
};
