const utils = require('../src/utils')


let dummyTelemetryClient = {
    trackAvailability : function(event){},
    trackEvent : function(event){}
}

let dummySslClient = {
    get : jest.fn()
}

let dummyHttpClient = jest.fn()

function datePlusDays(numDays){
    let date = new Date();
    date.setDate(date.getDate() + numDays);
    return date;
}

let dummyMetricContex = {}
let sslClientGet = jest.spyOn(dummySslClient, 'get')
let trackAvailability = jest.spyOn(dummyTelemetryClient, 'trackAvailability')
let trackEvent = jest.spyOn(dummyTelemetryClient, 'trackEvent')

beforeAll(() => {
    jest.useFakeTimers('modern');
    jest.setSystemTime(new Date(2022, 1, 1));
});

afterAll(() => {
    jest.useRealTimers();
});

beforeEach(() => {
    //init sample metric context
    dummyMetricContex = {
        testId: `my-test-id`,
        baseTelemetryData : {
          id: `my-test-id`,
          message: "",
          success : false,
          name: `my-test-id`,
          runLocation: "myLocation"
        },
        baseEventData : {
          name: `my-test-id`
        },
        monitoringConfiguration: {
            "apiName" : "aks_ingress",
            "appName": "microservice",
            "url": "https://myhost.com/path",
            "type": "private",
            "checkCertificate": 'true',
            "method": "GET",
            "expectedCodes": ["200-299", "303"],
            "tags": {
                "description": "AKS ingress tested from internal network"
            },
            "durationLimit": 10000,
            "certValidityRangeDays": "7"
        },
        apiMetrics: {},
        certMetrics: {}
      }
})

afterEach(() => {
    jest.clearAllMocks()
})

describe('trackSelfAvailabilityEvent tests', () => {
    test('calls telemetry client once', () => {
        let toTrack = {
            foo: "bar"
        }
        let startTime = new Date();
        startTime.setDate(startTime.getDate() -1);

        utils.trackSelfAvailabilityEvent(toTrack, startTime, dummyTelemetryClient, "dummy")

        expect(trackAvailability).toHaveBeenCalledTimes(1);
    });

    test('calls telemetry client with added properties', () => {
        let toTrack = {
            foo: "bar"
        }
        let startTime = new Date();
        startTime.setDate(startTime.getDate() -1);

        let expected = {
            ...toTrack,
            duration: 86400000,
            message: "dummy"
        }

        utils.trackSelfAvailabilityEvent(toTrack, startTime, dummyTelemetryClient, "dummy")

        expect(trackAvailability).toHaveBeenCalledWith(expected);
    });
})



describe('eventSender tests', () => {
    test('calls sendEvent once', () => {
        return utils.eventSender(dummyTelemetryClient)(dummyMetricContex).then(data =>{
            expect(trackEvent).toHaveBeenCalledTimes(1);
        })

      });

      test('calls sendEvent with base event data when no metrics provided', () => {
        let expected = {
            ...dummyMetricContex.baseEventData,
            measurements : {},
            properties: {}
        }

        return utils.eventSender(dummyTelemetryClient)(dummyMetricContex).then(data =>{
            expect(trackEvent).toHaveBeenCalledWith(expected);
        })

      });

      test('calls sendEvent with enriched event data when api metrics provided', () => {
        dummyMetricContex.apiMetrics = {
            'duration': 100,
            'targetStatus': 1,
            'targetExpirationTimestamp': 1000,
            'httpStatus': 200,
            'targetTlsVersion': 1.3,
            'targetExpireInDays': 8,
            'domain': "foo",
            'checkCert': true
        }


        let expected = {
            ...dummyMetricContex.baseEventData,
            measurements: {
                'duration': 100,
                'targetStatus': 1,
                'targetExpirationTimestamp': 1000,
                'httpStatus': 200,
                'targetTlsVersion': 1.3,
                'targetExpireInDays': 8
            },
            properties: {
                'domain': "foo",
                'checkCert': true
            }
        }

        return utils.eventSender(dummyTelemetryClient)(dummyMetricContex).then(data =>{
            expect(trackEvent).toHaveBeenCalledWith(expected);
        })

      });

      test('calls sendEvent with enriched event data when cert metrics provided', () => {
        dummyMetricContex.certMetrics = {
            'duration': 100,
            'targetStatus': 1,
            'targetExpirationTimestamp': 1000,
            'httpStatus': 200,
            'targetTlsVersion': 1.3,
            'targetExpireInDays': 8,
            'domain': "foo",
            'checkCert': true,
            'certSuccess': 1
        }


        let expected = {
            ...dummyMetricContex.baseEventData,
            measurements: {
                'duration': 100,
                'targetStatus': 1,
                'certSuccess': 1,
                'targetExpirationTimestamp': 1000,
                'httpStatus': 200,
                'targetTlsVersion': 1.3,
                'targetExpireInDays': 8
            },
            properties: {
                'domain': "foo",
                'checkCert': true
            }
        }

        return utils.eventSender(dummyTelemetryClient)(dummyMetricContex).then(data =>{
            expect(trackEvent).toHaveBeenCalledWith(expected);
        })
      });
})



