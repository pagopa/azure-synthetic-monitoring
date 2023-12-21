let appInsights = require("applicationinsights");
const axios = require('axios');
appInsights.setup().start();

let client = new appInsights.TelemetryClient();


const monitoringConfiguration = [
    {
        "testName" : "aks_ingress",
        "appName": "microservice_chart",
        "url": "https://dev01.blueprint.internal.devopslab.pagopa.it/blueprint/v5-java-helm-complete-test/",
        "type": "internal",
        "method": "GET",
        "expectedCodes": ["200-299", "303"]

    },
    {
        "testName" : "pagoPA_public_api",
        "appName": "pagopa_platform",
        "url": "https://api.dev.platform.pagopa.it",
        "type": "public",
        "method": "GET",
        "expectedCodes": ["200"]

    },
    {
        "testName" : "httpbin_public_api",
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

    let properties = {}
    properties['appName'] = monitoringConfiguration.appName

    let telemetryData =  {
        id: monitoringConfiguration.testName, 
        message: "",
        success : false, 
        name: `${monitoringConfiguration.testName}_${monitoringConfiguration.appName}_${monitoringConfiguration.type}`,
        runLocation: "northeurope", 
        properties: properties
    };

    let elapsedMillis = 0;
    const start = Date.now();
    try{
        let response = await axios( buildRequest(monitoringConfiguration));
        elapsedMillis = Date.now() - start;

        context.log(`test: ${monitoringConfiguration.testName}, response: ${response.status}`);
        context.log(`cert: ${response.request.res.socket.getPeerCertificate(false)}`);
        telemetryData['success'] = isStatusCodeAccepted(response.status, monitoringConfiguration.expectedCodes);
        telemetryData['message'] = `${response.statusText}`

    }catch (error){
        elapsedMillis = Date.now() - start;
        context.log(`test: ${monitoringConfiguration.testName}, error: ${JSON.stringify(error)}`);
        telemetryData['message'] = error.message
    }
    
    telemetryData['duration'] = elapsedMillis;

    context.log(`test ${monitoringConfiguration.testName}, telemetry: ${JSON.stringify(telemetryData)}`)

    client.trackAvailability(telemetryData);
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