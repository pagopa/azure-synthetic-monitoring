// modules
const utils = require('./utils')
const logger = require('./logger')

const tester = require('./synthetic-monitoring')
const appInsights = require("applicationinsights");
const process = require("process");
const availabilityPrefix = process.env.AVAILABILITY_PREFIX
const location = process.env.LOCATION
const telemetryClient = new appInsights.TelemetryClient(process.env.APP_INSIGHT_CONNECTION_STRING);

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
     utils.cronOnSuccess,
     utils.cronOnError
   );
}


function filterKeepAll (monitoringConfiguration) {
  return true;
}



