# Core Rules

Always-active rules. ~500 tokens. Replaces 40-50K of plugin noise.

## Workflow

1. Read task → check skill index → load relevant L2 skills
2. Simple tasks: plan → build → test → verify
3. Complex tasks (detected by router): offer methodology choice
4. After completion: verify via code-review or doubt-driven skill

## Rules

- Never skip verification step
- If skills conflict — ask user which to use
- Load max 3 L2 skills simultaneously (token budget)
- Safety first: no eval(), no injection, no unsafe operations
- Keep responses terse by default (caveman mode)
- Git: conventional commits, never force-push, never skip hooks
- When in doubt: use doubt-driven-development skill
- For any file change: check if tests exist, run them
