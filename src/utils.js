const constants = require('./const')
const statics = require('./statics')


module.exports = {
    trackSelfAvailabilityEvent,
    certChecker,
    eventSender,
    telemetrySender,
    checkApi
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

        console.log(`event for ${metricContext.testId}: ${JSON.stringify(metricContext.baseEventData)}`)
        client.trackEvent(metricContext.baseEventData);

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
            console.log(`tracking api telemetry for ${metricContext.testId} : ${JSON.stringify(apiTelemetryData)}`)
            client.trackAvailability(apiTelemetryData);
        }

        if (metricContext.certMetrics && Object.keys(metricContext.certMetrics).length > 0){
            let certTelemetryData = statics.enrichData(metricContext.baseTelemetryData, metricContext.certMetrics, constants.keysForTelemetry);
            console.log(`tracking cert telemetry for ${metricContext.testId}: ${JSON.stringify(certTelemetryData)}`)
            client.trackAvailability(certTelemetryData);
        }

        return metricContext
    }
}

/**
 * executes the ssl check required by the monitoring configuration
 * @param {*} sslClient 
 * @returns an async function that receives and returns the metric context
 */
function certChecker(sslClient){
    return async function checkCert(metricContext){
        console.log(`checking certificate for ${metricContext.testId}? ${metricContext.monitoringConfiguration.checkCertificate}`)
        let url = new URL(metricContext.monitoringConfiguration.url)

        metricContext.certMetrics = {
            domain: url.host,
            checkCert: metricContext.monitoringConfiguration.checkCertificate
        }

        if (metricContext.monitoringConfiguration.checkCertificate){
            return sslClient.get(url.host)
                .then(statics.certResponseElaborator(metricContext))
                .catch(statics.certErrorElaborator(metricContext))
        } else {
            return metricContext
        }
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
    console.log(`check api for ${metricContext.testId}`)
    return httpClient(statics.buildRequest(metricContext.monitoringConfiguration))
        .then(statics.apiResponseElaborator(metricContext))
        .catch(statics.apiErrorElaborator(metricContext))
}


