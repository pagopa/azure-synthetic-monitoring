# Azure Synthetic Monitoring

Azure function to monitor internal and external service status. It supports two operation modes:

- **cron** (default): runs all configured monitoring tests on a schedule and reports results to Application Insights
- **queue**: triggered by a message on an Azure Storage Queue, runs tests filtered by app name, and writes results back to a response queue

When running in cron mode, results are reported to Application Insights in the following formats:

- availability events, named `<prefix>-<app_name>-<api_name>` further distinguished by the `type` defined in the configuration used as "run location" for the test
- custom event, using the name `<prefix>-<app_name>-<api_name>-<type>`. these events are queryable using log insight and can be visualized using Grafana

## Operation modes

### Cron mode

The default mode. Runs all monitoring tests on a schedule, sending availability metrics and custom events directly to Application Insights.

Set `OPERATION_MODE=cron` (or omit the variable, as `cron` is the default).

### Queue mode

Designed to be triggered by an external alarm system. The application reads one message at a time from the inbound Azure Storage Queue, runs monitoring tests for the apps listed in the message, and writes the results to the outbound queue.

Set `OPERATION_MODE=queue`.

**Inbound message format:**

```json
{
  "alarmId": "unique-alarm-identifier",
  "appNames": ["appName1", "appName2"]
}
```

| Field      | Type            | Description                                                              |
|------------|-----------------|--------------------------------------------------------------------------|
| `alarmId`  | string          | Identifier of the alarm that triggered the check. Echoed in the response |
| `appNames` | array of string | List of `appName` values to test (matched against the table configuration) |

**Outbound message format:**

```json
{
  "alarmId": "unique-alarm-identifier",
  "tests": [
    {
      "testId": "appName_apiName_type",
      "appName": "appName",
      "apiName": "apiName",
      "type": "private",
      "apiMetrics": {},
      "certMetrics": {}
    }
  ],
  "success": true
}
```

| Field     | Type    | Description                                                               |
|-----------|---------|---------------------------------------------------------------------------|
| `alarmId` | string  | The alarm ID from the inbound message                                     |
| `tests`   | array   | One entry per monitoring test that was executed                           |
| `success` | boolean | `true` when test execution has completed successfully, `false` on failure |

**N.B.:** `success` field indicates whether the tests were executed successfully, not the result of the availability checks. Each entry in the `tests` array contains the results of an individual test, including both API and certificate metrics (if applicable).


## Configuration

This application relies on a configuration structure stored on the configured table storage structured as follows:


| Column Name         | description                                                                                                                                                        | required |
|---------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|
| PartitionKey        | string. name of the app and api being monitored, expressed using the format <app_name>-<api_name>                                                                  | yes      |
| RowKey              | string. type of the api being monitored. same as `type`                                                                                                            | yes      |
| url                 | string. url to be monitored                                                                                                                                        | yes      |
| method              | string, upper case. method to be used when invoking `url`                                                                                                          | yes      |
| body                | json stringifyied. body of the to be provided during the request. Allowed only when `method` is `PATCH`, `POST`, `DELETE`, `PUT`                                   | no       |
| expectedCodes       | json stringifyied string. list of string and ranges (eg "200-220") of accepted http status (considered a success for the availability metric)                      | yes      |
| type                | string. identified of the api type being called. suggested types: `private`, `public`                                                                              | yes      |
| checkCertificate    | boolean string. if true, also checks the server's certificate (expiration, version)                                                                                | yes      |
| durationLimit       | number. threshold, in milliseconds, over which a response time will trigger a failed availability test. to not be confused with `HTTP_CLIENT_TIMEOUT` env variable | yes      |
| tags                | json stringifyied. dictionary of tags to be added to the tracked metrics                                                                                           | yes      |
| headers             | json stringifyied. dictionary of headers to be sent in the http request                                                                                            | no       |
| bodyCompareStrategy | strategy to be used when compating received response body to `expectedBoddy`. Possible values listed in the table below *Detail on compareStrategy*                | no       |
| expectedBody        | json stringifyied. expected body type/content. used in conjunction with `bodyCompareStrategy`                                                                      | no       |

