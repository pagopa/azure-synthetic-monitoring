const statics = require('../src/statics')


let dummyMetricContex = {}

beforeEach(() => {
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
      "apiName" : "myApi",
      "appName": "myApp",
      "url": "https://myurl.com/path/",
      "type": "private",
      "checkCertificate": true,
      "method": "GET",
      "expectedCodes": ["200-299", "303"],
      "tags": {
          "description": "description"
      },
      "durationLimit": 1000,
      "availabilityPrefix": "synthetic",
      "certValidityRangeDays": 7
  },
  apiMetrics: {},
  certMetrics: {}
}
})

beforeAll(() => {
  jest.useFakeTimers('modern');
  jest.setSystemTime(new Date(2022, 1, 1));
});

afterAll(() => {
  jest.useRealTimers();
});


describe('isNull tests', () => {
  test('returns true when null vlaue', () => {
    expect(statics.isNull(null)).toBe(true);
  });

  test('returns true when "null" string', () => {
    expect(statics.isNull("null")).toBe(true);
  });

  test('returns false when valid string', () => {
    expect(statics.isNull("something")).toBe(false);
  });

  test('returns true when empty string', () => {
    expect(statics.isNull("")).toBe(true);
  });

  test('returns false when int', () => {
    expect(statics.isNull(5)).toBe(false);
  });

  test('returns false when object', () => {
    expect(statics.isNull({"foo": "bar"})).toBe(false);
  });
})


describe('enrichData tests', () => {
  test('leaves base untouched if no keys', () => {
    let baseData = {"foo": "bar"}
    let result = {"additional": "foo"}
    let expected = baseData
    let keysToAdd = ["other"]

    expect(statics.enrichData(baseData, result, keysToAdd)).toEqual(expected);
  });

  test('adds only defined keys', () => {
    let baseData = {"foo": "bar"}
    let result = {"additional": "foo", "other": "bar"}
    let expected = {"foo": "bar", "additional": "foo"}
    let keysToAdd = ["additional"]

    expect(statics.enrichData(baseData, result, keysToAdd)).toEqual(expected);
  });

  test('raises no exceptions when keys is empty', () => {
    let baseData = {"foo": "bar"}
    let result = {"additional": "foo", "other": "bar"}
    let expected = {"foo": "bar"}
    let keysToAdd = []

    expect(statics.enrichData(baseData, result, keysToAdd)).toEqual(expected);
  });

  test('raises no exceptions when keys is not in result', () => {
    let baseData = {"foo": "bar"}
    let result = {"additional": "foo"}
    let expected = {"foo": "bar"}
    let keysToAdd = ["other"]

    expect(statics.enrichData(baseData, result, keysToAdd)).toEqual(expected);
  });
})



describe('certResponseElaborator tests', () => {
  test('returns true on valid response', () => {
    let validTo = new Date();
    validTo.setDate(validTo.getDate() + 9);
    let mockCertResponse = {valid_to: validTo}
    let expectedCertMetric = {
      success : true,
      certSuccess : 1,
      targetExpireInDays: 9,
      targetExpirationTimestamp : validTo.getTime(),
      runLocation: `${dummyMetricContex.monitoringConfiguration.type}-cert`
    }

    expect(statics.readCert(dummyMetricContex, mockCertResponse)).toMatchObject({ certMetrics: expectedCertMetric});


  });


  test('returns false when cert expires in less than 7 days', () => {
    let validTo = new Date();
    validTo.setDate(validTo.getDate() + 6);
    let mockCertResponse = {valid_to: validTo}
    let expectedCertMetric = {
      success : false,
      certSuccess : 0,
      targetExpireInDays: 6,
      targetExpirationTimestamp : validTo.getTime(),
      runLocation: `${dummyMetricContex.monitoringConfiguration.type}-cert`
    }

    expect(statics.readCert(dummyMetricContex, mockCertResponse)).toMatchObject({ certMetrics: expectedCertMetric});


  });
})


describe('certErrorElaborator tests', () => {
  test('returns false with error message', () => {
    let validTo = new Date();
    validTo.setDate(validTo.getDate() + 6);
    let mockCertResponse = {valid_to: validTo}
    let expectedCertMetric = {
      success : false,
      message: "foo",
      runLocation: `${dummyMetricContex.monitoringConfiguration.type}-cert`
    }

    expect(statics.readCertError(dummyMetricContex, {"message": "foo"})).toMatchObject({ certMetrics: expectedCertMetric});

  });
})


