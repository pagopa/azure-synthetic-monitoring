const constants = require('./const')
const statics = require('./statics')
const logger = require('./logger')


module.exports = {
    trackSelfAvailabilityEvent,
    eventSender,
    telemetrySender,
    eventAndTelemetrySender,
    checkApi,
    logSender,
    logSuccess,
    logError,
    resultCollectorSender,
    queueOnError,
    queueOnSuccess,
    cronOnError,
    cronOnSuccess
}

/**
 *
 * @param {telemetryData} toTrack base event to use for tracking availability
 * @param {Date} startTime when the elaboration started
 * @param {TelemetryClient} telemetryClient appInsight client
 * @param {string} result message to be attached to the event
 */
function trackSelfAvailabilityEvent(toTrack, startTime, telemetryClient, result){
    let event = {
        ...toTrack,
        duration : Date.now() - startTime,
        message: result
    }
    telemetryClient.trackAvailability(event)
    logger.debug("selfAvailabilityEvent sent")
}




/**
 * sends a custom event to appInsight
 * @param {TelemetryClient} client
 * @returns  an async function that receives and returns the metric context
 */
function eventSender(client){
    return async function(metricContext){
        let enrichedMeasurements = statics.enrichData(metricContext.baseEventData.measurements, metricContext.apiMetrics, constants.keysForEvent)
        let enrichedProperties = statics.enrichData(metricContext.baseEventData.properties, metricContext.apiMetrics, constants.keysForEventProperties)
        if (metricContext.certMetrics){
            enrichedMeasurements = statics.enrichData(enrichedMeasurements, metricContext.certMetrics, constants.keysForEvent)
            enrichedProperties = statics.enrichData(enrichedProperties, metricContext.certMetrics, constants.keysForEventProperties)
        }
        metricContext.baseEventData['measurements'] = enrichedMeasurements
        metricContext.baseEventData['properties'] = enrichedProperties

        logger.info(`event for ${metricContext.testId}: ${JSON.stringify(metricContext.baseEventData)}`)
        client.trackEvent(metricContext.baseEventData);
        logger.debug("event sent")
        return metricContext;
    }
}


/**
 * sends the availability metrics according to what is found in the metric context
 * @param {TelemetryClient} client
 * @returns  an async function that receives and returns the metric context
 */
function telemetrySender(client){
    return async function(metricContext){
        //merge monitoring results and send
        if (metricContext.apiMetrics && Object.keys(metricContext.apiMetrics).length > 0 ){
            let apiTelemetryData = statics.enrichData(metricContext.baseTelemetryData, metricContext.apiMetrics, constants.keysForTelemetry);
            logger.info(`tracking api telemetry for ${metricContext.testId} : ${JSON.stringify(apiTelemetryData)}`)
            client.trackAvailability(apiTelemetryData);
        }

        if (metricContext.certMetrics && Object.keys(metricContext.certMetrics).length > 0 && metricContext.monitoringConfiguration.checkCertificate){
            let certTelemetryData = statics.enrichData(metricContext.baseTelemetryData, metricContext.certMetrics, constants.keysForTelemetry);
            logger.info(`tracking cert telemetry for ${metricContext.testId}: ${JSON.stringify(certTelemetryData)}`)
            client.trackAvailability(certTelemetryData);
        }
        logger.debug("telemetry sent")
        return metricContext
    }
}


/**
 * sends event and telemetry sequentially
 * @param {TelemetryClient} client
 * @returns  an async function that receives and returns the metric context
 */
function eventAndTelemetrySender(client){
    return async function(metricContext){
        const contextAfterEvent = await eventSender(client)(metricContext);
        return await telemetrySender(client)(contextAfterEvent);
    }
}



/**
 * calls the configured api and checks the response, populating the metric context accordingly
 * returns a promise fulfilled when the test is executed correctly, rejected when the test execution fails
 * @param {*} metricContext
 * @param {*} httpClient axios
 * @returns promise resolved with metricContext
 */
async function checkApi(metricContext, httpClient){
    metricContext['startTime'] = Date.now();
    logger.info(`check api for ${metricContext.testId}, ${JSON.stringify(statics.buildRequest(metricContext.monitoringConfiguration))}`)
    return httpClient(statics.buildRequest(metricContext.monitoringConfiguration))
        .then(statics.apiResponseElaborator(metricContext))
        .catch(statics.apiErrorElaborator(metricContext))
}


