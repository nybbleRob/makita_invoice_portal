const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Report = sequelize.define('Report', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true
      }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    type: {
      type: DataTypes.ENUM('financial', 'operational', 'analytical', 'custom'),
      defaultValue: 'custom'
    },
    data: {
      type: DataTypes.JSONB,
      defaultValue: {}
    },
    createdById: {
      type: DataTypes.UUID,
      allowNull: false
      // Foreign key handled by association in models/index.js
    },
    customerId: {
      type: DataTypes.UUID,
      allowNull: true
      // Foreign key handled by association in models/index.js
    },
    status: {
      type: DataTypes.ENUM('draft', 'published', 'archived'),
      defaultValue: 'draft'
    },
    tags: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: []
    }
  }, {
    tableName: 'reports',
    timestamps: true
  });

  return Report;
};
