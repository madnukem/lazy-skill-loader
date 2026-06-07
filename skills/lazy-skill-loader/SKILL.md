---
name: lazy-skill-loader
description: Progressive disclosure skill loader — keeps L1 index in context, loads L2 skill content on demand. Reduces prompt overhead from 40-50K to ~2K tokens.
triggers:
  - session start
  - any task where skills might be relevant
---

# Lazy Skill Loader

You are running with a **progressive disclosure** skill system. Instead of loading all skill instructions into context upfront, you have a lightweight L1 index and load full skill content only when needed.

## How It Works

### L1 Index (always in context)
A JSON registry of available skills with name, description, and triggers. ~540 tokens for 30 skills.

### L2 Content (loaded on demand)
Full SKILL.md files loaded via the Skill tool when the router determines relevance. 200-2000 tokens each.

### L3 Execution (at call time)
Tool calls, subagents, hooks activated only when the skill is actually used.

## Your Workflow

1. **On task start**: Read user message → identify relevant skills from L1
2. **Route**: Use keyword + context matching to select up to 3 skills
3. **Load**: Invoke the Skill tool for each selected skill to get L2 instructions
4. **Execute**: Follow the loaded skill instructions
5. **Complex task?** If multiple methodologies match, offer user a choice
6. **On completion**: Evict L2 content from active context

## Complexity Detection

A task is complex when it has 2+ of:
- Multi-methodology match (gate-based AND role-based skills trigger)
- Scope > 3 files or > 2 modules
- Architecture decision involved
- Ambiguous requirements

For complex tasks, present methodology options to the user.

## Available Skills

Load the registry at `registry/skills-registry.json` to see all 30 skills.

Key categories:
- **Gate-based** (21): TDD, code review, debugging, planning, security...
- **Role-based** (7): YC office hours, design review, eng review, CSO, ship, benchmark, canary
- **Utility** (2): Caveman token saver, planning with files

## Rules

- Max 3 skills loaded simultaneously (token budget: 6000)
- If unsure which skill fits, ask user
- Always verify work after completion
- Use core-rules.md for default behavior when no skill matches
