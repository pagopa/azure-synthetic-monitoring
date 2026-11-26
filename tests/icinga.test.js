jest.mock('../src/logger');

const axios = require('axios')
const icinga = require('../src/icinga')
const logger = require('../src/logger')
const utils = require('../src/utils')

function metricContext(overrides = {}) {
    return {
        testId: 'myApp_myApi_aks',
        baseTelemetryData: { id: 'myApp_myApi_aks', message: '', success: false, name: 'myApp_myApi_aks', runLocation: 'loc' },
        baseEventData: { name: 'myApp_myApi_aks' },
        monitoringConfiguration: {
            appName: 'myApp',
            apiName: 'myApi',
            type: 'aks',
            url: 'https://myhost.com/path',
            checkCertificate: true,
            durationLimit: 10000
        },
        apiMetrics: { success: true, message: 'OK', duration: 1234 },
        certMetrics: { success: true },
        ...overrides
    }
}

afterEach(() => {
    jest.clearAllMocks()
})


describe('readConfig tests', () => {
    test('reads mandatory values and applies defaults', () => {
        const config = icinga.readConfig({ ICINGA_API_URL: 'https://icinga:5665/', ICINGA_PASSWORD: 'pwd' })
        expect(config).toEqual({
            apiUrl: 'https://icinga:5665',
            user: 'synthetic',
            password: 'pwd',
            host: 'synthetic',
            caCert: undefined,
            tlsServername: undefined
        })
    })

    test('reads optional values', () => {
        const config = icinga.readConfig({
            ICINGA_API_URL: 'https://icinga:5665',
            ICINGA_PASSWORD: 'pwd',
            ICINGA_USER: 'user',
            ICINGA_HOST: 'host',
            ICINGA_CA_CERT: '-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----',
            ICINGA_TLS_SERVERNAME: 'icinga-vm'
        })
        expect(config.user).toBe('user')
        expect(config.host).toBe('host')
        expect(config.caCert).toBe('-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n')
        expect(config.tlsServername).toBe('icinga-vm')
    })

    test('normalizes a CA copied with carriage returns, indentation and blank lines', () => {
        const config = icinga.readConfig({
            ICINGA_API_URL: 'https://icinga:5665',
            ICINGA_PASSWORD: 'pwd',
            ICINGA_CA_CERT: '  -----BEGIN CERTIFICATE-----  \r\n  abc\r\n\n  def \r\n-----END CERTIFICATE-----\r\n\n'
        })
        expect(config.caCert).toBe('-----BEGIN CERTIFICATE-----\nabc\ndef\n-----END CERTIFICATE-----\n')
    })

    test('throws when mandatory values are missing', () => {
        expect(() => icinga.readConfig({})).toThrow('missing icinga configuration: ICINGA_API_URL, ICINGA_PASSWORD')
        expect(() => icinga.readConfig({ ICINGA_API_URL: 'https://icinga:5665' })).toThrow('ICINGA_PASSWORD')
    })
})


describe('createClient tests', () => {
    test('creates a dedicated instance with TLS verification enabled', () => {
        const client = icinga.createClient({ apiUrl: 'https://icinga:5665', user: 'u', password: 'p', host: 'h', caCert: 'PEM' })
        expect(client).not.toBe(axios)
        expect(client.defaults.baseURL).toBe('https://icinga:5665/v1')
        expect(client.defaults.auth).toEqual({ username: 'u', password: 'p' })
        expect(client.defaults.httpsAgent.options.ca).toBe('PEM')
        expect(client.defaults.httpsAgent.options.rejectUnauthorized).not.toBe(false)
        // the interceptors registered on the global axios are not inherited
        expect(client.interceptors.request.handlers.length).toBe(0)
        expect(client.interceptors.response.handlers.length).toBe(0)
        expect(client.defaults.httpsAgent.options.checkServerIdentity).toBeUndefined()
    })

    test('verifies the certificate against tlsServername instead of the url host', () => {
        const tls = require('tls')
        const spy = jest.spyOn(tls, 'checkServerIdentity').mockReturnValue(undefined)
        const client = icinga.createClient({ apiUrl: 'https://icinga.fqdn:5665', user: 'u', password: 'p', host: 'h', tlsServername: 'icinga-vm' })
        const cert = { subject: { CN: 'icinga-vm' } }

        client.defaults.httpsAgent.options.checkServerIdentity('icinga.fqdn', cert)

        expect(spy).toHaveBeenCalledWith('icinga-vm', cert)
        spy.mockRestore()
    })
})


