import React, { useEffect, useRef } from 'react';

/**
 * reCAPTCHA v3 Component
 * 
 * Automatically executes reCAPTCHA v3 on form submission.
 * Returns token via callback function.
 */
const Captcha = ({ onVerify, siteKey, action = 'login' }) => {
  const recaptchaRef = useRef(null);
  const scriptLoaded = useRef(false);

  useEffect(() => {
    // Skip if site key not provided (development mode)
    if (!siteKey || siteKey === '') {
      console.warn('⚠️  reCAPTCHA site key not set - CAPTCHA verification will be skipped');
      return;
    }

    // Load reCAPTCHA script if not already loaded
    if (!scriptLoaded.current && !window.grecaptcha) {
      const script = document.createElement('script');
      script.src = `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        scriptLoaded.current = true;
        window.grecaptcha.ready(() => {
          console.log('✅ reCAPTCHA v3 loaded');
        });
      };
      document.body.appendChild(script);
    } else if (window.grecaptcha) {
      scriptLoaded.current = true;
    }

    return () => {
      // Cleanup if needed
    };
  }, [siteKey]);

  const executeRecaptcha = async () => {
    // Skip if site key not provided
    if (!siteKey || siteKey === '') {
      // In development, call onVerify with null to allow request
      if (onVerify) {
        onVerify(null);
      }
      return null;
    }

    // Wait for grecaptcha to be ready
    if (!window.grecaptcha || !window.grecaptcha.ready) {
      console.warn('reCAPTCHA not loaded yet');
      if (onVerify) {
        onVerify(null);
      }
      return null;
    }

    try {
      const token = await window.grecaptcha.execute(siteKey, { action });
      if (onVerify) {
        onVerify(token);
      }
      return token;
    } catch (error) {
      console.error('reCAPTCHA execution error:', error);
      if (onVerify) {
        onVerify(null);
      }
      return null;
    }
  };

  // Expose execute function via ref
  React.useImperativeHandle(recaptchaRef, () => ({
    execute: executeRecaptcha
  }));

  // Return execute function for parent to call
  return {
    execute: executeRecaptcha
  };
};

// Export as hook for easier use
export const useRecaptcha = (siteKey, action = 'login') => {
  const [token, setToken] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const execute = React.useCallback(async () => {
    // Skip if site key not provided
    if (!siteKey || siteKey === '') {
      return null;
    }

    if (!window.grecaptcha || !window.grecaptcha.ready) {
      setError('reCAPTCHA not loaded');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const recaptchaToken = await window.grecaptcha.execute(siteKey, { action });
      setToken(recaptchaToken);
      return recaptchaToken;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [siteKey, action]);

  return { execute, token, loading, error };
};

export default Captcha;
