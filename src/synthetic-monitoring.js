let appInsights = require("applicationinsights");
const axios = require('axios');
const sslCertificate = require('get-ssl-certificate')
appInsights.setup(process.env.APP_INSIGHT_CONNECTION_STRING).start();

let client = new appInsights.TelemetryClient(process.env.APP_INSIGHT_CONNECTION_STRING);

const keysForTelemetry = ['success', 'message', 'duration', 'runLocation'];
const keysForEvent = ['duration', 'targetStatus', 'targetExpirationTimestamp', 'httpStatus', 'targetTlsVersion', 'targetExpireInDays'] ;
const keysForEventProperties = ['domain', 'checkCert'] ;
const TLS_VERSION_KEY = "TLS_VERSION"
const START_TIMESTAMP_KEY = "x-request-timestamp"
const RESPONSE_TIME_KEY = "RESPONSE_TIME"

//prepare axios interceptors
axios.interceptors.response.use(function (response) {
    //adding tls version to response
    response[TLS_VERSION_KEY] = response.request.res.socket.getProtocol()
    response[RESPONSE_TIME_KEY] = Date.now() - response.config.headers[START_TIMESTAMP_KEY]
    return response;
  }, function (error) {
    console.error(error)
    //nothing to do
    return Promise.reject(error);
  });

axios.interceptors.request.use(
    (config) => {
      config.headers[START_TIMESTAMP_KEY] = Date.now();
      return config;
    },
    (error) => {
      console.error(error)
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
    },
    {
        "apiName" : "verifyPaymentNotice",
        "appName": "pagoPA",
        "url": "https://api.uat.platform.pagopa.it/nodo/node-for-psp/v1",
        "type": "public",
        "checkCertificate": false,
        "method": "POST",
        "expectedCodes": ["200"],
        "headers" : {
            "SOAPAction": "verifyPaymentNotice",
            "Content-Type": "application/xml",
            "Ocp-Apim-Subscription-Key": "b44466604e7f428e930826e6e05556fd"
        },
        "body": "<soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:nod=\"http://pagopa-api.pagopa.gov.it/node/nodeForPsp.xsd\">    <soapenv:Header/>    <soapenv:Body>        <nod:verifyPaymentNoticeReq>            <idPSP>BCITITMM</idPSP>            <idBrokerPSP>00799960158</idBrokerPSP>            <idChannel>00799960158_12</idChannel>            <password>PLACEHOLDER</password>            <qrCode>                <fiscalCode>80005570561</fiscalCode>                <noticeNumber>301352423000009092</noticeNumber>            </qrCode>        </nod:verifyPaymentNoticeReq>    </soapenv:Body>  </soapenv:Envelope>",
        "tags": {
            "description": "sample post request"
        }
    }
]


async function main() {
    let tests = []
    for(idx in monitoringConfiguration){
        tests.push(testIt(monitoringConfiguration[idx]).catch((error) => {
            console.error(`error in test for ${JSON.stringify(monitoringConfiguration[idx])}: ${JSON.stringify(error)}`)
        }));
    }

    await Promise.all(tests)
    console.log('Monitoring run completed');
};


async function testIt(monitoringConfiguration){
    console.log(`preparing test for ${JSON.stringify(monitoringConfiguration)}`)

    let metricObjects =  initMetricObjects(monitoringConfiguration);

    let metricContex = {
        testId: `${monitoringConfiguration.appName}_${monitoringConfiguration.apiName}_${monitoringConfiguration.type}`,
        baseTelemetryData : metricObjects.telemetry,
        baseEventData : metricObjects.event,
        monitoringConfiguration: monitoringConfiguration,
        apiMetrics: null,
        certMetrics: null
    }

    return checkApi(metricContex)
    .then(certChecker())
    .then(telemetrySender(client))
    .then(eventSender(client))

}



