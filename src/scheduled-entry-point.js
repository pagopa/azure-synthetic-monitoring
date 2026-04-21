// modules
const utils = require('./utils')
const statics = require('./statics')
const constants = require('./const')

const tester = require('./synthetic-monitoring')

async function main() {
   // call tester with a "keep all" filter
   await tester.execute((monConfig) => true);
};

//start process
main()
