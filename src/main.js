// modules
const logger = require('./logger')
const constants = require('./const')
const queueExecutor = require('./queue-executor')
const cronExecutor = require('./cron-executor')



async function main() {

  const operationMode = process.env.OPERATION_MODE || constants.DEFAULT_OPERATION_MODE

  switch (operationMode) {
    case constants.QUEUE_OPERATION_MODE:
      logger.debug(`Running queue executor`)
      return await queueExecutor.execute();
    case constants.CRON_OPERATION_MODE:
      logger.debug(`Running cron executor`)
      return await cronExecutor.execute();
    default:
      logger.error(`Unknown operation mode: ${operationMode}, running cron executor`);
      return await cronExecutor.execute();
  }
}

//start process
main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    logger.error(`Fatal error: ${error?.message || error}`);
    if (error?.stack) {
      logger.error(`Stack trace: ${error.stack}`);
    }
    process.exit(1);
  });
