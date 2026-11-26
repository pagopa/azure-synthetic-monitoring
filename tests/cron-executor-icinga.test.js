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
            logger: require('../src/logger'),
            icinga: require('../src/icinga'),
            businessProcess: require('../src/business-process')
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

    const ICINGA_ENV = {
        ICINGA_INTEGRATION_ENABLED: 'true',
        ICINGA_API_URL: 'https://icinga:5665',
        ICINGA_PASSWORD: 'pwd',
        ICINGA_HOST: 'my-host'
    };

    test('the hook creates host and services, then updates the business process', async () => {
        const { cronExecutor, tester, icinga, businessProcess, logger } = loadCronExecutor({
            ...ICINGA_ENV, BP_API_URL: 'http://10.0.0.4:8080', ICINGA_BP: 'my-bp'
        });
        const order = [];
        jest.spyOn(icinga, 'ensureHostAndServices').mockImplementation(async () => { order.push('icinga'); });
        jest.spyOn(businessProcess, 'updateBusinessProcess').mockImplementation(async () => { order.push('bp'); });
        const configurations = [{ appName: 'a', apiName: 'b', type: 'c', tags: { domain: 'd' } }];

        await cronExecutor.execute();
        await tester.runMonitoring.mock.calls[0][4](configurations);

        expect(order).toEqual(['icinga', 'bp']);
        expect(logger.info).toHaveBeenCalledWith('icinga check results: sending 1 results to host my-host');
        expect(icinga.ensureHostAndServices).toHaveBeenCalledWith(configurations, expect.anything(), 'my-host');
        const [, client, bp, host] = businessProcess.updateBusinessProcess.mock.calls[0];
        expect(client.defaults.baseURL).toBe('http://10.0.0.4:8080');
        expect(bp).toBe('my-bp');
        expect(host).toBe('my-host');
        expect(logger.debug).toHaveBeenCalledWith('Icinga business process update enabled: http://10.0.0.4:8080, business process my-bp');
    });

    test('the business process is not updated without BP_API_URL', async () => {
        const { cronExecutor, tester, icinga, businessProcess, logger } = loadCronExecutor(ICINGA_ENV);
        jest.spyOn(icinga, 'ensureHostAndServices').mockResolvedValue(undefined);
        jest.spyOn(businessProcess, 'updateBusinessProcess').mockResolvedValue(undefined);

        await cronExecutor.execute();
        await tester.runMonitoring.mock.calls[0][4]([]);

        expect(icinga.ensureHostAndServices).toHaveBeenCalled();
        expect(businessProcess.updateBusinessProcess).not.toHaveBeenCalled();
        expect(logger.debug).toHaveBeenCalledWith('Icinga business process update disabled: BP_API_URL not set');
    });

    test('the business process is not updated without ICINGA_BP, icinga keeps working', async () => {
        const { cronExecutor, tester, icinga, businessProcess, logger } = loadCronExecutor({ ...ICINGA_ENV, BP_API_URL: 'http://10.0.0.4:8080' });
        jest.spyOn(icinga, 'ensureHostAndServices').mockResolvedValue(undefined);
        jest.spyOn(businessProcess, 'updateBusinessProcess').mockResolvedValue(undefined);

        await cronExecutor.execute();
        await tester.runMonitoring.mock.calls[0][4]([]);

        expect(tester.runMonitoring.mock.calls[0][1]).toBe('icingaSender');
        expect(icinga.ensureHostAndServices).toHaveBeenCalled();
        expect(businessProcess.updateBusinessProcess).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith('Icinga business process update disabled: missing business process configuration: ICINGA_BP');
    });

    test('logs the summary of the check results sent at the end of the run', async () => {
        const { cronExecutor, tester, utils, logger } = loadCronExecutor(ICINGA_ENV);
        tester.runMonitoring.mockImplementation(async () => {
            const stats = utils.appInsightAndIcingaSender.mock.calls[0][3];
            stats.sent = 2;
            stats.states.OK = 1;
            stats.states.CRITICAL = 1;
            stats.failed = 1;
        });

        await cronExecutor.execute();

        expect(logger.info).toHaveBeenCalledWith('icinga check results to host my-host: 2 sent (OK 1, WARNING 0, CRITICAL 1), 1 failed');
    });

    test('no icinga summary when the integration is disabled', async () => {
        const { cronExecutor, logger } = loadCronExecutor({ ICINGA_INTEGRATION_ENABLED: 'false' });

        await cronExecutor.execute();

        expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('icinga check results'));
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
