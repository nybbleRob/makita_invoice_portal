/**
 * Utility functions for generating secure temporary passwords
 * Uses crypto.randomBytes for cryptographically secure random generation
 */

const crypto = require('crypto');

/**
 * Character sets for password generation
 * Excludes visually ambiguous characters (0, O, l, 1, I)
 */
const CHAR_SETS = {
  uppercase: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lowercase: 'abcdefghjkmnpqrstuvwxyz',
  numbers: '23456789',
  symbols: '!@#$%^&*-_+=?'
};

/**
 * Get a cryptographically secure random integer in range [0, max)
 * @param {number} max - Upper bound (exclusive)
 * @returns {number} Random integer
 */
function secureRandomInt(max) {
  const randomBytes = crypto.randomBytes(4);
  const randomValue = randomBytes.readUInt32BE(0);
  return randomValue % max;
}

/**
 * Pick a random character from a string using secure random
 * @param {string} str - String to pick from
 * @returns {string} Single random character
 */
function secureRandomChar(str) {
  return str[secureRandomInt(str.length)];
}

/**
 * Shuffle an array using Fisher-Yates algorithm with secure random
 * @param {Array} array - Array to shuffle
 * @returns {Array} Shuffled array (mutates original)
 */
function secureShuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Generates a cryptographically secure temporary password
 * 
 * Requirements:
 * - Minimum 12 characters (actually generates 14)
 * - At least 3 uppercase letters
 * - At least 3 lowercase letters
 * - At least 3 numbers
 * - At least 2 symbols
 * - All characters randomly shuffled
 * 
 * @returns {string} Secure temporary password (14 characters)
 */
function generateTemporaryPassword() {
  const passwordChars = [];
  
  // Ensure minimum requirements
  // 3 uppercase
  for (let i = 0; i < 3; i++) {
    passwordChars.push(secureRandomChar(CHAR_SETS.uppercase));
  }
  
  // 3 lowercase
  for (let i = 0; i < 3; i++) {
    passwordChars.push(secureRandomChar(CHAR_SETS.lowercase));
  }
  
  // 3 numbers
  for (let i = 0; i < 3; i++) {
    passwordChars.push(secureRandomChar(CHAR_SETS.numbers));
  }
  
  // 2 symbols
  for (let i = 0; i < 2; i++) {
    passwordChars.push(secureRandomChar(CHAR_SETS.symbols));
  }
  
  // Add 3 more random characters from all sets for extra length (total 14)
  const allChars = CHAR_SETS.uppercase + CHAR_SETS.lowercase + CHAR_SETS.numbers + CHAR_SETS.symbols;
  for (let i = 0; i < 3; i++) {
    passwordChars.push(secureRandomChar(allChars));
  }
  
  // Shuffle to randomize positions
  secureShuffleArray(passwordChars);
  
  return passwordChars.join('');
}

/**
 * Generates a readable but still secure temporary password
 * Format: 4 uppercase + 4 numbers + 4 mixed + 2 symbols = 14 chars
 * 
 * This is more readable while still meeting security requirements:
 * - 14 characters
 * - Mix of uppercase, numbers, and symbols
 * - Cryptographically secure random generation
 * 
 * @returns {string} Readable secure temporary password
 */
function generateReadableTemporaryPassword() {
  const passwordChars = [];
  
  // 3 uppercase letters
  for (let i = 0; i < 3; i++) {
    passwordChars.push(secureRandomChar(CHAR_SETS.uppercase));
  }
  
  // 3 lowercase letters
  for (let i = 0; i < 3; i++) {
    passwordChars.push(secureRandomChar(CHAR_SETS.lowercase));
  }
  
  // 4 numbers
  for (let i = 0; i < 4; i++) {
    passwordChars.push(secureRandomChar(CHAR_SETS.numbers));
  }
  
  // 2 symbols (at least)
  for (let i = 0; i < 2; i++) {
    passwordChars.push(secureRandomChar(CHAR_SETS.symbols));
  }
  
  // Add 2 more random characters for good measure (total 14)
  const allChars = CHAR_SETS.uppercase + CHAR_SETS.lowercase + CHAR_SETS.numbers + CHAR_SETS.symbols;
  for (let i = 0; i < 2; i++) {
    passwordChars.push(secureRandomChar(allChars));
  }
  
  // Shuffle all characters for unpredictability
  secureShuffleArray(passwordChars);
  
  return passwordChars.join('');
}

/**
 * Generates a password with custom length
 * @param {number} length - Desired password length (minimum 12)
 * @returns {string} Secure password of specified length
 */
function generateSecurePassword(length = 14) {
  if (length < 12) {
    throw new Error('Password length must be at least 12 characters');
  }
  
  const passwordChars = [];
  
  // Ensure minimum requirements (12 chars worth)
  // 3 uppercase
  for (let i = 0; i < 3; i++) {
    passwordChars.push(secureRandomChar(CHAR_SETS.uppercase));
  }
  
  // 3 lowercase
  for (let i = 0; i < 3; i++) {
    passwordChars.push(secureRandomChar(CHAR_SETS.lowercase));
  }
  
  // 3 numbers
  for (let i = 0; i < 3; i++) {
    passwordChars.push(secureRandomChar(CHAR_SETS.numbers));
  }
  
  // 2 symbols
  for (let i = 0; i < 2; i++) {
    passwordChars.push(secureRandomChar(CHAR_SETS.symbols));
  }
  
  // Fill remaining with random characters
  const allChars = CHAR_SETS.uppercase + CHAR_SETS.lowercase + CHAR_SETS.numbers + CHAR_SETS.symbols;
  const remaining = length - 11;
  for (let i = 0; i < remaining; i++) {
    passwordChars.push(secureRandomChar(allChars));
  }
  
  // Shuffle
  secureShuffleArray(passwordChars);
  
  return passwordChars.join('');
}

module.exports = {
  generateTemporaryPassword,
  generateReadableTemporaryPassword,
  generateSecurePassword,
  // Export helpers for testing
  secureRandomInt,
  secureRandomChar
};
