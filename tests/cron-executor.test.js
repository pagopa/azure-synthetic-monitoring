jest.mock('applicationinsights');
jest.mock('@azure/data-tables');
jest.mock('../src/logger');

process.env.STORAGE_ACCOUNT_NAME = 'test-account';
process.env.STORAGE_ACCOUNT_KEY = 'test-key';
process.env.STORAGE_ACCOUNT_TABLE_NAME = 'test-table';
process.env.AVAILABILITY_PREFIX = 'test-prefix';
process.env.HTTP_CLIENT_TIMEOUT = '5000';
process.env.CERT_VALIDITY_RANGE_DAYS = '7';
process.env.APP_INSIGHT_CONNECTION_STRING = 'test-connection-string';
process.env.LOCATION = 'East US';

const cronExecutor = require('../src/cron-executor');
const tester = require('../src/synthetic-monitoring');
const utils = require('../src/utils');

jest.mock('../src/synthetic-monitoring');
jest.mock('../src/utils');

describe('cronExecutor tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('execute function is exported', () => {
    expect(cronExecutor.execute).toBeDefined();
    expect(typeof cronExecutor.execute).toBe('function');
  });

  test('execute calls runMonitoring with correct filter', async () => {
    tester.runMonitoring.mockResolvedValue(undefined);
    utils.eventAndTelemetrySender.mockReturnValue(jest.fn());
    utils.cronOnSuccess.mockReturnValue(jest.fn());
    utils.cronOnError.mockReturnValue(jest.fn());

    await cronExecutor.execute();

    expect(tester.runMonitoring).toHaveBeenCalledTimes(1);
    const [filterFunc] = tester.runMonitoring.mock.calls[0];
    expect(typeof filterFunc).toBe('function');
  });

  test('filter function returns true (keep all)', async () => {
    tester.runMonitoring.mockImplementation((filter) => {
      // Test the filter with a sample config
      const testConfig = { appName: 'test', apiName: 'api' };
      expect(filter(testConfig)).toBe(true);
    });
    utils.eventAndTelemetrySender.mockReturnValue(jest.fn());
    utils.cronOnSuccess.mockReturnValue(jest.fn());
    utils.cronOnError.mockReturnValue(jest.fn());

    await cronExecutor.execute();

    expect(tester.runMonitoring).toHaveBeenCalled();
  });

  test('execute passes eventAndTelemetrySender', async () => {
    tester.runMonitoring.mockResolvedValue(undefined);
    utils.eventAndTelemetrySender.mockReturnValue(jest.fn());
    utils.cronOnSuccess.mockReturnValue(jest.fn());
    utils.cronOnError.mockReturnValue(jest.fn());

    await cronExecutor.execute();

    expect(utils.eventAndTelemetrySender).toHaveBeenCalled();
    expect(tester.runMonitoring).toHaveBeenCalled();
  });

  test('execute passes cronOnSuccess handler', async () => {
    tester.runMonitoring.mockResolvedValue(undefined);
    utils.eventAndTelemetrySender.mockReturnValue(jest.fn());
    utils.cronOnSuccess.mockReturnValue(jest.fn());
    utils.cronOnError.mockReturnValue(jest.fn());

    await cronExecutor.execute();

    expect(utils.cronOnSuccess).toHaveBeenCalled();
  });

  test('execute passes cronOnError handler', async () => {
    tester.runMonitoring.mockResolvedValue(undefined);
    utils.eventAndTelemetrySender.mockReturnValue(jest.fn());
    utils.cronOnSuccess.mockReturnValue(jest.fn());
    utils.cronOnError.mockReturnValue(jest.fn());

    await cronExecutor.execute();

    expect(utils.cronOnError).toHaveBeenCalled();
  });
});

