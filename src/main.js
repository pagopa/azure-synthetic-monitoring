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
      return queueExecutor.execute();
    case constants.CRON_OPERATION_MODE:
      logger.debug(`Running cron executor`)
      return cronExecutor.execute();
    default:
      logger.error(`Unknown operation mode: ${operationMode}, running cron executor`);
      return cronExecutor.execute();
  }
}

//start process
main()