describe('apiResponseElaborator tests', () => {
  test('returns true when api response ok', () => {
    let mockApiResponse = {
      status: 200,
      statusText: "ok",
      TLS_VERSION: "v1.3",
      RESPONSE_TIME: 100
    }
    let expectedApiMetric = {
      success : true,
      httpStatus: 200,
      targetStatus: 1,
      targetTlsVersion: 1.3
    }


    return statics.apiResponseElaborator(dummyMetricContex)(mockApiResponse).then(data =>{
      expect(data).toMatchObject({ apiMetrics: expectedApiMetric});
    })

  });

  test('returns true when api response ok and body matches', () => {
    let mockApiResponse = {
      status: 200,
      statusText: "ok",
      TLS_VERSION: "v1.3",
      RESPONSE_TIME: 100,
      data: {"foo": "bar"}
    }
    let expectedApiMetric = {
      success : true,
      httpStatus: 200,
      targetStatus: 1,
      targetTlsVersion: 1.3
    }
    dummyMetricContex.monitoringConfiguration.bodyCompareStrategy = 'contains'
    dummyMetricContex.monitoringConfiguration.expectedBody = {"foo": "bar"}

    return statics.apiResponseElaborator(dummyMetricContex)(mockApiResponse).then(data =>{
      expect(data).toMatchObject({ apiMetrics: expectedApiMetric});
    })

  });

   test('returns false when api response ok and body match fails', () => {
    let mockApiResponse = {
      status: 200,
      statusText: "ok",
      TLS_VERSION: "v1.3",
      RESPONSE_TIME: 100,
      data: {"baz": "bar"}
    }
    let expectedApiMetric = {
      success : false,
      httpStatus: 200,
      targetStatus: 1,
      targetTlsVersion: 1.3
    }
    dummyMetricContex.monitoringConfiguration.bodyCompareStrategy = 'contains'
    dummyMetricContex.monitoringConfiguration.expectedBody = {"foo": "bar"}

    return statics.apiResponseElaborator(dummyMetricContex)(mockApiResponse).then(data =>{
      expect(data).toMatchObject({ apiMetrics: expectedApiMetric});
    })

  });

  test('returns false when api response not ok', () => {
    let mockApiResponse = {
      status: 500,
      statusText: "ok",
      TLS_VERSION: "v1.3",
      RESPONSE_TIME: 100
    }
    let expectedApiMetric = {
      success : false,
      httpStatus: 500,
      targetStatus: 0,
      targetTlsVersion: 1.3
    }


    return statics.apiResponseElaborator(dummyMetricContex)(mockApiResponse).then(data =>{
      expect(data).toMatchObject({ apiMetrics: expectedApiMetric});
    })

  });


  test('returns false when api response ok but took too long', () => {
    let mockApiResponse = {
      status: 200,
      statusText: "ok",
      TLS_VERSION: "v1.3",
      RESPONSE_TIME: 2000
    }
    let expectedApiMetric = {
      success : false,
      httpStatus: 200,
      targetStatus: 1,
      targetTlsVersion: 1.3
    }


    return statics.apiResponseElaborator(dummyMetricContex)(mockApiResponse).then(data =>{
      expect(data).toMatchObject({ apiMetrics: expectedApiMetric});
    })

  });

  test('elaborated metric context contains api response', () => {
    let mockApiResponse = {
      status: 200,
      statusText: "ok",
      TLS_VERSION: "v1.3",
      RESPONSE_TIME: 2000
    }


    return statics.apiResponseElaborator(dummyMetricContex)(mockApiResponse).then(data =>{
      expect(data).toMatchObject({ apiResponse: mockApiResponse});
    })

  });
})


describe('apiErrorElaborator tests', () => {
  test('returns false', () => {
    let expectedApiMetric = {
      success : false,
      targetStatus: 0,
      message: "foo"
    }


    return statics.apiErrorElaborator(dummyMetricContex)({message: "foo"}).then(data =>{
      expect(data).toMatchObject({ apiMetrics: expectedApiMetric});
    })

  });
})


describe('extractTlsVersion tests', () => {
  test('returns 0 if tls version empty string', () => {
    let versionString = ""
    let expected = 0

    expect(statics.extractTlsVersion(versionString)).toEqual(expected);
  });

  test('returns 0 if tls version null', () => {
    let versionString = null
    let expected = 0

    expect(statics.extractTlsVersion(versionString)).toEqual(expected);
  });

  test('returns 0 if tls version not valid', () => {
    let versionString = "foo"
    let expected = 0

    expect(statics.extractTlsVersion(versionString)).toEqual(expected);
  });

  test('returns valid tls version', () => {
    let versionString = "v1.3"
    let expected = 1.3

    expect(statics.extractTlsVersion(versionString)).toEqual(expected);
  });

  test('returns valid tls version when missing leading v', () => {
    let versionString = "1.3"
    let expected = 1.3

    expect(statics.extractTlsVersion(versionString)).toEqual(expected);
  });
})


