jest.mock('applicationinsights');
jest.mock('@azure/data-tables');
jest.mock('../src/logger');
jest.mock('../src/synthetic-monitoring');
jest.mock('../src/utils');

const BASE_ENV = { ...process.env };

function loadCronExecutor(env) {
    process.env = { ...BASE_ENV, APP_INSIGHT_CONNECTION_STRING: 'test-connection-string', ...env };
    let modules;
    jest.isolateModules(() => {
        modules = {
            cronExecutor: require('../src/cron-executor'),
            tester: require('../src/synthetic-monitoring'),
            utils: require('../src/utils'),
            logger: require('../src/logger')
        };
    });
    modules.tester.runMonitoring.mockResolvedValue(undefined);
    modules.utils.eventAndTelemetrySender.mockReturnValue('appInsightSender');
    modules.utils.appInsightAndIcingaSender.mockReturnValue('icingaSender');
    return modules;
}

afterEach(() => {
    process.env = { ...BASE_ENV };
    jest.clearAllMocks();
});

describe('cron-executor icinga integration', () => {
    test('uses the Application Insights sender when the integration is disabled', async () => {
        const { cronExecutor, tester, utils } = loadCronExecutor({ ICINGA_INTEGRATION_ENABLED: 'false' });

        await cronExecutor.execute();

        expect(utils.appInsightAndIcingaSender).not.toHaveBeenCalled();
        expect(tester.runMonitoring.mock.calls[0][1]).toBe('appInsightSender');
        expect(tester.runMonitoring.mock.calls[0][4]).toBeUndefined();
    });

    test('uses the icinga sender with the configured host when enabled', async () => {
        const { cronExecutor, tester, utils } = loadCronExecutor({
            ICINGA_INTEGRATION_ENABLED: 'true',
            ICINGA_API_URL: 'https://icinga:5665',
            ICINGA_PASSWORD: 'pwd',
            ICINGA_HOST: 'my-host'
        });

        await cronExecutor.execute();

        const [, client, host] = utils.appInsightAndIcingaSender.mock.calls[0];
        expect(client.defaults.baseURL).toBe('https://icinga:5665/v1');
        expect(host).toBe('my-host');
        expect(tester.runMonitoring.mock.calls[0][1]).toBe('icingaSender');
        // host and services are created before the tests
        expect(typeof tester.runMonitoring.mock.calls[0][4]).toBe('function');
    });

    test('falls back to Application Insights only when the icinga configuration is incomplete', async () => {
        const { cronExecutor, tester, utils, logger } = loadCronExecutor({ ICINGA_INTEGRATION_ENABLED: 'true' });

        await cronExecutor.execute();

        expect(utils.appInsightAndIcingaSender).not.toHaveBeenCalled();
        expect(tester.runMonitoring.mock.calls[0][1]).toBe('appInsightSender');
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Icinga integration disabled'));
        expect(tester.runMonitoring.mock.calls[0][4]).toBeUndefined();
    });
});