Note on the `type`: any value is accepted, it will be traced in the application insight availability panel as "runLocation". 
suggested values are:
  - `private`: means that the api being tested is reached through internal network (vnet)
  - `public`: means that the api being tested is reached through internet


**Detail on compareStrategy**

| Method          | Functionality                                                                                                                                                                                                                                                                                                                                                                                                      | Applied to |
|-----------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------|
| contains        | checks if all the fields defined in the expected body are present in the actual body, and if their value are equal (recursively). On object arrays, checks if the received array has exactly the same element of the expected, using this `contains` on each element for comparison. On primitive arrays, checks if all the expected elements are included n the received, using `Array.includes()` for comparison | objects    |
| containsKeys    | checks if all the fields defined in the expected body are present in the actual body, and if their value are of the expected type (recursively). Values associable to object keys: `bool` `string` `number` `array`, `object`. You can also define the array content type, using `["number"]`                                                                                                                      | objects    |
| listOfTypes     | checks if the response is a list containing the types defined in the `body` field. Uses the `containsKeys` logic to check each element of the list                                                                                                                                                                                                                                                                 | array      |
| typeOf          | checks if the response type is as expected. supports all types returned by javascript `typeof`                                                                                                                                                                                                                                                                                                                     | any        |
| xmlContains     | like contains; parses the reponse xml as json and then compares it to the expected                                                                                                                                                                                                                                                                                                                                 | any        |
| xmlContainsKeys | like containsKeys; but parses the reponse xml as json and then compares it to the expected                                                                                                                                                                                                                                                                                                                                                              | any        |




here's an example in json format to better understand the content
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

## Certificate check

When enabled, the application will check the certificate associated to the configured domain in addition to checking the configured api
The certificate is expected to expire in 7 days or more for the metric to be considered "success".
When checking the certificate, the suffix `-cert` will be appended to the "runLocation" field of the metric, and will be visualized in the Application Insight page alongside the other run locations configured (see `type` configuration field)

## Env variables

| name                              | description                                                                                           | required            | default   |
|-----------------------------------|-------------------------------------------------------------------------------------------------------|---------------------|-----------|
| `APP_INSIGHT_CONNECTION_STRING`   | application insight connection string. where to publish availability metrics and custom events        | yes                 | -         |
| `STORAGE_ACCOUNT_NAME`            | storage account name used to store the monitoring configuration table                                 | yes                 | -         |
| `STORAGE_ACCOUNT_KEY`             | storage account access key for the monitoring configuration table                                     | yes                 | -         |
| `STORAGE_ACCOUNT_TABLE_NAME`      | table name used to store the monitoring configuration                                                 | yes                 | -         |
| `STORAGE_ACCOUNT_CONNECTION_STRING` | storage account connection string. used by the queue client in queue mode                           | queue mode only     | -         |
| `INBOUND_QUEUE_NAME`              | name of the Azure Storage Queue from which monitoring requests are read                               | queue mode only     | -         |
| `OUTBOUND_QUEUE_NAME`             | name of the Azure Storage Queue to which monitoring results are written                               | queue mode only     | -         |
| `QUEUE_BATCH_SIZE`                | number of messages to retrieve from the inbound queue in each execution                                | queue mode only     | `1`       |
| `OPERATION_MODE`                  | execution mode. accepted values: `cron`, `queue`                                                      | no                  | `cron`    |
| `AVAILABILITY_PREFIX`             | prefix used in the custom metric and events names                                                     | no                  | synthetic |
| `HTTP_CLIENT_TIMEOUT`             | response timeout used by the http client performing the availability requests                         | yes                 | -         |
| `LOCATION`                        | region name where this job is run                                                                     | yes                 | -         |
| `CERT_VALIDITY_RANGE_DAYS`        | number of days before the expiration date of a certificate over which the check is considered success | yes                 | -         |
| `LOG_LEVEL`                       | logging verbosity. accepted values: `DEBUG`, `INFO`, `ERROR`                                          | no                  | `INFO`    |

## Deploy

To deploy this job you can use the module `monitoring_function` provided in [terraform-azurerm-v4](https://github.com/pagopa/terraform-azurerm-v4)


## Local execution

- Run `npm install` to install the dependencies
- Define a local environment file `local.env` with the required env variable and run the following command in the project root:

```bash
node --env-file=local.env src/main.js
```
