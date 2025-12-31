/**
 * Tabler Toast Utility
 * Replaces react-toastify with native Tabler toasts
 * Based on: https://docs.tabler.io/ui/components/toasts
 */

// Toast container element
let toastContainer = null;

// Initialize toast container
const initToastContainer = () => {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3';
    toastContainer.style.zIndex = '9999';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
};

// Create a toast element
const createToast = (message, type = 'info', duration = 3000) => {
  initToastContainer();
  
  const toastId = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const toast = document.createElement('div');
  toast.className = `toast show`;
  toast.id = toastId;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  toast.setAttribute('aria-atomic', 'true');
  
  // Determine icon and color based on type
  let iconSvg = '';
  let bgClass = '';
  
  switch (type) {
    case 'success':
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="icon" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M5 12l5 5l10 -10" /></svg>`;
      bgClass = 'bg-success';
      break;
    case 'error':
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="icon" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>`;
      bgClass = 'bg-danger';
      break;
    case 'warning':
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="icon" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 9v4" /><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z" /><path d="M12 16h.01" /></svg>`;
      bgClass = 'bg-warning';
      break;
    default:
      iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="icon" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>`;
      bgClass = 'bg-primary';
  }
  
  toast.innerHTML = `
    <div class="toast-header ${bgClass} text-white">
      <span class="me-2">${iconSvg}</span>
      <strong class="me-auto">${type.charAt(0).toUpperCase() + type.slice(1)}</strong>
      <button type="button" class="ms-2 btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>
    <div class="toast-body">${message}</div>
  `;
  
  toastContainer.appendChild(toast);
  
  // Initialize Bootstrap toast
  if (window.bootstrap && window.bootstrap.Toast) {
    const bsToast = new window.bootstrap.Toast(toast, {
      autohide: duration > 0,
      delay: duration
    });
    
    bsToast.show();
    
    // Remove toast element after it's hidden
    toast.addEventListener('hidden.bs.toast', () => {
      toast.remove();
    });
  } else {
    // Fallback: remove after duration
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 300);
    }, duration);
  }
  
  return toast;
};

// Toast methods
export const toast = {
  success: (message, duration = 3000) => createToast(message, 'success', duration),
  error: (message, duration = 5000) => createToast(message, 'error', duration),
  warning: (message, duration = 4000) => createToast(message, 'warning', duration),
  info: (message, duration = 3000) => createToast(message, 'info', duration),
};

export default toast;

