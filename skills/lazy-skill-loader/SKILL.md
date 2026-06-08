---
name: lazy-skill-loader
description: Progressive disclosure skill loader — keeps L1 index in context, loads L2 skill content on demand. Reduces prompt overhead from 40-50K to ~2K tokens. Use when managing skills or when the system needs to determine which skills are relevant for a task.
---

# Lazy Skill Loader

## Overview

A progressive disclosure system for managing Claude Code skills. Instead of loading 30+ full skill definitions into context (~40K tokens), the system maintains a lightweight L1 index (~540 tokens) and loads full skill content only when relevant to the current task.

This solves the context bloat problem where most of the loaded skill content is never used in a single session.

## How It Works

Three-layer architecture:

```
┌─────────────────────────────────────────────────────────────┐
│ L1: Lightweight Index (~540 tokens)                         │
│ - Always in context via SessionStart hook                  │
│ - Table: ID, description, methodology                        │
│ - Used for routing decisions                                │
└──────────────────────────┬──────────────────────────────────┘
                           │
                   ┌───────▼────────┐
                   │ Router Engine  │
                   │ - Keyword match│
                   │ - File patterns│
                   │ - Language     │
                   │ - Token budget │
                   └───────┬────────┘
                           │
                   ┌───────▼──────────────────────┐
                   │ L2: Full Skill Content         │
                   │ - Loaded on demand             │
                   │ - 200-2000 tokens per skill     │
                   │ - Max 3 concurrent (6000 total)│
                   └───────────────────────────────┘
                           │
                   ┌───────▼────────┐
                   │ L3: Execution  │
                   │ - Tool calls   │
                   │ - Subagents    │
                   │ - Hooks        │
                   └────────────────┘
```

## When to Use

- **Session start**: The L1 index is automatically injected via SessionStart hook
- **Task routing**: When determining which skills are relevant for a user request
- **Skill loading**: When a matched skill needs its full instructions loaded
- **Complexity detection**: When multiple methodologies match and user choice is needed

## Routing Algorithm

When a user message arrives:

```
1. FILTER BY LANGUAGE
   └── If skill specifies languages, skip non-matches

2. KEYWORD SCORING
   ├── Multi-word keyword: substring match (5pts) + word-boundary bonus (+5pts)
   └── Single-word keyword: exact word match (10pts) or substring (5pts)

3. FILE PATTERN SCORING
   └── Minimatch glob patterns against open files (8pts per match)

4. TAG OVERLAP BONUS
   └── +2pts per tag found in message

5. SORT BY SCORE
   └── Highest scores first

6. APPLY TOKEN BUDGET
   └── Skip skills that would exceed 6000 token budget

7. RETURN TOP N
   └── Limited by maxResults (default: 5)
```

## Lifecycle Management

### Loading a Skill

When a skill is matched:

```
┌──────────────────────┐
│ Check if already     │
│ loaded?              │
└──────┬───────────────┘
       │
    YES├───────────────┐ NO
       │               │
       │          ┌────▼────┐
       │          │ Load L2 │
       │          │ content │
       │          └────┬────┘
       │               │
       │          ┌────▼────┐
       │          │ Estimate│
       │          │ tokens  │
       │          └────┬────┘
       │               │
       │          ┌────▼─────────────┐
       │          │ Budget OK?       │
       │          └────┬─────────────┘
       │               │
       │          NO├──┴──┐YES
       │               │  │
       │        ┌──────▼──▼──────┐
       │        │ Evict oldest   │
       │        │ skill (LRU)    │
       │        └──────┬─────────┘
       │               │
       │          ┌────▼────┐
       │          │ Add to  │
       │          │ active  │
       │          │ set    │
       │          └─────────┘
       └───────────┘
```

### Eviction Rules

When token budget is full (6000 tokens) OR max skills reached (3):

```
Eviction candidate:
  - Least recently used (LRU)
  - Frees tokens for new skill
  - Prevents context overflow
```

## Complexity Detection

For tasks that match multiple methodologies, detect complexity:

```
Complexity signals:
├── Multi-methodology match (gate + role)
├── File count (>3 files)
├── Architecture keywords (design, pattern, refactor)
├── Schema keywords (migration, schema change)
├── Production keywords (deploy, release, canary)
└── Ambiguous language (maybe, possibly, might)

Thresholds:
├── 0 signals  → simple (proceed normally)
├── 1-2 signals → medium (offer methodology choice)
└── 3+ signals  → high (recommend comparison)
```

## Registry Format

Skills are registered in `registry/skills-registry.json`:

```json
{
  "version": 1,
  "skills": [
    {
      "id": "debugging",
      "name": "Debugging",
      "description": "Structured debugging: reproduce, isolate, hypothesis, fix, verify.",
      "path": "../agent-skills/skills/debugging/SKILL.md",
      "methodology": "gate-based",
      "token_estimate": 2000,
      "tags": ["workflow", "troubleshooting"],
      "triggers": {
        "keywords": ["debug", "fix", "bug", "error"],
        "file_patterns": ["*.test.*", "*test*.ts"],
        "languages": ["any"]
      }
    }
  ]
}
```

### Validation Rules

- Max 500 skills in registry
- Max 50 keywords per skill
- Max 20 file patterns per skill
- Paths must be relative, no `../` escape
- `token_estimate` must be finite positive number
- `methodology` must be: `gate-based`, `role-based`, or `utility`

## Available Skills Categories

```
┌─────────────────────────────────────────────────────────┐
│ Gate-based (21 skills)                                  │
│ - TDD, code-review, debugging, planning, security,     │
│   frontend, api-design, ci-cd, git-workflow, ...        │
├─────────────────────────────────────────────────────────┤
│ Role-based (7 skills)                                   │
│ - YC office hours, design review, eng review,           │
│   CSO, ship, benchmark, canary                          │
├─────────────────────────────────────────────────────────┤
│ Utility (2 skills)                                      │
│ - Caveman token saver, planning with files              │
└─────────────────────────────────────────────────────────┘
```

## Workflow for Agent

When a user sends a message:

```
1. PARSE MESSAGE
   └── Extract keywords, open files, language context

2. ROUTE
   └── Match against L1 index triggers

3. CHECK COMPLEXITY
   └── If multi-methodology → offer choice

4. LOAD L2
   └── Use Skill tool for each matched skill

5. EXECUTE
   └── Follow loaded skill instructions

6. VERIFY
   └── Check work after completion
```

## Configuration

Defaults (can be overridden):

| Setting | Default | Description |
|---------|---------|-------------|
| `maxTokens` | 6000 | Max tokens for loaded L2 skills |
| `maxSkills` | 3 | Max concurrent L2 skills |
| `maxResults` | 5 | Max skills to match per route |

## Red Flags

- Loading more than 3 skills without eviction
- Ignoring token budget limits
- Loading skills without keyword/file match
- Not offering methodology choice on multi-methodology matches
- Modifying registry without validation

## Verification

After routing and loading:

- [ ] Token budget within limits (< 6000)
- [ ] No more than 3 skills active
- [ ] Matched skills have relevant keywords/patterns
- [ ] L2 content successfully loaded
- [ ] If complex task, user was offered methodology choice
