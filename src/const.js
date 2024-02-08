const keysForTelemetry = ['success', 'message', 'duration', 'runLocation'];
const keysForEvent = ['duration', 'targetStatus', 'targetExpirationTimestamp', 'httpStatus', 'targetTlsVersion', 'targetExpireInDays', 'certSuccess'] ;
const keysForEventProperties = ['domain', 'checkCert'];
const TLS_VERSION_KEY = "TLS_VERSION"
const START_TIMESTAMP_KEY = "x-request-timestamp"
const RESPONSE_TIME_KEY = "RESPONSE_TIME"

module.exports = {
    keysForTelemetry,
    keysForEvent,
    keysForEventProperties,
    TLS_VERSION_KEY,
    START_TIMESTAMP_KEY,
    RESPONSE_TIME_KEY
}
