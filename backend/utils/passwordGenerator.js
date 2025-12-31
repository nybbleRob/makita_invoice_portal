/**
 * Utility functions for generating temporary passwords
 */

/**
 * Generates a secure temporary password
 * Format: Temp + 8 random alphanumeric characters + special character
 * Example: TempA3b7C9d2!
 * 
 * @returns {string} Temporary password
 */
function generateTemporaryPassword() {
  // Generate 8 random alphanumeric characters
  const randomChars = Math.random().toString(36).slice(-8);
  // Add a special character at the end
  const specialChars = '!@#$%^&*';
  const specialChar = specialChars[Math.floor(Math.random() * specialChars.length)];
  
  return `Temp${randomChars}${specialChar}`;
}

/**
 * Generates a more readable temporary password
 * Format: Temp + 4 random uppercase letters + 4 random numbers + special character
 * Example: TempABCD1234!
 * 
 * @returns {string} Temporary password
 */
function generateReadableTemporaryPassword() {
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // Exclude confusing letters
  const numbers = '23456789'; // Exclude 0 and 1
  const specialChars = '!@#$%^&*';
  
  let password = 'Temp';
  
  // Add 4 random uppercase letters
  for (let i = 0; i < 4; i++) {
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
  }
  
  // Add 4 random numbers
  for (let i = 0; i < 4; i++) {
    password += numbers[Math.floor(Math.random() * numbers.length)];
  }
  
  // Add special character
  password += specialChars[Math.floor(Math.random() * specialChars.length)];
  
  return password;
}

module.exports = {
  generateTemporaryPassword,
  generateReadableTemporaryPassword
};

