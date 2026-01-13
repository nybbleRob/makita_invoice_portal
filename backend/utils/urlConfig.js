/**
 * URL Configuration Utility
 * Centralized configuration for all URLs used throughout the application.
 * All URLs come from environment variables - no hardcoded fallbacks.
 * 
 * Required Environment Variables:
 * - FRONTEND_URL: Frontend/portal URL (e.g., https://edi.makitauk.com)
 * - BACKEND_URL: Backend API URL (e.g., https://edi.makitauk.com)
 *   OR API_URL: Alternative name for BACKEND_URL (for backward compatibility)
 */

/**
 * Get the frontend/portal URL from environment variables
 * @returns {string} Frontend URL
 * @throws {Error} If FRONTEND_URL is not set
 */
function getFrontendUrl() {
  const url = process.env.FRONTEND_URL;
  
  if (!url) {
    throw new Error(
      'FRONTEND_URL environment variable is required. ' +
      'Please set it in your .env file or environment configuration. ' +
      'Example: FRONTEND_URL=https://edi.makitauk.com'
    );
  }
  
  // Validate URL format
  try {
    new URL(url);
  } catch (error) {
    throw new Error(
      `FRONTEND_URL is not a valid URL: "${url}". ` +
      'Please provide a valid URL (e.g., https://edi.makitauk.com)'
    );
  }
  
  return url;
}

/**
 * Get the backend API URL from environment variables
 * @returns {string} Backend URL
 * @throws {Error} If BACKEND_URL or API_URL is not set
 */
function getBackendUrl() {
  const url = process.env.BACKEND_URL || process.env.API_URL;
  
  if (!url) {
    throw new Error(
      'BACKEND_URL or API_URL environment variable is required. ' +
      'Please set it in your .env file or environment configuration. ' +
      'Example: BACKEND_URL=https://edi.makitauk.com'
    );
  }
  
  // Validate URL format
  try {
    new URL(url);
  } catch (error) {
    throw new Error(
      `BACKEND_URL/API_URL is not a valid URL: "${url}". ` +
      'Please provide a valid URL (e.g., https://edi.makitauk.com)'
    );
  }
  
  return url;
}

/**
 * Get the login URL
 * @returns {string} Login URL
 */
function getLoginUrl() {
  return `${getFrontendUrl()}/login`;
}

/**
 * Get the password reset URL with token
 * @param {string} token - Reset token
 * @returns {string} Reset password URL
 */
function getResetPasswordUrl(token) {
  return `${getFrontendUrl()}/reset-password?token=${token}`;
}

/**
 * Get a document view URL
 * @param {string} documentType - Document type (invoices, credit-notes, statements)
 * @param {string} documentId - Document ID
 * @returns {string} Document view URL
 */
function getDocumentUrl(documentType, documentId) {
  return `${getFrontendUrl()}/${documentType}/${documentId}/view`;
}

module.exports = {
  getFrontendUrl,
  getBackendUrl,
  getLoginUrl,
  getResetPasswordUrl,
  getDocumentUrl
};
