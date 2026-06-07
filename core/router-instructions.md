# Router Instructions

How the agent uses the skill router to select and load skills on demand.

## On Task Start

1. Read user message
2. Determine open files and language context
3. Call `route(message, openFiles, registry, options)`:
   - `message`: user's full prompt
   - `openFiles`: files currently open/mentioned
   - `registry`: loaded from skills-registry.json
   - `options`: `{ maxResults: 3, language, tokenBudget: 6000 }`
4. If `result.multiMethodology === true` → invoke methodology selector
5. Load L2 (full SKILL.md) for each matched skill
6. Execute task using loaded skill instructions

## On Task Switch

If the user changes topic significantly:
1. Evict current L2 skills from context
2. Re-run router with new message
3. Load new L2 skills

## Token Budget

Default: 6000 tokens for L2 content (≈ 3-4 skills).
If routing returns > budget allows, highest-scored skills win.

## Fallback

If router returns 0 matches:
1. Agent decides independently using core rules only
2. User can force-load any skill via `/skill-name`
