const process = require('process');

const LOG_LEVELS = { DEBUG: 0, INFO: 1, ERROR: 2 };
const DEFAULT_LEVEL = 'INFO';

module.exports = { debug, info, error };

function getConfiguredLevel() {
    const level = process.env.LOG_LEVEL;
    return (level && level in LOG_LEVELS) ? level : DEFAULT_LEVEL;
}

function shouldLog(messageLevel) {
    return LOG_LEVELS[messageLevel] >= LOG_LEVELS[getConfiguredLevel()];
}

function debug(...args) {
    if (shouldLog('DEBUG')) console.log('[DEBUG]', ...args);
}

function info(...args) {
    if (shouldLog('INFO')) console.log('[INFO]',...args);
}

function error(...args) {
    if (shouldLog('ERROR')) console.log('[ERROR]',...args);
}

module.exports = { debug, info, error };
