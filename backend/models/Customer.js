const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Customer = sequelize.define('Customer', {
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
    code: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
      comment: 'Unique customer code/identifier'
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isEmail: true
      }
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: true
    },
    address: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {}
    },
    parentId: {
      type: DataTypes.UUID,
      allowNull: true,
      // Foreign key handled by association in models/index.js
      comment: 'Parent customer in hierarchy (null for root customers)'
    },
    level: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Depth level in hierarchy (0 = root)'
    },
    path: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Materialized path (e.g., "/1/2/3") for efficient queries'
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
      allowNull: true
      // Foreign key handled by association in models/index.js
    }
  }, {
    tableName: 'customers',
    timestamps: true,
    indexes: [
      {
        fields: ['parentId']
      },
      {
        fields: ['code'],
        unique: true
      },
      {
        fields: ['path']
      },
      {
        fields: ['level']
      }
    ],
    hooks: {
      beforeCreate: async (customer) => {
        await updateCustomerHierarchy(customer, sequelize);
      },
      beforeUpdate: async (customer) => {
        if (customer.changed('parentId')) {
          await updateCustomerHierarchy(customer, sequelize);
        }
      },
      afterCreate: async (customer) => {
        // Update path after ID is generated
        if (!customer.path || customer.path === `/${customer.id}`) {
          await updateCustomerHierarchy(customer, sequelize);
          await customer.save();
        }
      }
    }
  });

  // Instance method to get all children (recursive)
  Customer.prototype.getChildren = async function(includeInactive = false) {
    const where = { parentId: this.id };
    if (!includeInactive) {
      where.isActive = true;
    }
    
    const children = await Customer.findAll({
      where,
      include: [{
        model: Customer,
        as: 'children',
        required: false
      }]
    });
    
    return children;
  };

  // Instance method to get all descendants (recursive)
  Customer.prototype.getDescendants = async function(includeInactive = false) {
    const descendants = [];
    
    const getChildrenRecursive = async (parentId) => {
      const where = { parentId };
      if (!includeInactive) {
        where.isActive = true;
      }
      
      const children = await Customer.findAll({ where });
      descendants.push(...children);
      
      for (const child of children) {
        await getChildrenRecursive(child.id);
      }
    };
    
    await getChildrenRecursive(this.id);
    return descendants;
  };

  // Instance method to get ancestors (path to root)
  Customer.prototype.getAncestors = async function() {
    if (!this.path) {
      return [];
    }
    
    const pathIds = this.path.split('/').filter(id => id).map(id => id.trim());
    if (pathIds.length === 0) {
      return [];
    }
    
    return await Customer.findAll({
      where: {
        id: pathIds
      },
      order: [['level', 'ASC']]
    });
  };

  // Instance method to get full path name
  Customer.prototype.getFullPathName = async function(separator = ' > ') {
    const ancestors = await this.getAncestors();
    const pathNames = ancestors.map(a => a.name);
    pathNames.push(this.name);
    return pathNames.join(separator);
  };

  return Customer;
};

// Helper function to update hierarchy metadata
async function updateCustomerHierarchy(customer, sequelize) {
  const CustomerModel = customer.constructor;
  
  if (customer.parentId) {
    const parent = await CustomerModel.findByPk(customer.parentId);
    if (parent) {
      customer.level = parent.level + 1;
      customer.path = parent.path ? `${parent.path}/${customer.id}` : `/${customer.id}`;
    } else {
      customer.level = 0;
      customer.path = `/${customer.id}`;
    }
  } else {
    customer.level = 0;
    customer.path = `/${customer.id}`;
  }
  
  // Update all descendants if parent changed
  if (customer.changed('parentId') && customer.id) {
    await updateDescendantsPath(customer, sequelize);
  }
}

async function updateDescendantsPath(customer, sequelize) {
  const CustomerModel = customer.constructor;
  const { Op } = sequelize.Sequelize;
  
  const descendants = await CustomerModel.findAll({
    where: {
      path: {
        [Op.like]: `${customer.path}/%`
      }
    }
  });
  
  for (const desc of descendants) {
    const pathParts = desc.path.split('/').filter(p => p);
    const customerIndex = pathParts.indexOf(customer.id);
    if (customerIndex !== -1) {
      desc.level = customer.level + (pathParts.length - customerIndex);
      desc.path = customer.path + '/' + pathParts.slice(customerIndex + 1).join('/');
      await desc.save();
    }
  }
}

