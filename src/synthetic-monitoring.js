//dependencies
const appInsights = require("applicationinsights");
const axios = require('axios');
const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
const process = require('process')

// modules
const utils = require('./utils')
const statics = require('./statics')
const constants = require('./const')
const logger = require('./logger')


//env vars
const account = process.env.STORAGE_ACCOUNT_NAME;
const accountKey = process.env.STORAGE_ACCOUNT_KEY;
const tableName = process.env.STORAGE_ACCOUNT_TABLE_NAME
const availabilityPrefix = process.env.AVAILABILITY_PREFIX
const httpClientTimeout = process.env.HTTP_CLIENT_TIMEOUT
const certValidityRangeDays = process.env.CERT_VALIDITY_RANGE_DAYS

try {
  const aiSetup = appInsights.setup(process.env.APP_INSIGHT_CONNECTION_STRING);
  if (aiSetup) {
    aiSetup.start();
    logger.debug("Application Insights initialized successfully");
  }
} catch (error) {
  logger.error(`Failed to initialize Application Insights: ${error.message}`);
}

//clients
let tableClient;
try {
  const credential = new AzureNamedKeyCredential(account, accountKey);
  tableClient = new TableClient(`https://${account}.table.core.windows.net`, tableName, credential);
  logger.debug("Table client initialized successfully");
} catch (error) {
  logger.error(`Failed to initialize Table client: ${error.message}`);
  throw error;
}



module.exports = {
  runMonitoring
}

//prepare axios interceptors
axios.interceptors.response.use(function (response) {
    //adding tls version to response
    response[constants.TLS_VERSION_KEY] = response.request.res.socket?.getProtocol() || null
    response[constants.RESPONSE_TIME_KEY] = Date.now() - response.config.headers[constants.START_TIMESTAMP_KEY]
    return response;
  }, function (error) {
    logger.info(`resp error interceptor: ${JSON.stringify(error)}`)
    //nothing to do
    return Promise.reject(error);
  });

axios.interceptors.request.use(
    (config) => {
      config.headers[constants.START_TIMESTAMP_KEY] = Date.now();
      return config;
    },
    (error) => {
      logger.info(`req error interceptor: ${JSON.stringify(error)}`)
      return Promise.reject(error);
    }
  );


async function runMonitoring(monitoringConfigurationFilter, sender, onSuccess, onFailure) {
    let tableEntities = tableClient.listEntities();
    let tests = []
    const startTime = Date.now();
    for await (const tableConfiguration of tableEntities) {
        try {
            //property names remap and parsing
            let nameSplit = tableConfiguration.partitionKey.split("-")
            let monitoringConfiguration = {
                ...tableConfiguration,
                appName: nameSplit[0],
                apiName: nameSplit[1],
                type: tableConfiguration.type,
                tags: !statics.isNull(tableConfiguration['tags']) ? JSON.parse(tableConfiguration['tags']) : {},
                body: !statics.isNull(tableConfiguration['body']) ? JSON.parse(tableConfiguration['body']) : null,
                headers: !statics.isNull(tableConfiguration['headers'])? JSON.parse(tableConfiguration['headers']) : null,
                expectedCodes: !statics.isNull(tableConfiguration['expectedCodes']) ? JSON.parse(tableConfiguration['expectedCodes']) : null,
                bodyCompareStrategy: !statics.isNull(tableConfiguration['bodyCompareStrategy']) ? tableConfiguration['bodyCompareStrategy'] : null,
                expectedBody: !statics.isNull(tableConfiguration['expectedBody']) ? JSON.parse(tableConfiguration['expectedBody']) : null,
                durationLimit: tableConfiguration.durationLimit,
                httpClientTimeout,
                availabilityPrefix,
                certValidityRangeDays
            }
            logger.debug(`monitoringConfiguration: ${JSON.stringify(monitoringConfiguration)}`)

            if(monitoringConfigurationFilter(monitoringConfiguration)){
              logger.info(statics.testId(monitoringConfiguration), `passed the filter, adding test promise`)
              tests.push(testIt(monitoringConfiguration, axios, sender).catch((error) => {
                logger.error(statics.testId(monitoringConfiguration), `error in test: ${JSON.stringify(error.message)}`)
              }));
            }




        } catch (parseError){
            logger.error(`error parsing test for ${JSON.stringify(tableConfiguration)}. ${parseError.message}`)
            tests.push(new Promise((resolve, reject) => {
                reject(parseError.message)
              }));
        }
    }

    await Promise.all(tests)
                 .then(onSuccess(startTime))
                 .catch(onFailure(startTime))
}


/**
 * executes the test configured by a monitoring configuration, sends the generated telemetry and events
 * returns a promise fulfilled when the test is ran (any outcome), rejected when the execution fails
 * @param {monitoringConfiguration} monitoringConfiguration the monitoring configuration object
 * @param {axios} httpClient axios client instance
 * @param {*} sender telemetry sender function
 * @returns {Promise} promise fulfilled when test completes, rejected in case of execution failure
 */
async function testIt(monitoringConfiguration, httpClient, sender){
  let testId = statics.testId(monitoringConfiguration);
  logger.debug(testId, `preparing test`)

  let metricObjects =  statics.initMetricObjects(monitoringConfiguration);
  let metricContex = {
      testId: testId,
      baseTelemetryData : metricObjects.telemetry,
      baseEventData : metricObjects.event,
      monitoringConfiguration: monitoringConfiguration,
      apiMetrics: null,
      certMetrics: null
  }

  let url = new URL(metricContex.monitoringConfiguration.url)

  metricContex.certMetrics = {
      domain: url.host,
      checkCert: metricContex.monitoringConfiguration.checkCertificate
  }

  return utils.checkApi(metricContex, httpClient)
    .then(sender)
}

