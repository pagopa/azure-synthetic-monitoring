
// modules
const utils = require('./utils')
const statics = require('./statics')
const logger = require('./logger')
const tester = require('./synthetic-monitoring')

const { QueueClient } = require("@azure/storage-queue");


module.exports = {
  execute
}

/**
 * Processes a single message from the inbound queue.
 *
 * Retrieves a message from the Azure Storage Queue, parses its contents,
 * and executes synthetic monitoring tests based on the message configuration.
 * Upon completion, the message is removed from the queue and results are
 * sent to the outbound queue via success or error handlers.
 *
 * @returns {Promise<void>} Resolves when the message has been processed or
 *                          when the queue is empty
 */
async function execute() {
  const requestQueueClient = new QueueClient(process.env.STORAGE_ACCOUNT_CONNECTION_STRING, process.env.INBOUND_QUEUE_NAME);
  const responseQueueClient = new QueueClient(process.env.STORAGE_ACCOUNT_CONNECTION_STRING, process.env.OUTBOUND_QUEUE_NAME);
  const messages = await requestQueueClient.receiveMessages({ numberOfMessages: process.env.QUEUE_BATCH_SIZE || 1 });

  if (messages.receivedMessageItems.length === 0) {
    logger.info('No messages to process');
    return;
  }

  const receivedMessage = messages.receivedMessageItems[0];

    const messageId = receivedMessage.messageId;
    const popReceipt = receivedMessage.popReceipt;
    const body = JSON.parse(receivedMessage.messageText);
    const alarmId = body.alarmId;

    await tester.runMonitoring(
      statics.monitorConfigurationFilterByName(body.appNames),
      utils.resultCollectorSender,
      utils.queueOnSuccess(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId),
      utils.queueOnError(requestQueueClient, responseQueueClient, messageId, popReceipt, alarmId)
    );

}


