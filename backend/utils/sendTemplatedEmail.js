/**
 * Send email using an email template
 * @param {string} templateName - Name of the template (e.g., 'welcome', 'password-reset')
 * @param {string} to - Recipient email address
 * @param {Object} data - Data object with variables for template
 * @param {Object} settings - Settings object with email configuration
 * @param {Object} requestContext - Optional request context for logging (ipAddress, userAgent, requestId, userId)
 * @returns {Promise<Object>} - Result from sendEmail
 */
async function sendTemplatedEmail(templateName, to, data, settings, requestContext = {}) {
  const { EmailTemplate } = require('../models');
  const { renderEmailTemplate } = require('./emailTemplateRenderer');
  const { sendEmail } = require('./emailService');

  // Get company name and login URL from settings
  const companyName = settings?.companyName || 'eInvoice Portal';
  const loginUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

  // Merge default data
  const templateData = {
    companyName,
    loginUrl,
    ...data
  };

  try {
    // Get template info for logging
    const template = await EmailTemplate.findOne({
      where: { name: templateName, isActive: true }
    });

    // Render the template (pass settings for theming)
    const rendered = await renderEmailTemplate(templateName, templateData, EmailTemplate, settings);

    // Send the email with request context and template info
    const result = await sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      templateName,
      templateCategory: template?.category || null,
      emailType: template?.category || templateName || 'templated',
      ...requestContext
    }, settings);

    return result;
  } catch (error) {
    console.error(`Error sending templated email (${templateName}):`, error);
    throw error;
  }
}

module.exports = {
  sendTemplatedEmail
};

