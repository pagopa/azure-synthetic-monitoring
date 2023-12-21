let appInsights = require("applicationinsights");
const axios = require('axios');
const sslCertificate = require('get-ssl-certificate')
appInsights.setup().start();

let client = new appInsights.TelemetryClient();

const monitoringConfiguration = [
    {
        "apiName" : "aks_ingress",
        "appName": "microservice",
        "url": "https://dev01.blueprint.internal.devopslab.pagopa.it/blueprint/v5-java-helm-complete-test/",
        "type": "private",
        "method": "GET",
        "expectedCodes": ["200-299", "303"],
        "tags": {
            "description": "AKS ingress tested from internal network"
        },
    },
    {
        "apiName" : "aks_ingress",
        "appName": "microservice",
        "url": "https://dev01.blueprint.internal.devopslab.pagopa.it/blueprint/v5-java-helm-complete-test/",
        "type": "certificate",
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
        "apiName" : "post",
        "appName": "httpbin",
        "url": "https://httpbin.org/get",
        "type": "private",
        "method": "GET",
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
    }
]

module.exports = async function (context, myTimer) {
    for(idx in monitoringConfiguration){
        await testIt(monitoringConfiguration[idx], context);
    }

    context.log('Monitoring run completed');
};


async function testIt(monitoringConfiguration, context){

    let testId = `${monitoringConfiguration.appName}-${monitoringConfiguration.apiName}`

    context.log(`preparing test of ${JSON.stringify(monitoringConfiguration)}`)

    let properties = {}
    properties['appName'] = monitoringConfiguration.appName
    properties['apiName'] = monitoringConfiguration.apiName
    properties['endpoint'] = `${monitoringConfiguration.method} ${monitoringConfiguration.url}`

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

    
    let result = {};
    if (monitoringConfiguration.type == "certificate"){
        result = await checkCert(monitoringConfiguration, context);
    }else{
        result = await checkApi(monitoringConfiguration, context);
    }

    //merge monitoring results
    for (const [key, value] of Object.entries(result)) {
        telemetryData[key] = value;
    }

    
    context.log(`test ${testId}_${monitoringConfiguration.type}, telemetry: ${JSON.stringify(telemetryData)}`)
    client.trackAvailability(telemetryData);
}

async function checkCert(monitoringConfiguration, context){
    let telemetryData = {}
    let elapsedMillis = 0;
    const start = Date.now();
    try{
        let certResponse = await sslCertificate.get(monitoringConfiguration.url.replace(/(^\w+:|^)\/\//, '')); //strip schema
        elapsedMillis = Date.now() - start;
        let validTo = new Date(certResponse.valid_to);
        const millisToExpiration = validTo-start;
        telemetryData['success'] = millisToExpiration > 604800000; //7 days in millis
    }catch (error){
        elapsedMillis = Date.now() - start;
        context.log(`error: ${JSON.stringify(error)}`);
        telemetryData['message'] = error.message
    }
    telemetryData['duration'] = elapsedMillis;
        
    return telemetryData;
}


async function checkApi(monitoringConfiguration, context){
    let telemetryData = {}
    let elapsedMillis = 0;
    const start = Date.now();
    try{
        let response = await axios( buildRequest(monitoringConfiguration));
        elapsedMillis = Date.now() - start;

        context.log(`response: ${response.status}`);
        telemetryData['success'] = isStatusCodeAccepted(response.status, monitoringConfiguration.expectedCodes);
        telemetryData['message'] = `${response.statusText}`

    }catch (error){
        elapsedMillis = Date.now() - start;
        context.log(`error: ${JSON.stringify(error)}`);
        telemetryData['message'] = error.message
    }
    telemetryData['duration'] = elapsedMillis;

    return telemetryData
}

function buildRequest(monitoringConfiguration){
    let request = {
            method: monitoringConfiguration.method.toLowerCase(),
            url: monitoringConfiguration.url
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