describe('telemetrySender tests', () => {
    test('not calls trackAvailability when no metric provided', () => {

        return utils.telemetrySender(dummyTelemetryClient)(dummyMetricContex).then(data =>{
            expect(trackAvailability).toHaveBeenCalledTimes(0);
        })
    });


    test('calls trackAvailability once when only api metric provided', () => {
        dummyMetricContex.apiMetrics = {
            'duration': 100,
            'targetStatus': 1,
            'targetExpirationTimestamp': 1000,
            'httpStatus': 200,
            'targetTlsVersion': 1.3,
            'targetExpireInDays': 8,
            'domain': "foo",
            'checkCert': true
        }

        return utils.telemetrySender(dummyTelemetryClient)(dummyMetricContex).then(data =>{
            expect(trackAvailability).toHaveBeenCalledTimes(1);
        })
    });

    test('calls trackAvailability once when only cert metric provided', () => {

        dummyMetricContex.certMetrics = {
            'duration': 100,
            'targetStatus': 1,
            'targetExpirationTimestamp': 1000,
            'httpStatus': 200,
            'targetTlsVersion': 1.3,
            'targetExpireInDays': 8,
            'domain': "foo",
            'checkCert': true
        }

        return utils.telemetrySender(dummyTelemetryClient)(dummyMetricContex).then(data =>{
            expect(trackAvailability).toHaveBeenCalledTimes(1);
        })
    });

    test('trackAvailability not called when cert metric provided but checkCertificate is false', () => {

        dummyMetricContex.certMetrics = {
            'duration': 100,
            'targetStatus': 1,
            'targetExpirationTimestamp': 1000,
            'httpStatus': 200,
            'targetTlsVersion': 1.3,
            'targetExpireInDays': 8,
            'domain': "foo",
            'checkCert': true
        }
        dummyMetricContex.monitoringConfiguration.checkCertificate = false

        return utils.telemetrySender(dummyTelemetryClient)(dummyMetricContex).then(data =>{
            expect(trackAvailability).toHaveBeenCalledTimes(0);
        })
    });

})



