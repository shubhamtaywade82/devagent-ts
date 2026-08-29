# Model Benchmark Harness

DevAgent-TS includes a built-in benchmark harness to evaluate local and cloud LLMs for agentic coding readiness.

---

## Running the Benchmark

Score all installed local Ollama models and cloud tiers:

```bash
npm run benchmark
```

---

## Evaluation Criteria

1. **Tool Calling Syntax**: Correct function call extraction, argument parsing, and type validation.
2. **JSON Schema Adherence**: Strict structured JSON generation without Markdown markdown fence leakage.
3. **Agentic Decision Making**: Multi-turn tool chaining and recovery from mock environment errors.
4. **Throughput & Latency**: Time to First Token (TTFT) and Tokens Per Second (tok/s).
