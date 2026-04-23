const logger = require('../src/logger');

let consoleDebug;
let consoleLog;
let consoleError;

beforeEach(() => {
    consoleLog   = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.LOG_LEVEL;
});


describe('LOG_LEVEL=DEBUG', () => {
    beforeEach(() => { process.env.LOG_LEVEL = 'DEBUG'; });

    test('debug() calls console.debug', () => {
        logger.debug('msg');
        expect(consoleLog).toHaveBeenCalledWith('[DEBUG]', 'msg');
    });

    test('info() calls console.log', () => {
        logger.info('msg');
        expect(consoleLog).toHaveBeenCalledWith('[INFO]', 'msg');
    });

    test('error() calls console.error', () => {
        logger.error('msg');
        expect(consoleLog).toHaveBeenCalledWith('[ERROR]', 'msg');
    });
});


describe('LOG_LEVEL=INFO', () => {
    beforeEach(() => { process.env.LOG_LEVEL = 'INFO'; });

    test('debug() does not call console.debug', () => {
        logger.debug('msg');
        expect(consoleLog).not.toHaveBeenCalled();
    });

    test('info() calls console.log', () => {
        logger.info('msg');
        expect(consoleLog).toHaveBeenCalledWith('[INFO]', 'msg');
    });

    test('error() calls console.error', () => {
        logger.error('msg');
        expect(consoleLog).toHaveBeenCalledWith('[ERROR]','msg');
    });
});


describe('LOG_LEVEL=ERROR', () => {
    beforeEach(() => { process.env.LOG_LEVEL = 'ERROR'; });

    test('debug() does not call console.debug', () => {
        logger.debug('msg');
        expect(consoleLog).not.toHaveBeenCalled();
    });

    test('info() does not call console.log', () => {
        logger.info('msg');
        expect(consoleLog).not.toHaveBeenCalled();
    });

    test('error() calls console.error', () => {
        logger.error('msg');
        expect(consoleLog).toHaveBeenCalledWith('[ERROR]', 'msg');
    });
});


describe('LOG_LEVEL unset (defaults to INFO)', () => {
    test('debug() does not call console.debug', () => {
        logger.debug('msg');
        expect(consoleLog).not.toHaveBeenCalled();
    });

    test('info() calls console.log', () => {
        logger.info('msg');
        expect(consoleLog).toHaveBeenCalledWith('[INFO]', 'msg');
    });

    test('error() calls console.error', () => {
        logger.error('msg');
        expect(consoleLog).toHaveBeenCalledWith('[ERROR]','msg');
    });
});


describe('LOG_LEVEL invalid (defaults to INFO)', () => {
    beforeEach(() => { process.env.LOG_LEVEL = 'VERBOSE'; });

    test('debug() does not call console.debug', () => {
        logger.debug('msg');
        expect(consoleLog).not.toHaveBeenCalled();
    });

    test('info() calls console.log', () => {
        logger.info('msg');
        expect(consoleLog).toHaveBeenCalledWith('[INFO]', 'msg');
    });
});


describe('multiple arguments', () => {
    beforeEach(() => { process.env.LOG_LEVEL = 'DEBUG'; });

    test('passes all arguments through', () => {
        logger.info('hello', 'world', 42);
        expect(consoleLog).toHaveBeenCalledWith('[INFO]', 'hello', 'world', 42);
    });
});
