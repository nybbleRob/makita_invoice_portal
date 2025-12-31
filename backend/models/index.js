const { sequelize } = require('../config/database');
const { Sequelize } = require('sequelize');

// Import models
const User = require('./User')(sequelize, Sequelize.DataTypes);
const Report = require('./Report')(sequelize, Sequelize.DataTypes);
const Settings = require('./Settings')(sequelize, Sequelize.DataTypes);
const Customer = require('./Customer')(sequelize, Sequelize.DataTypes);
const File = require('./File')(sequelize, Sequelize.DataTypes);
const Template = require('./SupplierTemplate')(sequelize, Sequelize.DataTypes);
const Company = require('./Company')(sequelize, Sequelize.DataTypes);
const UserCompany = require('./UserCompany')(sequelize, Sequelize.DataTypes);
const Invoice = require('./Invoice')(sequelize, Sequelize.DataTypes);
const CreditNote = require('./CreditNote')(sequelize, Sequelize.DataTypes);
const Statement = require('./Statement')(sequelize, Sequelize.DataTypes);
const EmailTemplate = require('./EmailTemplate')(sequelize, Sequelize.DataTypes);
const DocumentQuery = require('./DocumentQuery')(sequelize, Sequelize.DataTypes);
const PendingRegistration = require('./PendingRegistration')(sequelize, Sequelize.DataTypes);
const ImportTransaction = require('./ImportTransaction')(sequelize, Sequelize.DataTypes);
const ColumnConfiguration = require('./ColumnConfiguration')(sequelize, Sequelize.DataTypes);
const EmailLog = require('./EmailLog')(sequelize, Sequelize.DataTypes);

// Define associations
// User associations
User.hasMany(User, { foreignKey: 'addedById', as: 'addedUsers' });
User.belongsTo(User, { foreignKey: 'addedById', as: 'addedByUser' });

User.hasMany(Report, { foreignKey: 'createdById', as: 'reports' });
Report.belongsTo(User, { foreignKey: 'createdById', as: 'createdBy' });

// Customer associations (Parent/Child hierarchy)
Customer.hasMany(Customer, { 
  foreignKey: 'parentId', 
  as: 'children',
  onDelete: 'SET NULL'
});
Customer.belongsTo(Customer, { 
  foreignKey: 'parentId', 
  as: 'parent',
  onDelete: 'SET NULL'
});

// Customer can have multiple reports
Customer.hasMany(Report, { foreignKey: 'customerId', as: 'reports' });
Report.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });

// Customer can have multiple files
Customer.hasMany(File, { foreignKey: 'customerId', as: 'files' });
File.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });

// User can have multiple files (uploaded by)
User.hasMany(File, { foreignKey: 'uploadedById', as: 'uploadedFiles' });
File.belongsTo(User, { foreignKey: 'uploadedById', as: 'uploadedBy' });

// User can have multiple files (manually edited by)
User.hasMany(File, { foreignKey: 'manuallyEditedById', as: 'manuallyEditedFiles' });
File.belongsTo(User, { foreignKey: 'manuallyEditedById', as: 'manuallyEditedBy' });

// Company associations
User.hasMany(Company, { foreignKey: 'createdById', as: 'createdCompanies' });
Company.belongsTo(User, { foreignKey: 'createdById', as: 'createdBy' });

// Company hierarchy (Parent/Child)
Company.hasMany(Company, { 
  foreignKey: 'parentId', 
  as: 'children',
  onDelete: 'SET NULL'
});
Company.belongsTo(Company, { 
  foreignKey: 'parentId', 
  as: 'parent',
  onDelete: 'SET NULL'
});

// Primary Contact association (Company has one primary contact user for notifications)
Company.belongsTo(User, { foreignKey: 'primaryContactId', as: 'primaryContact' });
User.hasMany(Company, { foreignKey: 'primaryContactId', as: 'primaryContactFor' });

// User-Company many-to-many association
User.belongsToMany(Company, {
  through: UserCompany,
  foreignKey: 'userId',
  otherKey: 'companyId',
  as: 'companies'
});

Company.belongsToMany(User, {
  through: UserCompany,
  foreignKey: 'companyId',
  otherKey: 'userId',
  as: 'users'
});

// Document associations (Invoices, Credit Notes, Statements)
Company.hasMany(Invoice, { foreignKey: 'companyId', as: 'invoices' });
Invoice.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });

Company.hasMany(CreditNote, { foreignKey: 'companyId', as: 'creditNotes' });
CreditNote.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });

Company.hasMany(Statement, { foreignKey: 'companyId', as: 'statements' });
Statement.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });

// Credit Note can be related to an Invoice
Invoice.hasMany(CreditNote, { foreignKey: 'invoiceId', as: 'creditNotes' });
CreditNote.belongsTo(Invoice, { foreignKey: 'invoiceId', as: 'invoice' });

// User associations for documents
User.hasMany(Invoice, { foreignKey: 'createdById', as: 'createdInvoices' });
Invoice.belongsTo(User, { foreignKey: 'createdById', as: 'createdBy' });

User.hasMany(CreditNote, { foreignKey: 'createdById', as: 'createdCreditNotes' });
CreditNote.belongsTo(User, { foreignKey: 'createdById', as: 'createdBy' });

User.hasMany(Statement, { foreignKey: 'createdById', as: 'createdStatements' });
Statement.belongsTo(User, { foreignKey: 'createdById', as: 'createdBy' });

// Document Query associations
Company.hasMany(DocumentQuery, { foreignKey: 'companyId', as: 'queries' });
DocumentQuery.belongsTo(Company, { foreignKey: 'companyId', as: 'company' });

User.hasMany(DocumentQuery, { foreignKey: 'lastMessageBy', as: 'queries' });
DocumentQuery.belongsTo(User, { foreignKey: 'lastMessageBy', as: 'lastMessageByUser' });

// Pending Registration associations
User.hasMany(PendingRegistration, { foreignKey: 'reviewedById', as: 'reviewedRegistrations' });
PendingRegistration.belongsTo(User, { foreignKey: 'reviewedById', as: 'reviewedBy' });

User.hasOne(PendingRegistration, { foreignKey: 'createdUserId', as: 'createdFromRegistration' });
PendingRegistration.belongsTo(User, { foreignKey: 'createdUserId', as: 'createdUser' });

// Import Transaction associations
User.hasMany(ImportTransaction, { foreignKey: 'userId', as: 'importTransactions' });
ImportTransaction.belongsTo(User, { foreignKey: 'userId', as: 'user' });


module.exports = {
  sequelize,
  Sequelize,
  User,
  Report,
  Settings,
  Customer,
  File,
  Template,
  Company,
  UserCompany,
  Invoice,
  CreditNote,
  Statement,
  EmailTemplate,
  DocumentQuery,
  PendingRegistration,
  ImportTransaction,
  ColumnConfiguration,
  EmailLog,
  SupplierTemplate: Template // Backward compatibility alias
};

