// modules
const utils = require('./utils')
const logger = require('./logger')

const tester = require('./synthetic-monitoring')
const appInsights = require("applicationinsights");
const process = require("process");
const availabilityPrefix = process.env.AVAILABILITY_PREFIX
const location = process.env.LOCATION

let telemetryClient;
try {
  const connString = process.env.APP_INSIGHT_CONNECTION_STRING;
  if (!connString) {
    logger.error("APP_INSIGHT_CONNECTION_STRING environment variable is not set");
  } else {
    logger.debug(`Initializing telemetry client with connection string (first 50 chars): ${connString.substring(0, 50)}...`);
    const aiSetup = appInsights.setup(connString);
    if (aiSetup) {
      aiSetup.start();
      telemetryClient = new appInsights.TelemetryClient(connString);
      logger.debug("Application Insights telemetry client initialized successfully");
      logger.debug(`Telemetry client available: ${telemetryClient !== undefined && telemetryClient !== null}`);
    }
  }
} catch (error) {
  logger.error(`Failed to initialize Application Insights: ${error.message}`);
  throw error;
}

//constants
const successMonitoringEvent = {
  id: `${availabilityPrefix}-monitoring-function`,
  message: "",
  success : true,
  name: `${availabilityPrefix}-monitoring-function`,
  runLocation: location,
}

const failedMonitoringEvent = {
  id: `${availabilityPrefix}-monitoring-function`,
  message: "At least one test failed to execute",
  success : false,
  name: `${availabilityPrefix}-monitoring-function`,
  runLocation: location,
}


module.exports = {
  execute
}


/**
 * Executes the synthetic monitoring function.
 * Runs all monitoring tests (using a keep-all filter), sends telemetry events to Application Insights,
 * and tracks availability metrics based on test results.
 * @async
 * @returns {Promise<void>}
 */
async function execute() {
   // call tester with a "keep all" filter
   await tester.runMonitoring(
     filterKeepAll,
     utils.eventAndTelemetrySender(telemetryClient),
     utils.cronOnSuccess(telemetryClient, successMonitoringEvent),
     utils.cronOnError(telemetryClient, failedMonitoringEvent)
   ).finally(() => {logger.info("flushing telemetry"); telemetryClient.flush()});
}


function filterKeepAll (monitoringConfiguration) {
  return true;
}



