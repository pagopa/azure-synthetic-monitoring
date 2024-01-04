let appInsights = require("applicationinsights");
const axios = require('axios');
const sslCertificate = require('get-ssl-certificate')
const tls = require('tls');
appInsights.setup().start();

let client = new appInsights.TelemetryClient();

const keysForTelemetry = ['success', 'message', 'duration', 'runLocation'];
const keysForEvent = ['duration', 'targetStatus', 'targetExpirationTimestamp', 'httpStatus', 'targetTlsVersion', 'targetExpireInDays'] ;
const keysForEventProperties = ['domain', 'checkCert'] ;


axios.interceptors.response.use(function (response) {
    //adding tsl version to response
    response['TSL_VERSION'] = response.request.res.socket.getProtocol()
    return response;
  }, function (error) {
    //nothing to do
    return Promise.reject(error);
  });

const monitoringConfiguration = [
    {
        "apiName" : "aks_ingress",
        "appName": "microservice",
        "url": "https://dev01.blueprint.internal.devopslab.pagopa.it/blueprint/v5-java-helm-complete-test/",
        "type": "private",
        "checkCertificate": true,
        "method": "GET",
        "expectedCodes": ["200-299", "303"],
        "tags": {
            "description": "AKS ingress tested from internal network"
        },
    },
    {
        "apiName" : "pagoPA_public_api",
        "appName": "pagoPA",
        "url": "https://api.dev.platform.pagopa.it",
        "type": "public",
        "checkCertificate": true,
        "method": "GET",
        "expectedCodes": ["200"],
        "tags": {
            "description": "pagopa public api tested from internet network"
        }

    },
    {
        "apiName" : "post",
        "appName": "httpbin",
        "url": "https://httpbin.org/post",
        "type": "public",
        "method": "POST",
        "checkCertificate": true,
        "expectedCodes": ["200"],
        "headers": {
            "Content-Type": "application/json"
        },
        "body": {
            "name": "value"
        },
        "tags": {
            "description": "sample post request"
        }
    },
    {
        "apiName" : "get",
        "appName": "httpbin",
        "url": "https://httpbin.org/get",
        "type": "private",
        "checkCertificate": true,
        "method": "GET",
        "expectedCodes": ["200"],
        "tags": {
            "description": "sample post request"
        }
    }
]




module.exports = async function (context, myTimer) {
    for(idx in monitoringConfiguration){
        await testIt(monitoringConfiguration[idx], context);
    }
    context.log('Monitoring run completed');
};


async function testIt(monitoringConfiguration, context){
    context.log(`preparing test of ${JSON.stringify(monitoringConfiguration)}`)

    let metricObjects =  initMetricObjects(monitoringConfiguration);

    let telemetryData = metricObjects.telemetry;
    let eventData = metricObjects.event;

    let result = await checkApi(monitoringConfiguration, context);
    eventData = enrichEvent(eventData, result)

    sendTelemetry(client, telemetryData, result, context);

    if (monitoringConfiguration.checkCertificate){
        context.log(`checking certificate...`)
        let certResult = await checkCert(monitoringConfiguration, context);
        eventData = enrichEvent(eventData, certResult);
        sendTelemetry(client, telemetryData, certResult, context);
    }

    sendEvent(client, eventData, context);

}

function enrichEvent(baseEvent, checkResult){
    let enrichedMeasurements = enrichData(baseEvent.measurements, checkResult, keysForEvent)
    baseEvent['measurements'] = enrichedMeasurements
    let enrichedProperties = enrichData(baseEvent.properties, checkResult, keysForEventProperties)
    baseEvent['properties'] = enrichedProperties
    return baseEvent;
}




function enrichData(baseData, checkResult, keyList){
    //merge monitoring results
    for (const [key, value] of Object.entries(checkResult)) {
        if(keyList.includes(key)){
            baseData[key] = value;
        }
    }
    return baseData;
}

function sendEvent(client, event, context){
    context.log(`tracking event: ${JSON.stringify(event)}`)
    client.trackEvent(event);
}

function sendTelemetry(client, baseData, checkResult, context){
    //merge monitoring results
    baseData = enrichData(baseData, checkResult, keysForTelemetry);
    context.log(`tracking telemetry: ${JSON.stringify(baseData)}`)
    client.trackAvailability(baseData);
}


