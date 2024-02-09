let comparator = require("../src/comparator");


test("Test typeOf return false", () => {
    expect(new comparator().getStrategy("typeOf")(2, 'number')).toBeTruthy();
    expect(new comparator().getStrategy("typeOf")(2, 'string')).toBeFalsy();
})

test("Test listOfTypes", () => {
    expect(new comparator().getStrategy("listOfTypes")([{key: 2},{key: 5}], {key: "number"})).toBeTruthy();
    expect(new comparator().getStrategy("listOfTypes")([{key: 2},{key: 5}, {key: 'valueOfString'}], {key: "number"})).toBeFalsy();
})

test("Test containsKeys", () => {
   expect(new comparator().getStrategy("containsKeys")(2, 'number')).toBeTruthy();
   expect(new comparator().getStrategy("containsKeys")({key: 2}, {key: "number"})).toBeTruthy();
   expect(new comparator().getStrategy("containsKeys")({key: []}, {key: "array"})).toBeTruthy();
})

test("Test contains", () => {
    expect(new comparator().getStrategy("contains")({key: 2}, {key: 2})).toBeTruthy();
    expect(new comparator().getStrategy("contains")({wrongKey: 2}, {key: 2})).toBeFalsy();
    //Same key but wrong type
    expect(new comparator().getStrategy("contains")({key: {}}, {key: 2})).toBeFalsy();
})
