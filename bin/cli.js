#!/usr/bin/env node
const { startRepl } = require("../dist/cli/repl");

startRepl().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
