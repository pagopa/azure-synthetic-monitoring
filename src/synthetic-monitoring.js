let appInsights = require("applicationinsights");
const axios = require('axios');
const sslCertificate = require('get-ssl-certificate')
const { TableClient, AzureNamedKeyCredential } = require("@azure/data-tables");
appInsights.setup(process.env.APP_INSIGHT_CONNECTION_STRING).start();

const account = process.env.STORAGE_ACCOUNT_NAME;
const accountKey = process.env.STORAGE_ACCOUNT_KEY;
const tableName = process.env.STORAGE_ACCOUNT_TABLE_NAME
const availabilityPrefix = process.env.AVAILABILITY_PREFIX
const httpClientTimeout = process.env.HTTP_CLIENT_TIMEOUT
const location = process.env.LOCATION
const statusCodeRangeSeparator = "-"

const credential = new AzureNamedKeyCredential(account, accountKey);
const tableClient = new TableClient(`https://${account}.table.core.windows.net`, tableName, credential);

let client = new appInsights.TelemetryClient(process.env.APP_INSIGHT_CONNECTION_STRING);

const keysForTelemetry = ['success', 'message', 'duration', 'runLocation'];
const keysForEvent = ['duration', 'targetStatus', 'targetExpirationTimestamp', 'httpStatus', 'targetTlsVersion', 'targetExpireInDays'] ;
const keysForEventProperties = ['domain', 'checkCert'];
const TLS_VERSION_KEY = "TLS_VERSION"
const START_TIMESTAMP_KEY = "x-request-timestamp"
const RESPONSE_TIME_KEY = "RESPONSE_TIME"

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
    response[TLS_VERSION_KEY] = response.request.res.socket.getProtocol()
    response[RESPONSE_TIME_KEY] = Date.now() - response.config.headers[START_TIMESTAMP_KEY]
    return response;
  }, function (error) {
    console.error(`resp error interceptor: ${JSON.stringify(error)}`)
    //nothing to do
    return Promise.reject(error);
  });

axios.interceptors.request.use(
    (config) => {
      config.headers[START_TIMESTAMP_KEY] = Date.now();
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
                tags: !isNull(tableConfiguration['tags']) ? JSON.parse(tableConfiguration['tags']) : {},
                body: !isNull(tableConfiguration['body']) ? JSON.parse(tableConfiguration['body']) : null,
                headers: !isNull(tableConfiguration['headers'])? JSON.parse(tableConfiguration['headers']) : null,
                expectedCodes: !isNull(tableConfiguration['expectedCodes']) ? JSON.parse(tableConfiguration['expectedCodes']) : null,
                durationLimit: tableConfiguration.durationLimit
            }
            console.log(`monitoringConfiguration: ${JSON.stringify(monitoringConfiguration)}`)

            tests.push(testIt(monitoringConfiguration).catch((error) => {
                console.error(`error in test for ${JSON.stringify(monitoringConfiguration)}: ${JSON.stringify(error)}`)
            }));

        }catch (parseError){
            console.error(`error parsing test for ${JSON.stringify(tableConfiguration)}`)
            tests.push(new Promise((resolve, reject) => {
                reject(parseError.message)
              }));
        }
    }

    Promise.all(tests)
                 .then((result) => {console.log("SUCCESS"); trackSelfAvailabilityEvent(successMonitoringEvent);})
                 .catch((error) => {console.error("FAILURE"); trackSelfAvailabilityEvent(failedMonitoringEvent);})
};

function trackSelfAvailabilityEvent(toTrack, startTime){
    let event = {
        ...toTrack,
        duration : Date.now() - startTime
    }
    client.trackAvailability(event)

}

function isNull(data){
  return data == null || data == "null"
}

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
        let statusCodeOk = isStatusCodeAccepted(response.status, metricContext.monitoringConfiguration.expectedCodes)
        console.log(`status code accepted for ${metricContext.testId}? ${statusCodeOk}`)
        let duration = response[RESPONSE_TIME_KEY];
        let durationOk = duration <= metricContext.monitoringConfiguration.durationLimit
        let apiMetrics = {
          duration,
          success : statusCodeOk && durationOk,
          message : !statusCodeOk ? `status code not valid: ${response.statusText}` : (!durationOk ? `time limit exceeded: ${duration} > ${metricContext.monitoringConfiguration.durationLimit}` : `${response.statusText}`),
          httpStatus : response.status,
          targetStatus : statusCodeOk ? 1 : 0,
          targetTlsVersion : extractTlsVersion(response[TLS_VERSION_KEY])
        }
        metricContext.apiMetrics = apiMetrics

        return metricContext
    }
}

function apiErrorElaborator(metricContext){
    return async function(error){
        console.log(`api error for ${metricContext.testId}: ${JSON.stringify(error)}`)
        let elapsedMillis = Date.now() - metricContext['startTime'];

        let apiMetrics = {
          message:  error.message,
          duration:  elapsedMillis,
          success:  false,
          targetStatus:  0
        }
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
            },
            timeout: httpClientTimeout
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

    let properties = {
      appName:  monitoringConfiguration.appName,
      apiName:  monitoringConfiguration.apiName,
      endpoint:  `${monitoringConfiguration.method} ${monitoringConfiguration.url}`
    }

    let measurements = {}

    for (const [key, value] of Object.entries(monitoringConfiguration.tags)) {
      properties[key] = value;
    }

    let telemetryData =  {
        id: `${availabilityPrefix}-${testId}`,
        message: "",
        success : false,
        name: `${availabilityPrefix}-${testId}`,
        runLocation: monitoringConfiguration.type,
        properties
    };

    let eventData = {
        name: `${availabilityPrefix}-${testId}-${monitoringConfiguration.type}`,
        measurements,
        properties
     }

    return {
        'telemetry': telemetryData,
        'event': eventData
    };
}

function isStatusCodeAccepted(statusCode, acceptedCodes){
    let accepted = false;
    acceptedCodes.forEach((codeRange) =>  {
        if(codeRange.indexOf(statusCodeRangeSeparator) > 0){// is an actual range eg: 200-250
            let boundaries = codeRange.split(statusCodeRangeSeparator);
            let minStatusCode = boundaries[0]
            let maxStatusCode = boundaries[1]
            if (statusCode >= minStatusCode && statusCode <= maxStatusCode){
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


main()
