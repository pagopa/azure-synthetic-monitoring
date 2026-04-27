jest.mock('applicationinsights');
jest.mock('@azure/data-tables');
jest.mock('@azure/storage-queue');

process.env.STORAGE_ACCOUNT_NAME = 'test-account';
process.env.STORAGE_ACCOUNT_KEY = 'test-key';
process.env.STORAGE_ACCOUNT_TABLE_NAME = 'test-table';
process.env.AVAILABILITY_PREFIX = 'test-prefix';
process.env.HTTP_CLIENT_TIMEOUT = '5000';
process.env.CERT_VALIDITY_RANGE_DAYS = '7';
process.env.APP_INSIGHT_CONNECTION_STRING = 'test-connection-string';
process.env.STORAGE_ACCOUNT_CONNECTION_STRING = 'test-connection';
process.env.INBOUND_QUEUE_NAME = 'inbound';
process.env.OUTBOUND_QUEUE_NAME = 'outbound';
process.env.QUEUE_BATCH_SIZE = '1';

const queueExecutor = require('../src/queue-executor');
const tester = require('../src/synthetic-monitoring');
const utils = require('../src/utils');
const statics = require('../src/statics');

jest.mock('../src/synthetic-monitoring');
jest.mock('../src/utils');
jest.mock('../src/statics');

describe('queueExecutor tests', () => {
  let mockQueueClient;
  let mockReceiveMessages;
  let mockDeleteMessage;
  let mockSendMessage;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDeleteMessage = jest.fn().mockResolvedValue({});
    mockSendMessage = jest.fn().mockResolvedValue({});
    mockReceiveMessages = jest.fn().mockResolvedValue({
      receivedMessageItems: []
    });

    mockQueueClient = {
      receiveMessages: mockReceiveMessages,
      deleteMessage: mockDeleteMessage,
      sendMessage: mockSendMessage
    };

    require('@azure/storage-queue').QueueClient.mockImplementation(() => mockQueueClient);
  });

  test('execute function is exported', () => {
    expect(queueExecutor.execute).toBeDefined();
    expect(typeof queueExecutor.execute).toBe('function');
  });

  test('execute returns when no messages in queue', async () => {
    mockReceiveMessages.mockResolvedValue({
      receivedMessageItems: []
    });

    await queueExecutor.execute();

    expect(mockReceiveMessages).toHaveBeenCalled();
    expect(tester.runMonitoring).not.toHaveBeenCalled();
  });

  test('execute processes a single message', async () => {
    const mockMessage = {
      messageId: 'msg-1',
      popReceipt: 'receipt-1',
      messageText: JSON.stringify({ alarmId: 'alarm-1', appNames: ['app1'] })
    };

    mockReceiveMessages.mockResolvedValue({
      receivedMessageItems: [mockMessage]
    });

    tester.runMonitoring.mockResolvedValue(undefined);
    utils.resultCollectorSender = jest.fn();
    utils.queueOnSuccess.mockReturnValue(jest.fn().mockResolvedValue(undefined));
    utils.queueOnError.mockReturnValue(jest.fn().mockResolvedValue(undefined));
    statics.monitorConfigurationFilterByName.mockReturnValue(jest.fn());

    await queueExecutor.execute();

    expect(tester.runMonitoring).toHaveBeenCalledTimes(1);
  });

  test('execute processes multiple messages', async () => {
    const mockMessages = [
      {
        messageId: 'msg-1',
        popReceipt: 'receipt-1',
        messageText: JSON.stringify({ alarmId: 'alarm-1', appNames: ['app1'] })
      },
      {
        messageId: 'msg-2',
        popReceipt: 'receipt-2',
        messageText: JSON.stringify({ alarmId: 'alarm-2', appNames: ['app2'] })
      }
    ];

    mockReceiveMessages.mockResolvedValue({
      receivedMessageItems: mockMessages
    });

    tester.runMonitoring.mockResolvedValue(undefined);
    utils.resultCollectorSender = jest.fn();
    utils.queueOnSuccess.mockReturnValue(jest.fn().mockResolvedValue(undefined));
    utils.queueOnError.mockReturnValue(jest.fn().mockResolvedValue(undefined));
    statics.monitorConfigurationFilterByName.mockReturnValue(jest.fn());

    await queueExecutor.execute();

    expect(tester.runMonitoring).toHaveBeenCalledTimes(2);
  });

  test('execute calls runMonitoring with correct parameters', async () => {
    const mockMessage = {
      messageId: 'msg-1',
      popReceipt: 'receipt-1',
      messageText: JSON.stringify({ alarmId: 'alarm-1', appNames: ['app1', 'app2'] })
    };

    mockReceiveMessages.mockResolvedValue({
      receivedMessageItems: [mockMessage]
    });

    tester.runMonitoring.mockResolvedValue(undefined);
    utils.resultCollectorSender = jest.fn();
    utils.queueOnSuccess.mockReturnValue(jest.fn().mockResolvedValue(undefined));
    utils.queueOnError.mockReturnValue(jest.fn().mockResolvedValue(undefined));
    statics.monitorConfigurationFilterByName.mockReturnValue(jest.fn());

    await queueExecutor.execute();

    const [filterFunc, sender, onSuccess, onError] = tester.runMonitoring.mock.calls[0];
    expect(typeof filterFunc).toBe('function');
    expect(typeof sender).toBe('function');
    expect(typeof onSuccess).toBe('function');
    expect(typeof onError).toBe('function');
  });

  test('execute passes correct alarmId to success handler', async () => {
    const mockMessage = {
      messageId: 'msg-1',
      popReceipt: 'receipt-1',
      messageText: JSON.stringify({ alarmId: 'alarm-123', appNames: ['app1'] })
    };

    mockReceiveMessages.mockResolvedValue({
      receivedMessageItems: [mockMessage]
    });

    tester.runMonitoring.mockResolvedValue(undefined);
    utils.resultCollectorSender = jest.fn();
    utils.queueOnSuccess.mockReturnValue(jest.fn().mockResolvedValue(undefined));
    utils.queueOnError.mockReturnValue(jest.fn().mockResolvedValue(undefined));
    statics.monitorConfigurationFilterByName.mockReturnValue(jest.fn());

    await queueExecutor.execute();

    expect(utils.queueOnSuccess).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      'msg-1',
      'receipt-1',
      'alarm-123'
    );
  });

  test('execute respects QUEUE_BATCH_SIZE environment variable', async () => {
    process.env.QUEUE_BATCH_SIZE = '5';
    
    mockReceiveMessages.mockResolvedValue({
      receivedMessageItems: []
    });

    await queueExecutor.execute();

    expect(mockReceiveMessages).toHaveBeenCalledWith(
      expect.objectContaining({ numberOfMessages: 5 })
    );
  });

  test('execute defaults QUEUE_BATCH_SIZE to 1 when not set', async () => {
    delete process.env.QUEUE_BATCH_SIZE;
    
    mockReceiveMessages.mockResolvedValue({
      receivedMessageItems: []
    });

    await queueExecutor.execute();

    expect(mockReceiveMessages).toHaveBeenCalledWith(
      expect.objectContaining({ numberOfMessages: 1 })
    );
  });
});
