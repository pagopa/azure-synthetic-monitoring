// Icinga business process integration: every run defines, through the bp-api on the Icinga VM,
// the nodes "synthetic_<domain>" of the business process with the synthetic services of each domain
const axios = require('axios')
const http = require('http')
const process = require('process')

const logger = require('./logger')
const icinga = require('./icinga')

// target of the bp-api: the nodes are "<target>_<domain>", referenced by the domain nodes written by Terraform
const TARGET = 'synthetic'
const REQUEST_TIMEOUT_MS = 10000

// same sanitization Terraform applies to the domain in the node names
const IDENTIFIER_SANITIZE = /[^A-Za-z0-9_.-]/g
// values accepted by the bp-api for host and block name
const VALUE_ALLOWED = /^[A-Za-z0-9_.:-]{1,255}$/

module.exports = {
    readConfig,
    createClient,
    blocks,
    updateBusinessProcess,
    TARGET
}


/**
 * reads the bp-api configuration from the environment
 * @param {object} env environment variables (defaults to process.env)
 * @returns {object|null} configuration, null when BP_API_URL is not set (business process update disabled)
 * @throws {Error} when BP_API_URL is set but ICINGA_BP is not
 */
function readConfig(env = process.env) {
    if (!env.BP_API_URL) {
        return null
    }
    if (!env.ICINGA_BP) {
        throw new Error('missing business process configuration: ICINGA_BP')
    }
    return {
        apiUrl: env.BP_API_URL.replace(/\/+$/, ''),
        bp: env.ICINGA_BP
    }
}


/**
 * creates a dedicated http client for the bp-api (not the global axios with the synthetic interceptors)
 * @param {object} config as returned by readConfig
 * @returns {Axios}
 */
function createClient(config) {
    return axios.create({
        baseURL: config.apiUrl,
        timeout: REQUEST_TIMEOUT_MS,
        headers: { Accept: 'application/json' },
        httpAgent: new http.Agent({ keepAlive: false })
    })
}


/**
 * business process blocks of the configurations having the "domain" tag:
 * one { domain, name } per service, duplicates removed, invalid names skipped and logged
 * @param {object[]} monitoringConfigurations
 * @returns {object[]}
 */
function blocks(monitoringConfigurations) {
    const result = new Map()
    for (const configuration of monitoringConfigurations) {
        const domain = configuration.tags && configuration.tags.domain
        if (!domain) {
            continue
        }
        const name = icinga.serviceName(configuration)
        if (!VALUE_ALLOWED.test(name)) {
            logger.error(`business process: service name ${JSON.stringify(name)} not accepted by the bp-api, skipped`)
            continue
        }
        const block = { domain: String(domain).replace(IDENTIFIER_SANITIZE, '_'), name }
        result.set(`${block.domain}|${block.name}`, block)
    }
    return [...result.values()]
}


/**
 * writes the synthetic section of the business process. never rejects: errors are logged
 * @param {object[]} monitoringConfigurations configurations about to be tested
 * @param {Axios} client bp-api client, as returned by createClient
 * @param {string} bp business process name
 * @param {string} host icinga host holding the synthetic services
 * @returns {Promise<void>}
 */
async function updateBusinessProcess(monitoringConfigurations, client, bp, host) {
    const body = { host, blocks: blocks(monitoringConfigurations) }
    const domains = new Set(body.blocks.map((block) => block.domain))
    if (body.blocks.length === 0) {
        // the bp-api rejects an empty list: the nodes stay as they are
        logger.info(`business process ${bp}: no test with the domain tag, not updated`)
        return
    }
    const path = `/business-process/${encodeURIComponent(bp)}/block/${TARGET}`
    try {
        const response = await client.post(path, body)
        logger.info(`business process ${bp} updated: ${body.blocks.length} services in ${domains.size} domains (${[...domains].join(', ')}), bp-api code ${response.status}`)
    } catch (error) {
        const detail = error.response ? `${error.response.status} ${JSON.stringify(error.response.data)}` : error.message
        logger.error(`error updating business process ${bp}: ${detail}`)
    }
}
