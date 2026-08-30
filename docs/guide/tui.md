# Terminal UI & Keybindings

Nexum features an interactive React terminal interface built on Ink with alternate screen buffer support (`\x1b[?1049h`).

---

## Primary Views

1. **Conversation View (`/chat` or `Ctrl+1`)**:
   Main chat interface with streamed tokens, syntax-highlighted markdown, and inline execution transcripts.

2. **Execution DAG View (`/dag` or `Ctrl+2`)**:
   Visual dependency graph of active and completed plan steps.

3. **Tasks View (`/tasks` or `Ctrl+3`)**:
   Multi-step task breakdown and status trackers.

4. **Changes & Diffs (`/git` or `Ctrl+4`)**:
   Unified diff viewer with addition/deletion counts.

5. **Logs View (`/logs` or `Ctrl+5`)**:
   Real-time system events, tool invocations, and debug traces.

---

## Global Keybindings

| Shortcut | Action |
| :--- | :--- |
| `Ctrl+M` | Open Model Switcher overlay |
| `Ctrl+P` | Open Universal Command Palette |
| `Ctrl+D` | Open Execution DAG overlay |
| `Ctrl+K` | Open Search Everywhere |
| `Ctrl+B` | Toggle Sidebar (Sessions, Tools, Skills) |
| `Ctrl+C` | Cancel in-flight turn (Double press quits) |

---

## Essential Slash Commands

- `/doctor`: Run system diagnostics
- `/plan <goal>`: Decompose and run an autonomous plan
- `/commit [msg]`: Stage changes and generate a commit message
- `/review`: Review working copy for code smells & security
- `/model <name>`: Switch active LLM (persists automatically)
- `/tier local|cloud`: Switch execution tier
- `/resume`: Restore conversation and plan from previous session
- `/theme default|midnight|solarized`: Change color theme
