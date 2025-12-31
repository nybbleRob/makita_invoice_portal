const documentai = require('@google-cloud/documentai');
const fs = require('fs');

/**
 * Test Google Document AI connection
 */
async function testDocumentAIConnection(documentAIConfig = {}) {
  let client = null;
  
  try {
    const projectId = documentAIConfig.projectId || process.env.GOOGLE_CLOUD_PROJECT_ID;
    const location = documentAIConfig.location || process.env.GOOGLE_CLOUD_LOCATION || 'us';
    const processorId = documentAIConfig.processorId || process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID;
    
    if (!projectId || !processorId) {
      return {
        success: false,
        message: 'Document AI requires both Project ID and Processor ID. Please configure these in Parsing Provider settings.',
        error: 'Missing configuration'
      };
    }
    
    // Initialize client with credentials
    // Priority: 1) JSON from env var, 2) JSON from database, 3) File path from env var, 4) File path from settings
    const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || 
                           documentAIConfig.credentialsJson;
    const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 
                           documentAIConfig.credentialsPath;
    
    if (credentialsJson) {
      // Use JSON from environment variable or database
      try {
        const credentials = typeof credentialsJson === 'string' 
          ? JSON.parse(credentialsJson) 
          : credentialsJson;
        client = new documentai.DocumentProcessorServiceClient({
          credentials: credentials
        });
      } catch (parseError) {
        return {
          success: false,
          message: `Invalid JSON in credentials: ${parseError.message}`,
          error: 'Invalid JSON'
        };
      }
    } else if (credentialsPath) {
      if (!fs.existsSync(credentialsPath)) {
        return {
          success: false,
          message: `Credentials file not found: ${credentialsPath}`,
          error: 'File not found'
        };
      }
      
      client = new documentai.DocumentProcessorServiceClient({
        keyFilename: credentialsPath
      });
    } else {
      client = new documentai.DocumentProcessorServiceClient();
    }
    
    // Test by getting processor information
    const processorName = `projects/${projectId}/locations/${location}/processors/${processorId}`;
    
    try {
      const [processor] = await client.getProcessor({
        name: processorName
      });
      
      return {
        success: true,
        message: 'Successfully connected to Google Document AI',
        details: {
          projectId,
          location,
          processorId,
          processorName: processor.displayName || 'N/A',
          processorType: processor.type || 'N/A',
          credentialsPath: credentialsPath ? 'Set' : 'Using default'
        }
      };
    } catch (processorError) {
      if (processorError.message.includes('NOT_FOUND')) {
        return {
          success: false,
          message: `Processor not found: ${processorId}. Please check that the Processor ID is correct and exists in your project.`,
          error: processorError.message,
          suggestion: 'Create a processor in Google Cloud Console → Document AI → Processors'
        };
      }
      throw processorError;
    }
  } catch (error) {
    const errorMessage = error.message || '';
    
    if (errorMessage.includes('ENOENT') || errorMessage.includes('not found')) {
      return {
        success: false,
        message: 'Credentials file not found. Please check your GOOGLE_APPLICATION_CREDENTIALS environment variable.',
        error: errorMessage
      };
    }
    
    if (errorMessage.includes('PERMISSION_DENIED') || errorMessage.includes('403')) {
      return {
        success: false,
        message: 'Permission denied. Please check that your service account has the "Document AI API User" role enabled.',
        error: errorMessage,
        suggestion: 'Enable the Document AI API in Google Cloud Console and grant the service account the necessary permissions.'
      };
    }
    
    if (errorMessage.includes('UNAUTHENTICATED') || errorMessage.includes('401')) {
      return {
        success: false,
        message: 'Authentication failed. Please check that your service account JSON file is valid.',
        error: errorMessage
      };
    }
    
    if (errorMessage.includes('API not enabled')) {
      return {
        success: false,
        message: 'Document AI API is not enabled for your project. Please enable it in Google Cloud Console.',
        error: errorMessage,
        suggestion: 'Go to Google Cloud Console → APIs & Services → Enable APIs → Search for "Document AI API" and enable it.'
      };
    }
    
    return {
      success: false,
      message: `Document AI connection failed: ${errorMessage}`,
      error: errorMessage
    };
  }
}

module.exports = {
  testDocumentAIConnection
};
