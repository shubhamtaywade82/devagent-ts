# 35+ Built-in Tools Reference

Nexum includes over 35 safety-guarded tools exposed to the agent loop with dynamic tool pruning.

---

## 1. Filesystem & Code Editing

- `read_file`: Read entire files or specific line ranges with 1-based indexing.
- `write_file`: Create or overwrite files atomically.
- `patch`: Apply unified diff hunks surgically.
- `append`: Append content to the end of a file.
- `move_file` / `copy_file`: Safely relocate or duplicate files.
- `delete_file`: Delete files (guarded by confirmation modal).
- `make_directory` / `list_directory`: Manage filesystem directory trees.
- `search_code`: Fast ripgrep searching across the workspace.
- `snapshot_backup`: Create instant restorable rollback points.

---

## 2. LSP Code Intelligence (14 Languages)

- `get_definition`: Jump to symbol definitions across files.
- `find_references`: Locate all usages and call sites.
- `hover`: Extract type signatures and docstrings.
- `diagnostics`: Query compiler/linter errors and warnings.
- `rename_symbol`: Safely refactor symbol names across the codebase.
- `document_symbols` / `workspace_symbols`: Inspect symbol trees.

---

## 3. Project & Test Runners

- `run_tests`: Run unit tests via npm/cargo/go/pytest.
- `run_lint`: Run linters with auto-fix support.
- `run_format`: Format code with project formatters.
- `run_build`: Execute build pipelines.
- `rspec` / `rubocop`: Native Ruby test & linter tools.

---

## 4. Sandboxed Shell & Docker

- `shell`: Run commands in an isolated Docker sandbox with resource bounds.
- `docker`: Inspect and manage local container lifecycles (privileged mode blocked).

---

## 5. Offline Documentation

- `search_docs`: Query pre-indexed DevDocs FTS5 SQLite database.
- `get_doc`: Retrieve full documentation pages for APIs and functions.
- `list_doc_sources`: List indexed documentation bundles.

---

## 6. Git & GitHub

- `git`: Safe repository inspection (`status`, `diff`, `log`, `branch`, `add`, `commit`).
- `github`: Query PRs, issues, and releases via `gh` CLI.

---

## 7. Database & Browser

- `sqlite_query`: Execute read-only queries against local SQLite databases.
- `browser_*`: Automated headless Playwright Chromium navigation and scraping.
