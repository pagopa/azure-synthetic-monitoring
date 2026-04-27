jest.mock('@azure/data-tables');
jest.mock('applicationinsights');
jest.mock('../src/logger');
jest.mock('../src/utils');

process.env.STORAGE_ACCOUNT_NAME = 'test-account';
process.env.STORAGE_ACCOUNT_KEY = 'test-key';
process.env.STORAGE_ACCOUNT_TABLE_NAME = 'test-table';
process.env.AVAILABILITY_PREFIX = 'test-prefix';
process.env.HTTP_CLIENT_TIMEOUT = '5000';
process.env.CERT_VALIDITY_RANGE_DAYS = '7';
process.env.APP_INSIGHT_CONNECTION_STRING = 'test-connection-string';

// Helper for async iterables
const createAsyncIterable = (items) => ({
  [Symbol.asyncIterator]: async function* () {
    for (const item of items) {
      yield item;
    }
  }
});

let globalMockListEntities;

// Set up mock BEFORE requiring the module
const { TableClient } = require('@azure/data-tables');
TableClient.mockImplementation(() => ({
  listEntities: () => globalMockListEntities || createAsyncIterable([])
}));

const syntheticMonitoring = require('../src/synthetic-monitoring');
const utils = require('../src/utils');

describe('runMonitoring tests', () => {
  let mockTableEntity;

  beforeEach(() => {
    mockTableEntity = {
      partitionKey: 'app-api',
      rowKey: 'config1',
      type: 'http',
      url: 'https://example.com',
      method: 'GET',
      checkCertificate: true,
      durationLimit: 1000,
      tags: null,
      body: null,
      headers: null,
      expectedCodes: null,
      bodyCompareStrategy: null,
      expectedBody: null
    };

    // Set default mock
    globalMockListEntities = createAsyncIterable([mockTableEntity]);
  });

  test('runMonitoring is exported', () => {
    expect(syntheticMonitoring.runMonitoring).toBeDefined();
    expect(typeof syntheticMonitoring.runMonitoring).toBe('function');
  });

  test('runMonitoring processes table entities', async () => {
    const mockFilter = jest.fn().mockReturnValue(true);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    expect(mockFilter).toHaveBeenCalled();
    expect(mockOnSuccess).toHaveBeenCalled();
  });

  test('runMonitoring filters configurations correctly', async () => {
    const mockFilter = jest.fn().mockReturnValue(false);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    expect(mockSender).not.toHaveBeenCalled();
  });

  test('runMonitoring handles parsing errors gracefully', async () => {
    const invalidEntity = {
      ...mockTableEntity,
      tags: '{invalid json}',
      expectedCodes: '{bad json'
    };

    globalMockListEntities = createAsyncIterable([invalidEntity]);

    const mockFilter = jest.fn().mockReturnValue(true);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    expect(mockOnFailure).toHaveBeenCalled();
  });

  test('runMonitoring parses monitoring configuration correctly', async () => {
    const mockFilter = jest.fn().mockReturnValue(true);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    expect(mockFilter).toHaveBeenCalled();
    const passedConfig = mockFilter.mock.calls[0][0];
    expect(passedConfig.appName).toBe('app');
    expect(passedConfig.apiName).toBe('api');
    expect(passedConfig.type).toBe('http');
  });

  test('runMonitoring handles multiple entities', async () => {
    const entity2 = {
      ...mockTableEntity,
      partitionKey: 'app2-api2',
      rowKey: 'config2'
    };

    globalMockListEntities = createAsyncIterable([mockTableEntity, entity2]);

    const mockFilter = jest.fn().mockReturnValue(true);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    expect(mockFilter).toHaveBeenCalledTimes(2);
  });

  test('runMonitoring calls onSuccess with startTime', async () => {
    const mockFilter = jest.fn().mockReturnValue(true);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01'));

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    expect(mockOnSuccess).toHaveBeenCalledWith(expect.any(Number));

    jest.useRealTimers();
  });

  test('runMonitoring handles empty table', async () => {
    globalMockListEntities = createAsyncIterable([]);

    const mockFilter = jest.fn().mockReturnValue(true);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    expect(mockOnSuccess).toHaveBeenCalled();
    expect(mockFilter).not.toHaveBeenCalled();
  });

  test('runMonitoring parses JSON fields correctly', async () => {
    mockTableEntity.tags = JSON.stringify({ key: 'value' });
    mockTableEntity.expectedCodes = JSON.stringify(['200', '201']);

    globalMockListEntities = createAsyncIterable([mockTableEntity]);

    const mockFilter = jest.fn().mockReturnValue(true);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    const passedConfig = mockFilter.mock.calls[0][0];
    expect(passedConfig.tags).toEqual({ key: 'value' });
    expect(passedConfig.expectedCodes).toEqual(['200', '201']);
  });

  test('runMonitoring sets null fields correctly', async () => {
    mockTableEntity.tags = null;
    mockTableEntity.body = null;
    mockTableEntity.headers = null;

    globalMockListEntities = createAsyncIterable([mockTableEntity]);

    const mockFilter = jest.fn().mockReturnValue(true);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    const passedConfig = mockFilter.mock.calls[0][0];
    expect(passedConfig.tags).toEqual({});
    expect(passedConfig.body).toBeNull();
    expect(passedConfig.headers).toBeNull();
  });

  test('runMonitoring includes environment variables in config', async () => {
    const mockFilter = jest.fn().mockReturnValue(true);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    const passedConfig = mockFilter.mock.calls[0][0];
    expect(passedConfig.httpClientTimeout).toBe('5000');
    expect(passedConfig.availabilityPrefix).toBe('test-prefix');
    expect(passedConfig.certValidityRangeDays).toBe('7');
  });

  test('runMonitoring catches test execution errors', async () => {
    const mockFilter = jest.fn().mockReturnValue(true);
    const mockSender = jest.fn().mockRejectedValue(new Error('Test execution failed'));
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    expect(mockOnFailure).toHaveBeenCalled();
  });

  test('runMonitoring extracts appName and apiName from partitionKey', async () => {
    mockTableEntity.partitionKey = 'myapp-myapi';
    globalMockListEntities = createAsyncIterable([mockTableEntity]);

    const mockFilter = jest.fn().mockReturnValue(true);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    const passedConfig = mockFilter.mock.calls[0][0];
    expect(passedConfig.appName).toBe('myapp');
    expect(passedConfig.apiName).toBe('myapi');
  });

  test('runMonitoring preserves all entity properties', async () => {
    mockTableEntity.url = 'https://test.com/api';
    mockTableEntity.method = 'POST';
    mockTableEntity.checkCertificate = true;
    mockTableEntity.durationLimit = 5000;

    globalMockListEntities = createAsyncIterable([mockTableEntity]);

    const mockFilter = jest.fn().mockReturnValue(true);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    const passedConfig = mockFilter.mock.calls[0][0];
    expect(passedConfig.url).toBe('https://test.com/api');
    expect(passedConfig.method).toBe('POST');
    expect(passedConfig.checkCertificate).toBe(true);
    expect(passedConfig.durationLimit).toBe(5000);
  });
});

