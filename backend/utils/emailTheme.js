/**
 * Email Theme Utility
 * Provides themed email wrapper with logo and company colors
 */

/**
 * Get email theme configuration from settings
 * @param {Object} settings - Settings object
 * @returns {Object} - Theme configuration
 */
function getEmailTheme(settings) {
  const companyName = settings?.companyName || settings?.portalName || settings?.siteTitle || 'Makita Invoice Portal';
  const primaryColor = settings?.primaryColor || '#066fd1';
  const logoLight = settings?.logoLight;
  const logoDark = settings?.logoDark;
  
  // For emails, we need absolute URLs that work from email clients
  // The backend serves uploaded files, so use the backend URL
  const backendUrl = process.env.BACKEND_URL || process.env.API_URL || 'https://edi.makitauk.com';
  const frontendUrl = process.env.FRONTEND_URL || 'https://edi.makitauk.com';
  
  // Determine logo URL (prefer light logo, fallback to dark)
  // Logos are stored as paths like "/uploads/logo-xxx.png" and served directly at /uploads/
  let logoUrl = null;
  if (logoLight) {
    if (logoLight.startsWith('http')) {
      logoUrl = logoLight;
    } else {
      // Relative paths - uploads are served at /uploads/ not /api/uploads/
      logoUrl = `${backendUrl}${logoLight.startsWith('/') ? '' : '/'}${logoLight}`;
    }
  } else if (logoDark) {
    if (logoDark.startsWith('http')) {
      logoUrl = logoDark;
    } else {
      logoUrl = `${backendUrl}${logoDark.startsWith('/') ? '' : '/'}${logoDark}`;
    }
  }
  
  console.log(`[EmailTheme] Logo URL resolved: ${logoUrl} (from logoLight=${logoLight}, logoDark=${logoDark})`);

  return {
    companyName,
    primaryColor,
    logoUrl,
    frontendUrl
  };
}

/**
 * Wrap email content in themed HTML template
 * @param {string} content - Main email content (HTML)
 * @param {Object} settings - Settings object
 * @returns {string} - Themed HTML email
 */
function wrapEmailContent(content, settings) {
  const theme = getEmailTheme(settings);
  
  // Logo HTML (if available) - minimal, just the logo
  const logoHtml = theme.logoUrl 
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr>
          <td align="center" style="padding-bottom: 30px;">
            <img src="${theme.logoUrl}" alt="${theme.companyName}" style="max-width: 200px; height: auto;" />
          </td>
        </tr>
      </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${theme.companyName}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, sans-serif !important;}
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5; line-height: 1.6;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 4px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              ${logoHtml}
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 30px; text-align: center; border-top: 1px solid #e0e0e0;">
              <p style="margin: 0; color: #999999; font-size: 12px;">
                © ${new Date().getFullYear()} ${theme.companyName}. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Generate styled button HTML for emails
 * @param {string} text - Button text
 * @param {string} url - Button URL
 * @param {Object} settings - Settings object (for color)
 * @returns {string} - Button HTML
 */
function emailButton(text, url, settings) {
  const theme = getEmailTheme(settings);
  const buttonColor = theme.primaryColor;
  
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 20px 0;">
      <tr>
        <td align="center">
          <a href="${url}" style="background-color: ${buttonColor}; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: 600; font-size: 16px;">${text}</a>
        </td>
      </tr>
    </table>
  `;
}

module.exports = {
  getEmailTheme,
  wrapEmailContent,
  emailButton
};

