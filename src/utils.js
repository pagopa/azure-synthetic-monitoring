const constants = require('./const')
const statics = require('./statics')


module.exports = {
    trackSelfAvailabilityEvent,
    testIt
}

function trackSelfAvailabilityEvent(toTrack, startTime, telemetryClient, result){
    let event = {
        ...toTrack,
        duration : Date.now() - startTime,
        message: result
    }
    telemetryClient.trackAvailability(event)
}



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

    return checkApi(metricContex, httpClient)
    .then(certChecker(sslClient))
    .then(telemetrySender(telemetryClient))
    .then(eventSender(telemetryClient))

}

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



function telemetrySender(client){
    return async function(metricContext){
        //merge monitoring results and send
        if (metricContext.apiMetrics){
            let apiTelemetryData = statics.enrichData(metricContext.baseTelemetryData, metricContext.apiMetrics, constants.keysForTelemetry);
            console.log(`tracking api telemetry for ${metricContext.testId} : ${JSON.stringify(apiTelemetryData)}`)
            client.trackAvailability(apiTelemetryData);
        }

        if (metricContext.certMetrics){
            let certTelemetryData = statics.enrichData(metricContext.baseTelemetryData, metricContext.certMetrics, constants.keysForTelemetry);
            console.log(`tracking cert telemetry for ${metricContext.testId}: ${JSON.stringify(certTelemetryData)}`)
            client.trackAvailability(certTelemetryData);
        }

        return metricContext
    }
}

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


async function checkApi(metricContext, httpClient){
    metricContext['startTime'] = Date.now();
    console.log(`check api for ${metricContext.testId}`)
    return httpClient(statics.buildRequest(metricContext.monitoringConfiguration))
        .then(statics.apiResponseElaborator(metricContext))
        .catch(statics.apiErrorElaborator(metricContext))
}