describe('utils.checkApi integration', () => {
  let mockTableEntity;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockTableEntity = {
      partitionKey: 'app-api',
      rowKey: 'config1',
      type: 'http',
      url: 'https://example.com/endpoint',
      method: 'GET',
      checkCertificate: true,
      durationLimit: 1000,
      tags: null,
      body: null,
      headers: null,
      expectedCodes: null,
      bodyCompareStrategy: null,
      expectedBody: null
    };

    globalMockListEntities = createAsyncIterable([mockTableEntity]);
  });

  test('checkApi is called with correct metricContext and httpClient', async () => {
    utils.checkApi.mockResolvedValue({ testId: 'app_api_http', apiMetrics: { duration: 100 } });

    const mockFilter = jest.fn().mockReturnValue(true);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    // Verify checkApi was called
    expect(utils.checkApi).toHaveBeenCalled();
    
    // Get the arguments passed to checkApi
    const checkApiCall = utils.checkApi.mock.calls[0];
    const metricContext = checkApiCall[0];
    const httpClient = checkApiCall[1];

    // Verify metricContext structure
    expect(metricContext).toHaveProperty('testId', 'app_api_http');
    expect(metricContext).toHaveProperty('monitoringConfiguration');
    expect(metricContext).toHaveProperty('baseTelemetryData');
    expect(metricContext).toHaveProperty('baseEventData');
    expect(metricContext).toHaveProperty('certMetrics');
    
    // Verify certMetrics is set correctly
    expect(metricContext.certMetrics).toEqual({
      domain: 'example.com',
      checkCert: true
    });

    // Verify httpClient is defined
    expect(httpClient).toBeDefined();
  });

  test('checkApi is called with correct URL parsing for certMetrics', async () => {
    mockTableEntity.url = 'https://api.example.com:8080/v1/endpoint?query=param';
    mockTableEntity.checkCertificate = false;
    globalMockListEntities = createAsyncIterable([mockTableEntity]);

    utils.checkApi.mockResolvedValue({ testId: 'app_api_http' });

    const mockFilter = jest.fn().mockReturnValue(true);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    const checkApiCall = utils.checkApi.mock.calls[0];
    const metricContext = checkApiCall[0];

    // Verify domain is correctly extracted from URL
    expect(metricContext.certMetrics.domain).toBe('api.example.com:8080');
    expect(metricContext.certMetrics.checkCert).toBe(false);
  });

  test('checkApi result is piped to sender', async () => {
    const mockCheckApiResult = {
      testId: 'app_api_http',
      apiMetrics: { duration: 250, httpStatus: 200 },
      certMetrics: { certSuccess: true },
      monitoringConfiguration: mockTableEntity
    };

    utils.checkApi.mockResolvedValue(mockCheckApiResult);

    const mockFilter = jest.fn().mockReturnValue(true);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    // Verify sender was called with the checkApi result
    expect(mockSender).toHaveBeenCalledWith(mockCheckApiResult);
  });

  test('checkApi errors are caught and handled', async () => {
    utils.checkApi.mockRejectedValue(new Error('Connection timeout'));

    const mockFilter = jest.fn().mockReturnValue(true);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    // Verify onFailure is called when checkApi throws
    expect(mockOnFailure).toHaveBeenCalled();
    expect(mockSender).not.toHaveBeenCalled();
  });

  test('checkApi is called for each configuration that passes filter', async () => {
    const entity2 = {
      ...mockTableEntity,
      partitionKey: 'app2-api2',
      url: 'https://api2.example.com'
    };

    globalMockListEntities = createAsyncIterable([mockTableEntity, entity2]);
    utils.checkApi.mockResolvedValue({ testId: 'test' });

    const mockFilter = jest.fn().mockReturnValue(true);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    // Verify checkApi was called twice
    expect(utils.checkApi).toHaveBeenCalledTimes(2);

    // Verify each call has the correct URL
    const firstCall = utils.checkApi.mock.calls[0][0];
    const secondCall = utils.checkApi.mock.calls[1][0];
    
    expect(firstCall.certMetrics.domain).toBe('example.com');
    expect(secondCall.certMetrics.domain).toBe('api2.example.com');
  });

  test('checkApi is not called for configurations that fail filter', async () => {
    utils.checkApi.mockResolvedValue({ testId: 'test' });

    const mockFilter = jest.fn().mockReturnValue(false);
    const mockSender = jest.fn().mockResolvedValue({ testId: 'test' });
    const mockOnSuccess = jest.fn().mockReturnValue(jest.fn());
    const mockOnFailure = jest.fn().mockReturnValue(jest.fn());

    await syntheticMonitoring.runMonitoring(mockFilter, mockSender, mockOnSuccess, mockOnFailure);

    // Verify checkApi was NOT called when filter returns false
    expect(utils.checkApi).not.toHaveBeenCalled();
    expect(mockSender).not.toHaveBeenCalled();
  });
});

