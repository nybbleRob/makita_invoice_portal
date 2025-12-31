/**
 * Seed email templates for user registration system
 */

const { EmailTemplate } = require('../models');
const { sequelize } = require('../models');

async function seedRegistrationEmailTemplates() {
  try {
    console.log('🌱 Seeding registration email templates...');

    const templates = [
      {
        name: 'registration-request',
        subject: 'New User Registration Request - {{applicantName}}',
        htmlBody: `
          <h2 style="color: {{primaryColor}}; margin-top: 0;">New User Registration Request</h2>
          <p>Hello {{userName}},</p>
          <p>A new user registration request has been submitted and requires your review.</p>
          
          <div style="background-color: #f9f9f9; padding: 20px; margin: 20px 0; border-radius: 4px; border-left: 4px solid {{primaryColor}};">
            <h3 style="margin-top: 0; color: #333;">Registration Details</h3>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width: 100%;">
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;"><strong>Name:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0; text-align: right;">{{applicantName}}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;"><strong>Email:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0; text-align: right;">{{applicantEmail}}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0;"><strong>Company Name:</strong></td>
                <td style="padding: 8px 0; border-bottom: 1px solid #e0e0e0; text-align: right;">{{companyName}}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0;"><strong>Account Number:</strong></td>
                <td style="padding: 8px 0; text-align: right;">{{accountNumber}}</td>
              </tr>
            </table>
          </div>
          
          <p style="margin-top: 20px;">
            <a href="{{reviewUrl}}" style="background-color: {{primaryColor}}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
              Review Registration Request
            </a>
          </p>
          
          <p style="margin-top: 20px; color: #666; font-size: 12px;">
            Registration ID: {{registrationId}}
          </p>
          
          <p>Best regards,<br>{{companyName}}</p>
        `,
        description: 'Email sent to administrators when a new user registration request is submitted.',
        variables: ['userName', 'applicantName', 'applicantEmail', 'companyName', 'accountNumber', 'reviewUrl', 'registrationId', 'primaryColor'],
        category: 'auth',
        isActive: true
      },
      {
        name: 'registration-approved',
        subject: 'Your Account Has Been Approved - {{companyName}}',
        htmlBody: `
          <h2 style="color: {{primaryColor}}; margin-top: 0;">Account Approved</h2>
          <p>Hello {{userName}},</p>
          <p>Great news! Your registration request has been approved and your account has been created.</p>
          
          <div style="background-color: #f9f9f9; padding: 20px; margin: 20px 0; border-radius: 4px; border-left: 4px solid {{primaryColor}};">
            <h3 style="margin-top: 0; color: #333;">Your Login Credentials</h3>
            <p><strong>Email:</strong> {{userEmail}}</p>
            <p><strong>Temporary Password:</strong> <code style="background-color: #fff; padding: 4px 8px; border-radius: 3px; font-family: monospace;">{{temporaryPassword}}</code></p>
            <p style="color: #d32f2f; font-weight: bold;">⚠️ Please change your password after your first login.</p>
          </div>
          
          <p style="margin-top: 20px;">
            <a href="{{loginUrl}}" style="background-color: {{primaryColor}}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
              Login to Your Account
            </a>
          </p>
          
          <p>Best regards,<br>{{companyName}}</p>
        `,
        description: 'Email sent to user when their registration request is approved.',
        variables: ['userName', 'userEmail', 'temporaryPassword', 'loginUrl', 'companyName', 'primaryColor'],
        category: 'auth',
        isActive: true
      },
      {
        name: 'registration-rejected',
        subject: 'Registration Request Update - {{companyName}}',
        htmlBody: `
          <h2 style="color: {{primaryColor}}; margin-top: 0;">Registration Request Update</h2>
          <p>Hello {{userName}},</p>
          <p>We regret to inform you that your registration request has been declined.</p>
          
          <div style="background-color: #fff3cd; padding: 20px; margin: 20px 0; border-radius: 4px; border-left: 4px solid #ffc107;">
            <h3 style="margin-top: 0; color: #856404;">Reason</h3>
            <p style="color: #856404;">{{rejectionReason}}</p>
          </div>
          
          <p>If you have any questions or would like to discuss this decision, please contact our support team.</p>
          
          <p>Best regards,<br>{{companyName}}</p>
        `,
        description: 'Email sent to user when their registration request is rejected.',
        variables: ['userName', 'rejectionReason', 'companyName', 'primaryColor'],
        category: 'auth',
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

    console.log('✨ Registration email templates seeded successfully!');
  } catch (error) {
    console.error('❌ Error seeding registration email templates:', error);
    throw error;
  }
}

if (require.main === module) {
  sequelize.authenticate()
    .then(() => {
      console.log('📦 Database connection established');
      return seedRegistrationEmailTemplates();
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

module.exports = { seedRegistrationEmailTemplates };

