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
- `type`: type of the test. Any value is accepted, it will be traced in the application insight availability panel as "runLocation". If `certificate` is used, the application will check only the expiration date of the certificate associated to the provided domain (details below)
  - suggested values are:
    - `private`: means that the api being tested is reached through internal network (vnet)
    - `public`: means that the api being tested is reached through internet
    - `certificate`: **keywork**, test the certificate's expiration date. if less than 7 days it traces an error
- `expectedCodes`: list of strings or ranges, defined as `min-max`. contains all the http status codes that will be considered OK and will lead to a success state
- `headers`: dictionary of additional headers to be used when performing the request. Useful when sending a body
- `body`: object, string or anything else that will be sent in the request. Allowed only when method is `PATCH`, `POST`, `DELETE`, `PUT`
- `tags`: additional attributes that will be associated to the availability metric, useful to describe, identify and make searchable the metric
