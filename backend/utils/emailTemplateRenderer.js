/**
 * Email Template Renderer
 * Renders email templates with variable substitution
 */

/**
 * Simple template renderer that replaces {{variable}} with values
 * Also supports Handlebars-like conditionals: {{#if variable}}...{{/if}}
 * @param {string} template - Template string with {{variables}}
 * @param {Object} data - Data object with variable values
 * @returns {string} - Rendered template
 */
function renderTemplate(template, data = {}) {
  if (!template) return '';

  let rendered = template;

  // Replace simple variables: {{variableName}}
  rendered = rendered.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    return data[varName] !== undefined && data[varName] !== null ? String(data[varName]) : '';
  });

  // Handle conditionals: {{#if variable}}...{{/if}}
  rendered = rendered.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, varName, content) => {
    const value = data[varName];
    // Check if value is truthy (not null, undefined, false, empty string, or 0)
    if (value && value !== 'false' && value !== '0' && value !== '') {
      return renderTemplate(content, data); // Recursively render content
    }
    return '';
  });

  return rendered;
}

/**
 * Strip HTML tags from text (for plain text version)
 * @param {string} html - HTML string
 * @returns {string} - Plain text
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove style tags
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove script tags
    .replace(/<[^>]+>/g, '') // Remove all HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ') // Collapse whitespace
    .trim();
}

/**
 * Render email template by name
 * @param {string} templateName - Name of the template (e.g., 'welcome', 'password-reset')
 * @param {Object} data - Data object with variable values
 * @param {Object} templateModel - Sequelize EmailTemplate model instance
 * @param {Object} settings - Settings object (optional, for theming)
 * @returns {Promise<Object>} - Object with subject, html, and text
 */
async function renderEmailTemplate(templateName, data, templateModel, settings = null) {
  const template = await templateModel.findOne({
    where: { name: templateName, isActive: true }
  });

  if (!template) {
    throw new Error(`Email template '${templateName}' not found or is inactive`);
  }

  // Get settings if not provided
  if (!settings) {
    const { Settings } = require('../models');
    settings = await Settings.getSettings();
  }

  // Merge default data
  const templateData = {
    companyName: settings?.companyName || data.companyName || 'Makita Invoice Portal',
    loginUrl: data.loginUrl || process.env.FRONTEND_URL || 'http://localhost:3000',
    primaryColor: settings?.primaryColor || '#066fd1', // Add primary color for buttons
    ...data
  };

  // Render subject
  const subject = renderTemplate(template.subject, templateData);

  // Render HTML body
  let htmlBody = renderTemplate(template.htmlBody, templateData);

  // Wrap in themed template if settings provided
  if (settings) {
    const { wrapEmailContent } = require('./emailTheme');
    htmlBody = wrapEmailContent(htmlBody, settings);
  }

  // Render text body (use provided textBody or auto-generate from HTML)
  // Strip theme wrapper from HTML before generating text
  let textBody = template.textBody
    ? renderTemplate(template.textBody, templateData)
    : stripHtml(htmlBody);

  return {
    subject,
    html: htmlBody,
    text: textBody
  };
}

module.exports = {
  renderTemplate,
  renderEmailTemplate,
  stripHtml
};