function eventSender(client){
    return async function(metricContext){
        let enrichedMeasurements = enrichData(metricContext.baseEventData.measurements, metricContext.apiMetrics, keysForEvent)
        let enrichedProperties = enrichData(metricContext.baseEventData.properties, metricContext.apiMetrics, keysForEventProperties)
        if (metricContext.certMetrics){
            enrichedMeasurements = enrichData(enrichedMeasurements, metricContext.certMetrics, keysForEvent)
            enrichedProperties = enrichData(enrichedProperties, metricContext.certMetrics, keysForEventProperties)
        }
        metricContext.baseEventData['measurements'] = enrichedMeasurements
        metricContext.baseEventData['properties'] = enrichedProperties

        console.log(`event for ${metricContext.testId}: ${JSON.stringify(metricContext.baseEventData)}`)
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


function telemetrySender(client){
    return async function(metricContext){
        //merge monitoring results and send
        if (metricContext.apiMetrics){
            let apiTelemetryData = enrichData(metricContext.baseTelemetryData, metricContext.apiMetrics, keysForTelemetry);
            console.log(`tracking api telemetry for ${metricContext.testId} : ${JSON.stringify(apiTelemetryData)}`)
            client.trackAvailability(apiTelemetryData);
        }

        if (metricContext.certMetrics){
            let certTelemetryData = enrichData(metricContext.baseTelemetryData, metricContext.certMetrics, keysForTelemetry);
            console.log(`tracking cert telemetry for ${metricContext.testId}: ${JSON.stringify(certTelemetryData)}`)
            client.trackAvailability(certTelemetryData);
        }

        return metricContext
    }
}



function certChecker(){
    return async function checkCert(metricContext){
        console.log(`checking certificate for ${metricContext.testId}? ${metricContext.monitoringConfiguration.checkCertificate}`)
        let url = new URL(metricContext.monitoringConfiguration.url)

        metricContext.certMetrics = {
            domain: url.host,
            checkCert: metricContext.monitoringConfiguration.checkCertificate
        }

        if (metricContext.monitoringConfiguration.checkCertificate){
            return sslCertificate.get(url.host)
                .then(certResponseElaborator(metricContext))
                .catch(certErrorElaborator(metricContext))
        } else {
            return metricContext
        }
    }
}


function certResponseElaborator(metricContext){
    return async function(certResponse){
        console.log(`cert response for ${metricContext.testId}: valid to ${certResponse.valid_to}`)
        let validTo = new Date(certResponse.valid_to);
        const millisToExpiration = validTo - Date.now();
        metricContext.certMetrics['success'] = millisToExpiration > 604800000; //7 days in millis
        metricContext.certMetrics['certSuccess'] =
        metricContext.certMetrics['targetExpireInDays'] = Math.floor(millisToExpiration / 86400000); //convert in days
        metricContext.certMetrics['targetExpirationTimestamp'] = validTo.getTime();
        metricContext.certMetrics['runLocation'] = `${metricContext.monitoringConfiguration.type}-cert`

        return metricContext
    }
}

function certErrorElaborator(metricContext){
    return async function(error){
        console.log(`cert error for ${metricContext.testId}: ${JSON.stringify(error)}`)
        metricContext.certMetrics['message'] = error.message
        metricContext.certMetrics['runLocation'] = `${metricContext.monitoringConfiguration.type}-cert`
        metricContext.certMetrics['success'] = false

        return metricContext
    }
}

function apiResponseElaborator(metricContext){
    return async function(response){
        console.log(`api response for ${metricContext.testId}: ${response.status}`)
        let apiMetrics = {}

        let statusCodeOk = isStatusCodeAccepted(response.status, metricContext.monitoringConfiguration.expectedCodes)
        console.log(`status code accepted for ${metricContext.testId}? ${statusCodeOk}`)

        apiMetrics['duration'] = response[RESPONSE_TIME_KEY];
        apiMetrics['success'] = statusCodeOk;
        apiMetrics['message'] = `${response.statusText}`
        apiMetrics['httpStatus'] = response.status
        apiMetrics['targetStatus'] = statusCodeOk ? 1 : 0

        console.log(`partial api metrics for  ${metricContext.testId}? ${JSON.stringify(response[TLS_VERSION_KEY])}`)

        apiMetrics['targetTlsVersion'] = extractTlsVersion(response[TLS_VERSION_KEY]);

        console.log(`partial2 api metrics for  ${metricContext.testId}? ${JSON.stringify(apiMetrics)}`)

        metricContext.apiMetrics = apiMetrics

        return metricContext
    }
}

function apiErrorElaborator(metricContext){
    return async function(error){
        console.log(`api error for ${metricContext.testId}: ${JSON.stringify(error)}`)
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

async function checkApi(metricContext){
    metricContext['startTime'] = Date.now();
    console.log(`check api for ${metricContext.testId}`)
    return axios(buildRequest(metricContext.monitoringConfiguration))
        .then(apiResponseElaborator(metricContext))
        .catch(apiErrorElaborator(metricContext))
}


function extractTlsVersion(versionString){
    if (versionString != null){
        // Utilizza una espressione regolare per estrarre la parte numerica
        const numericPart = versionString.match(/\d+(\.\d+)?/);

        // Verifica se è stata trovata una corrispondenza e ottieni il valore
        return numericPart ? Number(numericPart[0]) : 0;
    } else {
        return 0
    }

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


main().then(result => console.log("END"));
