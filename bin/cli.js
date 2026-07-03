#!/usr/bin/env node
const { startTui } = require("../dist/cli/tui");

startTui().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
