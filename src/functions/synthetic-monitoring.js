let appInsights = require("applicationinsights");
const axios = require('axios');
const sslCertificate = require('get-ssl-certificate')
appInsights.setup().start();

let client = new appInsights.TelemetryClient();

const keysForTelemetry = ['success', 'message', 'duration', 'runLocation'];
const keysForEvent = ['duration', 'targetStatus', 'targetExpirationTimestamp', 'httpStatus', 'targetTlsVersion', 'targetExpireInDays'] ;
const keysForEventProperties = ['domain', 'checkCert'] ;
const TLS_VERSION_KEY = "TLS_VERSION"
const START_TIMESTAMP_KEY = "x-request-timestamp"
const RESPONSE_TIME_KEY = "RESPONSE_TIME"

axios.interceptors.response.use(function (response) {
    //adding tls version to response
    response[TLS_VERSION_KEY] = response.request.res.socket.getProtocol()
    response[RESPONSE_TIME_KEY] = Date.now() - response.config.headers[START_TIMESTAMP_KEY]
    return response;
  }, function (error) {
    //nothing to do
    return Promise.reject(error);
  });

axios.interceptors.request.use(
    (config) => {
      config.headers[START_TIMESTAMP_KEY] = Date.now();
      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

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
    let tests = []
    for(idx in monitoringConfiguration){
        tests.push(testIt(monitoringConfiguration[idx], context).catch((error) => {
            context.error(`error in test for ${monitoringConfiguration[idx]}: ${JSON.stringify(error)}`)
        }));
    }

    await Promise.all(tests)
    context.log('Monitoring run completed');
};


async function testIt(monitoringConfiguration, context){
    context.log(`preparing test of ${JSON.stringify(monitoringConfiguration)}`)

    let metricObjects =  initMetricObjects(monitoringConfiguration);

    let metricContex = {
        baseTelemetryData : metricObjects.telemetry,
        baseEventData : metricObjects.event,
        monitoringConfiguration: monitoringConfiguration,
        apiMetrics: null,
        certMetrics: null
    }

    return checkApi(metricContex, context)
    .then(certChecker(context))
    .then(telemetrySender(client, context))
    .then(eventSender(client, context))

}



function eventSender(client, context){
    return async function(metricContext){
        context.log(`sending event for ${metricContext.monitoringConfiguration.method} ${metricContext.monitoringConfiguration.url}`)
        let enrichedMeasurements = enrichData(metricContext.baseEventData.measurements, metricContext.apiMetrics, keysForEvent)
        let enrichedProperties = enrichData(metricContext.baseEventData.properties, metricContext.apiMetrics, keysForEventProperties)
        if (metricContext.certMetrics){
            enrichedMeasurements = enrichData(enrichedMeasurements, metricContext.certMetrics, keysForEvent)
            enrichedProperties = enrichData(enrichedProperties, metricContext.certMetrics, keysForEventProperties)
        }
        metricContext.baseEventData['measurements'] = enrichedMeasurements
        metricContext.baseEventData['properties'] = enrichedProperties

        context.log(`event for ${metricContext.monitoringConfiguration.method} ${metricContext.monitoringConfiguration.url}: ${JSON.stringify(metricContext.baseEventData)}`)
        client.trackEvent(metricContext.baseEventData);

        return metricContext;
    }
}


function enrichData(baseData, checkResult, keyList){
    let newData = {...baseData} //create a clone
    //merge monitoring results
    for (const [key, value] of Object.entries(checkResult)) {
        if(keyList.includes(key)){
            newData[key] = value;
        }
    }
    return newData;
}


function telemetrySender(client, context){
    return async function(metricContext){
        //merge monitoring results and send
        context.log(`sending telemetry for ${metricContext.monitoringConfiguration.method} ${metricContext.monitoringConfiguration.url}`)
        if (metricContext.apiMetrics){
            let apiTelemetryData = enrichData(metricContext.baseTelemetryData, metricContext.apiMetrics, keysForTelemetry);
            context.log(`tracking api telemetry for ${metricContext.monitoringConfiguration.method} ${metricContext.monitoringConfiguration.url} : ${JSON.stringify(apiTelemetryData)}`)
            client.trackAvailability(apiTelemetryData);
        }
        
        if (metricContext.certMetrics){
            let certTelemetryData = enrichData(metricContext.baseTelemetryData, metricContext.certMetrics, keysForTelemetry);
            context.log(`tracking cert telemetry for ${metricContext.monitoringConfiguration.method} ${metricContext.monitoringConfiguration.url}: ${JSON.stringify(certTelemetryData)}`)
            client.trackAvailability(certTelemetryData);
        }

        return metricContext
    }
}



function certChecker(context){
    return async function checkCert(metricContext){
        context.log(`checking certificate of ${metricContext.monitoringConfiguration.method} ${metricContext.monitoringConfiguration.url}? ${metricContext.monitoringConfiguration.checkCertificate}`)
        if (metricContext.monitoringConfiguration.checkCertificate){
            let url = new URL(metricContext.monitoringConfiguration.url)
            metricContext.certMetrics = {
                domain: url.host,
                checkCert: true
            }
    
            return sslCertificate.get(url.host)
                .then(certResponseElaborator(metricContext, context))
                .catch(certErrorElaborator(metricContext, context))
        } else {
            return metricContext
        }
    }
}


function toPromise(myObject){
    return new Promise((resolve, reject) => {
        resolve(myObject);
      })
}

function certResponseElaborator(metricContext, context){
    return async function(certResponse){
        context.log(`cert response of ${metricContext.monitoringConfiguration.method} ${metricContext.monitoringConfiguration.url} valid to ${certResponse.valid_to}`)
        let validTo = new Date(certResponse.valid_to);
        const millisToExpiration = validTo - Date.now();
        metricContext.certMetrics['success'] = millisToExpiration > 604800000; //7 days in millis
        metricContext.certMetrics['targetExpireInDays'] = Math.floor(millisToExpiration / 86400000); //convert in days
        metricContext.certMetrics['targetExpirationTimestamp'] = validTo.getTime();
        metricContext.certMetrics['runLocation'] = `${metricContext.monitoringConfiguration.type}-cert`

        return metricContext
    }
}

function certErrorElaborator(metricContext, context){
    return async function(error){
        context.log(`cert error of ${metricContext.monitoringConfiguration.method} ${metricContext.monitoringConfiguration.url}: ${JSON.stringify(error)}`)
        metricContext.certMetrics['message'] = error.message
        metricContext.certMetrics['runLocation'] = `${metricContext.monitoringConfiguration.type}-cert`
        metricContext.certMetrics['success'] = false

        return metricContext
    }
}

function apiResponseElaborator(metricContext, context){
    return async function(response){
        context.log(`api response for ${metricContext.monitoringConfiguration.method} ${metricContext.monitoringConfiguration.url}: ${response.status}`)
        let apiMetrics = {}

        let statusCodeOk = isStatusCodeAccepted(response.status, metricContext.monitoringConfiguration.expectedCodes)

        apiMetrics['duration'] = response[RESPONSE_TIME_KEY];
        apiMetrics['success'] = statusCodeOk;
        apiMetrics['message'] = `${response.statusText}`
        apiMetrics['httpStatus'] = response.status
        apiMetrics['targetStatus'] = statusCodeOk ? 1 : 0
        apiMetrics['targetTlsVersion'] = Number(extractTlsVersion(response[TLS_VERSION_KEY]));

        metricContext.apiMetrics = apiMetrics

        return metricContext
    }
}

function apiErrorElaborator(metricContext, context){
    return async function(error){
        context.log(`api error of ${metricContext.monitoringConfiguration.method} ${metricContext.monitoringConfiguration.url}: ${JSON.stringify(error)}`)
        let elapsedMillis = Date.now() - metricContext['startTime'];
        
        let apiMetrics = {}
        apiMetrics['message'] = error.message
        apiMetrics['duration'] = elapsedMillis;
        apiMetrics['success'] = false;
        apiMetrics['targetStatus'] = 0
        metricContext.apiMetrics = apiMetrics
        return metricContext
    }
}

async function checkApi(metricContext, context){
    metricContext['startTime'] = Date.now();
    context.log(`check api of ${metricContext.monitoringConfiguration.method} ${metricContext.monitoringConfiguration.url}`)
    return axios(buildRequest(metricContext.monitoringConfiguration))
        .then(apiResponseElaborator(metricContext, context))
        .catch(apiErrorElaborator(metricContext, context))
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
