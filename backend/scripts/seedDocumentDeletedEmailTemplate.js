/**
 * Seed script for document-deleted email template
 * Creates the email template used when documents are deleted due to retention policy
 */

const { sequelize } = require('../config/database');
const { EmailTemplate } = require('../models');

async function seedDocumentDeletedTemplate() {
  try {
    console.log('📧 Seeding document-deleted email template...');
    
    const [template, created] = await EmailTemplate.findOrCreate({
      where: { name: 'document-deleted' },
      defaults: {
        name: 'document-deleted',
        subject: 'Document Deleted - {{documentType}} {{documentNumber}}',
        htmlBody: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Document Deleted</h2>
            <p>Dear {{userName}},</p>
            <p>This is to inform you that the following document has been automatically deleted from the system due to our document retention policy:</p>
            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p style="margin: 5px 0;"><strong>Document Type:</strong> {{documentType}}</p>
              <p style="margin: 5px 0;"><strong>Document Number:</strong> {{documentNumber}}</p>
              <p style="margin: 5px 0;"><strong>Deletion Date:</strong> {{deletionDate}}</p>
              <p style="margin: 5px 0;"><strong>Retention Period:</strong> {{retentionPeriod}} days</p>
            </div>
            <p>As per our document retention policy, documents are automatically removed from the portal after {{retentionPeriod}} days to prevent the system from becoming a document storage repository.</p>
            <p><strong>If you need an archived copy of this document, please contact Credit Control directly via email.</strong></p>
            <p>Thank you for your understanding.</p>
            <p>Best regards,<br>{{companyName}}</p>
          </div>
        `,
        textBody: `
Document Deleted

Dear {{userName}},

This is to inform you that the following document has been automatically deleted from the system due to our document retention policy:

Document Type: {{documentType}}
Document Number: {{documentNumber}}
Deletion Date: {{deletionDate}}
Retention Period: {{retentionPeriod}} days

As per our document retention policy, documents are automatically removed from the portal after {{retentionPeriod}} days to prevent the system from becoming a document storage repository.

If you need an archived copy of this document, please contact Credit Control directly via email.

Thank you for your understanding.

Best regards,
{{companyName}}
        `,
        description: 'Email sent to users when a document (Invoice, Credit Note, or Statement) is automatically deleted due to retention policy',
        variables: ['userName', 'documentType', 'documentNumber', 'deletionDate', 'retentionPeriod', 'companyName'],
        category: 'document',
        isActive: true
      }
    });
    
    if (created) {
      console.log('✅ Created document-deleted email template');
    } else {
      console.log('ℹ️  document-deleted email template already exists');
    }
    
    return template;
  } catch (error) {
    console.error('❌ Error seeding document-deleted email template:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  seedDocumentDeletedTemplate()
    .then(() => {
      console.log('✅ Seeding completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Seeding failed:', error);
      process.exit(1);
    });
}

module.exports = { seedDocumentDeletedTemplate };

