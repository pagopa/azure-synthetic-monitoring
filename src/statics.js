const statusCodeRangeSeparator = "-"
const constants = require('./const')
const comparator = require('./comparator')
const tls = require('tls')


module.exports = {
    isNull,
    enrichData,
    readCert,
    readCertError,
    apiResponseElaborator,
    apiErrorElaborator,
    extractTlsVersion,
    buildRequest,
    initMetricObjects,
    isStatusCodeAccepted,
    getCert
}

/**
 * checks if the given data is null or is the string "null"
 * @param {*} data
 * @returns boolean
 */
function isNull(data){
    return data == null || data == "null" || data == undefined || data == ""
}

/**
 * adds the keys defined in keyList found in checkResult to the baseData object
 *
 * @param {object} baseData
 * @param {object} checkResult
 * @param {list(string)} keyList
 * @returns a copy of base data, enriched
 */
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




/**
 * parses the certificate response and populates the related metrics in the metric context
 * @param {metricContext} metricContext
 * @param {certResponse} certResponse
 * @returns receives the certResponse and returns the enriched metric context
 */
function readCert(metricContext, certResponse){
        if (certResponse != null) {
            const millisBeforeExpiration = metricContext.monitoringConfiguration.certValidityRangeDays * 24 * 60 * 60 * 1000
            console.log(`cert response for ${metricContext.testId}: valid to ${certResponse.valid_to}`)
            let validTo = new Date(certResponse.valid_to);
            const millisToExpiration = validTo - Date.now();
            metricContext.certMetrics['success'] = millisToExpiration > millisBeforeExpiration;
            metricContext.certMetrics['certSuccess'] = millisToExpiration > millisBeforeExpiration ? 1 : 0
            metricContext.certMetrics['targetExpireInDays'] = Math.floor(millisToExpiration / 86400000); //convert in days
            metricContext.certMetrics['targetExpirationTimestamp'] = validTo.getTime();
            metricContext.certMetrics['runLocation'] = `${metricContext.monitoringConfiguration.type}-cert`
            return metricContext
        } else {
            console.log(`unable to check certificate for ${metricContext.testId}. cert is null`)
            return readCertError(metricContext, {message: 'server cert is null'})
        }
        
    }


/**
 * parses the error received from the certificate request and populates the related metric
 * @param {metricContext} metricContext
 * @param {error} error
 * @returns an async function that receives an error and returns the enriched metric context
 */
function readCertError(metricContext, error){
        console.log(`cert error for ${metricContext.testId}: ${JSON.stringify(error)}`)
        metricContext.certMetrics['message'] = error.message
        metricContext.certMetrics['runLocation'] = `${metricContext.monitoringConfiguration.type}-cert`
        metricContext.certMetrics['success'] = false

        return metricContext
}

/**
 * parses the api response and populates the related metric in the metric context
 * @param {metric context} metricContext
 * @returns an async function that receives a response and returns the enriched metric context
 */
