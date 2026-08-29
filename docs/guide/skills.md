# Custom Skills & Prompts

Skills are reusable Markdown instructions placed in `.devagent/skills/<skill-name>/SKILL.md`.

---

## Skill Format

```markdown
---
name: Clean Architecture Refactoring
description: Guides refactoring towards SOLID principles and clean layer separation.
---

# Instructions

When refactoring:
1. Ensure all single-responsibility boundaries are clear.
2. Replace hardcoded dependencies with inversion of control.
3. Verify test coverage before and after changes.
```

---

## Activating Skills

- Browse skills via `/skills` overlay in the TUI.
- Pin active skills to the prompt using `/skills <id>`.
