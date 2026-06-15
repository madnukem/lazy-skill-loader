#!/usr/bin/env node
// paths.test.js — Path existence tests (T2 from SKILL-REQUIREMENTS.md)
//
// Regression for INCIDENT-2026-06-15-tdd-workflow-unknown:
// Registry declared `path: "skills/gate-based/tdd/SKILL.md"` — file did not
// exist anywhere. The old `validateRegistry` only checked string format, so
// the registry passed validation but every skill was unresolvable.
//
// This test resolves each registry `path` against the plugin cache and
// plugin marketplaces directories where Claude Code actually discovers
// skills, and asserts the SKILL.md exists.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { createTestRunner } = require('./helpers');
const { test, assert, results } = createTestRunner();

const CLAUDE_HOME = path.join(os.homedir(), '.claude');
const PLUGIN_CACHE = path.join(CLAUDE_HOME, 'plugins', 'cache');
const PLUGIN_MARKETPLACES = path.join(CLAUDE_HOME, 'plugins', 'marketplaces');

/**
 * Search all plugin cache + marketplaces for a skill_dir/SKILL.md.
 * Returns absolute path if found, null otherwise.
 */
function resolveSkillFile(skillDir) {
  const targets = [
    PLUGIN_CACHE,
    PLUGIN_MARKETPLACES,
  ];
  const fileName = 'SKILL.md';

  for (const root of targets) {
    if (!fs.existsSync(root)) continue;
    // Walk: root/<plugin>/<...>/<version>/skills/<skillDir>/SKILL.md
    // Use depth-limited recursive scan instead of fixed-depth glob to survive
    // layout changes between plugin versions.
    const found = walkForSkillFile(root, skillDir, fileName, 0, 6);
    if (found) return found;
  }
  return null;
}

function walkForSkillFile(dir, skillDir, fileName, depth, maxDepth) {
  if (depth > maxDepth) return null;
  let stats;
  try { stats = fs.statSync(dir); } catch { return null; }
  if (!stats.isDirectory()) return null;

  // Direct hit: <dir>/SKILL.md where <dir> basename === skillDir
  if (path.basename(dir) === skillDir) {
    const candidate = path.join(dir, fileName);
    if (fs.existsSync(candidate)) return candidate;
  }

  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return null; }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    // Prune noise directories
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const child = path.join(dir, ent.name);
    const hit = walkForSkillFile(child, skillDir, fileName, depth + 1, maxDepth);
    if (hit) return hit;
  }
  return null;
}

// ── Real Registry: every skill_dir resolves to an installed SKILL.md ───────

test('every real registry path resolves to an installed SKILL.md', () => {
  const real = require('../registry/skills-registry.json');
  assert(real.skills.length > 0, 'registry must not be empty');

  const missing = [];
  for (const skill of real.skills) {
    // path is "skills/<skill_dir>/SKILL.md" — extract skill_dir
    const match = skill.path && skill.path.match(/^skills\/([^/]+)\/SKILL\.md$/);
    assert(match, `path "${skill.path}" must be intra-plugin form "skills/<dir>/SKILL.md"`);

    const skillDir = match[1];
    const resolved = resolveSkillFile(skillDir);
    if (!resolved) missing.push({ id: skill.id, skillDir });
  }

  assert(missing.length === 0,
    `${missing.length} skill(s) reference directories not installed in plugins:\n` +
    missing.map(m => `  ${m.id} → skills/${m.skillDir}/SKILL.md`).join('\n'));
});

test('every real registry source matches the id plugin prefix', () => {
  const real = require('../registry/skills-registry.json');
  for (const skill of real.skills) {
    const pluginPart = skill.id.split(':')[0];
    assert(skill.source === pluginPart,
      `skill.id="${skill.id}" plugin part "${pluginPart}" does not match source="${skill.source}"`);
  }
});

test('every conflict reference points to a real registry id or known plugin skill', () => {
  const real = require('../registry/skills-registry.json');
  const registryIds = new Set(real.skills.map(s => s.id));

  for (const skill of real.skills) {
    if (!Array.isArray(skill.conflicts)) continue;
    for (const c of skill.conflicts) {
      // Conflict may be a callable form even if the conflicting skill is not
      // in this registry (e.g. superpowers:test-driven-development lives in
      // a different plugin). Accept either: present in registry, or resolvable
      // via plugin cache.
      if (registryIds.has(c)) continue;
      const conflictSkillDir = c.split(':')[1];
      if (resolveSkillFile(conflictSkillDir)) continue;
      throw new Error(
        `skill "${skill.id}" lists conflict "${c}" which is neither in registry ` +
        `nor resolvable in plugin cache`);
    }
  }
});

// ── Plugin cache must exist for path existence to be meaningful ────────────

test('plugin cache directory exists', () => {
  assert(fs.existsSync(PLUGIN_CACHE),
    `expected plugin cache at ${PLUGIN_CACHE} — path existence tests are meaningless without it`);
});

const code = results();
process.exit(code);
