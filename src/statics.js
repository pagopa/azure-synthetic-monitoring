const statusCodeRangeSeparator = "-"
const constants = require('./const')


module.exports = {
    isNull,
    enrichData,
    certResponseElaborator,
    certErrorElaborator,
    apiResponseElaborator,
    apiErrorElaborator,
    extractTlsVersion,
    buildRequest,
    initMetricObjects,
    isStatusCodeAccepted
}


function isNull(data){
    return data == null || data == "null"
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



function certResponseElaborator(metricContext){
    return async function(certResponse){
        console.log(`cert response for ${metricContext.testId}: valid to ${certResponse.valid_to}`)
        let validTo = new Date(certResponse.valid_to);
        const millisToExpiration = validTo - Date.now();
        metricContext.certMetrics['success'] = millisToExpiration > 604800000; //7 days in millis
        metricContext.certMetrics['certSuccess'] = millisToExpiration > 604800000
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
        let duration = response[constants.RESPONSE_TIME_KEY];
        let durationOk = duration <= metricContext.monitoringConfiguration.durationLimit
        let apiMetrics = {
          duration,
          success : statusCodeOk && durationOk,
          message : !statusCodeOk ? `status code not valid: ${response.statusText}` : (!durationOk ? `time limit exceeded: ${duration} > ${metricContext.monitoringConfiguration.durationLimit}` : `${response.statusText}`),
          httpStatus : response.status,
          targetStatus : statusCodeOk ? 1 : 0,
          targetTlsVersion : extractTlsVersion(response[constants.TLS_VERSION_KEY])
        }
        metricContext.apiMetrics = apiMetrics

        return metricContext
    }
}

function apiErrorElaborator(metricContext){
    return async function(error){
        console.log(`api error for ${metricContext.testId}: ${JSON.stringify(error.message)}`)
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
            timeout: monitoringConfiguration.httpClientTimeout
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
        id: `${monitoringConfiguration.availabilityPrefix}-${testId}`,
        message: "",
        success : false,
        name: `${monitoringConfiguration.availabilityPrefix}-${testId}`,
        runLocation: monitoringConfiguration.type,
        properties
    };

    let eventData = {
        name: `${monitoringConfiguration.availabilityPrefix}-${testId}-${monitoringConfiguration.type}`,
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
            let [minStatusCode, maxStatusCode] = codeRange.split(statusCodeRangeSeparator);
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
