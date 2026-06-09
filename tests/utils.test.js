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
       let validTo = datePlusDays(10)
       let dummyHttpResponse = {
            status : 200,
            RESPONSE_TIME: 1234,
            statusText: "ok",
            TLS_VERSION: "v1.3",
            request: {
                res: {
                    socket: {
                        getPeerCertificate: function (booleanValue){
                            return {valid_to: validTo.getTime()}
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
              targetExpirationTimestamp: validTo.getTime(),
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


describe('resultCollectorSender tests', () => {
    test('returns the metricContext unchanged', () => {
        const result = utils.resultCollectorSender(dummyMetricContex);
        expect(result).toBe(dummyMetricContex);
    });
})


describe('queueOnSuccess tests', () => {
    const messageId = 'test-message-id';
    const popReceipt = 'test-pop-receipt';
    const alarmId = 'test-alarm-id';
    let requestQueueClient;
    let responseQueueClient;

    beforeEach(() => {
        requestQueueClient = { deleteMessage: jest.fn().mockResolvedValue({}) };
        responseQueueClient = { sendMessage: jest.fn().mockResolvedValue({}) };
    });

    test('calls responseQueueClient.sendMessage once', async () => {
        await utils.queueOnSuccess(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId)(Date.now())([dummyMetricContex]);
        expect(responseQueueClient.sendMessage).toHaveBeenCalledTimes(1);
    });

    test('calls requestQueueClient.deleteMessage with correct messageId and popReceipt', async () => {
        await utils.queueOnSuccess(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId)(Date.now())([dummyMetricContex]);
        expect(requestQueueClient.deleteMessage).toHaveBeenCalledWith(messageId, popReceipt);
    });

    test('sends correctly mapped result payload to responseQueueClient', async () => {
        await utils.queueOnSuccess(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId)(Date.now())([dummyMetricContex]);

        const expectedPayload = {
            alarmId,
            tests: [{
                testId: dummyMetricContex.testId,
                appName: dummyMetricContex.monitoringConfiguration.appName,
                apiName: dummyMetricContex.monitoringConfiguration.apiName,
                type: dummyMetricContex.monitoringConfiguration.type,
                apiMetrics: dummyMetricContex.apiMetrics,
                certMetrics: dummyMetricContex.certMetrics
            }],
            success: true
        };
        expect(responseQueueClient.sendMessage).toHaveBeenCalledWith(JSON.stringify(expectedPayload));
    });

    test('sets success to true in the response message', async () => {
        await utils.queueOnSuccess(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId)(Date.now())([]);
        const sent = JSON.parse(responseQueueClient.sendMessage.mock.calls[0][0]);
        expect(sent.success).toBe(true);
    });

    test('includes alarmId in the response message', async () => {
        await utils.queueOnSuccess(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId)(Date.now())([]);
        const sent = JSON.parse(responseQueueClient.sendMessage.mock.calls[0][0]);
        expect(sent.alarmId).toBe(alarmId);
    });

    test('handles empty results array', async () => {
        await utils.queueOnSuccess(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId)(Date.now())([]);
        const sent = JSON.parse(responseQueueClient.sendMessage.mock.calls[0][0]);
        expect(sent.tests).toHaveLength(0);
    });

    test('handles null results by treating them as an empty array', async () => {
        await utils.queueOnSuccess(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId)(Date.now())(null);
        const sent = JSON.parse(responseQueueClient.sendMessage.mock.calls[0][0]);
        expect(sent.tests).toHaveLength(0);
    });

    test('filters out null entries from results', async () => {
        const results = [dummyMetricContex, null, dummyMetricContex];
        await utils.queueOnSuccess(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId)(Date.now())(results);
        const sent = JSON.parse(responseQueueClient.sendMessage.mock.calls[0][0]);
        expect(sent.tests).toHaveLength(2);
    });

    test('maps multiple results correctly', async () => {
        const results = [
            { ...dummyMetricContex, testId: 'test-1' },
            { ...dummyMetricContex, testId: 'test-2' }
        ];
        await utils.queueOnSuccess(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId)(Date.now())(results);
        const sent = JSON.parse(responseQueueClient.sendMessage.mock.calls[0][0]);
        expect(sent.tests).toHaveLength(2);
        expect(sent.tests[0].testId).toBe('test-1');
        expect(sent.tests[1].testId).toBe('test-2');
    });
})


describe('queueOnError tests', () => {
    const messageId = 'test-message-id';
    const popReceipt = 'test-pop-receipt';
    const alarmId = 'test-alarm-id';
    let requestQueueClient;
    let responseQueueClient;

    beforeEach(() => {
        requestQueueClient = { deleteMessage: jest.fn().mockResolvedValue({}) };
        responseQueueClient = { sendMessage: jest.fn().mockResolvedValue({}) };
    });

    test('calls responseQueueClient.sendMessage once', async () => {
        await utils.queueOnError(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId)(Date.now())(new Error('boom'));
        expect(responseQueueClient.sendMessage).toHaveBeenCalledTimes(1);
    });

    test('calls requestQueueClient.deleteMessage with correct messageId and popReceipt', async () => {
        await utils.queueOnError(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId)(Date.now())(new Error('boom'));
        expect(requestQueueClient.deleteMessage).toHaveBeenCalledWith(messageId, popReceipt);
    });

    test('sends success: false in the response message', async () => {
        await utils.queueOnError(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId)(Date.now())(new Error('boom'));
        const sent = JSON.parse(responseQueueClient.sendMessage.mock.calls[0][0]);
        expect(sent.success).toBe(false);
    });

    test('sends an empty tests array in the response message', async () => {
        await utils.queueOnError(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId)(Date.now())(new Error('boom'));
        const sent = JSON.parse(responseQueueClient.sendMessage.mock.calls[0][0]);
        expect(sent.tests).toEqual([]);
    });

    test('includes alarmId in the response message', async () => {
        await utils.queueOnError(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId)(Date.now())(new Error('boom'));
        const sent = JSON.parse(responseQueueClient.sendMessage.mock.calls[0][0]);
        expect(sent.alarmId).toBe(alarmId);
    });

    test('sends the correct payload regardless of error type', async () => {
        const expectedPayload = { alarmId, tests: [], success: false };
        await utils.queueOnError(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId)(Date.now())('string error');
        expect(responseQueueClient.sendMessage).toHaveBeenCalledWith(JSON.stringify(expectedPayload));
    });
})


describe('logSender tests', () => {
    test('logSender logs the metric context', () => {
        const logger = require('../src/logger');
        const logSpy = jest.spyOn(logger, 'info').mockImplementation();

        utils.logSender(dummyMetricContex);

        expect(logSpy).toHaveBeenCalledWith(dummyMetricContex.testId, expect.stringContaining('logSender'));
        logSpy.mockRestore();
    });
})


describe('logSuccess tests', () => {
    test('returns a function', () => {
        const result = utils.logSuccess(Date.now());
        expect(typeof result).toBe('function');
    });

    test('calls logger.info when invoked', () => {
        const logger = require('../src/logger');
        const logSpy = jest.spyOn(logger, 'info').mockImplementation();

        const handler = utils.logSuccess(Date.now());
        handler('test result');

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('logSuccess'));
        logSpy.mockRestore();
    });
})


describe('logError tests', () => {
    test('returns a function', () => {
        const result = utils.logError(Date.now());
        expect(typeof result).toBe('function');
    });

    test('calls logger.error when invoked', () => {
        const logger = require('../src/logger');
        const errorSpy = jest.spyOn(logger, 'error').mockImplementation();

        const handler = utils.logError(Date.now());
        handler('test error');

        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('FAILURE'));
        errorSpy.mockRestore();
    });
})


describe('eventAndTelemetrySender tests', () => {
    test('returns an async function', () => {
        const handler = utils.eventAndTelemetrySender(dummyTelemetryClient);
        expect(typeof handler).toBe('function');
    });

    test('passes context from eventSender to telemetrySender', async () => {
        dummyMetricContex.apiMetrics = {
            'duration': 100,
            'targetStatus': 1,
            'httpStatus': 200,
        };

        const handler = utils.eventAndTelemetrySender(dummyTelemetryClient);
        const result = await handler(dummyMetricContex);

        expect(result).toMatchObject(dummyMetricContex);
        expect(trackEvent).toHaveBeenCalled();
        expect(trackAvailability).toHaveBeenCalled();
    });

    test('sends both event and telemetry data', async () => {
        dummyMetricContex.apiMetrics = {
            'duration': 100,
            'targetStatus': 1,
            'httpStatus': 200,
            'targetTlsVersion': 1.3
        };

        const handler = utils.eventAndTelemetrySender(dummyTelemetryClient);
        await handler(dummyMetricContex);

        // Check that both trackEvent and trackAvailability were called
        expect(trackEvent).toHaveBeenCalled();
        expect(trackAvailability).toHaveBeenCalled();
    });
})


describe('cronOnSuccess tests', () => {
    test('returns a curried function', () => {
        const handler = utils.cronOnSuccess(dummyTelemetryClient, {});
        expect(typeof handler).toBe('function');

        const innerHandler = handler(Date.now());
        expect(typeof innerHandler).toBe('function');
    });

    test('calls trackAvailability on success', () => {
        const mockEvent = {
            id: 'test',
            message: '',
            success: true,
            name: 'test'
        };

        const handler = utils.cronOnSuccess(dummyTelemetryClient, mockEvent);
        const startTime = Date.now();
        const innerHandler = handler(startTime);

        innerHandler('ok');

        expect(trackAvailability).toHaveBeenCalled();
    });

    test('sends ok message', () => {
        const mockEvent = {
            id: 'test',
            message: '',
            success: true,
            name: 'test'
        };

        const handler = utils.cronOnSuccess(dummyTelemetryClient, mockEvent);
        handler(Date.now())('result');

        expect(trackAvailability).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'ok' })
        );
    });
})


describe('cronOnError tests', () => {
    test('returns a curried function', () => {
        const handler = utils.cronOnError(dummyTelemetryClient, {});
        expect(typeof handler).toBe('function');

        const innerHandler = handler(Date.now());
        expect(typeof innerHandler).toBe('function');
    });

    test('calls trackAvailability on error', () => {
        const mockEvent = {
            id: 'test',
            message: '',
            success: false,
            name: 'test'
        };

        const handler = utils.cronOnError(dummyTelemetryClient, mockEvent);
        handler(Date.now())('error message');

        expect(trackAvailability).toHaveBeenCalled();
    });

    test('sends error message', () => {
        const mockEvent = {
            id: 'test',
            message: '',
            success: false,
            name: 'test'
        };

        const handler = utils.cronOnError(dummyTelemetryClient, mockEvent);
        handler(Date.now())('test error');

        expect(trackAvailability).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'test error' })
        );
    });
})


