#!/usr/bin/env node
require("dotenv").config();
const { startTui } = require("../dist/cli/tui");

startTui().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
