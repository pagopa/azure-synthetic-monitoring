// modules
const utils = require('./utils')
const logger = require('./logger')
const icinga = require('./icinga')
const businessProcess = require('./business-process')

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
      telemetryClient = appInsights.defaultClient;
      logger.debug("Application Insights telemetry client initialized successfully");
      logger.debug(`Telemetry client available: ${telemetryClient !== undefined && telemetryClient !== null}`);
    }
  }
} catch (error) {
  logger.error(`Failed to initialize Application Insights: ${error.message}`);
  throw error;
}

let icingaConfig = null;
let icingaClient = null;
if (process.env.ICINGA_INTEGRATION_ENABLED === 'true') {
  try {
    icingaConfig = icinga.readConfig();
    icingaClient = icinga.createClient(icingaConfig);
    logger.debug(`Icinga integration enabled: ${icingaConfig.apiUrl}, host ${icingaConfig.host}, user ${icingaConfig.user}`);
  } catch (error) {
    // the synthetic tests and Application Insights keep working without icinga
    logger.error(`Icinga integration disabled: ${error.message}`);
  }
}

let bpConfig = null;
let bpClient = null;
if (icingaClient) {
  try {
    bpConfig = businessProcess.readConfig();
    if (bpConfig) {
      bpClient = businessProcess.createClient(bpConfig);
      logger.debug(`Icinga business process update enabled: ${bpConfig.apiUrl}, business process ${bpConfig.bp}`);
    } else {
      logger.debug("Icinga business process update disabled: BP_API_URL not set");
    }
  } catch (error) {
    // host, services and check results keep working without the business process
    logger.error(`Icinga business process update disabled: ${error.message}`);
  }
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
   const icingaStats = icinga.createStats();
   // call tester with a "keep all" filter
   await tester.runMonitoring(
     filterKeepAll,
     icingaClient ? utils.appInsightAndIcingaSender(telemetryClient, icingaClient, icingaConfig.host, icingaStats) : utils.eventAndTelemetrySender(telemetryClient),
     utils.cronOnSuccess(telemetryClient, successMonitoringEvent),
     utils.cronOnError(telemetryClient, failedMonitoringEvent),
     icingaClient ? icingaBeforeTests : undefined
   );

   if (icingaClient) {
     logger.info(`icinga check results to host ${icingaConfig.host}: ${icinga.statsSummary(icingaStats)}`);
   }

   // Wait a bit for SDK to queue telemetry, then flush
   await new Promise(resolve => setTimeout(resolve, 100));

   // Flush telemetry to ensure all metrics are sent before function terminates
   logger.info("Flushing telemetry to Application Insights");
   return new Promise((resolve) => {
    if (!telemetryClient) {
      logger.error("Telemetry client is null, skipping flush");
      resolve();
      return;
    }
    telemetryClient.flush({ isAppCrashing: false }, (error) => {
      if (error) {
        logger.error(`Failed to flush telemetry: ${error}`);
      } else {
        logger.info("Telemetry flushed successfully");
      }
      resolve();
    });
   });
}


/**
 * prepares icinga before the tests: host and services first, so that the check results find them,
 * then the synthetic nodes of the business process. both never reject
 * @param {object[]} configurations configurations about to be tested
 */
async function icingaBeforeTests(configurations) {
  await icinga.ensureHostAndServices(configurations, icingaClient, icingaConfig.host);
  if (bpClient) {
    await businessProcess.updateBusinessProcess(configurations, bpClient, bpConfig.bp, icingaConfig.host);
  }
  logger.info(`icinga check results: sending ${configurations.length} results to host ${icingaConfig.host}`);
}


function filterKeepAll (monitoringConfiguration) {
  return true;
}



