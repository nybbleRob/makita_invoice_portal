/**
 * Send email using an HTML template file
 * Templates are loaded from backend/templates/emails/*.html
 * 
 * @param {string} templateName - Name of the template (e.g., 'welcome', 'password-reset')
 * @param {string} to - Recipient email address
 * @param {Object} data - Data object with variables for template
 * @param {Object} settings - Settings object with email configuration
 * @param {Object} requestContext - Optional request context for logging (ipAddress, userAgent, requestId, userId)
 * @returns {Promise<Object>} - Result from sendEmail
 */
const fs = require('fs');
const path = require('path');
const { sendEmail } = require('./emailService');

// Template cache to avoid re-reading files in production
const templateCache = {};

/**
 * Get the templates directory path
 */
function getTemplatesDir() {
  return path.join(__dirname, '../templates/emails');
}

/**
 * Load a template file (with caching in production)
 */
function loadTemplate(templateName) {
  const cacheKey = templateName;
  
  if (templateCache[cacheKey] && process.env.NODE_ENV === 'production') {
    return templateCache[cacheKey];
  }
  
  const templatePath = path.join(getTemplatesDir(), `${templateName}.html`);
  
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Email template not found: ${templateName}.html`);
  }
  
  const template = fs.readFileSync(templatePath, 'utf8');
  templateCache[cacheKey] = template;
  
  return template;
}

/**
 * Extract subject from HTML title tag
 */
function extractSubject(html, data) {
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (titleMatch) {
    let subject = titleMatch[1];
    // Replace variables in subject
    subject = replaceVariables(subject, data);
    return subject;
  }
  return 'Notification';
}

/**
 * Replace all occurrences of {{variable}} with values
 */
function replaceVariables(template, variables) {
  let result = template;
  
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    result = result.replace(regex, value ?? '');
  }
  
  return result;
}

/**
 * Process conditional sections in template
 * Supports: {{#if variable}}content{{/if}} and {{#unless variable}}content{{/unless}}
 */
function processConditionals(template, variables) {
  let result = template;
  
  // Match {{#if variable}}...{{/if}} - non-greedy
  const ifRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
  
  result = result.replace(ifRegex, (match, variable, content) => {
    const value = variables[variable];
    // Show content if value is truthy
    if (value && value !== 'false' && value !== '0') {
      return content;
    }
    return '';
  });
  
  // Handle {{#unless variable}}...{{/unless}}
  const unlessRegex = /\{\{#unless\s+(\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g;
  
  result = result.replace(unlessRegex, (match, variable, content) => {
    const value = variables[variable];
    // Show content if value is falsy
    if (!value || value === 'false' || value === '0') {
      return content;
    }
    return '';
  });
  
  // Handle {{#each items}}...{{/each}} for arrays
  const eachRegex = /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
  
  result = result.replace(eachRegex, (match, arrayName, itemTemplate) => {
    const items = variables[arrayName];
    if (!Array.isArray(items) || items.length === 0) {
      return '';
    }
    
    return items.map(item => {
      let itemHtml = itemTemplate;
      // Replace {{this.property}} with item.property
      itemHtml = itemHtml.replace(/\{\{this\.(\w+)\}\}/g, (m, prop) => {
        return item[prop] !== undefined ? String(item[prop]) : '';
      });
      return itemHtml;
    }).join('');
  });
  
  return result;
}

/**
 * Generate a darker shade for button hover
 */
function darkenColor(hex, percent = 10) {
  hex = hex.replace('#', '');
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);
  r = Math.max(0, Math.floor(r * (100 - percent) / 100));
  g = Math.max(0, Math.floor(g * (100 - percent) / 100));
  b = Math.max(0, Math.floor(b * (100 - percent) / 100));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

const { getFrontendUrl, getBackendUrl, getLoginUrl } = require('./urlConfig');

/**
 * Get branding variables from settings
 */
function getBrandingVariables(settings) {
  const primaryColor = settings?.primaryColor || '#066FD1';
  const primaryColorHover = darkenColor(primaryColor);
  const companyName = settings?.companyName || 'Makita Invoice Portal';
  const supportEmail = settings?.supportEmail || 'support@example.com';
  const portalUrl = getFrontendUrl();
  const loginUrl = getLoginUrl();
  
  // Build logo URL
  let logoUrl = '';
  if (settings?.logoLight) {
    if (settings.logoLight.startsWith('http')) {
      logoUrl = settings.logoLight;
    } else {
      const backendUrl = getBackendUrl();
      logoUrl = `${backendUrl}/api/uploads/${settings.logoLight}`;
    }
  }
  
  return {
    primaryColor,
    primaryColorHover,
    companyName,
    supportEmail,
    portalUrl,
    loginUrl,
    logoUrl,
    currentYear: new Date().getFullYear().toString()
  };
}

/**
 * Strip HTML tags for plain text version
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Render email template from HTML file
 */
function renderEmailTemplate(templateName, data, settings) {
  // Load template
  const template = loadTemplate(templateName);
  
  // Get branding variables
  const brandingVars = getBrandingVariables(settings);
  
  // Merge all variables (user data overrides branding)
  const allVariables = {
    ...brandingVars,
    ...data
  };
  
  // Extract subject from title tag before processing
  const subject = extractSubject(template, allVariables);
  
  // Replace variables
  let html = replaceVariables(template, allVariables);
  
  // Process conditionals
  html = processConditionals(html, allVariables);
  
  // Generate plain text version
  const text = stripHtml(html);
  
  return { subject, html, text };
}

/**
 * Send email using template
 */
async function sendTemplatedEmail(templateName, to, data, settings, requestContext = {}) {
  try {
    // Render the template
    const rendered = renderEmailTemplate(templateName, data, settings);
    
    // Determine email category based on template name
    let category = 'system';
    if (['password-reset', 'password-changed', 'welcome', 'registration-request', 'registration-approved', 'registration-rejected'].includes(templateName)) {
      category = 'auth';
    } else if (['document-notification', 'document-summary', 'document-deleted', 'query-notification'].includes(templateName)) {
      category = 'document';
    } else if (['import-summary', 'retention-cleanup-summary'].includes(templateName)) {
      category = 'notification';
    }
    
    // Send the email with request context
    const result = await sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      templateName,
      templateCategory: category,
      emailType: category,
      ...requestContext
    }, settings);
    
    return result;
  } catch (error) {
    console.error(`Error sending templated email (${templateName}):`, error);
    throw error;
  }
}

module.exports = {
  sendTemplatedEmail,
  renderEmailTemplate,
  loadTemplate,
  getBrandingVariables
};
