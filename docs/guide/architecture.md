# Architecture Overview

Nexum is built around an event-driven, sandboxed, multi-tier agent architecture designed for maximum autonomy, privacy, and safety.

```
┌──────────────────────────────────────────────────────────┐
│                   Ink React Terminal UI                  │
│       Conversation · Plan · Tasks · Changes · Logs       │
└────────────────────────────┬─────────────────────────────┘
                             │ Events & Dispatch
┌────────────────────────────▼─────────────────────────────┐
│               Centralized State Store (Redux)            │
│               .nexum/checkpoint.json                  │
└────────────────────────────┬─────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────┐
│                 Agent Orchestration Loop                 │
│         Parallel DAG Planner · Loop Detection            │
└──────┬──────────────┬──────────────┬──────────────┬──────┘
       │              │              │              │
┌──────▼──────┐┌──────▼──────┐┌──────▼──────┐┌──────▼──────┐
│ Capability  ││  Docker     ││   14 LSP    ││  Offline    │
│ Router      ││  Sandbox    ││   Servers   ││  DevDocs    │
│ Local/Cloud ││  --net=none ││  AST Engine ││  SQLite FTS │
└─────────────┘└─────────────┘└─────────────┘└─────────────┘
```

---

## Key Architectural Principles

1. **Local-First with Capability Fallback**:
   Every turn attempts low-latency local execution. If the model determines it needs heavy reasoning or vision capabilities, it self-escalates via `escalate_task` to the cloud tier.

2. **Isolated Docker Sandboxing**:
   All shell and build executions run in dedicated ephemeral containers with no network access (`--network=none`), bounded CPU/memory, and hard 2 MiB output ceilings with escalation kills.

3. **Immutable Single Source of Truth**:
   The entire UI is driven by an immutable event-reduced state store, ensuring clean rendering and time-travel replay capabilities.

4. **Fault Recovery & Checkpointing**:
   Multi-step plans are checkpointed to `.nexum/checkpoint.json` after every step transition. Crashed or aborted sessions resume seamlessly via `/resume`.
