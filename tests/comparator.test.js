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



describe('comparator main tests', () => {
  test('returns false when strategy not found', () => {
    expect(comparator.compare("something", {wrongKey: 2}, {key: 2})).toBeFalsy();
  });

  test('returns false when exception occurs', () => {
    expect(comparator.compare("something", {wrongKey: 2}, {key: 2})).toBeFalsy();
  });
})