describe('checkApi tests', () => {
    test('calls http client once', () => {
        let dummyHttpResponse = {
            status : 200,
            RESPONSE_TIME: 1234,
            statusText: "ok",
            TLS_VERSION: "v1.3"
        }

        dummyHttpClient.mockReturnValue(new Promise((resolve, reject) => {
            resolve(dummyHttpResponse)
          }))


        return utils.checkApi(dummyMetricContex, dummyHttpClient).then(data =>{
            expect(dummyHttpClient).toHaveBeenCalledTimes(1);
        })
    });

    test('enrich context with response data when response ok', () => {
        let dummyHttpResponse = {
            status : 200,
            RESPONSE_TIME: 1234,
            statusText: "ok",
            TLS_VERSION: "v1.3",
            request: {
                res: {
                    socket: {
                        getPeerCertificate: function (booleanValue){
                            return {valid_to: new Date()}
                        }
                    }
                }
            }
        }

        dummyHttpClient.mockReturnValue(new Promise((resolve, reject) => {
            resolve(dummyHttpResponse)
          }))

        let expected = {
            ...dummyMetricContex,
            apiMetrics: {
                duration: dummyHttpResponse.RESPONSE_TIME,
                success : true,
                message : dummyHttpResponse.statusText,
                httpStatus : dummyHttpResponse.status,
                targetStatus : 1,
                targetTlsVersion : 1.3
            }
        }


        return utils.checkApi(dummyMetricContex, dummyHttpClient).then(data =>{
            expect(data).toMatchObject(expected);
        })
    });


    test('enrich context with error data when response fails', () => {
        dummyHttpClient.mockReturnValue(new Promise((resolve, reject) => {
            reject({message: "failure message"})
          }))

        let expected = {
            ...dummyMetricContex,
            apiMetrics: {
                success : false,
                message : "failure message",
                targetStatus : 0,
            }
        }


        return utils.checkApi(dummyMetricContex, dummyHttpClient).then(data =>{
            expect(data).toMatchObject(expected);
        })
    });

    test('enrich metric context with domain info when checkCertificate is false', () => {
         dummyHttpClient.mockReturnValue(new Promise((resolve, reject) => {
            reject({message: "failure message"})
          }))

        let expected = {
             ...dummyMetricContex
        }
        expected.certMetrics.domain = "myhost.com"
        expected.certMetrics.checkCert = false

        dummyMetricContex.monitoringConfiguration.checkCertificate = 'false'

        return utils.checkApi(dummyMetricContex, dummyHttpClient).then(data =>{
            expect(data).toMatchObject(expected);
        })

    });

    test('enrich context with error cert data when response fails and checkCert true', () => {
        dummyHttpClient.mockReturnValue(new Promise((resolve, reject) => {
            reject({message: "failure message"})
          }))

        let expected = {
            ...dummyMetricContex,
            certMetrics: {
              success:false,
              runLocation:"private-cert"
            },

        }

        return utils.checkApi(dummyMetricContex, dummyHttpClient).then(data =>{
            expect(data).toMatchObject(expected);
        })
    });



     test('enrich context with cert data when response ok and checkCert true', () => {
        let targetDate = datePlusDays(10)
        let dummyHttpResponse = {
            status : 200,
            RESPONSE_TIME: 1234,
            statusText: "ok",
            TLS_VERSION: "v1.3",
            request: {
                res: {
                    socket: {
                        getPeerCertificate: function (booleanValue){
                            return {valid_to: targetDate}
                        }
                    }
                }
            }
        }

        dummyHttpClient.mockReturnValue(new Promise((resolve, reject) => {
            resolve(dummyHttpResponse)
          }))

        let expected = {
            ...dummyMetricContex,
            certMetrics: {
              success:true,
              certSuccess:1,
              targetExpireInDays:10,
              targetExpirationTimestamp:targetDate.getTime(),
              runLocation:"private-cert"
            },

        }


        return utils.checkApi(dummyMetricContex, dummyHttpClient).then(data =>{
            expect(data).toMatchObject(expected);
        })
    });

    test('not enrich context with cert data when response ok and checkCert false', () => {
        let dummyHttpResponse = {
            status : 200,
            RESPONSE_TIME: 1234,
            statusText: "ok",
            TLS_VERSION: "v1.3",
            request: {
                res: {
                    socket: {
                        getPeerCertificate: function (booleanValue){
                            return {valid_to: datePlusDays(10)}
                        }
                    }
                }
            }
        }
        dummyMetricContex.monitoringConfiguration.checkCertificate = 'false'
        dummyHttpClient.mockReturnValue(new Promise((resolve, reject) => {
            resolve(dummyHttpResponse)
          }))

        let expected = {
            ...dummyMetricContex,
            certMetrics: {},

        }


        return utils.checkApi(dummyMetricContex, dummyHttpClient).then(data =>{
            expect(data).toMatchObject(expected);
        })
    });


})
