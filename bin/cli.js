#!/usr/bin/env node
import { startRepl } from "./src/cli/repl";

startRepl().catch((e) => {
  console.error(`Fatal: ${e.message}`);
  process.exit(1);
});