describe('exitStatus tests', () => {
    test('OK when api and certificate succeed', () => {
        expect(icinga.exitStatus(metricContext())).toBe(icinga.EXIT_OK)
    })

    test('CRITICAL when the api check fails', () => {
        expect(icinga.exitStatus(metricContext({ apiMetrics: { success: false, message: 'timeout' } }))).toBe(icinga.EXIT_CRITICAL)
        expect(icinga.exitStatus(metricContext({ apiMetrics: null }))).toBe(icinga.EXIT_CRITICAL)
    })

    test('WARNING when only the certificate check fails', () => {
        expect(icinga.exitStatus(metricContext({ certMetrics: { success: false, message: 'expiring' } }))).toBe(icinga.EXIT_WARNING)
    })

    test('certificate ignored when not checked', () => {
        const context = metricContext({ certMetrics: { success: false } })
        context.monitoringConfiguration.checkCertificate = false
        expect(icinga.exitStatus(context)).toBe(icinga.EXIT_OK)
    })
})


describe('checkResultPayload tests', () => {
    test('builds the payload for a successful test', () => {
        expect(icinga.checkResultPayload(metricContext(), 'synthetic')).toEqual({
            type: 'Service',
            service: 'synthetic!myApp-myApi-aks',
            exit_status: 0,
            plugin_output: 'OK - OK',
            check_source: 'synthetic-monitoring',
            performance_data: ['duration=1.234s;;10']
        })
    })

    test('reports the certificate error in the output', () => {
        const payload = icinga.checkResultPayload(metricContext({ certMetrics: { success: false, message: 'cert expiring' } }), 'synthetic')
        expect(payload.exit_status).toBe(1)
        expect(payload.plugin_output).toBe('WARNING - OK (certificate: cert expiring)')
    })

    test('omits perfdata without duration and handles missing message', () => {
        const payload = icinga.checkResultPayload(metricContext({ apiMetrics: { success: false } }), 'synthetic')
        expect(payload.exit_status).toBe(2)
        expect(payload.plugin_output).toBe('CRITICAL - no message provided')
        expect(payload.performance_data).toBeUndefined()
    })

    test('omits the critical threshold without durationLimit', () => {
        const context = metricContext()
        delete context.monitoringConfiguration.durationLimit
        expect(icinga.checkResultPayload(context, 'synthetic').performance_data).toEqual(['duration=1.234s;;'])
    })
})


describe('sendCheckResult tests', () => {
    test('posts the payload to process-check-result', async () => {
        const client = { post: jest.fn().mockResolvedValue({ data: { results: [{ code: 200 }] } }) }
        const context = metricContext()

        const result = await icinga.sendCheckResult(context, client, 'synthetic')

        expect(result).toBe(context)
        expect(client.post).toHaveBeenCalledWith('/actions/process-check-result', expect.objectContaining({
            service: 'synthetic!myApp-myApi-aks',
            exit_status: 0
        }))
    })

    test('logs status and body on http error without rejecting', async () => {
        const error = new Error('Request failed with status code 404')
        error.response = { status: 404, data: { error: 404, status: 'No objects found.' } }
        error.config = { auth: { username: 'synthetic', password: 'secret' } }
        const client = { post: jest.fn().mockRejectedValue(error) }
        const context = metricContext()

        await expect(icinga.sendCheckResult(context, client, 'synthetic')).resolves.toBe(context)

        const logged = logger.error.mock.calls.map((args) => args.join(' ')).join('\n')
        expect(logged).toContain('404')
        expect(logged).toContain('No objects found.')
        expect(logged).not.toContain('secret')
    })

    test('logs the message on network error without rejecting', async () => {
        const client = { post: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) }
        const context = metricContext()

        await expect(icinga.sendCheckResult(context, client, 'synthetic')).resolves.toBe(context)
        expect(logger.error).toHaveBeenCalledWith(context.testId, expect.stringContaining('ECONNREFUSED'))
    })
})


describe('appInsightAndIcingaSender tests', () => {
    test('sends telemetry and then the icinga check result', async () => {
        const telemetryClient = { trackEvent: jest.fn(), trackAvailability: jest.fn() }
        const client = { post: jest.fn().mockResolvedValue({ data: {} }) }
        const context = metricContext()

        const result = await utils.appInsightAndIcingaSender(telemetryClient, client, 'synthetic')(context)

        expect(result).toBe(context)
        expect(telemetryClient.trackEvent).toHaveBeenCalled()
        expect(telemetryClient.trackAvailability).toHaveBeenCalled()
        expect(client.post).toHaveBeenCalledTimes(1)
    })

    test('telemetry is sent even when icinga is down', async () => {
        const telemetryClient = { trackEvent: jest.fn(), trackAvailability: jest.fn() }
        const client = { post: jest.fn().mockRejectedValue(new Error('ETIMEDOUT')) }

        await utils.appInsightAndIcingaSender(telemetryClient, client, 'synthetic')(metricContext())

        expect(telemetryClient.trackAvailability).toHaveBeenCalled()
    })
})