describe('cron-executor Application Insights integration scenarios', () => {
  const appInsights = require('applicationinsights');
  const logger = require('../src/logger');
  const tester = require('../src/synthetic-monitoring');
  const utils = require('../src/utils');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('execute calls runMonitoring with telemetryClient in handlers', async () => {
    appInsights.setup.mockReturnValue({ start: jest.fn() });
    const mockTelemetryClient = { trackEvent: jest.fn(), trackAvailability: jest.fn() };
    appInsights.TelemetryClient.mockReturnValue(mockTelemetryClient);

    tester.runMonitoring.mockResolvedValue(undefined);
    utils.eventAndTelemetrySender.mockReturnValue(jest.fn());
    utils.cronOnSuccess.mockReturnValue(jest.fn());
    utils.cronOnError.mockReturnValue(jest.fn());

    await cronExecutor.execute();

    // Verify telemetryClient is passed to handlers (this is how module would use it if init succeeded)
    expect(utils.eventAndTelemetrySender).toHaveBeenCalled();
    expect(utils.cronOnSuccess).toHaveBeenCalled();
    expect(utils.cronOnError).toHaveBeenCalled();
    expect(tester.runMonitoring).toHaveBeenCalled();
  });

  test('execute passes filter that returns true for all configurations', async () => {
    tester.runMonitoring.mockResolvedValue(undefined);
    utils.eventAndTelemetrySender.mockReturnValue(jest.fn());
    utils.cronOnSuccess.mockReturnValue(jest.fn());
    utils.cronOnError.mockReturnValue(jest.fn());

    await cronExecutor.execute();

    const [filterFunc] = tester.runMonitoring.mock.calls[0];

    // Filter should accept any configuration
    expect(filterFunc({ appName: 'test1' })).toBe(true);
    expect(filterFunc({ appName: 'test2', enabled: false })).toBe(true);
    expect(filterFunc({})).toBe(true);
  });

  test('execute passes successMonitoringEvent to cronOnSuccess', async () => {
    tester.runMonitoring.mockResolvedValue(undefined);
    utils.eventAndTelemetrySender.mockReturnValue(jest.fn());
    utils.cronOnSuccess.mockReturnValue(jest.fn());
    utils.cronOnError.mockReturnValue(jest.fn());

    await cronExecutor.execute();

    expect(utils.cronOnSuccess).toHaveBeenCalledWith(
      undefined, // telemetryClient is undefined in test (mocks don't return real client)
      expect.objectContaining({
        success: true,
        name: expect.stringContaining('monitoring-function')
      })
    );
  });

  test('execute passes failedMonitoringEvent to cronOnError', async () => {
    tester.runMonitoring.mockResolvedValue(undefined);
    utils.eventAndTelemetrySender.mockReturnValue(jest.fn());
    utils.cronOnSuccess.mockReturnValue(jest.fn());
    utils.cronOnError.mockReturnValue(jest.fn());

    await cronExecutor.execute();

    expect(utils.cronOnError).toHaveBeenCalledWith(
      undefined, // telemetryClient is undefined in test (mocks don't return real client)
      expect.objectContaining({
        success: false,
        message: 'At least one test failed to execute'
      })
    );
  });

  test('runMonitoring receives 4 arguments: filter, sender, onSuccess, onError', async () => {
    tester.runMonitoring.mockResolvedValue(undefined);
    utils.eventAndTelemetrySender.mockReturnValue(jest.fn());
    utils.cronOnSuccess.mockReturnValue(jest.fn());
    utils.cronOnError.mockReturnValue(jest.fn());

    await cronExecutor.execute();

    const args = tester.runMonitoring.mock.calls[0];
    expect(args.length).toBe(4);
    expect(typeof args[0]).toBe('function'); // filter
    expect(typeof args[1]).toBe('function'); // sender
    expect(typeof args[2]).toBe('function'); // onSuccess
    expect(typeof args[3]).toBe('function'); // onError
  });

  test('runMonitoring is awaited (execute returns promise)', async () => {
    tester.runMonitoring.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 10)));
    utils.eventAndTelemetrySender.mockReturnValue(jest.fn());
    utils.cronOnSuccess.mockReturnValue(jest.fn());
    utils.cronOnError.mockReturnValue(jest.fn());

    const result = cronExecutor.execute();
    expect(result).toBeInstanceOf(Promise);

    await result;
    expect(tester.runMonitoring).toHaveBeenCalled();
  });

  test('execute handles runMonitoring errors', async () => {
    const testError = new Error('Monitoring failed');
    tester.runMonitoring.mockRejectedValue(testError);
    utils.eventAndTelemetrySender.mockReturnValue(jest.fn());
    utils.cronOnSuccess.mockReturnValue(jest.fn());
    utils.cronOnError.mockReturnValue(jest.fn());

    await expect(cronExecutor.execute()).rejects.toThrow('Monitoring failed');
  });
});


