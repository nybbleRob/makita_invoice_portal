/**
 * Tabler Email Template Renderer
 * 
 * Renders Tabler email templates with dynamic variable substitution
 * Uses the portal's branding settings (primaryColor, logo, companyName)
 */

const fs = require('fs');
const path = require('path');

// Template cache to avoid re-reading files
const templateCache = {};

/**
 * Get the templates directory path
 */
function getTemplatesDir() {
  return path.join(__dirname, '../templates/emails');
}

/**
 * Load a template file (with caching)
 */
function loadTemplate(templateName) {
  const cacheKey = templateName;
  
  if (templateCache[cacheKey] && process.env.NODE_ENV === 'production') {
    return templateCache[cacheKey];
  }
  
  const templatePath = path.join(getTemplatesDir(), `${templateName}.html`);
  
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Email template not found: ${templateName}`);
  }
  
  const template = fs.readFileSync(templatePath, 'utf8');
  templateCache[cacheKey] = template;
  
  return template;
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
 * Generate a darker shade for button hover
 */
function darkenColor(hex, percent = 10) {
  // Remove # if present
  hex = hex.replace('#', '');
  
  // Parse RGB
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);
  
  // Darken
  r = Math.max(0, Math.floor(r * (100 - percent) / 100));
  g = Math.max(0, Math.floor(g * (100 - percent) / 100));
  b = Math.max(0, Math.floor(b * (100 - percent) / 100));
  
  // Convert back to hex
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

const { getFrontendUrl, getBackendUrl } = require('./urlConfig');

/**
 * Get branding variables from settings
 */
function getBrandingVariables(settings) {
  const primaryColor = settings?.primaryColor || '#066FD1';
  const primaryColorHover = darkenColor(primaryColor);
  const companyName = settings?.companyName || 'Invoice Portal';
  const supportEmail = settings?.supportEmail || 'support@example.com';
  const portalUrl = getFrontendUrl();
  
  // Build logo URL
  // Logos are stored as paths like "/uploads/logo-xxx.png" and served directly at /uploads/
  let logoUrl = '';
  if (settings?.logoLight) {
    // Check if it's already a full URL
    if (settings.logoLight.startsWith('http')) {
      logoUrl = settings.logoLight;
    } else {
      // Construct URL from backend
      // Logo path already includes /uploads/, so just append to backend URL
      const backendUrl = getBackendUrl();
      logoUrl = `${backendUrl}${settings.logoLight.startsWith('/') ? '' : '/'}${settings.logoLight}`;
    }
  }
  
  return {
    primaryColor,
    primaryColorHover,
    companyName,
    supportEmail,
    portalUrl,
    logoUrl,
    currentYear: new Date().getFullYear().toString()
  };
}

/**
 * Render an email template with variables
 * 
 * @param {string} templateName - Name of the template (without .html)
 * @param {object} variables - Variables to substitute
 * @param {object} settings - Portal settings (for branding)
 * @returns {string} Rendered HTML
 */
function renderTemplate(templateName, variables = {}, settings = {}) {
  const template = loadTemplate(templateName);
  
  // Get branding variables
  const brandingVars = getBrandingVariables(settings);
  
  // Merge all variables (user variables override branding)
  const allVariables = {
    ...brandingVars,
    ...variables
  };
  
  // Replace variables
  let html = replaceVariables(template, allVariables);
  
  // Handle conditional sections: {{#if variable}}content{{/if}}
  html = processConditionals(html, allVariables);
  
  return html;
}

/**
 * Process conditional sections in template
 * Supports: {{#if variable}}content{{/if}}
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
  
  return result;
}

/**
 * Format a date for display in emails
 */
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

/**
 * Format currency for display
 */
function formatCurrency(amount, currency = 'GBP') {
  if (amount === null || amount === undefined) return '';
  const num = parseFloat(amount);
  if (isNaN(num)) return '';
  
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency
  }).format(num);
}

/**
 * Escape HTML entities
 */
function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

/**
 * Generate a VML-compatible button (works in Outlook)
 */
function generateButton(text, url, settings, options = {}) {
  const primaryColor = settings?.primaryColor || '#066FD1';
  const width = options.width || 200;
  const fullWidth = options.fullWidth || false;
  
  const widthStyle = fullWidth ? 'width: 100%;' : `width: ${width}px;`;
  
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
      <tr>
        <td style="background-color: ${primaryColor};" align="center">
          <!--[if mso]>
          <v:rect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
            href="${url}" style="height:44px;v-text-anchor:middle;${widthStyle}"
            strokecolor="${primaryColor}" fillcolor="${primaryColor}">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:500;">
              ${escapeHtml(text)}
            </center>
          </v:rect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="${url}" style="background-color: ${primaryColor}; color: #ffffff;
            display: inline-block; font-family: Inter, Arial, sans-serif; font-size: 14px; font-weight: 500;
            line-height: 44px; text-align: center; text-decoration: none; ${widthStyle}
            -webkit-text-size-adjust: none; mso-hide: all;">
            ${escapeHtml(text)}
          </a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>
  `;
}

module.exports = {
  renderTemplate,
  loadTemplate,
  getBrandingVariables,
  formatDate,
  formatCurrency,
  escapeHtml,
  generateButton,
  darkenColor
};

