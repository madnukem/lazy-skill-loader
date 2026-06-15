// lib/vault.js — Bootstrap/restore/sync engine for the lazy-skills vault.
//
// Vault = directory holding backups of original SKILL.md files plus a
// registry describing what has been patched. Bootstrap replaces originals
// with compact stubs (saving ~80% of context tokens); restore puts them back.
//
// All operations are idempotent: running bootstrap twice is a no-op.
// Drift detection: if a stub is overwritten (e.g. by `git pull` in a plugin
// marketplace), checkDrift reports it and `sync` re-applies the stub.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { sha256 } = require('./hash');
const { parse } = require('./frontmatter');
const { renderStub, isStub } = require('./stub-generator');

const REGISTRY_VERSION = 1;
const SELF_NAME = 'lazy-skill-loader';

function tildeHome() {
  return os.homedir().replace(/\\/g, '/');
}

function toDisplayPath(absolutePath) {
  const home = tildeHome();
  if (absolutePath.startsWith(home)) return '~' + absolutePath.slice(home.length);
  return absolutePath;
}

function defaultSkillsDir() {
  return path.join(os.homedir(), '.claude', 'skills');
}

function defaultPluginsDir() {
  return path.join(os.homedir(), '.claude', 'plugins', 'cache');
}

function defaultVaultRoot() {
  return path.join(os.homedir(), '.claude', 'lazy-skills');
}

// ── Scan ────────────────────────────────────────────────────────────────────

