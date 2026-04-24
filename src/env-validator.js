const logger = require('./logger');
const constants = require('./const');

module.exports = {
  validateEnvironment
};

/**
 * Validates that all required environment variables are set.
 * Throws an error if any required variables are missing.
 * @throws {Error} If any required environment variable is missing
 */
function validateEnvironment() {
  const operationMode = process.env.OPERATION_MODE || constants.DEFAULT_OPERATION_MODE;
  
  const requiredCommonVars = [
    'STORAGE_ACCOUNT_NAME',
    'STORAGE_ACCOUNT_KEY',
    'STORAGE_ACCOUNT_TABLE_NAME',
    'APP_INSIGHT_CONNECTION_STRING'
  ];
  
  const requiredQueueVars = [
    'STORAGE_ACCOUNT_CONNECTION_STRING',
    'INBOUND_QUEUE_NAME',
    'OUTBOUND_QUEUE_NAME'
  ];
  
  const missingVars = [];
  
  // Check common required vars
  for (const varName of requiredCommonVars) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  }
  
  // Check queue-specific vars if running in queue mode
  if (operationMode === constants.QUEUE_OPERATION_MODE) {
    for (const varName of requiredQueueVars) {
      if (!process.env[varName]) {
        missingVars.push(varName);
      }
    }
  }
  
  if (missingVars.length > 0) {
    const errorMsg = `Missing required environment variables: ${missingVars.join(', ')}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
  
  logger.debug(`Environment validation passed for mode: ${operationMode}`);
}
