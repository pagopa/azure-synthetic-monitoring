// modules
const utils = require('./utils')

const tester = require('./synthetic-monitoring')
const appInsights = require("applicationinsights");
const process = require("process");

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




async function main() {
   // call tester with a "keep all" filter
   await tester.execute(
     (monConfig) => true,
     utils.eventAndTelemetrySender(telemetryClient),
     onTestSuccess,
     onTestFailure
   );
};


function onTestSuccess(result, startTime){
  return (result) => {utils.trackSelfAvailabilityEvent(successMonitoringEvent, startTime, telemetryClient, "ok"); console.log("SUCCESS")}
}

function onTestFailure(error, startTime){
  return (error) => {utils.trackSelfAvailabilityEvent(failedMonitoringEvent, startTime, telemetryClient, error); console.error(`FAILURE: ${error}`)}
}


//start process
main()
