# Incident: `Skill(tdd-workflow)` → "Unknown skill"

**Date:** 2026-06-15
**Severity:** High (core feature broken — Skill tool cannot invoke any L1-indexed skill)
**Status:** Open

## Summary

The `SessionStart` hook (`hooks/session-start.js`) successfully prints the L1
index of 30 skills into the conversation context, including `tdd-workflow`,
`code-review`, `debugging`, `planning`, etc. However, attempting to invoke any
of these IDs through the `Skill` tool returns `Error: Unknown skill`.

The L1 index advertises skills that the `Skill` tool cannot resolve.

## Reproduction

1. Start a new Claude Code session.
2. Observe the `SessionStart` output — the L1 table is printed with 30 rows.
3. Call `Skill(skill="tdd-workflow")`.
4. Result: `Error: Unknown skill: tdd-workflow`.

## Root Cause

Two coupled defects:

### Defect 1 — Registry points to non-existent paths

`registry/skills-registry.json` declares relative paths like:

```json
{
  "id": "tdd-workflow",
  "source": "agent-skills",
  "path": "skills/gate-based/tdd/SKILL.md"
}
```

This path is interpreted relative to the installed skill directory
`~/.claude/skills/lazy-skill-loader/`. The expected file would be:

```
~/.claude/skills/lazy-skill-loader/skills/gate-based/tdd/SKILL.md
```

**This file does not exist.** Neither does the `skills/gate-based/` subtree,
nor the `skills/agent-skills/` subtree referenced by other entries. The
installed skill directory contains only `SKILL.md` (9523 bytes) — no
`registry/`, no `skills/`, no `hooks/`.

### Defect 2 — Installed payload is incomplete

The source repository at `C:/Users/Vassa/skills_research/lazy-skill-loader/`
contains:

```
hooks/session-start.js
registry/skills-registry.json     (18596 bytes, 30 entries)
skills/lazy-skill-loader/SKILL.md
core/   lib/   tests/
```

The deployed copy at `~/.claude/skills/lazy-skill-loader/` contains only:

```
SKILL.md                          (9523 bytes)
```

The `registry/` and the referenced `skills/` subtrees were not shipped to the
installation directory. The SessionStart hook itself evidently runs from a
different location (it still finds a registry and prints the table — possibly
from a separate hook registration pointing back at the source repo), but the
`Skill` tool resolves skill IDs by scanning `~/.claude/skills/**/SKILL.md` and
the plugin namespaces, neither of which contains `tdd-workflow`.

### Where the skills actually live

The `source: "agent-skills"` entries correspond conceptually to the
`addy-agent-skills` plugin, installed at:

```
~/.claude/plugins/marketplaces/addy-agent-skills/skills/
~/.claude/plugins/cache/addy-agent-skills/agent-skills/1.0.0/skills/
```

But the IDs there are namespaced (`agent-skills:test-driven-development`) and
the directory name is `test-driven-development`, not `tdd-workflow`. The
registry's `id` field is not a Claude Code skill ID — it is a private
identifier used only by the L1 table for routing hints.

## Impact

- Every entry in the L1 index is currently uncallable via the `Skill` tool.
- The agent is misdirected: the L1 table claims "Use the Skill tool to load
  full instructions for any skill above," but every attempt fails.
- Users and agents must independently rediscover the real IDs under
  `superpowers:*` / `agent-skills:*` / `chrome-devtools-mcp:*`.

## Evidence

```
$ ls ~/.claude/skills/lazy-skill-loader/
SKILL.md        # that's it

$ find ~/.claude -name "tdd-workflow" -type d
(empty)

$ find ~/.claude -path "*lazy-skill-loader/registry*"
(empty)

# Source repo:
$ ls C:/Users/Vassa/skills_research/lazy-skill-loader/registry/
skills-registry.json     # 18596 bytes
```

## Fix Options

### Option A — Ship the registry and skill files alongside SKILL.md

Copy `registry/skills-registry.json` and the referenced `skills/` subtrees
into the installed directory. This restores the intended architecture but
duplicates content already present under `plugins/marketplaces/addy-agent-skills/`.

### Option B — Rewrite the registry to point at real installed paths

Map each entry to its actual `plugin:skill-id` form and teach the hook to
emit `plugin:skill-id` in the L1 table instead of the private `id`. The
agent then calls `Skill("superpowers:test-driven-development")` directly.
This eliminates the indirection layer entirely.

### Option C — Add a resolution layer in `session-start.js`

Have the hook resolve `path` fields against the real plugin layout at
session start and rewrite the printed IDs to match what the `Skill` tool
accepts. Most fragile of the three; only worth it if the private IDs must
be preserved for compatibility.

**Recommended:** Option B. The private ID namespace adds no value if the
agent must use the real ID to invoke the skill anyway.

## Workaround (for affected sessions)

Ignore the L1 table's ID column. Use the real skill IDs:

| L1 advertised ID   | Real callable ID                          |
|--------------------|-------------------------------------------|
| `tdd-workflow`     | `superpowers:test-driven-development`     |
| `code-review`      | `agent-skills:code-review-and-quality`    |
| `debugging`        | `superpowers:systematic-debugging`        |
| `planning`         | `agent-skills:planning-and-task-breakdown`|
| `spec-driven`      | `superpowers:writing-plans`               |
| `security`         | `agent-skills:security-and-hardening`     |
| `frontend`         | `frontend-design:frontend-design`         |

When in doubt, search
`~/.claude/plugins/marketplaces/*/skills/*/SKILL.md` and
`~/.claude/plugins/cache/*/*/<version>/skills/*/SKILL.md` for the real ID.
