#!/usr/bin/env node
import 'dotenv/config';

const [command] = process.argv.slice(2);

// `nexum migrate` — explicit DevAgent → Nexum state migration
// (docs/REBRANDING.md §4). Routed here rather than inside the TUI so it runs
// without loading the full terminal app. Everything else (including the
// legacy `devagent`/`devagent-ts` bin aliases) launches the TUI, which owns
// its own subcommand parsing (`nexum asl ...`).
if (command === 'migrate') {
  const { main } = await import('../dist/cli/migrate.js');
  await main(process.argv.slice(3));
} else {
  await import('../dist/tui/index.js');
}
