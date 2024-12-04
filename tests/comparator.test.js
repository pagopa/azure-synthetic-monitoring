let comparator = require("../src/comparator");




describe('typeOf tests', () => {
  test('number', () => {
    expect(comparator.compare("typeOf", 2, 'number')).toBeTruthy();
    expect(comparator.compare("typeOf", 2, 'string')).toBeFalsy();
    expect(comparator.compare("typeOf", 2, 'object')).toBeFalsy();
    expect(comparator.compare("typeOf", 2, 'boolean')).toBeFalsy();
  });

  test('string', () => {
    expect(comparator.compare("typeOf", "foo", 'string')).toBeTruthy();
    expect(comparator.compare("typeOf", "foo", 'number')).toBeFalsy();
    expect(comparator.compare("typeOf", "foo", 'object')).toBeFalsy();
    expect(comparator.compare("typeOf", "foo", 'boolean')).toBeFalsy();
  });

  test('object', () => {
    expect(comparator.compare("typeOf", {"foo": 3}, 'string')).toBeFalsy();
    expect(comparator.compare("typeOf", {"foo": 3}, 'number')).toBeFalsy();
    expect(comparator.compare("typeOf", {"foo": 3}, 'object')).toBeTruthy();
    expect(comparator.compare("typeOf", {"foo": 3}, 'boolean')).toBeFalsy();
  });

  test('boolean', () => {
    expect(comparator.compare("typeOf", true, 'string')).toBeFalsy();
    expect(comparator.compare("typeOf", true, 'number')).toBeFalsy();
    expect(comparator.compare("typeOf", true, 'object')).toBeFalsy();
    expect(comparator.compare("typeOf", true, 'boolean')).toBeTruthy();
  });
})


describe('listOfTypes tests', () => {
  test('returns true when comparing list of expected objects', () => {
    expect(comparator.compare("listOfTypes", [{key: 2},{key: 5}], {key: "number"})).toBeTruthy();
    expect(comparator.compare("listOfTypes", [{key: { innerKey : 'foo'}},{key: {innerKey: 'bar'}}], {key: {innerKey: 'string'}})).toBeTruthy();
    expect(comparator.compare("listOfTypes", ['foo','bar'], 'string')).toBeTruthy();
    expect(comparator.compare("listOfTypes", [2, 4], 'number')).toBeTruthy();
    expect(comparator.compare("listOfTypes", [false, true], 'boolean')).toBeTruthy();
  });

  test('returns false when comparing list of unexpected objects', () => {
    expect(comparator.compare("listOfTypes", [{key: 2},{key: 5}, {key: 'valueOfString'}], {key: "number"})).toBeFalsy();
    expect(comparator.compare("listOfTypes", [{key: 2},{key: 5}, {key: 'valueOfString'}], 'boolean')).toBeFalsy();
    expect(comparator.compare("listOfTypes", [{key: 2},{key: 5}], {key: "string"})).toBeFalsy();
    expect(comparator.compare("listOfTypes", [{key: { innerKey : 'foo'}},{key: {innerKey: 'bar'}}], {key: 'string'})).toBeFalsy();
    expect(comparator.compare("listOfTypes", ['foo','bar'], 'number')).toBeFalsy();
    expect(comparator.compare("listOfTypes", [2, 4], 'boolean')).toBeFalsy();
    expect(comparator.compare("listOfTypes", [false, true], 'string')).toBeFalsy();
  });


})