function logSender(metricContext){
  logger.info(`logSender ${metricContext.testId}: ${JSON.stringify(metricContext)}`)
}

function logSuccess(startTime) {
  return (result) => logger.info(`logSuccess result: ${JSON.stringify(result)}`)
}

function logError(startTime) {
  return (error) => logger.error(`FAILURE: ${error}`)
}


/**
 * A pass-through sender that returns the metricContext unchanged.
 * Use this when you want to collect all results after execute() completes —
 * the array of returned contexts is available in the onSuccess callback via Promise.all.
 * @param {object} metricContext
 * @returns metricContext
 */
function resultCollectorSender(metricContext) {
    logger.debug(`resultCollectorSender ${metricContext.testId}: result collected`)
    return metricContext;
}


/**
 * Factory for an onSuccess handler that batches all check results into a single
 * JSON message sent to the given Azure Storage Queue.
 * Designed to be used as the onSuccess callback in execute().
 * Each result entry contains: testId, appName, apiName, type, apiMetrics, certMetrics.
 * @param {QueueClient} requestQueueClient Azure Storage Queue client for the request queue
 * @param {QueueClient} responseQueueClient Azure Storage Queue client for the response queue
 * @param {string} messageId The message ID from the request queue message
 * @param {string} popReceipt The pop receipt from the request queue message
 * @param {string} alarmId The alarm ID to include in the response
 * @returns {function} (startTime) => async (results) => void
 */
function queueOnSuccess(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId) {
    return function(startTime) {
        return async function(results) {
            const payload = (results || [])
                .filter(r => r != null)
                .map(r => ({
                    testId: r.testId,
                    appName: r.monitoringConfiguration.appName,
                    apiName: r.monitoringConfiguration.apiName,
                    type: r.monitoringConfiguration.type,
                    apiMetrics: r.apiMetrics,
                    certMetrics: r.certMetrics
                }));
            let testResults = {
              alarmId: alarmId,
              tests: payload,
              success: true
            }
            await responseQueueClient.sendMessage(JSON.stringify(testResults)).then(requestQueueClient.deleteMessage(messageId, popReceipt));
            logger.info(`SUCCESS queueResultsSender: sent ${payload.length} results to response queue`);
        }
    }
}


/**
 * Factory for an onError handler that sends an error response message to the
 * Azure Storage Queue when checks fail.
 * Designed to be used as the onError callback in execute().
 * Sends an empty tests array and success: false in the response.
 * @param {QueueClient} requestQueueClient Azure Storage Queue client for the request queue
 * @param {QueueClient} responseQueueClient Azure Storage Queue client for the response queue
 * @param {string} messageId The message ID from the request queue message
 * @param {string} popReceipt The pop receipt from the request queue message
 * @param {string} alarmId The alarm ID to include in the response
 * @returns {function} (startTime) => async (error) => void
 */
function queueOnError(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId) {
  return function(startTime) {
    return async function(error) {

      let testResults = {
        alarmId: alarmId,
        tests: [],
        success: false
      }
      await responseQueueClient.sendMessage(JSON.stringify(testResults)).then(requestQueueClient.deleteMessage(messageId, popReceipt));
      logger.error(`FAILURE queueOnError: ${error}. sent error results to response queue`);
    }
  }
}

/**
 * Factory for an onSuccess handler that tracks a successful test execution.
 * Sends a self-availability event to Application Insights and logs the success.
 * @param {number} startTime The timestamp when the test started
 * @returns {function} (result) => void A function that accepts the test result
 */
function cronOnSuccess(startTime){
  return (result) => {
    utils.trackSelfAvailabilityEvent(successMonitoringEvent, startTime, telemetryClient, "ok");
    logger.info("SUCCESS")
  }
}

/**
 * Factory for an onError handler that tracks a failed test execution.
 * Sends a failed availability event to Application Insights and logs the error details.
 * @param {number} startTime The timestamp when the test started
 * @returns {function} (error) => void A function that accepts the error information
 */
function cronOnError(startTime){
  return (error) => {
    utils.trackSelfAvailabilityEvent(failedMonitoringEvent, startTime, telemetryClient, error);
    logger.error(`FAILURE: ${error}`)
  }
}





