# Lazy Skill Loader for Claude Code

> Progressive disclosure system — L1 index stays in prompt, L2 skills load on demand. Cuts 40K+ token overhead to ~600 tokens.

By Vassa

## The Problem

Claude Code skills systems like agent-skills, superpowers, and gstack load **all** skill definitions into the context. With 30+ skills, that's 40K+ tokens wasted — 10%+ of the context window on content the agent rarely uses in a single session.

```
Session with 30 skills loaded:
  - Skill definitions: ~40K tokens (always present)
  - User prompt + code: ~5K tokens
  - 87% of skill content is unused in most sessions

The model loads skills for:
  - TDD → code-review is irrelevant
  - API design → browser-testing is irrelevant
  - Frontend → shipping-checklist is irrelevant
```

## Solution

Three-layer progressive disclosure:

### L1: Lightweight Index (~540 tokens)

A table of all skills with minimal metadata:
- ID, one-line description, methodology tag
- Loaded via SessionStart hook
- Always available for routing decisions

### L2: Full Skill Content (on-demand)

Complete SKILL.md loaded only when:
- Keyword match in user message
- File pattern match (open files)
- Language match
- Token budget available

### L3: Executable Tools

The skill's actual tool calls (Bash, Agent, etc.) — executed after L2 content guides the model.

```
Traditional:           Lazy Skill Loader:
┌─────────────────┐   ┌─────────────────┐
│ All 30 skills    │   │ L1 index only   │
│ 40K tokens       │   │ 540 tokens      │
└─────────────────┘   └────┬────────────┘
                          │
                   ┌──────▼──────┐
                   │ Agent routes │
                   │ via keywords │
                   └──────┬──────┘
                          │
                   ┌──────▼──────┐
                   │ Load L2 skill│
                   │ ~2K tokens   │
                   └─────────────┘
```

## Architecture

```
                    ┌──────────────────────┐
                    │   Claude Code        │
                    │   Session Start      │
                    │                      │
                    │  ┌────────────────┐ │
                    │  │ SessionStart   │ │
                    │  │ hook executes  │ │
                    │  │ L1 index to   │ │
                    │  │ stdout (inject │ │
                    │  │ into prompt)   │ │
                    │  └────────┬───────┘ │
                    └────────────┼────────┘
                                 │
                    ┌────────────▼──────────┐
                    │  L1 Index in Context   │
                    │  30 skills, 540 tokens │
                    └────────────┬──────────┘
                                 │
                    ┌────────────▼──────────┐
                    │  User: "fix bug in     │
                    │  authentication.ts"   │
                    └────────────┬──────────┘
                                 │
                    ┌────────────▼──────────┐
                    │  Router (lib/router.js)│
                    │  - Keyword: "bug"      │
                    │  - Keyword: "fix"      │
                    │  - File: "*.ts"        │
                    │  → Matches: debugging │
                    └────────────┬──────────┘
                                 │
                    ┌────────────▼──────────┐
                    │  Lifecycle Manager    │
                    │  (lib/lifecycle.js)    │
                    │  - Load L2 content    │
                    │  - Track token budget │
                    │  - Evict when full    │
                    └────────────┬──────────┘
                                 │
                    ┌────────────▼──────────┐
                    │  L2 Content Loaded    │
                    │  Full SKILL.md ~2K    │
                    │  tokens               │
                    └───────────────────────┘
```

### Key Components

| File | Purpose |
|------|---------|
| `hooks/session-start.js` | SessionStart hook — outputs L1 index table + drift warning |
| `lib/router.js` | Keyword + file pattern routing with scoring |
| `lib/lifecycle.js` | L2 loading, token budget, eviction |
| `lib/registry.js` | Registry validation and normalization |
| `lib/methodology.js` | Complexity detection + methodology choice |
| `lib/frontmatter.js` | Minimal YAML parser/stringifier for SKILL.md |
| `lib/hash.js` | SHA-256 helper for idempotency and drift |
| `lib/stub-generator.js` | Renders compact stub replacing original SKILL.md |
| `lib/vault.js` | Bootstrap / restore / sync / drift engine |
| `bin/lazy-bootstrap.js` | CLI for vault operations |
| `registry/skills-registry.json` | Central registry of all skills |
| `SPEC-skill-patching.md` | Patch contract, risks, recovery procedures |
| `skills/lazy-skill-loader/SKILL.md` | This skill's own definition |

## Installation

### Option 1: Clone into `~/.claude/skills/`

Skill tool discovers skills at `~/.claude/skills/<name>/SKILL.md`. Clone the
whole repo there so the directory layout matches:

```bash
git clone <repo> ~/.claude/skills/lazy-skill-loader
```

After cloning, verify these resources exist at the install location:

