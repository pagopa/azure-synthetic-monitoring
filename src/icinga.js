// Icinga integration: publishes the result of each synthetic test as a passive check result
const axios = require('axios')
const https = require('https')
const tls = require('tls')
const process = require('process')

const logger = require('./logger')

const DEFAULT_USER = 'synthetic'
const DEFAULT_HOST = 'synthetic'
const REQUEST_TIMEOUT_MS = 10000
const MAX_SOCKETS = 10

// Icinga plugin exit codes
const EXIT_OK = 0
const EXIT_WARNING = 1
const EXIT_CRITICAL = 2
const STATUS_LABEL = { [EXIT_OK]: 'OK', [EXIT_WARNING]: 'WARNING', [EXIT_CRITICAL]: 'CRITICAL' }

// a service without results from synthetic for this long goes CRITICAL: every passive result
// postpones the next active check (dummy) by check_interval. with the cron every 5 minutes
// a single missed run turns the service red
const FRESHNESS_SECONDS = 480
const MANAGED_BY = 'synthetic'

module.exports = {
    readConfig,
    createClient,
    serviceName,
    exitStatus,
    checkResultPayload,
    sendCheckResult,
    createStats,
    statsSummary,
    hostAttributes,
    serviceAttributes,
    ensureHostAndServices,
    FRESHNESS_SECONDS,
    EXIT_OK,
    EXIT_WARNING,
    EXIT_CRITICAL
}


/**
 * reads the icinga configuration from the environment
 * @param {object} env environment variables (defaults to process.env)
 * @returns {object} icinga configuration
 * @throws {Error} when a mandatory variable is missing
 */
function readConfig(env = process.env) {
    const missing = ['ICINGA_API_URL', 'ICINGA_PASSWORD'].filter((name) => !env[name])
    if (missing.length > 0) {
        throw new Error(`missing icinga configuration: ${missing.join(', ')}`)
    }
    return {
        apiUrl: env.ICINGA_API_URL.replace(/\/+$/, ''),
        user: env.ICINGA_USER || DEFAULT_USER,
        password: env.ICINGA_PASSWORD,
        host: env.ICINGA_HOST || DEFAULT_HOST,
        caCert: env.ICINGA_CA_CERT ? normalizePem(env.ICINGA_CA_CERT) : undefined,
        // name to verify on the api certificate when it differs from the url host:
        // the icinga api certificate is issued for the VM short hostname
        tlsServername: env.ICINGA_TLS_SERVERNAME || undefined
    }
}


/**
 * normalizes a PEM read from the environment: "\n" literals (single line env files)
 * become new lines, carriage returns and leading/trailing spaces of each line are removed
 * @param {string} pem
 * @returns {string}
 */
function normalizePem(pem) {
    return pem
        .replace(/\\n/g, '\n')
        .split('\n')
        .map((line) => line.replace(/\r/g, '').trim())
        .filter((line) => line.length > 0)
        .join('\n') + '\n'
}


/**
 * creates a dedicated http client for the icinga api.
 * it is a separate axios instance so that the interceptors registered on the global axios
 * (used by the synthetic tests) are not applied: they would log the whole request config,
 * credentials included, on error
 * TLS verification is always enabled: when caCert is not provided the system CAs are used,
 * when tlsServername is provided the certificate is verified against that name instead of the url host
 * @param {object} config icinga configuration, as returned by readConfig
 * @returns {Axios} axios instance
 */
function createClient(config) {
    const agentOptions = { keepAlive: true, maxSockets: MAX_SOCKETS, ca: config.caCert }
    if (config.tlsServername) {
        // the certificate is still fully verified (CA, validity), only the expected name changes
        agentOptions.checkServerIdentity = (host, cert) => tls.checkServerIdentity(config.tlsServername, cert)
    }
    return axios.create({
        baseURL: `${config.apiUrl}/v1`,
        timeout: REQUEST_TIMEOUT_MS,
        auth: { username: config.user, password: config.password },
        headers: { Accept: 'application/json' },
        httpsAgent: new https.Agent(agentOptions)
    })
}


/**
 * name of the icinga service associated to a monitoring configuration
 * @param {object} monitoringConfiguration
 * @returns {string}
 */
function serviceName(monitoringConfiguration) {
    return `${monitoringConfiguration.appName}-${monitoringConfiguration.apiName}-${monitoringConfiguration.type}`
}


/**
 * icinga exit status of a test: CRITICAL when the api check fails,
 * WARNING when only the certificate check fails, OK otherwise
 * @param {object} metricContext
 * @returns {number}
 */
function exitStatus(metricContext) {
    if (!metricContext.apiMetrics || !metricContext.apiMetrics.success) {
        return EXIT_CRITICAL
    }
    if (certFailed(metricContext)) {
        return EXIT_WARNING
    }
    return EXIT_OK
}


