/**
 * In-Memory Store for Bulk Parsing Test Results
 * Stores test results temporarily until "Finish Test" is called
 */

class BulkTestStore {
  constructor() {
    // Store format: { testId: { results: [], status: 'processing'|'completed'|'failed', createdAt, completedAt } }
    this.tests = new Map();
    
    // Clean up old tests (older than 24 hours) every hour
    setInterval(() => {
      this.cleanupOldTests();
    }, 60 * 60 * 1000); // Every hour
  }

  /**
   * Create a new bulk test session
   * @param {string} testId - Unique test ID
   * @param {number} totalFiles - Total number of files to process
   * @param {Array<string>} filePaths - Array of all uploaded file paths
   * @returns {Object} Test session object
   */
  createTest(testId, totalFiles, filePaths = [], source = 'upload') {
    const test = {
      testId,
      totalFiles,
      processedFiles: 0,
      results: [],
      filePaths: filePaths, // Store all original file paths for cleanup
      source: source, // 'upload' or 'ftp' - indicates where files came from
      status: 'processing', // 'processing', 'completed', 'failed'
      createdAt: new Date().toISOString(),
      completedAt: null,
      errors: [],
      emailSent: false // Track if completion email has been sent
    };
    
    this.tests.set(testId, test);
    return test;
  }

  /**
   * Add a result to a test session
   * @param {string} testId - Test ID
   * @param {Object} result - Parsing result
   */
  addResult(testId, result) {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error(`Test ${testId} not found`);
    }
    
    test.results.push(result);
    test.processedFiles = test.results.length;
    
    // Check if all files are processed
    if (test.processedFiles >= test.totalFiles) {
      test.status = 'completed';
      test.completedAt = new Date().toISOString();
    }
    
    return test;
  }

  /**
   * Get test status and results
   * @param {string} testId - Test ID
   * @returns {Object|null} Test object or null if not found
   */
  getTest(testId) {
    return this.tests.get(testId) || null;
  }

  /**
   * Update test status
   * @param {string} testId - Test ID
   * @param {string} status - New status
   * @param {string} error - Optional error message
   */
  updateStatus(testId, status, error = null) {
    const test = this.tests.get(testId);
    if (!test) {
      throw new Error(`Test ${testId} not found`);
    }
    
    test.status = status;
    if (status === 'completed' || status === 'failed') {
      test.completedAt = new Date().toISOString();
    }
    if (error) {
      test.errors.push(error);
    }
    
    return test;
  }

  /**
   * Delete a test and return file paths for cleanup
   * @param {string} testId - Test ID
   * @returns {Array<string>} Array of file paths to delete
   */
  deleteTest(testId) {
    const test = this.tests.get(testId);
    if (!test) {
      return [];
    }
    
    // Collect all file paths:
    // 1. From original upload (filePaths array)
    // 2. From results (in case some files were processed)
    const allFilePaths = new Set();
    
    // Add original file paths
    if (test.filePaths && Array.isArray(test.filePaths)) {
      test.filePaths.forEach(path => {
        if (path) allFilePaths.add(path);
      });
    }
    
    // Add file paths from results (in case they differ or weren't in original list)
    test.results.forEach(result => {
      if (result.filePath) {
        allFilePaths.add(result.filePath);
      }
    });
    
    // Delete the test
    this.tests.delete(testId);
    
    return Array.from(allFilePaths);
  }

  /**
   * Clean up tests older than 24 hours
   */
  cleanupOldTests() {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [testId, test] of this.tests.entries()) {
      const createdAt = new Date(test.createdAt).getTime();
      if (now - createdAt > maxAge) {
        console.log(`🧹 Cleaning up old bulk test: ${testId}`);
        this.tests.delete(testId);
      }
    }
  }

  /**
   * Get all file paths from a test for cleanup
   * @param {string} testId - Test ID
   * @returns {Array<string>} Array of file paths
   */
  getFilePaths(testId) {
    const test = this.tests.get(testId);
    if (!test) {
      return [];
    }
    
    return test.results
      .map(result => result.filePath)
      .filter(path => path);
  }
}

// Singleton instance
const bulkTestStore = new BulkTestStore();

module.exports = bulkTestStore;