```
~/.claude/skills/lazy-skill-loader/SKILL.md
~/.claude/skills/lazy-skill-loader/hooks/session-start.js
~/.claude/skills/lazy-skill-loader/registry/skills-registry.json
~/.claude/skills/lazy-skill-loader/lib/
~/.claude/skills/lazy-skill-loader/core/
```

If any of these is missing, the skill is broken — see `SKILL-REQUIREMENTS.md`.

### Option 2: Register the SessionStart hook

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/skills/lazy-skill-loader/hooks/session-start.js"
          }
        ]
      }
    ]
  }
}
```

The hook resolves paths via `__dirname`, so it works regardless of where the
skill is installed — as long as `hooks/`, `registry/`, and `lib/` are siblings.

### Registry schema (v2)

Each entry uses a **callable** `id` in `plugin:skill` form — the same id the
Claude Code `Skill` tool accepts. Do not invent private ids like `tdd-workflow`
that do not resolve through `Skill(...)`: that was the root cause of
`INCIDENT-2026-06-15-tdd-workflow-unknown`.

```json
{
  "id": "agent-skills:debugging-and-error-recovery",
  "source": "agent-skills",
  "path": "skills/debugging-and-error-recovery/SKILL.md",
  ...
}
```

The `path` is the skill's location **inside its source plugin**, used for
future lazy-loading. The path-existence test resolves it against
`~/.claude/plugins/cache/**/skills/<dir>/SKILL.md`.

### Verification

After install:

```bash
cd ~/.claude/skills/lazy-skill-loader && npm test
node ~/.claude/skills/lazy-skill-loader/hooks/session-start.js
# Should print: "Lazy Skill Loader: L1 index loaded. N skills available."
```

If `npm test` fails or the hook prints "could not load registry", the install
is incomplete — re-check that `registry/` and `lib/` are present.

## Activating Vault Mode (token savings ~80%)

The L1 index above only saves you tokens if Claude Code's hardcoded skill
discovery can be prevented — and it can't, hooks run too late. **Vault Mode**
works around this by patching `SKILL.md` files in place: originals are backed
up to `~/.claude/lazy-skills/`, and replaced with compact stubs (~30 tokens
each instead of ~200). Plugin namespaces (`plugin:skill` callable IDs) are
preserved byte-for-byte.

See `SPEC-skill-patching.md` for the full contract. The short version:

### Migration steps

**1. Smoke test on one skill first** (recommended):

```bash
node ~/.claude/skills/lazy-skill-loader/bin/lazy-bootstrap.js --apply --no-plugins
```

This patches only custom skills in `~/.claude/skills/` (typically ~10–15
files). Plugin skills are untouched.

**2. Verify nothing broke:**

```bash
# Restart your Claude Code session, then check available-skills:
# - Stub descriptions should now read "[lazy] <hint>. Vault: ~/.claude/..."
# - All skill IDs should still resolve via Skill('<name>')
# - L1 index from the hook should still print normally
```

If any skill fails to resolve, **restore immediately**:

```bash
node ~/.claude/skills/lazy-skill-loader/bin/lazy-bootstrap.js --restore
```

**3. Full bootstrap (custom + plugins):**

```bash
node ~/.claude/skills/lazy-skill-loader/bin/lazy-bootstrap.js --apply
```

This patches all plugin skills under `~/.claude/plugins/cache/` as well.
Expect ~50–80 files total depending on what you have installed.

### Daily usage after migration

Nothing changes from your side. Claude Code reads the stubs (tiny), the
SessionStart hook still prints the L1 index (same), and when the agent
actually needs a skill's full content it `Read`s the vault backup.

### Drift detection (automatic)

Plugin updates via `git pull` may overwrite our stubs. The SessionStart hook
detects this by comparing SHA-256 of each stub against the recorded hash and
warns you:

```
⚠ Lazy Skill Loader: 3 skill(s) drifted (likely plugin update):
  - agent-skills:code-simplification
  - superpowers:brainstorming
  - ...