describe('axios interceptors', () => {
  // Get axios instance to test interceptors
  let axios;

  beforeEach(() => {
    jest.clearAllMocks();
    // Get axios to access its interceptors
    axios = require('axios');
  });

  test('response interceptor adds TLS_VERSION from socket', async () => {
    const mockSocket = {
      getProtocol: jest.fn().mockReturnValue('TLSv1.3')
    };

    const mockResponse = {
      status: 200,
      data: { success: true },
      request: {
        res: {
          socket: mockSocket
        }
      },
      config: {
        headers: {
          'x-request-timestamp': Date.now() - 100
        }
      }
    };

    // Get response handler from interceptors
    const responseHandlers = axios.interceptors.response.handlers;
    expect(responseHandlers.length).toBeGreaterThan(0);

    // The response interceptor should be the first one
    const responseHandler = responseHandlers[0].fulfilled;
    const result = responseHandler(mockResponse);

    // Verify TLS_VERSION is added
    expect(result.TLS_VERSION).toBe('TLSv1.3');
  });

  test('response interceptor handles missing socket gracefully', async () => {
    const mockResponse = {
      status: 200,
      data: { success: true },
      request: {
        res: {
          socket: null
        }
      },
      config: {
        headers: {
          'x-request-timestamp': Date.now()
        }
      }
    };

    const responseHandlers = axios.interceptors.response.handlers;
    const responseHandler = responseHandlers[0].fulfilled;
    const result = responseHandler(mockResponse);

    // TLS_VERSION should be null when socket is unavailable
    expect(result.TLS_VERSION).toBeNull();
  });

  test('response interceptor calculates RESPONSE_TIME correctly', async () => {
    const startTime = Date.now();
    const expectedDuration = 150;
    
    const mockResponse = {
      status: 200,
      data: { success: true },
      request: {
        res: {
          socket: {
            getProtocol: jest.fn().mockReturnValue('TLSv1.2')
          }
        }
      },
      config: {
        headers: {
          'x-request-timestamp': startTime
        }
      }
    };

    // Simulate time passing
    jest.useFakeTimers();
    jest.setSystemTime(new Date(startTime + expectedDuration));

    const responseHandlers = axios.interceptors.response.handlers;
    const responseHandler = responseHandlers[0].fulfilled;
    const result = responseHandler(mockResponse);

    // Verify RESPONSE_TIME is calculated
    expect(result.RESPONSE_TIME).toBe(expectedDuration);

    jest.useRealTimers();
  });

  test('request interceptor adds START_TIMESTAMP_KEY to headers', async () => {
    const mockConfig = {
      headers: {}
    };

    const requestHandlers = axios.interceptors.request.handlers;
    expect(requestHandlers.length).toBeGreaterThan(0);

    // The request interceptor should be the first one
    const requestHandler = requestHandlers[0].fulfilled;
    const result = requestHandler(mockConfig);

    // Verify timestamp header is added
    expect(result.headers['x-request-timestamp']).toBeDefined();
    expect(typeof result.headers['x-request-timestamp']).toBe('number');
  });

  test('request interceptor preserves existing headers', async () => {
    const mockConfig = {
      headers: {
        'Authorization': 'Bearer token',
        'Content-Type': 'application/json'
      }
    };

    const requestHandlers = axios.interceptors.request.handlers;
    const requestHandler = requestHandlers[0].fulfilled;
    const result = requestHandler(mockConfig);

    // Verify existing headers are preserved
    expect(result.headers['Authorization']).toBe('Bearer token');
    expect(result.headers['Content-Type']).toBe('application/json');
    // And timestamp is added
    expect(result.headers['x-request-timestamp']).toBeDefined();
  });

  test('response interceptor error handler rejects promise', async () => {
    const testError = new Error('Network error');

    const responseHandlers = axios.interceptors.response.handlers;
    const errorHandler = responseHandlers[0].rejected;

    // Error handler should reject
    await expect(errorHandler(testError)).rejects.toEqual(testError);
  });

  test('request interceptor error handler rejects promise', async () => {
    const testError = new Error('Config error');

    const requestHandlers = axios.interceptors.request.handlers;
    const errorHandler = requestHandlers[0].rejected;

    // Error handler should reject
    await expect(errorHandler(testError)).rejects.toEqual(testError);
  });

  test('interceptors work together in full request/response cycle', async () => {
    const startTime = Date.now();
    const duration = 200;

    // Simulate request config
    const requestConfig = {
      headers: {},
      method: 'GET',
      url: 'https://example.com/api'
    };

    // Apply request interceptor
    const requestHandlers = axios.interceptors.request.handlers;
    const requestHandler = requestHandlers[0].fulfilled;
    const configWithTimestamp = requestHandler(requestConfig);

    // Verify timestamp was added
    expect(configWithTimestamp.headers['x-request-timestamp']).toBeDefined();
    const addedTimestamp = configWithTimestamp.headers['x-request-timestamp'];

    // Simulate response
    jest.useFakeTimers();
    jest.setSystemTime(new Date(addedTimestamp + duration));

    const mockResponse = {
      status: 200,
      data: { result: 'success' },
      request: {
        res: {
          socket: {
            getProtocol: jest.fn().mockReturnValue('TLSv1.3')
          }
        }
      },
      config: configWithTimestamp
    };

    // Apply response interceptor
    const responseHandlers = axios.interceptors.response.handlers;
    const responseHandler = responseHandlers[0].fulfilled;
    const enrichedResponse = responseHandler(mockResponse);

    // Verify response has both TLS and response time
    expect(enrichedResponse.TLS_VERSION).toBe('TLSv1.3');
    expect(enrichedResponse.RESPONSE_TIME).toBe(duration);
    expect(enrichedResponse.status).toBe(200);

    jest.useRealTimers();
  });

  test('interceptors handle missing request config properties', async () => {
    const mockResponse = {
      status: 200,
      data: { success: true },
      request: {
        res: {
          socket: {
            getProtocol: jest.fn().mockReturnValue('TLSv1.2')
          }
        }
      },
      config: {
        headers: {}
        // Missing 'x-request-timestamp' header
      }
    };

    const responseHandlers = axios.interceptors.response.handlers;
    const responseHandler = responseHandlers[0].fulfilled;
    const result = responseHandler(mockResponse);

    // Should handle gracefully - RESPONSE_TIME will be calculated from undefined
    // which will result in NaN, but the interceptor should not crash
    expect(result.TLS_VERSION).toBe('TLSv1.2');
  });
});
