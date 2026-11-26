jest.mock('../src/logger');

const axios = require('axios')
const businessProcess = require('../src/business-process')
const logger = require('../src/logger')

const configuration = (appName, apiName, domain, type = 'apim') => ({
    appName, apiName, type, url: 'https://myhost.com/path', tags: domain === undefined ? {} : { domain }
})

afterEach(() => {
    jest.clearAllMocks()
})


describe('readConfig tests', () => {
    test('disabled without BP_API_URL', () => {
        expect(businessProcess.readConfig({})).toBeNull()
    })

    test('reads url and business process name', () => {
        expect(businessProcess.readConfig({ BP_API_URL: 'http://10.0.0.4:8080/', ICINGA_BP: 'my-bp' })).toEqual({ apiUrl: 'http://10.0.0.4:8080', bp: 'my-bp' })
    })

    test('the business process name is mandatory with BP_API_URL', () => {
        expect(() => businessProcess.readConfig({ BP_API_URL: 'http://10.0.0.4:8080' })).toThrow('missing business process configuration: ICINGA_BP')
    })
})


describe('createClient tests', () => {
    test('creates a dedicated instance', () => {
        const client = businessProcess.createClient({ apiUrl: 'http://10.0.0.4:8080', bp: 'bp' })
        expect(client).not.toBe(axios)
        expect(client.defaults.baseURL).toBe('http://10.0.0.4:8080')
        expect(client.interceptors.request.handlers.length).toBe(0)
        expect(client.interceptors.response.handlers.length).toBe(0)
    })
})


describe('blocks tests', () => {
    test('one block per service with the domain tag, duplicates removed', () => {
        expect(businessProcess.blocks([
            configuration('bizevents', 'status', 'bizevents'),
            configuration('bizevents', 'status', 'bizevents'),
            configuration('checkout', 'status', 'ecommerce'),
            configuration('nodomain', 'status')
        ])).toEqual([
            { domain: 'bizevents', name: 'bizevents-status-apim' },
            { domain: 'ecommerce', name: 'checkout-status-apim' }
        ])
    })

    test('domain sanitized like Terraform does', () => {
        expect(businessProcess.blocks([configuration('app', 'api', 'pay wallet')])[0].domain).toBe('pay_wallet')
    })

    test('names not accepted by the bp-api are skipped and logged', () => {
        expect(businessProcess.blocks([configuration('app', 'api', 'd', 'bad type')])).toEqual([])
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('"app-api-bad type"'))
    })
})


describe('updateBusinessProcess tests', () => {
    test('posts the synthetic section of the business process', async () => {
        const client = { post: jest.fn().mockResolvedValue({ status: 200 }) }

        await businessProcess.updateBusinessProcess([
            configuration('bizevents', 'status', 'bizevents'),
            configuration('checkout', 'status', 'ecommerce')
        ], client, 'pagoPa_Platform', 'synthetic')

        expect(client.post).toHaveBeenCalledWith('/business-process/pagoPa_Platform/block/synthetic', {
            host: 'synthetic',
            blocks: [
                { domain: 'bizevents', name: 'bizevents-status-apim' },
                { domain: 'ecommerce', name: 'checkout-status-apim' }
            ]
        })
        expect(logger.info).toHaveBeenCalledWith('business process pagoPa_Platform updated: 2 services in 2 domains (bizevents, ecommerce), bp-api code 200')
    })

    test('not called without blocks: the bp-api rejects an empty list', async () => {
        const client = { post: jest.fn() }

        await businessProcess.updateBusinessProcess([configuration('app', 'api')], client, 'bp', 'synthetic')

        expect(client.post).not.toHaveBeenCalled()
        expect(logger.info).toHaveBeenCalledWith('business process bp: no test with the domain tag, not updated')
    })

    test('logs http errors without rejecting', async () => {
        const error = Object.assign(new Error('400'), { response: { status: 400, data: { detail: 'business process file not found' } } })
        const client = { post: jest.fn().mockRejectedValue(error) }

        await expect(businessProcess.updateBusinessProcess([configuration('a', 'b', 'd')], client, 'bp', 'synthetic')).resolves.toBeUndefined()

        expect(logger.error).toHaveBeenCalledWith('error updating business process bp: 400 {"detail":"business process file not found"}')
    })

    test('logs network errors without rejecting', async () => {
        const client = { post: jest.fn().mockRejectedValue(new Error('connect ETIMEDOUT')) }

        await expect(businessProcess.updateBusinessProcess([configuration('a', 'b', 'd')], client, 'bp', 'synthetic')).resolves.toBeUndefined()

        expect(logger.error).toHaveBeenCalledWith('error updating business process bp: connect ETIMEDOUT')
    })
})
