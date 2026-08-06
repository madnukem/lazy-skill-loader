# Installing lazy-skill-loader

> **For the LLM doing the install.** Read this top to bottom, then execute.
> Works the same for Claude, GPT, Gemini, or any capable model.

## What this does

lazy-skill-loader compresses every SKILL.md in the user's harness into a tiny
**stub**, backing up the originals to a vault. The model sees short descriptions
in the session-start index and loads full content on demand via `Read`.
Net effect: ~80% fewer tokens spent on unused skills.

## Install steps

### 1. Place the loader

Clone or copy this repo to:

```
~/.claude/skills/lazy-skill-loader/
```

On Windows (Git Bash) that's `C:/Users/<user>/.claude/skills/lazy-skill-loader/`.
On Linux/macOS, `~/.claude/skills/lazy-skill-loader/`.

Verify the layout:

```
~/.claude/skills/lazy-skill-loader/
  hooks/session-start.js
  bin/lazy-bootstrap.js
  bin/update-registry.js
  lib/vault.js, stub-generator.js, frontmatter.js, registry.js, hash.js
  STUB_INSTRUCTION.md      ← read this before compressing
  INSTALL.md               ← you are here
```

### 2. Register the session-start hook

Add to the user's `~/.claude/settings.json` under `hooks.SessionStart`:

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "node ~/.claude/skills/lazy-skill-loader/hooks/session-start.js"
    }
  ]
}
```

Use an absolute path for the command (expand `~` to the real home dir).

### 3. Compress existing skills

**Read `STUB_INSTRUCTION.md` first.** It defines how to compress. The act of
compression is judgment, not truncation — each skill's stub must preserve the
signals that tell the model *when* to reach for it.

Two modes:

**A) Algorithmic (fast, uniform)** — run the bundled bootstrap:

```bash
node ~/.claude/skills/lazy-skill-loader/bin/lazy-bootstrap.js --apply
```

This stubs every SKILL.md it finds (custom skills + plugin cache + direct
plugin installs) using the rules in `STUB_INSTRUCTION.md` as implemented in
`lib/stub-generator.js`. Good default.

**B) Intelligent (per-skill judgment)** — you compress skills one at a time:

1. `node bin/lazy-bootstrap.js --list` to see candidates
2. For each skill: `Read` the original, distill per `STUB_INSTRUCTION.md`,
   `Write` the stub, keep a backup in the vault
3. Register each entry so restore/drift-detection work

Use (B) when the algorithmic stubs are too generic and the model struggles to
route — i.e., when descriptions need real understanding, not truncation.

### 4. Rebuild the registry

The session-start hook reads `registry/skills-registry.json` to build the
model-facing index. Rebuild it from the vault so stub descriptions appear:

```bash
node ~/.claude/skills/lazy-skill-loader/bin/update-registry.js
```

This is **local only** — do not commit `registry/skills-registry.json`. Every
user's registry differs because they have different skills installed.

### 5. Verify

```bash
node ~/.claude/skills/lazy-skill-loader/hooks/session-start.js
```

You should see a table of all skills with descriptions. Restart the harness
so the hook fires on the next session.

## Uninstall / restore originals

```bash
node ~/.claude/skills/lazy-skill-loader/bin/lazy-bootstrap.js --restore
```

Puts every original SKILL.md back from the vault and clears the registry.
