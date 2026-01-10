/**
 * Supplier Document Import Job Processor
 * BullMQ job processor for supplier document import
 */

const { processSupplierDocumentImport } = require('../services/supplierDocumentProcessor');

/**
 * Process a supplier document import job
 * @param {Object} job - Bull job object
 * @returns {Promise<Object>} Import results
 */
async function processSupplierDocumentImportJob(job) {
  try {
    console.log(`📥 [Supplier Import] Processing job ${job.id}: ${job.data.fileName || 'Unknown'}`);
    
    const result = await processSupplierDocumentImport(job);
    
    if (result.success) {
      console.log(`✅ [Supplier Import] Job ${job.id} completed: ${result.invoiceNumber || result.fileName}`);
    } else {
      console.error(`❌ [Supplier Import] Job ${job.id} failed: ${result.error}`);
    }
    
    return result;
  } catch (error) {
    console.error(`❌ [Supplier Import] Job ${job.id} error:`, error.message);
    throw error;
  }
}

module.exports = {
  processSupplierDocumentImportJob
};
