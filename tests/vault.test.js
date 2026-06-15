// tests/vault.test.js — Integration tests for vault bootstrap/restore/sync.
// All tests operate in an isolated temp dir to avoid touching ~/.claude.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { createTestRunner } = require('./helpers');
const { test, assert, results } = createTestRunner();
const vault = require('../lib/vault');
const { sha256 } = require('../lib/hash');
const { parse } = require('../lib/frontmatter');

// ── Test scaffolding ────────────────────────────────────────────────────────

function setupFakeHome() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lsl-vault-'));
  const home = path.join(tmp, 'home');
  const claudeDir = path.join(home, '.claude');
  fs.mkdirSync(path.join(claudeDir, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(claudeDir, 'plugins', 'cache'), { recursive: true });
  process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true }); } catch {} });
  return { tmp, home, claudeDir };
}

function writeSkill(parentDir, name, description, body) {
  const dir = path.join(parentDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const content = `---
name: ${name}
description: ${description}
---
${body || '# ' + name}`;
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
  return path.join(dir, 'SKILL.md');
}

function writePluginSkill(cacheDir, owner, plugin, version, skillDir, description) {
  const dir = path.join(cacheDir, owner, plugin, version, 'skills', skillDir);
  fs.mkdirSync(dir, { recursive: true });
  const content = `---
name: ${skillDir}
description: ${description}
---
# ${skillDir}`;
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
  return path.join(dir, 'SKILL.md');
}

// ── Tests ──────────────────────────────────────────────────────────────────

test('bootstrap_custom_skill_creates_backup_and_stub', () => {
  const { home } = setupFakeHome();
  const skillsDir = path.join(home, '.claude', 'skills');
  const vaultRoot = path.join(home, '.claude', 'lazy-skills');
  const originalDesc = 'A very long description that should be preserved in the vault backup but shortened in the stub for token efficiency';
  writeSkill(skillsDir, 'audit-pattern', originalDesc, '# Real audit content');

  const summary = vault.bootstrap({ vaultRoot, skillsDir, pluginsDir: path.join(home, '.claude', 'plugins', 'cache'), includePlugins: false });

  assert(summary.applied === 1, `expected 1 applied, got ${summary.applied}`);
  assert(summary.errors.length === 0, `errors: ${JSON.stringify(summary.errors)}`);

  // Backup exists
  const backupPath = path.join(vaultRoot, 'backups', 'custom', 'audit-pattern', 'SKILL.md');
  assert(fs.existsSync(backupPath), 'backup file missing');
  const backupContent = fs.readFileSync(backupPath, 'utf8');
  assert(backupContent.includes(originalDesc), 'backup should contain full original description');

  // Stub written to original location
  const stubPath = path.join(skillsDir, 'audit-pattern', 'SKILL.md');
  const stubContent = fs.readFileSync(stubPath, 'utf8');
  assert(stubContent.includes('[lazy]'), `stub missing [lazy] marker: ${stubContent.slice(0, 200)}`);
  assert(!stubContent.includes(originalDesc), 'stub should NOT contain full description');
});

test('bootstrap_plugin_skill_keeps_original_name', () => {
  const { home } = setupFakeHome();
  const pluginsCache = path.join(home, '.claude', 'plugins', 'cache');
  writePluginSkill(pluginsCache, 'addy-agent-skills', 'agent-skills', '1.0.0',
                   'test-driven-development', 'TDD red-green-refactor');
  const vaultRoot = path.join(home, '.claude', 'lazy-skills');
  const skillsDir = path.join(home, '.claude', 'skills');

  const summary = vault.bootstrap({
    vaultRoot, skillsDir, pluginsDir: pluginsCache,
    includeCustom: false, includePlugins: true,
  });

  assert(summary.applied === 1, `expected 1 applied, got ${summary.applied}`);
  assert(summary.errors.length === 0, `errors: ${JSON.stringify(summary.errors)}`);

  // Stub name in frontmatter == original skill_dir
  const stubPath = path.join(pluginsCache, 'addy-agent-skills', 'agent-skills', '1.0.0',
                              'skills', 'test-driven-development', 'SKILL.md');
  const { frontmatter } = parse(fs.readFileSync(stubPath, 'utf8'));
  assert(frontmatter.name === 'test-driven-development',
    `name should be unchanged, got: ${frontmatter.name}`);
});

test('bootstrap_idempotent_second_run_noop', () => {
  const { home } = setupFakeHome();
  const skillsDir = path.join(home, '.claude', 'skills');
  const vaultRoot = path.join(home, '.claude', 'lazy-skills');
  const pluginsCache = path.join(home, '.claude', 'plugins', 'cache');
  writeSkill(skillsDir, 'foo', 'foo desc');

  vault.bootstrap({ vaultRoot, skillsDir, pluginsDir: pluginsCache, includePlugins: false });
  const stubBefore = fs.readFileSync(path.join(skillsDir, 'foo', 'SKILL.md'), 'utf8');

  const summary2 = vault.bootstrap({ vaultRoot, skillsDir, pluginsDir: pluginsCache, includePlugins: false });
  const stubAfter = fs.readFileSync(path.join(skillsDir, 'foo', 'SKILL.md'), 'utf8');

  assert(summary2.applied === 0, `second run should apply 0, got ${summary2.applied}`);
  assert(summary2.skipped === 1, `second run should skip 1, got ${summary2.skipped}`);
  assert(stubBefore === stubAfter, 'stub content should be byte-identical on second run');
});

test('bootstrap_detects_drift_after_overwrite', () => {
  const { home } = setupFakeHome();
  const skillsDir = path.join(home, '.claude', 'skills');
  const vaultRoot = path.join(home, '.claude', 'lazy-skills');
  const pluginsCache = path.join(home, '.claude', 'plugins', 'cache');
  writeSkill(skillsDir, 'foo', 'foo desc');

  vault.bootstrap({ vaultRoot, skillsDir, pluginsDir: pluginsCache, includePlugins: false });

  // Simulate plugin update: overwrite stub with new content
  fs.writeFileSync(path.join(skillsDir, 'foo', 'SKILL.md'),
    '---\nname: foo\ndescription: updated by plugin\n---\n# Updated');

  const drifted = vault.checkDrift({ vaultRoot });
  assert(drifted.length === 1, `expected 1 drift, got ${drifted.length}`);
  assert(drifted[0].stub_id === 'foo', `drift id: ${drifted[0].stub_id}`);
});

test('sync_reapplies_stub_after_drift', () => {
  const { home } = setupFakeHome();
  const skillsDir = path.join(home, '.claude', 'skills');
  const vaultRoot = path.join(home, '.claude', 'lazy-skills');
  const pluginsCache = path.join(home, '.claude', 'plugins', 'cache');
  writeSkill(skillsDir, 'foo', 'original desc');

  vault.bootstrap({ vaultRoot, skillsDir, pluginsDir: pluginsCache, includePlugins: false });

  // Overwrite stub
  const stubPath = path.join(skillsDir, 'foo', 'SKILL.md');
  fs.writeFileSync(stubPath, '---\nname: foo\ndescription: new from plugin update\n---\n# New');

  const summary = vault.sync({ vaultRoot });
  assert(summary.synced === 1, `expected 1 synced, got ${summary.synced}`);

  const after = fs.readFileSync(stubPath, 'utf8');
  assert(after.includes('[lazy]'), 'stub should be re-applied with [lazy] marker');

  // Drift should now be clean
  const drifted = vault.checkDrift({ vaultRoot });
  assert(drifted.length === 0, `expected 0 drift after sync, got ${drifted.length}`);
});

test('restore_full_overwrites_stubs_byte_exact', () => {
  const { home } = setupFakeHome();
  const skillsDir = path.join(home, '.claude', 'skills');
  const vaultRoot = path.join(home, '.claude', 'lazy-skills');
  const pluginsCache = path.join(home, '.claude', 'plugins', 'cache');
  const origContent = '---\nname: foo\ndescription: original\n---\n# Original body';
  fs.mkdirSync(path.join(skillsDir, 'foo'), { recursive: true });
  fs.writeFileSync(path.join(skillsDir, 'foo', 'SKILL.md'), origContent);

  vault.bootstrap({ vaultRoot, skillsDir, pluginsDir: pluginsCache, includePlugins: false });
  const summary = vault.restore({ vaultRoot });
  assert(summary.restored === 1, `expected 1 restored, got ${summary.restored}`);

  const restored = fs.readFileSync(path.join(skillsDir, 'foo', 'SKILL.md'), 'utf8');
  assert(restored === origContent, 'restored content should be byte-exact with original');
});

test('restore_partial_glob_filters_entries', () => {
  const { home } = setupFakeHome();
  const skillsDir = path.join(home, '.claude', 'skills');
  const vaultRoot = path.join(home, '.claude', 'lazy-skills');
  const pluginsCache = path.join(home, '.claude', 'plugins', 'cache');
  writeSkill(skillsDir, 'foo', 'foo');
  writeSkill(skillsDir, 'bar', 'bar');

  vault.bootstrap({ vaultRoot, skillsDir, pluginsDir: pluginsCache, includePlugins: false });
  const summary = vault.restore({ vaultRoot, filter: 'foo' });
  assert(summary.restored === 1, `expected 1 restored, got ${summary.restored}`);

  // foo restored to original, bar still a stub
  const fooContent = fs.readFileSync(path.join(skillsDir, 'foo', 'SKILL.md'), 'utf8');
  const barContent = fs.readFileSync(path.join(skillsDir, 'bar', 'SKILL.md'), 'utf8');
  assert(fooContent.includes('description: foo') && !fooContent.includes('[lazy]'),
    'foo should be restored to original');
  assert(barContent.includes('[lazy]'), 'bar should still be a stub');
});

test('lazy_skill_loader_self_never_stubbed', () => {
  const { home } = setupFakeHome();
  const skillsDir = path.join(home, '.claude', 'skills');
  const vaultRoot = path.join(home, '.claude', 'lazy-skills');
  const pluginsCache = path.join(home, '.claude', 'plugins', 'cache');
  writeSkill(skillsDir, 'lazy-skill-loader', 'self skill — should not be patched');
  writeSkill(skillsDir, 'other', 'other skill');

  vault.bootstrap({ vaultRoot, skillsDir, pluginsDir: pluginsCache, includePlugins: false });

  const selfContent = fs.readFileSync(path.join(skillsDir, 'lazy-skill-loader', 'SKILL.md'), 'utf8');
  const otherContent = fs.readFileSync(path.join(skillsDir, 'other', 'SKILL.md'), 'utf8');
  assert(!selfContent.includes('[lazy]'), 'self should NOT be stubbed');
  assert(otherContent.includes('[lazy]'), 'other should be stubbed');
});

test('duplicate_bare_names_no_collision_for_plugin_skills', () => {
  const { home } = setupFakeHome();
  const pluginsCache = path.join(home, '.claude', 'plugins', 'cache');
  const skillsDir = path.join(home, '.claude', 'skills');
  const vaultRoot = path.join(home, '.claude', 'lazy-skills');

  // Two plugins both have "test-driven-development"
  writePluginSkill(pluginsCache, 'addy', 'agent-skills', '1.0.0', 'test-driven-development', 'agent-skills TDD');
  writePluginSkill(pluginsCache, 'official', 'superpowers', '5.0.0', 'test-driven-development', 'superpowers TDD');

  const summary = vault.bootstrap({
    vaultRoot, skillsDir, pluginsDir: pluginsCache,
    includeCustom: false, includePlugins: true,
  });

  assert(summary.applied === 2, `expected 2 applied, got ${summary.applied}`);
  assert(summary.errors.length === 0, `errors: ${JSON.stringify(summary.errors)}`);

  const reg = vault.loadRegistry(vaultRoot);
  const ids = reg.entries.map(e => e.stub_id);
  assert(ids.includes('agent-skills:test-driven-development'), `missing agent-skills TDD: ${ids}`);
  assert(ids.includes('superpowers:test-driven-development'), `missing superpowers TDD: ${ids}`);
});

test('bootstrap_handles_version_dir_change', () => {
  const { home } = setupFakeHome();
  const pluginsCache = path.join(home, '.claude', 'plugins', 'cache');
  const skillsDir = path.join(home, '.claude', 'skills');
  const vaultRoot = path.join(home, '.claude', 'lazy-skills');

  writePluginSkill(pluginsCache, 'owner', 'plugin', '1.0.0', 'foo', 'foo 1.0.0');
  vault.bootstrap({
    vaultRoot, skillsDir, pluginsDir: pluginsCache,
    includeCustom: false, includePlugins: true,
  });

  // Plugin updates to 1.1.0
  writePluginSkill(pluginsCache, 'owner', 'plugin', '1.1.0', 'foo', 'foo 1.1.0');
  const summary2 = vault.bootstrap({
    vaultRoot, skillsDir, pluginsDir: pluginsCache,
    includeCustom: false, includePlugins: true,
  });

  assert(summary2.applied === 1, `expected 1 new applied (v1.1.0), got ${summary2.applied}`);

  const reg = vault.loadRegistry(vaultRoot);
  const versions = reg.entries
    .filter(e => e.plugin === 'plugin')
    .map(e => e.version);
  assert(versions.includes('1.0.0'), 'should keep 1.0.0 entry');
  assert(versions.includes('1.1.0'), 'should have 1.1.0 entry');
});

test('matchGlob supports star wildcard', () => {
  assert(vault.matchGlob('agent-skills:foo', 'agent-skills:*'), 'should match');
  assert(vault.matchGlob('superpowers:foo', 'agent-skills:*') === false, 'should not match');
  assert(vault.matchGlob('anything', null) === true, 'null filter matches all');
  assert(vault.matchGlob('audit-pattern', 'audit-*'), 'prefix glob should match');
});

test('registry contains required schema fields', () => {
  const { home } = setupFakeHome();
  const skillsDir = path.join(home, '.claude', 'skills');
  const vaultRoot = path.join(home, '.claude', 'lazy-skills');
  const pluginsCache = path.join(home, '.claude', 'plugins', 'cache');
  writeSkill(skillsDir, 'foo', 'desc here');

  vault.bootstrap({ vaultRoot, skillsDir, pluginsDir: pluginsCache, includePlugins: false });
  const reg = vault.loadRegistry(vaultRoot);

  assert(typeof reg.version === 'number', 'version must be number');
  assert(Array.isArray(reg.entries), 'entries must be array');
  assert(reg.generated_at, 'generated_at must be present');
  const e = reg.entries[0];
  assert(e.stub_id && e.original_name && e.source && e.source_path && e.vault_path,
    'entry missing required fields');
  assert(e.original_hash && e.stub_hash, 'entry missing hashes');
  assert(e.original_hash.startsWith('sha256:'), 'hash format wrong');
});

const code = results();
process.exit(code);