Run: lazy-bootstrap --sync
```

Run `--sync` to re-apply stubs. The vault backup is preserved (it's the
original from before any patching).

### CLI commands

```
lazy-bootstrap --apply [--no-custom] [--no-plugins]   backup + patch (default)
lazy-bootstrap --check                                 report drift only
lazy-bootstrap --sync [--force]                        re-apply stubs
lazy-bootstrap --restore [glob]                        restore originals
lazy-bootstrap --list                                  show all vault entries
lazy-bootstrap --help                                  usage
```

### What gets patched

- `~/.claude/skills/<name>/SKILL.md` (custom skills)
- `~/.claude/plugins/cache/<owner>/<plugin>/<version>/skills/<dir>/SKILL.md` (plugin skills)

### What does NOT get patched

- `lazy-skill-loader` itself (self-protected)
- Skills without frontmatter / `name` field (reported as error)
- Files that are already stubs but not in registry (manual restore required)
- Anything outside the two locations above

### Rollback

Full rollback to pre-vault state:

```bash
lazy-bootstrap --restore        # restore all originals from vault
# Vault directory can then be deleted if desired:
rm -rf ~/.claude/lazy-skills
```

## Configuration

All settings can be overridden via environment variables or options:

| Option | Default | Description |
|--------|---------|-------------|
| `maxTokens` | 6000 | Max tokens for loaded L2 skills |
| `maxSkills` | 3 | Max concurrent L2 skills loaded |
| `maxResults` | 5 | Max skills to match per route |

## Registry Format

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
        "keywords": ["debug", "fix", "bug", "error", "broken"],
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
- `methodology` must be one of: `gate-based`, `role-based`, `utility`

## Routing Algorithm

1. **Filter by language** — if skill specifies languages, skip non-matches
2. **Keyword scoring:**
   - Multi-word keyword: substring match (5pts) + word-boundary bonus (+5pts)
   - Single-word keyword: exact word match (10pts) or substring (5pts)
3. **File pattern scoring** — minimatch glob patterns (8pts per match)
4. **Tag overlap bonus** — +2pts per tag found in message
5. **Sort by score** — highest first
6. **Apply token budget** — skip skills that would exceed budget
7. **Return top N** — limited by `maxResults`

## Lifecycle Management

### Loading

When a skill is matched:
1. Check if already loaded → skip
2. Load L2 content from file (or fallback to description)
3. Estimate token count (~3 chars per token)
4. If budget exceeded → evict oldest skill
5. Add to active set

### Eviction

When token budget is full:
- Evict least-recently-used (LRU) skill
- Frees tokens for new skill
- Prevents context overflow

### State

```
Active skills:
  - id: "debugging"
  - content: "<full SKILL.md>"
  - tokensUsed: 2100
  - loadedAt: 1748901234567
```

## Complexity Detection

For tasks that match multiple methodologies, the system detects complexity:

| Signals | Complexity | Action |
|---------|------------|--------|
| 0 | simple | Proceed normally |
| 1-2 | medium | Offer methodology choice |
| 3+ | high | Recommend parallel comparison |

Signal sources:
- Multi-methodology match (gate + role)
- File count (>3 files touched)
- Architecture keywords (design, pattern, refactor)
- Schema keywords (migration, change schema)
- Production keywords (deploy, release, canary)
- Ambiguous language (maybe, possibly, might)

## Tests

```bash
npm test                      # all 128 tests
npm run test:registry         # 26 registry tests
npm run test:routing          # 25 routing tests
npm run test:methodology      # 15 methodology tests
npm run test:lifecycle        # 18 lifecycle tests
npm run test:paths            # 4 path tests
npm run test:payload          # 11 payload tests
npm run test:frontmatter      # 8 YAML parser tests
npm run test:stub             # 9 stub generator tests
npm run test:vault            # 12 vault integration tests
```

### Coverage

| Suite | Tests | What it covers |
|-------|-------|----------------|
| Registry | 26 | Validation, normalization, path traversal, limits |
| Routing | 25 | Keyword matching, file patterns, scoring, budgets |
| Methodology | 15 | Complexity detection, methodology choice |
| Lifecycle | 18 | Loading, eviction, token tracking, complexity |
| Paths | 4 | Path resolution across platforms |
| Payload | 11 | Hook payload shape |
| Frontmatter | 8 | YAML parse/stringify edge cases |
| Stub Generator | 9 | Stub rendering, hint truncation, isStub detection |
| Vault | 12 | Bootstrap, restore, sync, drift, idempotency, plugin versions |

## Limitations

1. **Bash tool only for hooks** — SessionStart hook uses Node.js, Windows requires git bash or WSL
2. **Static routing** — keyword/pattern matching is heuristic, not semantic
3. **Manual registry** — skills must be registered in JSON, not auto-discovered
4. **Path assumptions** — assumes skill paths are relative to registry location
5. **No caching** — L2 content is re-read on each load (could cache in future)

## Roadmap

- [x] Vault Mode (patch-in-place stubs for ~80% token savings)
- [x] Drift detection via SessionStart hook
- [x] CLI tool for vault management (`lazy-bootstrap`)
- [ ] Auto-discovery from skill directories
- [ ] L2 content caching with TTL
- [ ] Semantic routing via embeddings
- [ ] Statistics dashboard (what skills load most often)
- [ ] Integration with circuit-breaker for retry logic

## License

MIT