function certFailed(metricContext) {
    return Boolean(metricContext.monitoringConfiguration.checkCertificate)
        && metricContext.certMetrics != null
        && metricContext.certMetrics.success === false
}


/**
 * url of the test without credentials, if any were embedded in it
 * @param {string} url
 * @returns {string}
 */
function displayUrl(url) {
    try {
        const parsed = new URL(url)
        parsed.username = ''
        parsed.password = ''
        return parsed.toString()
    } catch (error) {
        return 'invalid url'
    }
}


/**
 * plugin output shown on icinga:
 *   OK - <url>[\ncertificate OK]
 *   KO - <url> - <api error>[\ncertificate OK | \ncertificate KO[ - <cert error>]]   (CRITICAL)
 *   KO certificate - <url> - <cert error>                                           (WARNING)
 * the certificate outcome is reported only when the certificate is checked, on a second line
 * (icinga long output: the lists show only the first line). its error is omitted when equal
 * to the api one (e.g. both timed out)
 * @param {object} metricContext
 * @param {number} status exit status, as returned by exitStatus
 * @returns {string}
 */
function pluginOutput(metricContext, status) {
    const url = displayUrl(metricContext.monitoringConfiguration.url)
    if (status === EXIT_WARNING) {
        return `KO certificate - ${url} - ${metricContext.certMetrics.message || 'check failed'}`
    }
    if (status === EXIT_OK) {
        return `OK - ${url}${certificateSuffix(metricContext)}`
    }
    const apiMessage = (metricContext.apiMetrics || {}).message
    return `KO - ${url} - ${apiMessage || 'no message provided'}${certificateSuffix(metricContext, apiMessage)}`
}


function certificateSuffix(metricContext, apiMessage) {
    const certMetrics = metricContext.certMetrics
    if (!metricContext.monitoringConfiguration.checkCertificate || certMetrics == null || typeof certMetrics.success !== 'boolean') {
        return ''
    }
    if (certMetrics.success) {
        return '\ncertificate OK'
    }
    return certMetrics.message && certMetrics.message !== apiMessage
        ? `\ncertificate KO - ${certMetrics.message}`
        : '\ncertificate KO'
}


/**
 * builds the body of the process-check-result action
 * @param {object} metricContext
 * @param {string} host icinga host holding the synthetic services
 * @returns {object}
 */
function checkResultPayload(metricContext, host) {
    const configuration = metricContext.monitoringConfiguration
    const status = exitStatus(metricContext)
    const apiMetrics = metricContext.apiMetrics || {}
    const output = pluginOutput(metricContext, status)

    const payload = {
        type: 'Service',
        service: `${host}!${serviceName(configuration)}`,
        exit_status: status,
        plugin_output: output,
        check_source: 'synthetic-monitoring'
    }

    // perfdata format: label=value[UOM];[warn];[crit]
    if (typeof apiMetrics.duration === 'number') {
        const crit = configuration.durationLimit ? `${configuration.durationLimit / 1000}` : ''
        payload.performance_data = [`duration=${apiMetrics.duration / 1000}s;;${crit}`]
    }
    return payload
}


/**
 * counters of the check results sent in a run, updated by sendCheckResult
 * @returns {object}
 */
function createStats() {
    return { sent: 0, failed: 0, states: { OK: 0, WARNING: 0, CRITICAL: 0 } }
}


/**
 * one line summary of the check results sent in a run
 * @param {object} stats as returned by createStats
 * @returns {string}
 */
function statsSummary(stats) {
    const states = Object.entries(stats.states).map(([state, count]) => `${state} ${count}`).join(', ')
    return `${stats.sent} sent (${states}), ${stats.failed} failed`
}


/**
 * publishes the result of a test on icinga. never rejects: errors are logged
 * @param {object} metricContext
 * @param {Axios} client icinga client, as returned by createClient
 * @param {string} host icinga host holding the synthetic services
 * @param {object} [stats] run counters, as returned by createStats
 * @returns {Promise<object>} the metric context
 */
async function sendCheckResult(metricContext, client, host, stats) {
    const payload = checkResultPayload(metricContext, host)
    // new lines escaped: one log line per send
    const sent = `${STATUS_LABEL[payload.exit_status]} "${payload.plugin_output.replace(/\n/g, '\\n')}"`
    try {
        const response = await client.post('/actions/process-check-result', payload)
        const results = response.data && response.data.results
        const code = Array.isArray(results) && results.length > 0 ? results[0].code : response.status
        logger.debug(metricContext.testId, `icinga check result sent for ${payload.service}: ${sent}, icinga code ${code}`)
        if (stats) {
            stats.sent++
            stats.states[STATUS_LABEL[payload.exit_status]]++
        }
    } catch (error) {
        logger.error(metricContext.testId, `error sending icinga check result for ${payload.service}: ${sent}, ${errorDetail(error)}`)
        if (stats) {
            stats.failed++
        }
    }
    return metricContext
}


