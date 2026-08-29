---
layout: home

hero:
  name: "⚡ DevAgent-TS"
  text: "Autonomous AI Coding Assistant Runtime & TUI"
  tagline: "Local-first Ollama models, Docker sandboxing, 14 LSP language servers, offline DevDocs FTS5, and parallel DAG planning."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Architecture
      link: /guide/architecture
    - theme: alt
      text: Tool Reference
      link: /guide/tools

features:
  - icon: 🛡️
    title: Docker-Sandboxed Execution
    details: Shell actions run in an isolated Linux container with --network=none, bounded CPU/RAM, and strict output ceilings.
  - icon: 🧠
    title: Two-Tier Capability Router
    details: Fast local models handle rapid turns; self-escalates seamlessly to cloud reasoning models for complex tasks.
  - icon: 🔍
    title: 14 Language Server Protocols
    details: Native IDE-grade definitions, references, hover, diagnostics, and symbols for TypeScript, Python, Rust, Go, Java, and more.
  - icon: 📚
    title: Offline DevDocs Search
    details: Embedded SQLite FTS5 index covering 25+ programming languages, frameworks, and machine learning libraries.
  - icon: 📋
    title: Parallel DAG Orchestrator
    details: Decomposes tasks into dependency graphs, executes independent steps concurrently, and detects infinite loops.
  - icon: 💾
    title: Memory & Crash Recovery
    details: Atomic step checkpoints and SQLite episode recording allow seamless session resumption without data loss.
---
