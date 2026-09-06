# Nexum Issue-to-PR & CI Autonomous Automation

## 1. Vision & Workflow

The ultimate developer workflow moves from micro-supervision ("review every tool call") to **intent → verification → pull request review**:

```bash
# Developer specifies an issue
nexum issue 184
```

Nexum autonomously drives the full lifecycle:

```text
GitHub Issue #184
       │
       ▼
1. INGEST           Fetch title, description, labels, and comments via `gh issue view`
       │
       ▼
2. REPRODUCE        Inspect repo, locate test suite, write/run reproduction test
       │
       ▼
3. PLAN             Decompose fix into steps, dependencies, and rollback hooks
       │
       ▼
4. IMPLEMENT        Apply targeted edits in isolated branch `nexum/issue-184-fix`
       │
       ▼
5. VERIFY           Run test runner, check linters, inspect LSP diagnostics
       │
       ▼
6. REVIEW           Inspect unified git diff, summarize changes & impact
       │
       ▼
7. DELIVER          Push feature branch, open GitHub PR: "Closes #184"
```

---

## 2. CI Autonomous Repair Pipeline

In addition to local issue automation, Nexum integrates into CI workflows (e.g. GitHub Actions):

```yaml
# .github/workflows/nexum-repair.yml
name: Autonomous CI Repair
on:
  workflow_run:
    workflows: ["Test Suite"]
    types: [completed]

jobs:
  repair:
    if: ${{ github.event.workflow_run.conclusion == 'failure' }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install -g @nemesis-oss/nexum
      - name: Run Nexum Autonomous Repair
        env:
          OLLAMA_API_KEY: ${{ secrets.OLLAMA_API_KEY }}
          NEXUM_AUTO_APPROVE: "true"
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          nexum fix "Diagnose and fix the test failure from workflow run ${{ github.event.workflow_run.id }}"
```

---

## 3. Granular Permission Control Plane

To support autonomous pipelines safely, permissions evolve beyond a binary `autoApprove` flag into permission classes:

| Permission Class | Capabilities Covered | Default Interactive | Autonomous / CI |
| :--- | :--- | :---: | :---: |
| **READ** | Filesystem reads, git status/log/diff, LSP diagnostics | Automatic | Automatic |
| **WRITE** | File modifications, patches, directory creation | Automatic | Automatic |
| **EXECUTE** | Sandboxed shell commands (`ShellTool`), test runners | Automatic | Automatic |
| **NETWORK** | Headless browser navigation, public APIs, DevDocs | Automatic | Automatic |
| **REPOSITORY** | Creating git branches, staging, committing | Automatic | Automatic |
| **REMOTE** | `git push`, creating remotes | **Approval Prompt** | Automatic (`NEXUM_AUTO_APPROVE`) |
| **GITHUB** | Opening PRs, commenting on issues | **Approval Prompt** | Automatic (`NEXUM_AUTO_APPROVE`) |
| **DESTRUCTIVE** | File deletions (`delete_file`), force commands | **Approval Prompt** | Explicit Opt-In |
