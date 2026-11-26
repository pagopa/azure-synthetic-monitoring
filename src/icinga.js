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

module.exports = {
    readConfig,
    createClient,
    serviceName,
    exitStatus,
    checkResultPayload,
    sendCheckResult,
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
 * builds the body of the process-check-result action
 * @param {object} metricContext
 * @param {string} host icinga host holding the synthetic services
 * @returns {object}
 */
function checkResultPayload(metricContext, host) {
    const configuration = metricContext.monitoringConfiguration
    const status = exitStatus(metricContext)
    const apiMetrics = metricContext.apiMetrics || {}

    let output = `${STATUS_LABEL[status]} - ${apiMetrics.message || 'no message provided'}`
    if (certFailed(metricContext)) {
        output += ` (certificate: ${metricContext.certMetrics.message || 'check failed'})`
    }

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
 * publishes the result of a test on icinga. never rejects: errors are logged
 * @param {object} metricContext
 * @param {Axios} client icinga client, as returned by createClient
 * @param {string} host icinga host holding the synthetic services
 * @returns {Promise<object>} the metric context
 */
async function sendCheckResult(metricContext, client, host) {
    const payload = checkResultPayload(metricContext, host)
    try {
        const response = await client.post('/actions/process-check-result', payload)
        logger.info(metricContext.testId, `icinga check result sent for ${payload.service}: ${JSON.stringify(response.data)}`)
    } catch (error) {
        // only status and body: the error object holds the request config, credentials included
        const detail = error.response ? `${error.response.status} ${JSON.stringify(error.response.data)}` : error.message
        logger.error(metricContext.testId, `error sending icinga check result for ${payload.service}: ${detail}`)
    }
    return metricContext
}