describe('containsKeys tests', () => {
  test('returns true when comparing expected objects', () => {
    expect(comparator.compare("containsKeys", {key: 2}, {key: "number"})).toBeTruthy();
    expect(comparator.compare("containsKeys", {key: []}, {key: "array"})).toBeTruthy();
    expect(comparator.compare("containsKeys", {key: {innerKey: 'foo'}}, {key: {innerKey: "string"}})).toBeTruthy();
    expect(comparator.compare("containsKeys", {key: {innerKey: ['foo']}}, {key: {innerKey: "array"}})).toBeTruthy();
    expect(comparator.compare("containsKeys", {key1: ["stringValue"], key2: [2]}, {key1: ['string'], key2: ['number']})).toBeTruthy();
  });

  test('returns false when comparing unexpected objects', () => {
    expect(comparator.compare("containsKeys", {key: 2}, {key: "string"})).toBeFalsy();
    expect(comparator.compare("containsKeys", {key: []}, {key: "number"})).toBeFalsy();
    expect(comparator.compare("containsKeys", {key: {innerKey: 'foo'}}, {key: "string"})).toBeFalsy();
    expect(comparator.compare("containsKeys", {key: {innerKey: ['foo']}}, {key: {innerKey: "string"}})).toBeFalsy();
  });


})

describe('xmlContainsKeys tests', () => {
  test('returns true when comparing expected objects', () => {
    expect(comparator.compare("xmlContainsKeys", "<key>2</key>", {key: "number"})).toBeTruthy();
    expect(comparator.compare("xmlContainsKeys", "<key></key><key></key>", {key: "array"})).toBeTruthy();
    expect(comparator.compare("xmlContainsKeys", "<key><innerKey>foo</innerKey></key>", {key: {innerKey: "string"}})).toBeTruthy();
    expect(comparator.compare("xmlContainsKeys", "<key><innerKey>foo</innerKey><innerKey>bar</innerKey></key>", {key: {innerKey: "array"}})).toBeTruthy();
    expect(comparator.compare("xmlContainsKeys", "<key1>stringValue</key1><key1>stringValue2</key1><key2>2</key2><key2>3</key2>", {key1: ['string'], key2: ['number']})).toBeTruthy();
  });

  test('returns false when comparing unexpected objects', () => {
    expect(comparator.compare("xmlContainsKeys", "<key>2</key>", {key: "string"})).toBeFalsy();
    expect(comparator.compare("xmlContainsKeys", "<key></key><key></key>", {key: "number"})).toBeFalsy();
    expect(comparator.compare("xmlContainsKeys", "<key><innerKey>foo</innerKey></key>", {key: "string"})).toBeFalsy();
    expect(comparator.compare("xmlContainsKeys", "<key><innerKey>foo</innerKey><innerKey>bar</innerKey></key>", {key: {innerKey: "string"}})).toBeFalsy();
  });

  test('returns true when comparing real soap response', () => {
    expect(comparator.compare("xmlContainsKeys", "<?xml version='1.0' encoding='UTF-8' standalone='no' ?><soapenv:Envelope xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:soapenv='http://schemas.xmlsoap.org/soapenvelope/' xmlns:xs='http://www.w3.org/2001/XMLSchema' xmlns:common='http://pagopa-api.pagopa.gov.it/xsd/common-types/v1.0.0' xmlns:nfp='http://pagopa-api.pagopa.gov.it/node/nodeForPsp.xsd'><soapenv:Body><nfp:verifyPaymentNoticeRes><outcome>KO</outcome><fault><faultCode>PPT_PAGAMENTO_DUPLICATO</faultCode><faultString>Pagamento in attesa risulta concluso al sistema pagoPA</faultString><id>NodoDeiPagamentiSPC</id><description>Pagamento duplicato</description></fault></nfp:verifyPaymentNoticeRes></soapenv:Body></soapenv:Envelope>",
     {"soapenv:Envelope": { "soapenv:Body": { "nfp:verifyPaymentNoticeRes": {outcome: "string"} }}})).toBeTruthy();
  })

})


