import React, { useState, useEffect, useRef } from 'react';

/**
 * Document Retention Timer Component
 * Displays countdown timer for document retention with color-coded warnings
 * 
 * @param {Date|string} expiryDate - When the document will be deleted
 * @param {Date|string} startDate - When retention countdown began
 * @param {number} retentionPeriod - Retention period in days
 */
const DocumentRetentionTimer = ({ expiryDate, startDate, retentionPeriod }) => {
  const [displayText, setDisplayText] = useState('');
  const [badgeClass, setBadgeClass] = useState('');
  const [tooltipText, setTooltipText] = useState('');
  const badgeRef = useRef(null);
  const tooltipInstanceRef = useRef(null);

  useEffect(() => {
    // Don't do anything if retention is disabled
    if (!retentionPeriod || !expiryDate) {
      return;
    }

    const calculateTimeRemaining = () => {
      const now = new Date();
      const expiry = new Date(expiryDate);
      const diff = expiry - now;

      // Update tooltip text
      const expiryDateFormatted = new Date(expiryDate).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      setTooltipText(`Document will be deleted on ${expiryDateFormatted}`);

      if (diff <= 0) {
        setDisplayText('Expired');
        setBadgeClass('bg-danger-lt');
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      // Determine color based on time remaining
      if (days > 5) {
        setBadgeClass('bg-success-lt');
        setDisplayText(`${days} Days`);
      } else if (days >= 2) {
        setBadgeClass('bg-warning-lt');
        setDisplayText(`${days} Days`);
      } else if (days > 0 || hours > 0) {
        setBadgeClass('bg-danger-lt');
        if (hours < 1) {
          setDisplayText(`${minutes} Minutes`);
        } else {
          setDisplayText(`${hours} Hours ${minutes} Minutes`);
        }
      } else {
        setBadgeClass('bg-danger-lt');
        setDisplayText(`${minutes} Minutes`);
      }
    };

    // Calculate immediately
    calculateTimeRemaining();

    // Update every minute
    const interval = setInterval(calculateTimeRemaining, 60000);

    return () => clearInterval(interval);
  }, [expiryDate, retentionPeriod]);

  // Initialize Bootstrap tooltip
  useEffect(() => {
    if (!badgeRef.current || !retentionPeriod || !expiryDate || !tooltipText) {
      return;
    }

    const element = badgeRef.current;

    // Wait a bit to ensure element is fully in DOM and Bootstrap is loaded
    const initTooltip = () => {
      // Dispose existing tooltip if it exists
      if (tooltipInstanceRef.current) {
        if (tooltipInstanceRef.current.dispose) {
          tooltipInstanceRef.current.dispose();
        } else if (typeof window.$ !== 'undefined' && element) {
          // eslint-disable-next-line no-undef
          $(element).tooltip('dispose');
        }
        tooltipInstanceRef.current = null;
      }

      // Try to get existing tooltip instance from Bootstrap
      let existingTooltip = null;
      if (window.bootstrap?.Tooltip?.getInstance) {
        existingTooltip = window.bootstrap.Tooltip.getInstance(element);
      }
      if (existingTooltip) {
        existingTooltip.dispose();
      }

      // Set title attribute first (required for tooltip)
      element.setAttribute('title', tooltipText);
      element.setAttribute('data-bs-original-title', tooltipText);

      // Initialize Bootstrap tooltip
      // Try multiple ways to access Bootstrap Tooltip
      let TooltipClass = null;
      
      // Method 1: window.bootstrap.Tooltip (standard Bootstrap 5)
      if (window.bootstrap && window.bootstrap.Tooltip) {
        TooltipClass = window.bootstrap.Tooltip;
      }
      // Method 2: Check if Tooltip is available globally (Tabler might expose it)
      else if (window.Tooltip) {
        TooltipClass = window.Tooltip;
      }
      // Method 3: jQuery/bootstrap fallback
      else if (typeof window.$ !== 'undefined' && window.$.fn && window.$.fn.tooltip) {
        // eslint-disable-next-line no-undef
        $(element).tooltip({
          placement: 'top',
          trigger: 'hover focus',
          title: tooltipText
        });
        tooltipInstanceRef.current = true; // Mark as initialized
        return;
      }

      if (TooltipClass) {
        try {
          tooltipInstanceRef.current = new TooltipClass(element, {
            placement: 'top',
            trigger: 'hover focus',
            title: tooltipText
          });
        } catch (error) {
          console.warn('Failed to initialize tooltip:', error);
        }
      }
    };

    // Small delay to ensure DOM is ready and Bootstrap is loaded
    const timeoutId = setTimeout(initTooltip, 100);

    return () => {
      clearTimeout(timeoutId);
      if (tooltipInstanceRef.current) {
        if (tooltipInstanceRef.current.dispose) {
          tooltipInstanceRef.current.dispose();
        } else if (typeof window.$ !== 'undefined' && element) {
          // eslint-disable-next-line no-undef
          $(element).tooltip('dispose');
        }
        tooltipInstanceRef.current = null;
      }
    };
  }, [retentionPeriod, expiryDate, tooltipText]);

  // Update tooltip content when tooltipText changes (if tooltip already initialized)
  useEffect(() => {
    if (!badgeRef.current || !tooltipInstanceRef.current || !tooltipText) {
      return;
    }

    const element = badgeRef.current;

    // Update tooltip content if instance exists
    if (tooltipInstanceRef.current && tooltipInstanceRef.current.setContent) {
      // Bootstrap 5.2+ method
      tooltipInstanceRef.current.setContent({ '.tooltip-inner': tooltipText });
    } else if (tooltipInstanceRef.current && tooltipInstanceRef.current._config) {
      // Update config and refresh
      element.setAttribute('title', tooltipText);
      element.setAttribute('data-bs-original-title', tooltipText);
      if (tooltipInstanceRef.current._setContent) {
        tooltipInstanceRef.current._setContent({ '.tooltip-inner': tooltipText });
      }
    } else {
      // Fallback: update title attribute
      element.setAttribute('title', tooltipText);
      element.setAttribute('data-bs-original-title', tooltipText);
    }
  }, [tooltipText]);

  // Don't render anything if retention is disabled
  if (!retentionPeriod || !expiryDate) {
    return null;
  }

  return (
    <span 
      ref={badgeRef}
      className={`badge ${badgeClass}`}
      style={{ fontSize: '0.75rem' }}
      data-bs-toggle="tooltip"
      data-bs-placement="top"
      title={tooltipText}
    >
      {displayText}
    </span>
  );
};

export default DocumentRetentionTimer;

