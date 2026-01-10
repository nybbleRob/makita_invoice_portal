const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Supplier = sequelize.define('Supplier', {
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
      },
      comment: 'Supplier name'
    },
    code: {
      type: DataTypes.STRING(50),
      allowNull: true,
      unique: true,
      comment: 'Optional supplier code/identifier'
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isEmail: true
      }
    },
    phone: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    address: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
      comment: 'Company address (street, city, state, zip, country)'
    },
    taxId: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Tax identification number'
    },
    vatNumber: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'VAT registration number'
    },
    website: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isUrl: true
      }
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Additional flexible data'
    },
    createdById: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: 'User who created this supplier'
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date when supplier was deleted'
    }
  }, {
    tableName: 'suppliers',
    timestamps: true,
    paranoid: false, // We track deletion manually with deletedAt
    indexes: [
      {
        fields: ['name']
      },
      {
        fields: ['code'],
        unique: true
      },
      {
        fields: ['isActive']
      },
      {
        fields: ['createdAt']
      },
      {
        fields: ['deletedAt'],
        where: {
          deletedAt: null
        }
      }
    ]
  });

  // Instance methods
  Supplier.prototype.getActiveTemplates = async function() {
    const { SupplierTemplate } = require('./index');
    return await SupplierTemplate.findAll({
      where: {
        supplierId: this.id,
        enabled: true,
        deletedAt: null
      },
      order: [['priority', 'DESC'], ['isDefault', 'DESC'], ['createdAt', 'DESC']]
    });
  };

  Supplier.prototype.getTemplateByType = async function(templateType, fileType = 'pdf') {
    const { SupplierTemplate } = require('./index');
    return await SupplierTemplate.findOne({
      where: {
        supplierId: this.id,
        templateType,
        fileType,
        enabled: true,
        deletedAt: null
      },
      order: [['isDefault', 'DESC'], ['priority', 'DESC'], ['createdAt', 'DESC']]
    });
  };

  // Static methods
  Supplier.findByCode = async function(code) {
    return await Supplier.findOne({
      where: {
        code,
        deletedAt: null
      }
    });
  };

  Supplier.searchByName = async function(searchTerm, limit = 50) {
    const { Op } = require('sequelize');
    return await Supplier.findAll({
      where: {
        name: {
          [Op.iLike]: `%${searchTerm}%`
        },
        deletedAt: null
      },
      limit,
      order: [['name', 'ASC']]
    });
  };

  return Supplier;
};
