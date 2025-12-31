/**
 * Get user initials from name
 * @param {string} name - User's full name
 * @returns {string} - Initials (e.g., "Rob Eccles" -> "RE")
 */
export const getInitials = (name) => {
  if (!name) return 'U';
  
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  
  // Get first letter of first name and first letter of last name
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

/**
 * Get avatar colour class based on name (for consistent colours)
 * @param {string} name - User's name
 * @returns {string} - CSS class for avatar background
 */
export const getAvatarColorClass = (name) => {
  if (!name) return 'bg-blue';
  
  const colours = [
    'bg-blue',
    'bg-azure',
    'bg-indigo',
    'bg-purple',
    'bg-pink',
    'bg-red',
    'bg-orange',
    'bg-yellow',
    'bg-lime',
    'bg-green',
    'bg-teal',
    'bg-cyan'
  ];
  
  // Simple hash function to get consistent color for same name
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colours[Math.abs(hash) % colours.length];
};