function apiResponseElaborator(metricContext){
    return async function(response){
        console.log(`api response for ${metricContext.testId}: ${response.status}`)

        if (metricContext.monitoringConfiguration.checkCertificate == 'true'){
            let serverCert = await getCert(metricContext, response, tls);
            console.log(`checking cert for ${metricContext.testId}: ${JSON.stringify(serverCert)}`)

            if(serverCert) {
                metricContext = readCert(metricContext, serverCert)
            } else {
                metricContext = readCertError(metricContext, {message: error}) 
                
            }
        }
        let statusCodeOk = isStatusCodeAccepted(response.status, metricContext.monitoringConfiguration.expectedCodes)
        console.log(`status code accepted for ${metricContext.testId}? ${statusCodeOk}`)
        let errorMessage = ""

        let duration = response[constants.RESPONSE_TIME_KEY];
        let durationOk = duration <= metricContext.monitoringConfiguration.durationLimit

        let bodyMatches = true
        const bodyCompareStrategy = metricContext.monitoringConfiguration.bodyCompareStrategy
        if (!isNull(bodyCompareStrategy)){
            const expectedBody = metricContext.monitoringConfiguration.expectedBody
            console.log(`comparing body for ${metricContext.testId}. Received body: ${response.data}`)
            bodyMatches =  comparator.compare(bodyCompareStrategy, response.data, expectedBody)
        }

        if(!statusCodeOk){
            errorMessage = errorMessage + `status code ${response.status} not valid: ${response.statusText} `
        }
        if(!durationOk) {
            errorMessage = errorMessage + `time limit exceeded: ${duration} > ${metricContext.monitoringConfiguration.durationLimit} `
        }
        if(!bodyMatches){
            errorMessage = errorMessage + `body check failed`
        }
        const success = statusCodeOk && durationOk && bodyMatches

        let apiMetrics = {
          duration,
          success,
          message : success ? `${response.statusText}` : errorMessage,
          httpStatus : response.status,
          targetStatus : statusCodeOk ? 1 : 0,
          targetTlsVersion : extractTlsVersion(response[constants.TLS_VERSION_KEY])
        }
        metricContext.apiMetrics = apiMetrics
        metricContext.apiResponse = response

        return metricContext
    }
}


async function getCert(metricContext, response, tlsClient){
    let serverCert = response.request.res.socket.getPeerCertificate(false);
    console.log(`cert from response for ${metricContext.testId}: ${JSON.stringify(serverCert)}`)
    if (serverCert) {
        return serverCert
    } else {
        console.log(`server cert is null for ${metricContext.testId}, checking with tls...`)
        try{
            serverCert = await getCertWithTls(metricContext, tlsClient)
        } catch(error) {
            console.log(`failed to load server cert for ${metricContext.testId}`)
            serverCert = null
        }
        return serverCert
    }
}

async function getCertWithTls(metricContext, tlsClient){ 
    return new Promise(function (resolve, reject){
        let parsedUrl = new URL(metricContext.monitoringConfiguration.url)
        const options = {
            host: parsedUrl.host,
            port: parsedUrl.port || parsedUrl.protocol.includes('https') ? 443 : 80,
            servername: metricContext.monitoringConfiguration.headers["Host"] || parsedUrl.hostname,
            rejectUnauthorized: true
        };
        const socket = tlsClient.connect(options, () => {
            const cert = socket.getPeerCertificate();
            console.log(`got cert using tls for ${metricContext.testId}: ${JSON.stringify(cert)}`)
            resolve({cert: cert, socket: socket});
        });
        socket.on('error', (err) => {
            console.log(`socket error for ${metricContext.testId}: ${JSON.stringify(err)}`);
            socket.end();
        });
    }).then((result => {
        result.socket.end();
        return result.cert;
    }))
}

/**
 * parses the error received from the api request and populates the related metric
 * @param {metricContext} metricContext
 * @returns an async function that receives an error and returns the enriched metric context
 */
function apiErrorElaborator(metricContext){
    return async function(error){
        console.log(`api error for ${metricContext.testId}: ${JSON.stringify(error.message)}`)
        let elapsedMillis = Date.now() - metricContext['startTime'];

        if (metricContext.monitoringConfiguration.checkCertificate == 'true'){
            console.log(`cert error for${metricContext.testId}`)
            metricContext = readCertError(metricContext, error)
        }

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


/**
 * parses a string containing the tls version and returns the version as a number
 * @param {string} versionString
 * @returns the number representing the tls version
 */
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

/**
 * creates the http request based on the given monitoring configuration
 * built for axios client
 * @param {monitoringConfiguration} monitoringConfiguration
 * @returns http request configuration
 */
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

/**
 * creates the basic metric objects used to track availability and events in app insight
 * @param {monitoringConfiguration} monitoringConfiguration
 * @returns object containing 'telemetry' and 'event' base data
 */
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

/**
 * check ifthe given status code is present in the list of acceptedCodes (single or range)
 * @param {*} statusCode to check
 * @param {list(string)} acceptedCodes list of codes, can also include ranges defined as "min-max" eg: "200-205"
 * @returns boolean
 */
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
