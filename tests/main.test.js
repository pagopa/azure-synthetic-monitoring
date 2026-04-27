jest.mock('applicationinsights');
jest.mock('@azure/data-tables');

process.env.STORAGE_ACCOUNT_NAME = 'test-account';
process.env.STORAGE_ACCOUNT_KEY = 'test-key';
process.env.STORAGE_ACCOUNT_TABLE_NAME = 'test-table';
process.env.AVAILABILITY_PREFIX = 'test-prefix';
process.env.HTTP_CLIENT_TIMEOUT = '5000';
process.env.CERT_VALIDITY_RANGE_DAYS = '7';
process.env.APP_INSIGHT_CONNECTION_STRING = 'test-connection-string';

const queueExecutor = require('../src/queue-executor');
const cronExecutor = require('../src/cron-executor');
const constants = require('../src/const');

jest.mock('../src/queue-executor');
jest.mock('../src/cron-executor');
jest.mock('../src/logger');

describe('main tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queueExecutor.execute.mockResolvedValue(undefined);
    cronExecutor.execute.mockResolvedValue(undefined);
  });


  test('queueExecutor has execute function', () => {
    expect(typeof queueExecutor.execute).toBe('function');
  });

  test('cronExecutor has execute function', () => {
    expect(typeof cronExecutor.execute).toBe('function');
  });
});
