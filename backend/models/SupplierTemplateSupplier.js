/**
 * Supplier Template Model
 * Defines coordinate-based parsing templates for supplier documents (invoices, credit notes, statements)
 */

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SupplierTemplate = sequelize.define('SupplierTemplate', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    supplierId: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: 'Supplier this template belongs to'
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Template name (e.g., "Amazon Invoice Template")'
    },
    code: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Template code (auto-generated from name)'
    },
    templateType: {
      type: DataTypes.STRING(50),
      allowNull: false,
      validate: {
        isIn: [['invoice', 'credit_note', 'statement']]
      },
      comment: 'Type of template: invoice, credit_note, or statement'
    },
    fileType: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'pdf',
      validate: {
        isIn: [['pdf', 'excel']]
      },
      comment: 'File type this template is for: pdf or excel'
    },
    isDefault: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Is this the default template for this supplier/type/fileType combination'
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'Is this template enabled'
    },
    priority: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      comment: 'Template priority (higher = preferred)'
    },
    coordinates: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Coordinate-based field extraction (x, y, width, height, page)'
    },
    patterns: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Regex patterns for field extraction (optional fallback)'
    },
    markers: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Text markers/anchors for relative extraction'
    },
    transformations: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Data transformations to apply to extracted values'
    },
    customFields: {
      type: DataTypes.JSONB,
      defaultValue: [],
      comment: 'Custom fields that assign to supplier and template'
    },
    mandatoryFields: {
      type: DataTypes.JSONB,
      defaultValue: [],
      comment: 'Which fields are mandatory for this template (e.g., ["documentType", "invoiceNumber", "poNumber"])'
    },
    sampleFileUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Path to sample PDF/Excel used to create template'
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {},
      comment: 'Additional flexible data'
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Date when template was deleted'
    }
  }, {
    tableName: 'supplier_templates',
    underscored: true,
    timestamps: true,
    paranoid: false,
    indexes: [
      {
        fields: ['supplierId']
      },
      {
        fields: ['templateType']
      },
      {
        fields: ['fileType']
      },
      {
        fields: ['enabled']
      },
      {
        fields: ['isDefault']
      },
      {
        fields: ['supplierId', 'templateType', 'fileType']
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
  SupplierTemplate.prototype.setAsDefault = async function() {
    const { Op } = require('sequelize');
    
    // Unset other defaults of the same supplier/type/fileType combination
    await SupplierTemplate.update(
      { isDefault: false },
      {
        where: {
          supplierId: this.supplierId,
          templateType: this.templateType,
          fileType: this.fileType,
          id: { [Op.ne]: this.id },
          deletedAt: null
        }
      }
    );
    
    // Set this as default
    this.isDefault = true;
    await this.save();
  };

  SupplierTemplate.prototype.validateMandatoryFields = function(coordinates) {
    if (!this.mandatoryFields || this.mandatoryFields.length === 0) {
      return { valid: true, missing: [] };
    }

    const missingFields = [];
    const coordKeys = Object.keys(coordinates || {});
    
    for (const fieldName of this.mandatoryFields) {
      // Check if field exists in coordinates (try camelCase and snake_case)
      const camelCase = fieldName.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      const snakeCase = fieldName.replace(/([A-Z])/g, '_$1').toLowerCase();
      
      const hasField = coordKeys.some(key => 
        key === fieldName || 
        key === camelCase || 
        key === snakeCase ||
        key.toLowerCase() === fieldName.toLowerCase() ||
        key.toLowerCase() === camelCase.toLowerCase() ||
        key.toLowerCase() === snakeCase.toLowerCase()
      );

      if (!hasField) {
        missingFields.push(fieldName);
      }
    }

    return {
      valid: missingFields.length === 0,
      missing: missingFields
    };
  };

  // Static methods
  SupplierTemplate.findBySupplierAndType = async function(supplierId, templateType, fileType = 'pdf') {
    return await this.findOne({
      where: {
        supplierId,
        templateType,
        fileType,
        enabled: true,
        deletedAt: null
      },
      order: [['isDefault', 'DESC'], ['priority', 'DESC'], ['createdAt', 'DESC']]
    });
  };

  SupplierTemplate.findDefaultForSupplier = async function(supplierId, templateType, fileType = 'pdf') {
    // First try to find a template marked as default
    let template = await this.findOne({
      where: {
        supplierId,
        templateType,
        fileType,
        isDefault: true,
        enabled: true,
        deletedAt: null
      },
      order: [['priority', 'DESC'], ['createdAt', 'DESC']]
    });
    
    if (template) {
      return template;
    }
    
    // If no default found, get the first enabled template (ordered by priority)
    return await this.findOne({
      where: {
        supplierId,
        templateType,
        fileType,
        enabled: true,
        deletedAt: null
      },
      order: [['priority', 'DESC'], ['createdAt', 'DESC']]
    });
  };

  return SupplierTemplate;
};
