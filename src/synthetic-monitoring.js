//dependencies
const appInsights = require("applicationinsights");
const axios = require('axios');
const sslClient = require('get-ssl-certificate')
const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");

// modules
const utils = require('./utils')
const statics = require('./statics')
const constants = require('./const')

//env vars
const account = process.env.STORAGE_ACCOUNT_NAME;
const accountKey = process.env.STORAGE_ACCOUNT_KEY;
const tableName = process.env.STORAGE_ACCOUNT_TABLE_NAME
const availabilityPrefix = process.env.AVAILABILITY_PREFIX
const httpClientTimeout = process.env.HTTP_CLIENT_TIMEOUT
const location = process.env.LOCATION

appInsights.setup(process.env.APP_INSIGHT_CONNECTION_STRING).start();

//clients
const credential = new AzureNamedKeyCredential(account, accountKey);
const tableClient = new TableClient(`https://${account}.table.core.windows.net`, tableName, credential);
const client = new appInsights.TelemetryClient(process.env.APP_INSIGHT_CONNECTION_STRING);


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

//prepare axios interceptors
axios.interceptors.response.use(function (response) {
    //adding tls version to response
    response[constants.TLS_VERSION_KEY] = response.request.res.socket.getProtocol()
    response[constants.RESPONSE_TIME_KEY] = Date.now() - response.config.headers[constants.START_TIMESTAMP_KEY]
    return response;
  }, function (error) {
    console.error(`resp error interceptor: ${JSON.stringify(error)}`)
    //nothing to do
    return Promise.reject(error);
  });

axios.interceptors.request.use(
    (config) => {
      config.headers[constants.START_TIMESTAMP_KEY] = Date.now();
      return config;
    },
    (error) => {
      console.error(`req error interceptor: ${JSON.stringify(error)}`)
      return Promise.reject(error);
    }
  );


async function main() {
    let tableEntities = tableClient.listEntities();
    let tests = []
    const startTime = Date.now();
    for await (const tableConfiguration of tableEntities) {

        try{
            //property names remap and parsing
            let monitoringConfiguration = {
                ...tableConfiguration,
                appName: tableConfiguration.partitionKey,
                apiName: tableConfiguration.rowKey,
                tags: !statics.isNull(tableConfiguration['tags']) ? JSON.parse(tableConfiguration['tags']) : {},
                body: !statics.isNull(tableConfiguration['body']) ? JSON.parse(tableConfiguration['body']) : null,
                headers: !statics.isNull(tableConfiguration['headers'])? JSON.parse(tableConfiguration['headers']) : null,
                expectedCodes: !statics.isNull(tableConfiguration['expectedCodes']) ? JSON.parse(tableConfiguration['expectedCodes']) : null,
                durationLimit: tableConfiguration.durationLimit,
                httpClientTimeout,
                availabilityPrefix
            }
            console.log(`monitoringConfiguration: ${JSON.stringify(monitoringConfiguration)}`)

            tests.push(testIt(monitoringConfiguration, client, sslClient, axios).catch((error) => {
                console.error(`error in test for ${JSON.stringify(monitoringConfiguration)}: ${JSON.stringify(error.message)}`)
            }));

        }catch (parseError){
            console.error(`error parsing test for ${JSON.stringify(tableConfiguration)}`)
            tests.push(new Promise((resolve, reject) => {
                reject(parseError.message)
              }));
        }
    }

    Promise.all(tests)
                 .then((result) => {console.log("SUCCESS"); utils.trackSelfAvailabilityEvent(successMonitoringEvent, startTime, client, result);})
                 .catch((error) => {console.error(`FAILURE: ${error}`); utils.trackSelfAvailabilityEvent(failedMonitoringEvent, startTime, client, error);})
};


/**
 * executes the test configured by a monitoring configuration, sends the generated telemetry and events
 * returns a promise fullfilled when the thest is ran (any outcome), rejected when the execution fails
 * @param {monitoringConfiguration} monitoringConfiguration 
 * @param {TelemetryClient} telemetryClient 
 * @param {*} sslClient 
 * @param {axios} httpClient axios client
 * @returns promise rejected in case of a test EXECUTION failure
 */
async function testIt(monitoringConfiguration, telemetryClient, sslClient, httpClient){
  console.log(`preparing test for ${JSON.stringify(monitoringConfiguration)}`)

  let metricObjects =  statics.initMetricObjects(monitoringConfiguration);

  let metricContex = {
      testId: `${monitoringConfiguration.appName}_${monitoringConfiguration.apiName}_${monitoringConfiguration.type}`,
      baseTelemetryData : metricObjects.telemetry,
      baseEventData : metricObjects.event,
      monitoringConfiguration: monitoringConfiguration,
      apiMetrics: null,
      certMetrics: null
  }

  return utils.checkApi(metricContex, httpClient)
  .then(utils.certChecker(sslClient))
  .then(utils.telemetrySender(telemetryClient))
  .then(utils.eventSender(telemetryClient))

}

//start process
main()
