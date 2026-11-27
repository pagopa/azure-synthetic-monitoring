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
            plugin_output: 'OK - https://myhost.com/path\ncertificate OK',
            check_source: 'synthetic-monitoring',
            performance_data: ['duration=1.234s;;10']
        })
    })

    test('reports the certificate error in the output', () => {
        const payload = icinga.checkResultPayload(metricContext({ certMetrics: { success: false, message: 'cert expiring' } }), 'synthetic')
        expect(payload.exit_status).toBe(1)
        expect(payload.plugin_output).toBe('KO certificate - https://myhost.com/path - cert expiring')
    })

    test('omits perfdata without duration and handles missing message', () => {
        const payload = icinga.checkResultPayload(metricContext({ apiMetrics: { success: false } }), 'synthetic')
        expect(payload.exit_status).toBe(2)
        expect(payload.plugin_output).toBe('KO - https://myhost.com/path - no message provided\ncertificate OK')
        expect(payload.performance_data).toBeUndefined()
    })

    test('omits the critical threshold without durationLimit', () => {
        const context = metricContext()
        delete context.monitoringConfiguration.durationLimit
        expect(icinga.checkResultPayload(context, 'synthetic').performance_data).toEqual(['duration=1.234s;;'])
    })
})


describe('plugin output tests', () => {
    test('reports the api error with the url', () => {
        const payload = icinga.checkResultPayload(metricContext({ apiMetrics: { success: false, message: 'timeout of 10000ms exceeded' } }), 'synthetic')
        expect(payload.plugin_output).toBe('KO - https://myhost.com/path - timeout of 10000ms exceeded\ncertificate OK')
    })

    test('does not repeat the certificate error when the api check fails', () => {
        const payload = icinga.checkResultPayload(metricContext({
            apiMetrics: { success: false, message: 'timeout of 10000ms exceeded' },
            certMetrics: { success: false, message: 'timeout of 10000ms exceeded' }
        }), 'synthetic')
        expect(payload.exit_status).toBe(2)
        expect(payload.plugin_output).toBe('KO - https://myhost.com/path - timeout of 10000ms exceeded\ncertificate KO')
    })

    test('reports a different certificate error when the api check fails', () => {
        const payload = icinga.checkResultPayload(metricContext({
            apiMetrics: { success: false, message: 'status code 503 not valid: Service Temporarily Unavailable' },
            certMetrics: { success: false, message: 'certificate expiring in 3 days' }
        }), 'synthetic')
        expect(payload.plugin_output).toBe('KO - https://myhost.com/path - status code 503 not valid: Service Temporarily Unavailable\ncertificate KO - certificate expiring in 3 days')
    })

    test('no certificate outcome when the certificate is not checked', () => {
        const ok = metricContext()
        ok.monitoringConfiguration.checkCertificate = false
        expect(icinga.checkResultPayload(ok, 'synthetic').plugin_output).toBe('OK - https://myhost.com/path')

        const ko = metricContext({ apiMetrics: { success: false, message: 'boom' } })
        ko.monitoringConfiguration.checkCertificate = false
        expect(icinga.checkResultPayload(ko, 'synthetic').plugin_output).toBe('KO - https://myhost.com/path - boom')
    })

    test('no certificate outcome when the certificate check did not run', () => {
        const context = metricContext({ apiMetrics: { success: false, message: 'boom' }, certMetrics: { domain: 'myhost.com', checkCert: true } })
        expect(icinga.checkResultPayload(context, 'synthetic').plugin_output).toBe('KO - https://myhost.com/path - boom')
    })

    test('keeps the query string and removes embedded credentials', () => {
        const context = metricContext()
        context.monitoringConfiguration.url = 'https://user:secret@api.host/shared/statuspage/v1/info?product=bizevents'
        const payload = icinga.checkResultPayload(context, 'synthetic')
        expect(payload.plugin_output).toBe('OK - https://api.host/shared/statuspage/v1/info?product=bizevents\ncertificate OK')
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
        expect(logger.debug).toHaveBeenCalledWith(context.testId,
            'icinga check result sent for synthetic!myApp-myApi-aks: OK "OK - https://myhost.com/path\\ncertificate OK", icinga code 200')
    })

    test('logs the sent state also on error', async () => {
        const client = { post: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) }
        const context = metricContext({ apiMetrics: { success: false, message: 'boom' } })

        await icinga.sendCheckResult(context, client, 'synthetic')

        expect(logger.error).toHaveBeenCalledWith(context.testId,
            'error sending icinga check result for synthetic!myApp-myApi-aks: CRITICAL "KO - https://myhost.com/path - boom\\ncertificate OK", connect ECONNREFUSED')
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


describe('object attributes tests', () => {
    test('host is a dummy always UP managed by synthetic', () => {
        expect(icinga.hostAttributes()).toEqual({
            check_command: 'dummy',
            vars: { dummy_state: 0, dummy_text: 'synthetic monitoring', managed_by: 'synthetic' }
        })
    })

    test('service goes CRITICAL after 8 minutes without results', () => {
        const configuration = { ...metricContext().monitoringConfiguration, tags: { domain: 'bizevents' } }
        expect(icinga.serviceAttributes(configuration)).toEqual({
            check_command: 'dummy',
            max_check_attempts: 1,
            check_interval: 480,
            retry_interval: 480,
            vars: {
                dummy_state: 2,
                dummy_text: 'no result from synthetic in the last 8 minutes',
                managed_by: 'synthetic',
                url: 'https://myhost.com/path',
                domain: 'bizevents'
            }
        })
    })

    test('service without domain tag has no domain var', () => {
        const configuration = { ...metricContext().monitoringConfiguration, tags: {} }
        expect(icinga.serviceAttributes(configuration).vars.domain).toBeUndefined()
    })
})


describe('ensureHostAndServices tests', () => {
    const configuration = (appName, apiName, type = 'aks') => ({ appName, apiName, type, url: 'https://myhost.com/path', tags: {} })
    const notFound = () => Object.assign(new Error('404'), { response: { status: 404, data: { error: 404, status: 'No objects found.' } } })
    const alreadyExists = () => Object.assign(new Error('500'), {
        response: { status: 500, data: { results: [{ code: 500, errors: ["Object 'x' already exists."], status: 'Object could not be created.' }] } }
    })

    // attributes on icinga of a service created by synthetic and up to date: <appName>-<apiName>-<type>
    const upToDate = (name) => {
        const [appName, apiName, type] = name.split('-')
        return icinga.serviceAttributes(configuration(appName, apiName, type))
    }

    // services: created by synthetic (name => up to date, [name, attrs] => given attrs), unmanaged: created by someone else
    function client({ hostExists = true, services = [], unmanaged = [], put, post, del } = {}) {
        const result = (name, attrs) => ({ name: `synthetic!${name}`, attrs: { name, ...attrs } })
        return {
            get: jest.fn().mockImplementation((path) => {
                if (path.startsWith('/objects/hosts/')) {
                    return hostExists ? Promise.resolve({ data: { results: [{ name: 'synthetic' }] } }) : Promise.reject(notFound())
                }
                return Promise.resolve({ data: { results: [
                    ...services.map((service) => Array.isArray(service) ? result(...service) : result(service, upToDate(service))),
                    ...unmanaged.map((name) => result(name, { check_command: 'dummy', vars: null }))
                ] } })
            }),
            put: put || jest.fn().mockResolvedValue({ data: { results: [{ code: 200 }] } }),
            post: post || jest.fn().mockResolvedValue({ data: { results: [{ code: 200 }] } }),
            delete: del || jest.fn().mockResolvedValue({ data: { results: [{ code: 200 }] } })
        }
    }

    test('creates only the missing services, once each', async () => {
        const c = client({ services: ['app-one-aks'] })

        await icinga.ensureHostAndServices([configuration('app', 'one'), configuration('app', 'two'), configuration('app', 'two')], c, 'synthetic')

        expect(c.get).toHaveBeenCalledWith('/objects/services?attrs=name&attrs=check_command&attrs=check_interval&attrs=retry_interval&attrs=max_check_attempts&attrs=vars', { params: { filter: 'host.name=="synthetic"' } })
        expect(c.put).toHaveBeenCalledTimes(1)
        expect(c.put).toHaveBeenCalledWith('/objects/services/synthetic!app-two-aks', { attrs: expect.objectContaining({ check_interval: 480 }) })
        expect(c.delete).not.toHaveBeenCalled()
        expect(c.post).not.toHaveBeenCalled()
        expect(logger.info).toHaveBeenCalledWith('icinga host synthetic: 1 services existing, 1 created, 0 updated, 0 deleted, 0 failed')
    })

    test('updates only the changed attributes of the services managed by synthetic, vars as a whole', async () => {
        const changedUrl = { ...upToDate('app-one-aks'), vars: { ...upToDate('app-one-aks').vars, url: 'https://old.com/path' } }
        const oldInterval = { ...upToDate('app-two-aks'), check_interval: 300.0, retry_interval: 480.0 }
        const c = client({ services: [['app-one-aks', changedUrl], ['app-two-aks', oldInterval], 'app-three-aks'] })

        await icinga.ensureHostAndServices([configuration('app', 'one'), configuration('app', 'two'), configuration('app', 'three')], c, 'synthetic')

        expect(c.post.mock.calls).toEqual([
            ['/objects/services/synthetic!app-one-aks', { attrs: { vars: upToDate('app-one-aks').vars } }],
            ['/objects/services/synthetic!app-two-aks', { attrs: { check_interval: 480 } }]
        ])
        expect(logger.info).toHaveBeenCalledWith('icinga service synthetic!app-one-aks updated: vars')
        expect(logger.info).toHaveBeenCalledWith('icinga service synthetic!app-two-aks updated: check_interval')
        expect(logger.info).toHaveBeenCalledWith('icinga host synthetic: 3 services existing, 0 created, 2 updated, 0 deleted, 0 failed')
    })

    test('a domain tag removed from the configuration is removed from the vars', async () => {
        const withDomain = { ...upToDate('app-one-aks'), vars: { ...upToDate('app-one-aks').vars, domain: 'core' } }
        const c = client({ services: [['app-one-aks', withDomain]] })

        await icinga.ensureHostAndServices([configuration('app', 'one')], c, 'synthetic')

        expect(c.post).toHaveBeenCalledWith('/objects/services/synthetic!app-one-aks', { attrs: { vars: upToDate('app-one-aks').vars } })
        expect(upToDate('app-one-aks').vars).not.toHaveProperty('domain')
    })

    test('never updates services not created by synthetic', async () => {
        const c = client({ unmanaged: ['app-one-aks'] })

        await icinga.ensureHostAndServices([configuration('app', 'one')], c, 'synthetic')

        expect(c.post).not.toHaveBeenCalled()
        expect(c.put).not.toHaveBeenCalled()
    })

    test('a failed update is logged and counted', async () => {
        const stale = { ...upToDate('app-one-aks'), max_check_attempts: 3 }
        const post = jest.fn().mockRejectedValue(Object.assign(new Error('403'), { response: { status: 403, data: { status: 'No permission' } } }))
        const c = client({ services: [['app-one-aks', stale]], post })

        await expect(icinga.ensureHostAndServices([configuration('app', 'one')], c, 'synthetic')).resolves.toBeUndefined()

        expect(logger.error).toHaveBeenCalledWith('error updating icinga service synthetic!app-one-aks: 403 {"status":"No permission"}')
        expect(logger.info).toHaveBeenCalledWith('icinga host synthetic: 1 services existing, 0 created, 0 updated, 0 deleted, 1 failed')
    })

    test('creates the host when missing, before the services', async () => {
        const c = client({ hostExists: false })

        await icinga.ensureHostAndServices([configuration('app', 'one')], c, 'synthetic')

        expect(c.put.mock.calls.map((call) => call[0])).toEqual(['/objects/hosts/synthetic', '/objects/services/synthetic!app-one-aks'])
        expect(c.put.mock.calls[0][1]).toEqual({ attrs: icinga.hostAttributes() })
    })

    test('an object created meanwhile by another run counts as created', async () => {
        const c = client({ put: jest.fn().mockRejectedValue(alreadyExists()) })

        await icinga.ensureHostAndServices([configuration('app', 'one')], c, 'synthetic')

        expect(logger.error).not.toHaveBeenCalled()
        expect(logger.info).toHaveBeenCalledWith('icinga host synthetic: 0 services existing, 1 created, 0 updated, 0 deleted, 0 failed')
    })

    test('services are not created when the host cannot be created', async () => {
        const c = client({ hostExists: false, put: jest.fn().mockRejectedValue(Object.assign(new Error('403'), { response: { status: 403, data: { status: 'No permission' } } })) })

        await icinga.ensureHostAndServices([configuration('app', 'one')], c, 'synthetic')

        expect(c.put).toHaveBeenCalledTimes(1)
        expect(logger.error).toHaveBeenCalledWith('error creating icinga host synthetic: 403 {"status":"No permission"}')
    })

    test('counts failed services and never rejects', async () => {
        const put = jest.fn()
            .mockResolvedValueOnce({ data: {} })
            .mockRejectedValueOnce(new Error('socket hang up'))
        const c = client({ put })

        await expect(icinga.ensureHostAndServices([configuration('app', 'one'), configuration('app', 'two')], c, 'synthetic')).resolves.toBeUndefined()

        expect(logger.error).toHaveBeenCalledWith('error creating icinga service synthetic!app-two-aks: socket hang up')
        expect(logger.info).toHaveBeenCalledWith('icinga host synthetic: 0 services existing, 1 created, 0 updated, 0 deleted, 1 failed')
    })

    test('deletes the services managed by synthetic without a configuration', async () => {
        const c = client({ services: ['app-one-aks', 'old-one-aks', 'old-two-aks'] })

        await icinga.ensureHostAndServices([configuration('app', 'one')], c, 'synthetic')

        expect(c.put).not.toHaveBeenCalled()
        expect(c.delete.mock.calls).toEqual([
            ['/objects/services/synthetic!old-one-aks', { params: { cascade: 1 } }],
            ['/objects/services/synthetic!old-two-aks', { params: { cascade: 1 } }]
        ])
        expect(logger.info).toHaveBeenCalledWith('icinga service synthetic!old-one-aks deleted: no monitoring configuration')
        expect(logger.info).toHaveBeenCalledWith('icinga service synthetic!old-two-aks deleted: no monitoring configuration')
        expect(logger.info).toHaveBeenCalledWith('icinga host synthetic: 3 services existing, 0 created, 0 updated, 2 deleted, 0 failed')
    })

    test('never deletes services not created by synthetic', async () => {
        const c = client({ unmanaged: ['manual-one-aks'] })

        await icinga.ensureHostAndServices([configuration('app', 'one')], c, 'synthetic')

        expect(c.delete).not.toHaveBeenCalled()
        expect(logger.info).toHaveBeenCalledWith('icinga host synthetic: 1 services existing, 1 created, 0 updated, 0 deleted, 0 failed')
    })

    test('a service already deleted counts as deleted, other errors as failed', async () => {
        const del = jest.fn()
            .mockRejectedValueOnce(notFound())
            .mockRejectedValueOnce(Object.assign(new Error('403'), { response: { status: 403, data: { status: 'No permission' } } }))
        const c = client({ services: ['old-one-aks', 'old-two-aks'], del })

        await expect(icinga.ensureHostAndServices([configuration('app', 'one')], c, 'synthetic')).resolves.toBeUndefined()

        expect(logger.error).toHaveBeenCalledWith('error deleting icinga service synthetic!old-two-aks: 403 {"status":"No permission"}')
        expect(logger.info).toHaveBeenCalledWith('icinga host synthetic: 2 services existing, 1 created, 0 updated, 1 deleted, 1 failed')
    })

    test('logs and resolves when icinga is unreachable', async () => {
        const c = { get: jest.fn().mockRejectedValue(new Error('connect ETIMEDOUT')), put: jest.fn() }

        await expect(icinga.ensureHostAndServices([configuration('app', 'one')], c, 'synthetic')).resolves.toBeUndefined()

        expect(c.put).not.toHaveBeenCalled()
        expect(logger.error).toHaveBeenCalledWith('error reading icinga host synthetic: connect ETIMEDOUT')
    })

    test('creates the services in batches', async () => {
        let inFlight = 0
        let maxInFlight = 0
        const put = jest.fn().mockImplementation(async () => {
            inFlight++
            maxInFlight = Math.max(maxInFlight, inFlight)
            await new Promise((resolve) => setImmediate(resolve))
            inFlight--
            return { data: {} }
        })
        const configurations = Array.from({ length: 25 }, (_, i) => configuration('app', `api${i}`))

        await icinga.ensureHostAndServices(configurations, client({ put }), 'synthetic')

        expect(put).toHaveBeenCalledTimes(25)
        expect(maxInFlight).toBeLessThanOrEqual(10)
    })
})


describe('run stats tests', () => {
    test('counts sent results by state and failed sends', async () => {
        const stats = icinga.createStats()
        const ok = { post: jest.fn().mockResolvedValue({ data: { results: [{ code: 200 }] } }) }
        const ko = { post: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) }

        await icinga.sendCheckResult(metricContext(), ok, 'synthetic', stats)
        await icinga.sendCheckResult(metricContext({ certMetrics: { success: false, message: 'expiring' } }), ok, 'synthetic', stats)
        await icinga.sendCheckResult(metricContext({ apiMetrics: { success: false, message: 'boom' } }), ok, 'synthetic', stats)
        await icinga.sendCheckResult(metricContext(), ko, 'synthetic', stats)

        expect(stats).toEqual({ sent: 3, failed: 1, states: { OK: 1, WARNING: 1, CRITICAL: 1 } })
        expect(icinga.statsSummary(stats)).toBe('3 sent (OK 1, WARNING 1, CRITICAL 1), 1 failed')
    })

    test('stats are optional', async () => {
        const client = { post: jest.fn().mockResolvedValue({ data: {} }) }
        await expect(icinga.sendCheckResult(metricContext(), client, 'synthetic')).resolves.toBeDefined()
    })

    test('appInsightAndIcingaSender passes the stats', async () => {
        const stats = icinga.createStats()
        const telemetryClient = { trackEvent: jest.fn(), trackAvailability: jest.fn() }
        const client = { post: jest.fn().mockResolvedValue({ data: {} }) }

        await utils.appInsightAndIcingaSender(telemetryClient, client, 'synthetic', stats)(metricContext())

        expect(stats.sent).toBe(1)
    })
})
