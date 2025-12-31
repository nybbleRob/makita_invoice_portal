/**
 * Seed Password Changed Email Template
 * Creates email template for password changed notifications
 * Uses the same theming system as other emails
 */

const { EmailTemplate } = require('../models');
const { sequelize } = require('../models');

async function seedPasswordChangedEmailTemplate() {
  try {
    console.log('🌱 Seeding password changed email template...');

    const templateData = {
      name: 'password-changed',
      subject: 'Password Changed Successfully',
      htmlBody: `
        <h2>Password Changed Successfully</h2>
        <p>Dear {{userName}},</p>
        <p>Your password has been successfully changed.</p>
        <p>If you did not make this change, please contact your administrator immediately.</p>
        <p style="margin-top: 20px;">
          <a href="{{loginUrl}}" style="background-color: {{primaryColor}}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
            Login to Portal
          </a>
        </p>
        <p style="margin-top: 20px; color: #666; font-size: 14px;">
          Best regards,<br>
          {{companyName}}
        </p>
      `,
      description: 'Email sent when a user successfully changes their password',
      variables: ['userName', 'userEmail', 'companyName', 'loginUrl', 'primaryColor'],
      category: 'auth',
      isActive: true
    };

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

    console.log('✨ Password changed email template seeded successfully!');
  } catch (error) {
    console.error('❌ Error seeding password changed email template:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  sequelize.authenticate()
    .then(() => {
      console.log('📦 Database connection established');
      return seedPasswordChangedEmailTemplate();
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

module.exports = { seedPasswordChangedEmailTemplate };

