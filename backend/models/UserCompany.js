const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const UserCompany = sequelize.define('UserCompany', {
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
    companyId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'companies',
        key: 'id'
      },
      onDelete: 'CASCADE'
    }
  }, {
    tableName: 'user_companies',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['userId', 'companyId']
      },
      {
        fields: ['userId']
      },
      {
        fields: ['companyId']
      }
    ]
  });

  return UserCompany;
};

