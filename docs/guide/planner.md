# DAG Planner & Parallel Execution

Complex engineering tasks require multi-step planning and topological execution.

---

## Directed Acyclic Graph (DAG) Modeling

When you run `/plan <task>`, the agent decomposes the task into steps with declared dependencies:

```json
[
  { "id": "1", "title": "Setup test database schema", "dependencies": [] },
  { "id": "2", "title": "Implement authentication controller", "dependencies": ["1"] },
  { "id": "3", "title": "Implement JWT middleware", "dependencies": ["1"] },
  { "id": "4", "title": "Write end-to-end integration tests", "dependencies": ["2", "3"] }
]
```

---

## Parallel Execution

Independent steps (like Step 2 and Step 3 above) execute concurrently via `Promise.all`, significantly reducing total mission duration.

---

## Loop Detection

The loop detector tracks repeated tool invocations and prevents hallucinated infinite loops, forcing a replan or user escalation if the agent gets stuck.
