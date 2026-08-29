# Offline DevDocs Search

DevAgent-TS features an embedded SQLite FTS5 documentation search engine powered by pre-packaged DevDocs bundles.

---

## 25+ Supported Documentation Sources

- **Languages**: TypeScript, JavaScript, Python, Go, Rust, Ruby, C, C++, C#, Java, Kotlin, Swift, PHP, Elixir, Zig, Lua.
- **Web & Backend**: React, Vue, Next.js, Node.js, Express, Rails, Django, FastAPI, Spring, Laravel, Svelte.
- **ML & Data Science**: PyTorch, TensorFlow, Pandas, NumPy, Scikit-learn.
- **Databases & DevOps**: PostgreSQL, SQLite, Redis, Docker, Kubernetes, Git, Nginx.

---

## Ingesting Documentation

Download and index documentation bundles into your local `.devagent/docs.db`:

```bash
# Ingest specific docs
npm run docs:ingest -- react typescript python

# Ingest all detected workspace dependencies
npm run docs:ingest -- --auto
```

---

## Agent Usage

During a task, the agent automatically detects workspace languages and queries offline docs via `search_docs` and `get_doc`:

```
User: How do I configure middleware in Next.js 14?
Agent -> search_docs("nextjs middleware matcher")
Agent -> get_doc("next/middleware")
```
