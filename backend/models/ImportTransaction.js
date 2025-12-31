const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ImportTransaction = sequelize.define('ImportTransaction', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },
    type: {
      type: DataTypes.ENUM('company_import'),
      allowNull: false,
      defaultValue: 'company_import'
    },
    createdCompanies: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
      comment: 'Array of company IDs that were created during this import'
    },
    updatedCompanies: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: [],
      comment: 'Array of {companyId, previousData} objects for companies that were updated'
    },
    importData: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
      comment: 'Snapshot of import file data for reference'
    },
    status: {
      type: DataTypes.ENUM('completed', 'undone'),
      allowNull: false,
      defaultValue: 'completed'
    }
  }, {
    tableName: 'import_transactions',
    timestamps: true,
    indexes: [
      {
        fields: ['userId']
      },
      {
        fields: ['type']
      },
      {
        fields: ['status']
      },
      {
        fields: ['createdAt']
      }
    ]
  });

  return ImportTransaction;
};