describe('contains tests', () => {
  test('returns true when comparing expected objects', () => {
    expect(comparator.compare("contains", {key: 2}, {key: 2})).toBeTruthy();
    expect(comparator.compare("contains", {key: {innerKey: 2}}, {key: {innerKey: 2}})).toBeTruthy();
    expect(comparator.compare("contains", {key: {innerKey: 2}, key2: 'foo'}, {key: {innerKey: 2}})).toBeTruthy();
    expect(comparator.compare("contains", {key: 'bar', key2: 'foo'}, {key: 'bar'})).toBeTruthy();
    expect(comparator.compare("contains", {key: [{key2: 1}, {key2: 2}]}, {key: [{key2: 1}, {key2: 2}]})).toBeTruthy();
  });

  test('returns false when comparing unexpected objects', () => {
    expect(comparator.compare("contains", {wrongKey: 2}, {key: 2})).toBeFalsy();
    expect(comparator.compare("contains", {key: {innerKey: 2}}, {key: {innerKey: 3}})).toBeFalsy();
    //Same key but wrong type
    expect(comparator.compare("contains", {key: {}}, {key: 2})).toBeFalsy();
    expect(comparator.compare("contains", {key: [{key2: 1}, {key2: 2}]}, {key: [{key2: 3}, {key2: 3}]})).toBeFalsy();
  });
})


describe('xmlContains tests', () => {
  test('returns true when comparing expected objects', () => {
    expect(comparator.compare("xmlContains", "<key>2</key>", {key: 2})).toBeTruthy();
    expect(comparator.compare("xmlContains", "<key><innerKey>2</innerKey></key>", {key: {innerKey: 2}})).toBeTruthy();
    expect(comparator.compare("xmlContains", "<key><innerKey>2</innerKey></key><key2>foo</key2>", {key: {innerKey: 2}, key2: 'foo'}, {key: {innerKey: 2}})).toBeTruthy();
    expect(comparator.compare("xmlContains", "<key>bar</key><key2>foo</key2>", {key: 'bar'})).toBeTruthy();
    expect(comparator.compare("xmlContains", "<key>1</key><key>2</key>", {key: [1, 2]})).toBeTruthy();
    expect(comparator.compare("xmlContains", "<key><key2>1</key2></key><key><key2>2</key2></key>", {key: [{key2: 1}, {key2: 2}]})).toBeTruthy();
  });

  test('returns true when comparing real soap response', () => {
    expect(comparator.compare("xmlContains", "<?xml version='1.0' encoding='UTF-8' standalone='no' ?><soapenv:Envelope xmlns:xsi='http://www.w3.org/2001/XMLSchema-instance' xmlns:soapenv='http://schemas.xmlsoap.org/soapenvelope/' xmlns:xs='http://www.w3.org/2001/XMLSchema' xmlns:common='http://pagopa-api.pagopa.gov.it/xsd/common-types/v1.0.0' xmlns:nfp='http://pagopa-api.pagopa.gov.it/node/nodeForPsp.xsd'><soapenv:Body><nfp:verifyPaymentNoticeRes><outcome>KO</outcome><fault><faultCode>PPT_PAGAMENTO_DUPLICATO</faultCode><faultString>Pagamento in attesa risulta concluso al sistema pagoPA</faultString><id>NodoDeiPagamentiSPC</id><description>Pagamento duplicato</description></fault></nfp:verifyPaymentNoticeRes></soapenv:Body></soapenv:Envelope>",
     {"soapenv:Envelope": { "soapenv:Body": { "nfp:verifyPaymentNoticeRes": {outcome: "KO"} }}})).toBeTruthy();
  })

  test('returns false when comparing unexpected objects', () => {
    expect(comparator.compare("xmlContains", "<wrongKey>2</wrongKey>", {key: 2})).toBeFalsy();
    expect(comparator.compare("xmlContains", "<key><innerKey>2</innerKey></key>", {key: {innerKey: 3}})).toBeFalsy();
    //Same key but wrong type
    expect(comparator.compare("xmlContains", "<key></key>", {key: 2})).toBeFalsy();
    expect(comparator.compare("xmlContains", "<key><key2>1</key2></key><key><key2>2</key2></key>", {key: [{key2: 3}, {key2: 3}]})).toBeFalsy();
      });
})



describe('comparator main tests', () => {
  test('returns false when strategy not found', () => {
    expect(comparator.compare("something", {wrongKey: 2}, {key: 2})).toBeFalsy();
  });

  test('returns false when exception occurs', () => {
    expect(comparator.compare("something", {wrongKey: 2}, {key: 2})).toBeFalsy();
  });
})