function initMetricObjects(monitoringConfiguration){
    let testId = `${monitoringConfiguration.appName}-${monitoringConfiguration.apiName}`

    let properties = {}
    properties['appName'] = monitoringConfiguration.appName
    properties['apiName'] = monitoringConfiguration.apiName
    properties['endpoint'] = `${monitoringConfiguration.method} ${monitoringConfiguration.url}`

    let measurements = {}

    for (const [key, value] of Object.entries(monitoringConfiguration.tags)) {
      properties[key] = value;
    }

    let telemetryData =  {
        id: `synthetic_${testId}`,
        message: "",
        success : false,
        name: `synthetic_${testId}`,
        runLocation: monitoringConfiguration.type,
        properties: properties
    };

    let eventData = {
        name: `synthetic_${testId}_${monitoringConfiguration.type}`,
        measurements: measurements,
        properties: properties

     }

    return {
        'telemetry': telemetryData,
        'event': eventData
    };
}


async function checkCert(monitoringConfiguration, context){
    let telemetryData = {}
    let elapsedMillis = 0;
    const start = Date.now();
    try{
        let url = new URL(monitoringConfiguration.url)
        telemetryData['domain'] = url.host
        telemetryData['checkCert'] = true
        let certResponse = await sslCertificate.get(url.host);
        elapsedMillis = Date.now() - start;
        let validTo = new Date(certResponse.valid_to);
        const millisToExpiration = validTo - start;
        telemetryData['success'] = millisToExpiration > 604800000; //7 days in millis
        telemetryData['targetExpireInDays'] = Math.floor(millisToExpiration / 86400000); //convert in days
        telemetryData['targetExpirationTimestamp'] = validTo.getTime();
    }catch (error){
        elapsedMillis = Date.now() - start;
        context.log(`error: ${JSON.stringify(error)}`);
        telemetryData['message'] = error.message
    }
    telemetryData['duration'] = elapsedMillis;
    telemetryData['runLocation'] = `${monitoringConfiguration.type}-cert`

    return telemetryData;
}


async function checkApi(monitoringConfiguration, context){
    let telemetryData = {}
    telemetryData['targetStatus'] = 0
    let elapsedMillis = 0;
    const start = Date.now();
    try{
        let response = await axios( buildRequest(monitoringConfiguration));
        elapsedMillis = Date.now() - start;

        context.log(`response: ${response.status}`);

        telemetryData['success'] = isStatusCodeAccepted(response.status, monitoringConfiguration.expectedCodes);
        telemetryData['message'] = `${response.statusText}`
        telemetryData['httpStatus'] = response.status
        telemetryData['targetStatus'] = isStatusCodeAccepted(response.status, monitoringConfiguration.expectedCodes) ? 1 : 0
        telemetryData['targetTlsVersion'] = Number(extractTlsVersion(response['TSL_VERSION']));
    }catch (error){
        elapsedMillis = Date.now() - start;
        context.log(`error: ${JSON.stringify(error)}`);
        telemetryData['message'] = error.message
    }
    telemetryData['duration'] = elapsedMillis;

    return telemetryData
}

function extractTlsVersion(versionString){
    // Utilizza una espressione regolare per estrarre la parte numerica
    const numericPart = versionString.match(/\d+(\.\d+)?/);

    // Verifica se è stata trovata una corrispondenza e ottieni il valore
    return numericPart ? numericPart[0] : null;
}

function buildRequest(monitoringConfiguration){
    let request = {
            method: monitoringConfiguration.method.toLowerCase(),
            url: monitoringConfiguration.url,
            validateStatus: function (status) {
                return true; //every status code should be treated as a valid code (it will be checked later)
            }
    }

    if (monitoringConfiguration.headers) {
        request['headers'] = monitoringConfiguration.headers
    }

    if (["post", "put", "delete", "patch"].includes(monitoringConfiguration.method.toLowerCase())){
        request['data']= monitoringConfiguration.body;
    }

    return request;
}


function isStatusCodeAccepted(statusCode, acceptedCodes){
    let accepted = false;
    acceptedCodes.forEach((codeRange) =>  {
        // is an actual range eg: 200-250
        if(codeRange.indexOf('-') > 0){
            let boundaries = codeRange.split('-');
            if (statusCode >= boundaries[0] && statusCode <= boundaries[1]){
                accepted = true
            }
        }else{//is a specific code eg: 303
            if (statusCode == codeRange){
                accepted = true
            }
        }
    })

    return accepted;
}
