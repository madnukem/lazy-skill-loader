# Methodology Selector

Determines when to offer methodology choice for complex tasks.

## Complexity Heuristics

A task is **complex** when ANY of:
- Multi-methodology: router returns skills from 2+ methodologies
- Scope: touches >3 files or >2 modules
- Architecture: involves new API, schema change, or cross-cutting concern
- Uncertainty: requirements are ambiguous or user says "I'm not sure"
- Risk: production-critical, security-sensitive, or hard to reverse

## Decision Matrix

| Complexity | Action |
|-----------|--------|
| Low (0-1 signals) | Use default gate-based workflow, no choice offered |
| Medium (2 signals) | Offer choice: gate-based OR role-based |
| High (3+ signals) | Offer all three: gate-based, role-based, or parallel |

## Methodologies

### Gate-based (agent-skills default)
spec → plan → build → test → verify

Best for: well-defined tasks, bug fixes, single-module features.
Strength: quality gates at each step prevent drift.

### Role-based (gstack pattern)
CEO → Designer → Eng Manager → QA → Ship

Best for: new features with UI/UX, cross-team impact, product decisions.
Strength: multiple perspectives catch blind spots.

### Parallel comparison
Run both gate-based and role-based via worktree agents simultaneously.
Compare plans, merge best parts.

Best for: first-time architecture decisions, high-stakes launches.
Strength: cross-validation eliminates methodology bias.

## Presentation Format

When offering choice:

```
Сложная задача обнаружена (N сигналов сложности).

1. Gate-based — spec → plan → build → test → verify
2. Role-based — CEO → Design → Eng → QA → Ship
3. Параллельно — оба метода, сравнение результатов

Выберите: 1 / 2 / 3
```
