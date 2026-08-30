# Capability-Based Model Router & Escalation

Nexum introduces a local-first capability router that optimizes latency, cost, and task success.

---

## Capabilities & Tags

Models in your local Ollama library and cloud keys are tagged with capabilities:

- `coding`: High code synthesis accuracy (`qwen2.5-coder`, `deepseek-coder`).
- `reasoning`: Complex multi-step deduction and architecture (`deepseek-r1`, `o1`).
- `vision`: Image, screenshot, and diagram comprehension (`llava`, `minicpm-v`).
- `quick`: Sub-second local response for simple lookups (`qwen2.5-coder:1.5b`, `llama3.2:3b`).

---

## Dynamic Self-Escalation (`escalate_task`)

When a fast local model encounters a problem beyond its parameter capacity (such as intricate multi-file architectural refactoring), it calls the `escalate_task` tool.

The router seamlessly migrates the turn to a cloud reasoning model with the full active transcript preserved.
