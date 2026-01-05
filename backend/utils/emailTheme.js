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
    ? `<img src="${theme.logoUrl}" alt="${theme.companyName}" style="max-width: 200px; height: auto;" />`
    : `<span style="font-size: 24px; font-weight: 600; color: ${theme.primaryColor};">${theme.companyName}</span>`;

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
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <!-- Logo inside box -->
          <tr>
            <td align="center" style="padding: 40px 30px 20px;">
              ${logoHtml}
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 0 30px 40px;">
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
 * Uses VML for Outlook compatibility and table-based layout
 * @param {string} text - Button text
 * @param {string} url - Button URL
 * @param {Object} settings - Settings object (for color)
 * @returns {string} - Button HTML
 */
function emailButton(text, url, settings) {
  const theme = getEmailTheme(settings);
  const color = theme.primaryColor;
  
  // Outlook-compatible button using VML + table fallback
  // VML renders in Outlook, the <a> tag renders in all other clients
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 20px 0;">
      <tr>
        <td align="center" style="background-color: ${color};">
          <!--[if mso]>
          <v:rect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" 
            href="${url}" style="height:44px;v-text-anchor:middle;width:200px;" 
            strokecolor="${color}" fillcolor="${color}">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">
              ${text}
            </center>
          </v:rect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="${url}" style="background-color: ${color}; color: #ffffff; display: inline-block; font-family: Arial, sans-serif; font-size: 16px; font-weight: bold; line-height: 44px; text-align: center; text-decoration: none; width: 200px; -webkit-text-size-adjust: none; mso-hide: all;">
            ${text}
          </a>
          <!--<![endif]-->
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

