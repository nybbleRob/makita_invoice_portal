/**
 * Seed Document Notification Email Templates
 * Creates email templates for document notifications (invoices, credit notes, statements)
 * These templates use the same theming system as other emails
 */

const { EmailTemplate } = require('../models');
const { sequelize } = require('../models');

async function seedDocumentEmailTemplates() {
  try {
    console.log('🌱 Seeding document notification email templates...');

    const templates = [
      {
        name: 'invoice-notification',
        subject: 'New {{documentTypeLabel}} Available - {{companyName}}',
        htmlBody: `
          <h2>New {{documentTypeLabel}} Available</h2>
          <p>Dear {{userName}},</p>
          <p>{{totalCount}} new document{{plural}} {{haveHas}} been processed for <strong>{{companyName}}</strong> (Account: {{companyReference}}).</p>
          
          {{#if hasInvoices}}
          <h3>Invoices ({{invoiceCount}})</h3>
          <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Invoice Number</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Date</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              {{invoiceTableRows}}
            </tbody>
          </table>
          {{/if}}
          
          {{#if hasCreditNotes}}
          <h3>Credit Notes ({{creditNoteCount}})</h3>
          <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Credit Note Number</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Date</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              {{creditNoteTableRows}}
            </tbody>
          </table>
          {{/if}}
          
          <p style="margin-top: 20px;">
            <a href="{{viewLink}}" style="background-color: {{primaryColor}}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
              View Documents
            </a>
          </p>
        `,
        description: 'Individual invoice/credit note notification email (sent per company)',
        variables: ['userName', 'userEmail', 'companyName', 'companyReference', 'documentTypeLabel', 'totalCount', 'plural', 'haveHas', 'hasInvoices', 'invoiceCount', 'invoiceTableRows', 'hasCreditNotes', 'creditNoteCount', 'creditNoteTableRows', 'viewLink', 'primaryColor'],
        category: 'document',
        isActive: true
      },
      {
        name: 'invoice-summary',
        subject: 'Document Import Summary - {{totalCount}} new document{{plural}} available',
        htmlBody: `
          <h2>Document Import Summary</h2>
          <p>Dear {{userName}},</p>
          <p>{{totalCount}} new document{{plural}} {{haveHas}} been processed across {{companyCount}} compan{{companyPlural}}.</p>
          
          {{#if hasInvoices}}
          <h3>Invoices ({{invoiceCount}})</h3>
          <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Company</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Invoice Number</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Date</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              {{invoiceTableRows}}
            </tbody>
          </table>
          {{/if}}
          
          {{#if hasCreditNotes}}
          <h3>Credit Notes ({{creditNoteCount}})</h3>
          <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Company</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Credit Note Number</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Date</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              {{creditNoteTableRows}}
            </tbody>
          </table>
          {{/if}}
          
          <p style="margin-top: 20px;">
            <a href="{{viewLink}}" style="background-color: {{primaryColor}}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
              View All Documents
            </a>
          </p>
        `,
        description: 'Summary email for invoices/credit notes (one email per import session)',
        variables: ['userName', 'userEmail', 'totalCount', 'plural', 'haveHas', 'companyCount', 'companyPlural', 'hasInvoices', 'invoiceCount', 'invoiceTableRows', 'hasCreditNotes', 'creditNoteCount', 'creditNoteTableRows', 'viewLink', 'primaryColor'],
        category: 'document',
        isActive: true
      },
      {
        name: 'statement-notification',
        subject: 'New Statement{{plural}} Available - {{companyName}}',
        htmlBody: `
          <h2>New Statement{{plural}} Available</h2>
          <p>Dear {{userName}},</p>
          <p>{{statementCount}} new statement{{plural}} {{haveHas}} been processed for <strong>{{companyName}}</strong> (Account: {{companyReference}}).</p>
          <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Statement Number</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Period</th>
              </tr>
            </thead>
            <tbody>
              {{statementTableRows}}
            </tbody>
          </table>
          <p style="margin-top: 20px;">
            <a href="{{viewLink}}" style="background-color: {{primaryColor}}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
              View Statements
            </a>
          </p>
        `,
        description: 'Individual statement notification email (sent per company)',
        variables: ['userName', 'userEmail', 'companyName', 'companyReference', 'statementCount', 'plural', 'haveHas', 'statementTableRows', 'viewLink', 'primaryColor'],
        category: 'document',
        isActive: true
      },
      {
        name: 'statement-summary',
        subject: 'Statement Import Summary - {{statementCount}} new statement{{plural}} available',
        htmlBody: `
          <h2>Statement Import Summary</h2>
          <p>Dear {{userName}},</p>
          <p>{{statementCount}} new statement{{plural}} {{haveHas}} been processed across {{companyCount}} compan{{companyPlural}}.</p>
          <table style="border-collapse: collapse; width: 100%; margin: 10px 0;">
            <thead>
              <tr style="background-color: #f5f5f5;">
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Company</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Statement Number</th>
                <th style="padding: 8px; border: 1px solid #ddd; text-align: left;">Period</th>
              </tr>
            </thead>
            <tbody>
              {{statementTableRows}}
            </tbody>
          </table>
          <p style="margin-top: 20px;">
            <a href="{{viewLink}}" style="background-color: {{primaryColor}}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
              View All Statements
            </a>
          </p>
        `,
        description: 'Summary email for statements (one email per import session)',
        variables: ['userName', 'userEmail', 'statementCount', 'plural', 'haveHas', 'companyCount', 'companyPlural', 'statementTableRows', 'viewLink', 'primaryColor'],
        category: 'document',
        isActive: true
      }
    ];

    for (const templateData of templates) {
      const [template, created] = await EmailTemplate.findOrCreate({
        where: { name: templateData.name },
        defaults: templateData
      });

      if (created) {
        console.log(`✅ Created template: ${templateData.name}`);
      } else {
        // Update existing template
        await template.update(templateData);
        console.log(`🔄 Updated template: ${templateData.name}`);
      }
    }

    console.log('✨ Document notification email templates seeded successfully!');
  } catch (error) {
    console.error('❌ Error seeding document email templates:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  sequelize.authenticate()
    .then(() => {
      console.log('📦 Database connection established');
      return seedDocumentEmailTemplates();
    })
    .then(() => {
      console.log('✅ Seeding complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Seeding failed:', error);
      process.exit(1);
    });
}

module.exports = { seedDocumentEmailTemplates };