/**
 * attributes of the icinga host holding the synthetic services: always UP,
 * the state of the synthetic checks is on the services
 * @returns {object}
 */
function hostAttributes() {
    return {
        check_command: 'dummy',
        vars: {
            dummy_state: 0,
            dummy_text: 'synthetic monitoring',
            managed_by: MANAGED_BY
        }
    }
}


/**
 * attributes of the icinga service of a monitoring configuration. the active check is a dummy
 * returning CRITICAL: it runs only when synthetic sends no result for FRESHNESS_SECONDS
 * @param {object} monitoringConfiguration
 * @returns {object}
 */
function serviceAttributes(monitoringConfiguration) {
    const vars = {
        dummy_state: EXIT_CRITICAL,
        dummy_text: `no result from synthetic in the last ${FRESHNESS_SECONDS / 60} minutes`,
        managed_by: MANAGED_BY,
        url: displayUrl(monitoringConfiguration.url)
    }
    const tags = monitoringConfiguration.tags || {}
    if (tags.domain) {
        vars.domain = tags.domain
    }
    return {
        check_command: 'dummy',
        max_check_attempts: 1,
        check_interval: FRESHNESS_SECONDS,
        retry_interval: FRESHNESS_SECONDS,
        vars
    }
}


function alreadyExists(error) {
    return Boolean(error.response) && JSON.stringify(error.response.data || '').includes('already exists')
}


function errorDetail(error) {
    // only status and body: the error object holds the request config, credentials included
    return error.response ? `${error.response.status} ${JSON.stringify(error.response.data)}` : error.message
}


/**
 * creates an icinga object. an object that already exists (e.g. created by a concurrent run) is ok
 * @returns {Promise<boolean>} true when the object exists at the end of the call
 */
async function createObject(client, path, attrs, label) {
    try {
        await client.put(path, { attrs })
        logger.debug(`icinga ${label} created`)
        return true
    } catch (error) {
        if (alreadyExists(error)) {
            return true
        }
        logger.error(`error creating icinga ${label}: ${errorDetail(error)}`)
        return false
    }
}


async function ensureHost(client, host) {
    try {
        await client.get(`/objects/hosts/${encodeURIComponent(host)}`, { params: { attrs: 'name' } })
        return true
    } catch (error) {
        if (!error.response || error.response.status !== 404) {
            logger.error(`error reading icinga host ${host}: ${errorDetail(error)}`)
            return false
        }
    }
    return createObject(client, `/objects/hosts/${encodeURIComponent(host)}`, hostAttributes(), `host ${host}`)
}


async function existingServices(client, host) {
    const response = await client.get('/objects/services', {
        params: { filter: `host.name=="${host}"`, attrs: 'name' }
    })
    const results = (response.data && response.data.results) || []
    return new Set(results.map((result) => result.attrs.name))
}


/**
 * creates on icinga the host and the services missing for the given configurations.
 * existing objects are not modified. never rejects: errors are logged and the tests run anyway
 * (the results of the services that could not be created are rejected by icinga with 404)
 * @param {object[]} monitoringConfigurations configurations about to be tested
 * @param {Axios} client icinga client, as returned by createClient
 * @param {string} host icinga host holding the synthetic services
 * @returns {Promise<void>}
 */
async function ensureHostAndServices(monitoringConfigurations, client, host) {
    try {
        if (!await ensureHost(client, host)) {
            return
        }
        const existing = await existingServices(client, host)

        const missing = new Map()
        for (const configuration of monitoringConfigurations) {
            const name = serviceName(configuration)
            if (!existing.has(name) && !missing.has(name)) {
                missing.set(name, configuration)
            }
        }

        let failed = 0
        const queue = [...missing.entries()]
        // a few requests at a time: the first run creates all the services
        for (let i = 0; i < queue.length; i += MAX_SOCKETS) {
            const outcomes = await Promise.all(queue.slice(i, i + MAX_SOCKETS).map(([name, configuration]) =>
                createObject(client, `/objects/services/${encodeURIComponent(host)}!${encodeURIComponent(name)}`,
                    serviceAttributes(configuration), `service ${host}!${name}`)))
            failed += outcomes.filter((created) => !created).length
        }

        logger.info(`icinga host ${host}: ${existing.size} services existing, ${missing.size - failed} created, ${failed} failed`)
    } catch (error) {
        logger.error(`error preparing icinga host ${host} and services: ${errorDetail(error)}`)
    }
}
