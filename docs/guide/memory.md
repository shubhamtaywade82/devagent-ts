# Persistent Memory & Learning

DevAgent-TS remembers past lessons, mistakes, and user preferences across terminal sessions.

---

## Storage & Architecture

- SQLite database stored at `.devagent/memory.db`.
- Post-mission reflection automatically extracts rules and lessons.
- Developers can explicitly teach preferences using the `/learn <rule>` command.

---

## Context Packing

Before each user prompt, relevant memory snippets and learnings are dynamically injected into the system prompt context without exceeding token budgets.