function scanCustomSkills(skillsDir) {
  const out = [];
  if (!fs.existsSync(skillsDir)) return out;
  for (const name of fs.readdirSync(skillsDir)) {
    if (name === SELF_NAME) continue;
    const dir = path.join(skillsDir, name);
    let stat;
    try { stat = fs.statSync(dir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const md = path.join(dir, 'SKILL.md');
    if (fs.existsSync(md)) out.push(md);
  }
  return out;
}

/**
 * Find all SKILL.md under plugins/cache/<owner>/<plugin>/<version>/skills/<dir>/.
 * Optional pluginFilter restricts to a single plugin name.
 */
function scanPluginSkills(pluginsDir, pluginFilter) {
  const out = [];
  if (!fs.existsSync(pluginsDir)) return out;
  for (const owner of fs.readdirSync(pluginsDir)) {
    const ownerDir = path.join(pluginsDir, owner);
    let ownerStat;
    try { ownerStat = fs.statSync(ownerDir); } catch { continue; }
    if (!ownerStat.isDirectory()) continue;
    for (const plugin of fs.readdirSync(ownerDir)) {
      if (pluginFilter && plugin !== pluginFilter) continue;
      const pluginDir = path.join(ownerDir, plugin);
      let pluginStat;
      try { pluginStat = fs.statSync(pluginDir); } catch { continue; }
      if (!pluginStat.isDirectory()) continue;
      for (const version of fs.readdirSync(pluginDir)) {
        const versionDir = path.join(pluginDir, version);
        let versionStat;
        try { versionStat = fs.statSync(versionDir); } catch { continue; }
        if (!versionStat.isDirectory()) continue;
        const skillsDir = path.join(versionDir, 'skills');
        if (!fs.existsSync(skillsDir)) continue;
        for (const skillDir of fs.readdirSync(skillsDir)) {
          const md = path.join(skillsDir, skillDir, 'SKILL.md');
          if (fs.existsSync(md)) out.push(md);
        }
      }
    }
  }
  return out;
}

// ── Entry helpers ──────────────────────────────────────────────────────────

function entryFromCustomPath(skillMdPath, skillsDir) {
  const skillDir = path.basename(path.dirname(skillMdPath));
  return {
    source: 'custom',
    stub_id: skillDir,
    original_name: skillDir,
    source_path: skillMdPath,
    skills_base: skillsDir,
  };
}

function entryFromPluginPath(skillMdPath) {
  // path: .../cache/<owner>/<plugin>/<version>/skills/<skillDir>/SKILL.md
  const parts = skillMdPath.replace(/\\/g, '/').split('/');
  const skillsIdx = parts.lastIndexOf('skills');
  if (skillsIdx < 0 || parts.length < skillsIdx + 3) return null;
  const skillDir = parts[skillsIdx + 1];
  const version = parts[skillsIdx - 1];
  const plugin = parts[skillsIdx - 2];
  return {
    source: 'plugin',
    stub_id: `${plugin}:${skillDir}`,
    original_name: skillDir,
    source_path: skillMdPath,
    plugin,
    version,
    skill_dir: skillDir,
  };
}

function vaultPathFor(entry, vaultRoot) {
  if (entry.source === 'custom') {
    return path.join(vaultRoot, 'backups', 'custom', entry.original_name, 'SKILL.md');
  }
  // plugin
  return path.join(vaultRoot, 'backups', 'plugins', entry.plugin, entry.version,
                   entry.skill_dir, 'SKILL.md');
}

// ── Registry I/O ───────────────────────────────────────────────────────────

function registryPath(vaultRoot) {
  return path.join(vaultRoot, 'vault-registry.json');
}

function loadRegistry(vaultRoot) {
  try {
    const raw = fs.readFileSync(registryPath(vaultRoot), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.entries || !Array.isArray(parsed.entries)) {
      return { version: REGISTRY_VERSION, vault_root: vaultRoot, entries: [] };
    }
    return parsed;
  } catch {
    return { version: REGISTRY_VERSION, vault_root: vaultRoot, entries: [] };
  }
}

function saveRegistry(vaultRoot, registry) {
  if (!fs.existsSync(vaultRoot)) fs.mkdirSync(vaultRoot, { recursive: true });
  const out = {
    version: REGISTRY_VERSION,
    generated_at: new Date().toISOString(),
    vault_root: toDisplayPath(vaultRoot),
    entries: registry.entries,
  };
  fs.writeFileSync(registryPath(vaultRoot), JSON.stringify(out, null, 2));
}

function indexByStubId(entries) {
  const m = new Map();
  for (const e of entries) m.set(e.stub_id, e);
  return m;
}

function indexBySourcePath(entries) {
  const m = new Map();
  for (const e of entries) m.set(e.source_path, e);
  return m;
}

// ── Core: bootstrap ────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.vaultRoot     absolute path to ~/.claude/lazy-skills
 * @param {string} [opts.skillsDir]   default ~/.claude/skills
 * @param {string} [opts.pluginsDir]  default ~/.claude/plugins/cache
 * @param {boolean} [opts.includeCustom=true]
 * @param {boolean} [opts.includePlugins=true]
 * @returns {object} summary { applied, skipped, drifted, errors }
 */
function bootstrap(opts) {
  const vaultRoot = opts.vaultRoot || defaultVaultRoot();
  const skillsDir = opts.skillsDir || defaultSkillsDir();
  const pluginsDir = opts.pluginsDir || defaultPluginsDir();
  const includeCustom = opts.includeCustom !== false;
  const includePlugins = opts.includePlugins !== false;
  const pluginFilter = opts.pluginFilter || null;

  if (!fs.existsSync(vaultRoot)) fs.mkdirSync(vaultRoot, { recursive: true });
  fs.mkdirSync(path.join(vaultRoot, 'backups', 'custom'), { recursive: true });
  fs.mkdirSync(path.join(vaultRoot, 'backups', 'plugins'), { recursive: true });

  const registry = loadRegistry(vaultRoot);
  const byPath = indexBySourcePath(registry.entries);

  const candidates = [];
  if (includeCustom) {
    for (const p of scanCustomSkills(skillsDir)) {
      candidates.push(entryFromCustomPath(p, skillsDir));
    }
  }
  if (includePlugins) {
    for (const p of scanPluginSkills(pluginsDir, pluginFilter)) {
      const e = entryFromPluginPath(p);
      if (e) candidates.push(e);
    }
  }

  const summary = { applied: 0, skipped: 0, drifted: 0, errors: [], newEntries: [] };

  for (const cand of candidates) {
    try {
      const normalizedPath = cand.source_path.replace(/\\/g, '/');
      const sourceContent = fs.readFileSync(cand.source_path, 'utf8');
      const currentHash = sha256(sourceContent);
      const prev = byPath.get(normalizedPath);

      // Idempotency: already stubbed by us and original hash unchanged
      if (prev && prev.stub_hash === currentHash) {
        summary.skipped++;
        continue;
      }

      // Skip if the file is already a stub but we have no record — means
      // someone else patched it or our registry was wiped. Treat as drifted.
      if (isStub(sourceContent) && !prev) {
        summary.errors.push({
          stub_id: cand.stub_id,
          reason: 'file is already a stub but not in registry — restore manually or remove',
        });
        continue;
      }

      const fm = parse(sourceContent).frontmatter;
      if (!fm || !fm.name) {
        summary.errors.push({
          stub_id: cand.stub_id,
          reason: 'no frontmatter or name field — skipping',
        });
        continue;
      }

      // Capture ORIGINAL content for backup. If prev exists and current
      // content differs from both recorded original and recorded stub,
      // the original moved — treat current as new original.
      const originalContent = sourceContent;
      const originalHash = currentHash;

      // Write backup
      const vaultPath = vaultPathFor(cand, vaultRoot);
      fs.mkdirSync(path.dirname(vaultPath), { recursive: true });
      fs.writeFileSync(vaultPath, originalContent);

      // Render + write stub
      const iso = new Date().toISOString();
      const stubContent = renderStub({
        name: fm.name,
        description: fm.description || '',
        vaultPath,
        bootstrappedAt: iso,
      });
      fs.writeFileSync(cand.source_path, stubContent);

      const entry = {
        stub_id: cand.stub_id,
        original_name: fm.name,
        source: cand.source,
        source_path: normalizedPath,
        vault_path: vaultPath.replace(/\\/g, '/'),
        original_hash: originalHash,
        stub_hash: sha256(stubContent),
        description_hint: String(fm.description || '').slice(0, 80),
        bootstrapped_at: iso,
      };
      if (cand.source === 'plugin') {
        entry.plugin = cand.plugin;
        entry.version = cand.version;
        entry.skill_dir = cand.skill_dir;
      }

      // Replace by source_path (allows multiple versions of same plugin skill)
      const idx = registry.entries.findIndex(e => e.source_path === normalizedPath);
      if (idx >= 0) {
        registry.entries[idx] = entry;
        summary.drifted++;
      } else {
        registry.entries.push(entry);
        summary.newEntries.push(entry);
      }
      summary.applied++;
    } catch (err) {
      summary.errors.push({ stub_id: cand.stub_id, reason: err.message });
    }
  }

  saveRegistry(vaultRoot, registry);
  return summary;
}

// ── Core: restore ──────────────────────────────────────────────────────────

/**
 * Restore original SKILL.md from vault backups. Optionally filter by glob.
 *
 * @param {object} opts
 * @param {string} opts.vaultRoot
 * @param {string} [opts.filter]   glob pattern for stub_id (e.g. "agent-skills-*")
 * @param {boolean} [opts.keepRegistry]  if true, don't remove restored entries from registry
 * @returns {object} { restored, skipped, errors }
 */
function restore(opts) {
  const vaultRoot = opts.vaultRoot || defaultVaultRoot();
  const filter = opts.filter || null;
  const keepRegistry = opts.keepRegistry === true;

  const registry = loadRegistry(vaultRoot);
  const summary = { restored: 0, skipped: 0, errors: [] };
  const remaining = [];

  for (const entry of registry.entries) {
    if (filter && !matchGlob(entry.stub_id, filter)) {
      remaining.push(entry);
      continue;
    }
    try {
      if (!fs.existsSync(entry.vault_path)) {
        summary.errors.push({
          stub_id: entry.stub_id,
          reason: `backup missing at ${entry.vault_path}`,
        });
        remaining.push(entry);
        continue;
      }
      const backup = fs.readFileSync(entry.vault_path, 'utf8');
      fs.writeFileSync(entry.source_path, backup);
      summary.restored++;
    } catch (err) {
      summary.errors.push({ stub_id: entry.stub_id, reason: err.message });
      remaining.push(entry);
    }
  }

  if (!keepRegistry) {
    if (remaining.length === 0) {
      // All restored — wipe registry
      saveRegistry(vaultRoot, { version: REGISTRY_VERSION, vault_root: vaultRoot, entries: [] });
    } else {
      saveRegistry(vaultRoot, { ...registry, entries: remaining });
    }
  }

  return summary;
}

// ── Drift detection ────────────────────────────────────────────────────────

/**
 * Walk every entry in the registry and compare stub_hash against the current
 * content of source_path. Returns list of drifted entries.
 */
function checkDrift(opts) {
  const vaultRoot = opts.vaultRoot || defaultVaultRoot();
  const registry = loadRegistry(vaultRoot);
  const drifted = [];

  for (const entry of registry.entries) {
    try {
      if (!fs.existsSync(entry.source_path)) {
        drifted.push({ stub_id: entry.stub_id, reason: 'source_path missing' });
        continue;
      }
      const currentHash = sha256(fs.readFileSync(entry.source_path, 'utf8'));
      if (currentHash !== entry.stub_hash) {
        drifted.push({
          stub_id: entry.stub_id,
          reason: 'content differs from recorded stub',
          current_hash: currentHash,
          expected_hash: entry.stub_hash,
        });
      }
    } catch (err) {
      drifted.push({ stub_id: entry.stub_id, reason: err.message });
    }
  }

  return drifted;
}

/**
 * Re-apply stubs only for drifted entries (or all if force=true).
 * Used after plugin updates overwrite our stubs.
 */
function sync(opts) {
  const vaultRoot = opts.vaultRoot || defaultVaultRoot();
  const force = opts.force === true;
  const drifted = force ? null : checkDrift({ vaultRoot });
  const registry = loadRegistry(vaultRoot);
  const byId = indexByStubId(registry.entries);

  const targets = force ? registry.entries : drifted;
  const summary = { synced: 0, skipped: 0, errors: [] };

  for (const d of targets) {
    const entry = byId.get(d.stub_id);
    if (!entry) {
      summary.errors.push({ stub_id: d.stub_id, reason: 'not in registry' });
      continue;
    }
    try {
      if (!fs.existsSync(entry.source_path)) {
        summary.errors.push({ stub_id: d.stub_id, reason: 'source_path missing' });
        continue;
      }
      const iso = new Date().toISOString();
      const stubContent = renderStub({
        name: entry.original_name,
        description: entry.description_hint || '',
        vaultPath: entry.vault_path,
        bootstrappedAt: iso,
      });
      fs.writeFileSync(entry.source_path, stubContent);
      entry.stub_hash = sha256(stubContent);
      entry.bootstrapped_at = iso;
      summary.synced++;
    } catch (err) {
      summary.errors.push({ stub_id: d.stub_id, reason: err.message });
    }
  }

  saveRegistry(vaultRoot, registry);
  return summary;
}

// ── Glob helper (minimal — supports * wildcards only) ─────────────────────

function matchGlob(str, pattern) {
  if (!pattern) return true;
  // Convert glob to regex: escape special chars except *, then replace * with .*
  const re = new RegExp('^' +
    pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(str);
}

// ── Self-skip safety ───────────────────────────────────────────────────────

function selfProtected() {
  return [SELF_NAME];
}

module.exports = {
  // paths
  defaultVaultRoot, defaultSkillsDir, defaultPluginsDir,
  toDisplayPath,
  // scan
  scanCustomSkills, scanPluginSkills,
  // registry
  loadRegistry, saveRegistry, registryPath,
  // core ops
  bootstrap, restore, checkDrift, sync,
  // helpers
  matchGlob, selfProtected,
  // constants
  REGISTRY_VERSION, SELF_NAME,
};
