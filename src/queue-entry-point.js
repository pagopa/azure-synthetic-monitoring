
// modules
const utils = require('./utils')
const statics = require('./statics')
const constants = require('./const')

const tester = require('./synthetic-monitoring')
const util = require("node:util");




async function main() {

  //todo add event parsing

   // call tester with a "keep all" filter
   await tester.execute(statics.monitorConfigurationFilterByName(['fe']),
     utils.logSender,
     utils.logSuccess,
     utils.logError
   );
};



//start process
main()