describe('buildRequest tests', () => {
  test('on get request ', () => {
    let monitoringConfiguration = {
      "apiName" : "aks_ingress",
      "appName": "microservice",
      "url": "https://myUrl.com",
      "type": "private",
      "checkCertificate": true,
      "method": "GET",
      "expectedCodes": ["200-299", "303"],
      "tags": {
          "description": "AKS ingress tested from internal network"
      },
      "durationLimit": 1000,
      "httpClientTimeout": 1000
    }
    let expected = {
      method: "get",
      url: "https://myUrl.com",
      timeout: 1000
  }

    expect(statics.buildRequest(monitoringConfiguration)).toMatchObject(expected);
  });

  test('ignores body on get request ', () => {
    let monitoringConfiguration = {
      "apiName" : "aks_ingress",
      "appName": "microservice",
      "url": "https://myUrl.com",
      "type": "private",
      "checkCertificate": true,
      "method": "GET",
      "expectedCodes": ["200-299", "303"],
      "tags": {
          "description": "AKS ingress tested from internal network"
      },
      "body": "something",
      "durationLimit": 1000,
      "httpClientTimeout": 1000
    }
    let expected = {
      method: "get",
      url: "https://myUrl.com",
      timeout: 1000
  }

    expect(statics.buildRequest(monitoringConfiguration)).toMatchObject(expected);
    expect(statics.buildRequest(monitoringConfiguration)).toEqual(expect.not.objectContaining({"data": expect.anything()}));
  });

  test('adds headers if configured ', () => {
    let monitoringConfiguration = {
      "apiName" : "aks_ingress",
      "appName": "microservice",
      "url": "https://myUrl.com",
      "type": "private",
      "checkCertificate": true,
      "method": "GET",
      "expectedCodes": ["200-299", "303"],
      "tags": {
          "description": "AKS ingress tested from internal network"
      },
      "headers": {
         "foo": "bar",
         "baz": "fooz"
      },
      "body": "something",
      "durationLimit": 1000,
      "httpClientTimeout": 1000
    }
    let expected = {
      method: "get",
      url: "https://myUrl.com",
      timeout: 1000,
      headers: {
        "foo": "bar",
        "baz": "fooz"
      }
  }

    expect(statics.buildRequest(monitoringConfiguration)).toMatchObject(expected);
  });


  test('adds body when configured', () => {
    let monitoringConfiguration = {
      "apiName" : "aks_ingress",
      "appName": "microservice",
      "url": "https://myUrl.com",
      "type": "private",
      "checkCertificate": true,
      "method": "PUT",
      "expectedCodes": ["200-299", "303"],
      "tags": {
          "description": "AKS ingress tested from internal network"
      },
      "body": "something",
      "durationLimit": 1000,
      "httpClientTimeout": 1000
    }
    let expected = {
      method: "put",
      url: "https://myUrl.com",
      timeout: 1000,
      data: "something"
  }

    expect(statics.buildRequest(monitoringConfiguration)).toMatchObject(expected);
  });
} )


describe('isStatusCodeAccepted tests', () => {
  test('returns true when code matched', () => {
    let received = 200
    let accepted = ["200"]

    expect(statics.isStatusCodeAccepted(received, accepted)).toBe(true);
  });

  test('returns true when code contained in list', () => {
    let received = 300
    let accepted = ["200", "300", "400"]

    expect(statics.isStatusCodeAccepted(received, accepted)).toBe(true);
  });

  test('returns false when code not contained in list', () => {
    let received = 500
    let accepted = ["200", "300", "400"]

    expect(statics.isStatusCodeAccepted(received, accepted)).toBe(false);
  });

  test('returns true when code in range', () => {
    let received = 305
    let accepted = ["200", "300-310", "400"]

    expect(statics.isStatusCodeAccepted(received, accepted)).toBe(true);
  });

  test('returns true when code in range lower bound', () => {
    let received = 300
    let accepted = ["200", "300-310", "400"]

    expect(statics.isStatusCodeAccepted(received, accepted)).toBe(true);
  });

  test('returns true when code in range upper bound', () => {
    let received = 310
    let accepted = ["200", "300-310", "400"]

    expect(statics.isStatusCodeAccepted(received, accepted)).toBe(true);
  });
})



describe('initMetricObjects tests', () => {
  test('build correct metric objects', () => {
    let result = statics.initMetricObjects(dummyMetricContex.monitoringConfiguration)

    let expected = {
      "event": {
        "measurements": {},
        "name": "synthetic-myApp-myApi-private",
        "properties": {
          "apiName": "myApi",
          "appName": "myApp",
          "description": "description",
          "endpoint": "GET https://myurl.com/path/",
        }
      },
      "telemetry": {
        "id": "synthetic-myApp-myApi",
        "message": "",
        "name": "synthetic-myApp-myApi",
        "properties": {
          "apiName": "myApi",
          "appName": "myApp",
          "description": "description",
          "endpoint": "GET https://myurl.com/path/",
        },
        "runLocation": "private",
        "success": false
      }
   }

    expect(result).toEqual(expected);
  });


})
