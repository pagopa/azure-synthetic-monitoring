# Azure Synthetic Monitoring

Azure function to monitor internal and external service status, reporting to Application Insight

## Configuration

This application relies on a configuration structure that defines what to test and how to test it. here's an example

```json
{
  "apiName": "post",
  "appName": "httpbin",
  "url": "https://httpbin.org/get",
  "type": "private",
  "method": "GET",
  "expectedCodes": [
    "200",
    "300-303"
  ],
  "headers": {
    "Content-Type": "application/json"
  },
  "body": {
    "name": "value"
  },
  "tags": {
    "description": "sample post request"
  }
}
```

where:

- `apiName`: name of the api that is being tested
- `appName`: name of the app which exposes the `apiName`. Note that the pair `apiName`-`appName` must be unique
- `url`: url used for the test
- `method`: http method used for the test
- `type`: type of the test. Any value is accepted, it will be traced in the application insight availability panel as "runLocation". 
  - suggested values are:
    - `private`: means that the api being tested is reached through internal network (vnet)
    - `public`: means that the api being tested is reached through internet
- `checkCertificate`: if specified, the application will check the expiration date of the certificate associated to the provided domain
- `expectedCodes`: list of strings or ranges, defined as `min-max`. contains all the http status codes that will be considered OK and will lead to a success state
- `headers`: dictionary of additional headers to be used when performing the request. Useful when sending a body
- `body`: object, string or anything else that will be sent in the request. Allowed only when method is `PATCH`, `POST`, `DELETE`, `PUT`
- `tags`: additional attributes that will be associated to the availability metric, useful to describe, identify and make searchable the metric


## Certificate check

When enabled, the application will check the certificate associated to the configured domain in addition to checking the configured api
The certificate is expected to expire in 7 days or more for the metric to be considered "success".
When checking the certificate, the suffix `-cert` will be appended to the "runLocation" field of the metric, and will be visualized in the Application Insight page alongside the other run locations configured (see `type` configuration field)