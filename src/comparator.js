const {XMLParser} = require('fast-xml-parser');
const logger = require('./logger');

function compare(strategyName, actual, expected){
  if(strategyName in strategies){
      return strategies[strategyName](actual, expected)
  }else {
    // default value if strategy not found
    return false
  }
}



const contains = function (actual, expected) {
        let result = true;
        try {
            Object.keys(expected).forEach((key) => {
                logger.debug(`checking object key: ${key}`)
                if (typeof expected[key] === 'object') {
                    if (expected[key] instanceof Array) {//expecting array, check each expected element to be contained in the actual array
                        logger.debug(`expecting array  ${JSON.stringify(actual[key])} contains ${JSON.stringify(expected[key])}`)
                        for (let expectedIdx in expected[key]) {
                            let check = true
                            if (typeof expected[key][expectedIdx] == 'object') {//if array of objects, recursive call.
                                check = this.contains(actual[key][expectedIdx], expected[key][expectedIdx])
                                logger.debug(`expecting array item ${JSON.stringify(actual[key][expectedIdx])} contains ${JSON.stringify(expected[key][expectedIdx])}. check: ${check}`)
                            } else {//if array of primitives, use includes
                                check = actual[key].includes(expected[key][expectedIdx])
                                logger.debug(`expecting array item ${JSON.stringify(actual[key])} includes ${JSON.stringify(expected[key][expectedIdx])}. check: ${check}`)
                            }
                            result = result && check
                        }
                    } else {//expecting a "normal" object
                        let check = this.contains(actual[key], expected[key])
                        logger.debug(`expecting an object from ${actual[key]}. check: ${check}`)
                        result = result && check
                    }
                } else {//expecting a primitive, direct comparison
                    logger.debug(`expecting ${expected[key]} == ${actual[key]}`)
                    result = result && (expected[key] == actual[key])
                }
            })
        } catch (err) {
            logger.error(`failed check: ${err}`)
            result = false
        }
        return result;
    }


 const containsKeys = function (actual, expected) {
        let result = true;
        try {
            logger.debug(`type of expected ${typeof expected} `)
            if (!(typeof expected === 'object')) {//primitive type or generic 'object'
                let check = (actual == null || (typeof actual) == expected)
                logger.debug(`checking primitive type directly ${actual} ${expected}: ${check}`)
                result = result && check;
            } else {
                Object.keys(expected).forEach( (key) => {
                    logger.debug(`checking object key ${key}`)
                    if (expected[key] == "array") { //if we simply expect an array, and we don't care about the content. allows null
                        let check = actual[key] == null || actual[key] instanceof Array
                        logger.debug(`expecting generic array from ${actual[key]}: ${check}`)
                        result = result && check
                    } else {
                        if (typeof expected[key] === 'object') {
                            logger.debug(`expecting object from ${actual[key]}`)
                            if (actual[key] instanceof Array) {//if we want to check the content of the array
                                logger.debug(`- that object is an array`)
                                actual[key].forEach((element) => {
                                    logger.debug(`-- checking array element ${element}, should be ${expected[key][0]}`)
                                    let check = this.containsKeys(element, expected[key][0])//compare each element with the "schema" expected
                                    logger.debug(`-- checking array element ${element}, should be ${expected[key][0]} resulted: ${check}`)
                                    result = result && check
                                })
                            } else {
                                logger.debug(`- that object is an actual object. checking contents`)
                                let check = this.containsKeys(actual[key], expected[key])
                                logger.debug(`- that object is an actual object checking contents resulted: ${check}`)
                                result = result && check;//object, but not array
                            }
                        } else {
                            let check = (actual[key] == null || (typeof actual[key]) == expected[key])
                            logger.debug(`checking primitive type nested ${actual[key]} ${expected[key]}: ${check}`)
                            result = result && check;//primitive type
                        }
                    }
                })
            }

        } catch (err) {
            logger.error(`failed check: ${err}`)
            result = false
        }
        return result;
    }


 const listOfTypes = function (actual, expected) {
        let result = true;
        actual.forEach((object) => {
            result = result && this.containsKeys(object, expected);
        })

        return result;
    };


 const typeOf = function (actual, expected) {
        let check = typeof actual == expected
        logger.debug(`checking primitive type of ${actual} == ${expected}: ${check}`)
        return check;
    }


const xmlContains = function (actual, expected) {
  let result = true;
  try{
    const parser = new XMLParser();
    let actualParsed = parser.parse(actual);
    logger.debug(actualParsed)
    result = this.contains(actualParsed, expected);
  } catch (err) {
    logger.error(`failed check: ${err}`)
    result = false;
  }
  return result;
}

const xmlContainsKeys = function (actual, expected) {
  let result = true;
  try{
    const parser = new XMLParser();
    let actualParsed = parser.parse(actual);
    logger.debug(actualParsed)
    result = this.containsKeys(actualParsed, expected);
  } catch (err) {
    logger.error(`failed check: ${err}`)
    result = false;
  }
  return result;
}

 const strategies = {
        contains,
        containsKeys,
        listOfTypes,
        typeOf,
        xmlContains,
        xmlContainsKeys
    }



module.exports = {
  compare
}
