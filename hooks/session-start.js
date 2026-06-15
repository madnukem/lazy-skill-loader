#!/usr/bin/env node
// session-start.js — SessionStart hook: outputs L1 skill index for context injection.
// Also performs drift detection against the lazy-skills vault (SHA-256 only, no full reads).

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const registryPath = path.join(__dirname, '..', 'registry', 'skills-registry.json');

try {
  const raw = fs.readFileSync(registryPath, 'utf8');
  const registry = JSON.parse(raw);

  if (!registry.skills || !Array.isArray(registry.skills)) {
    console.log('Lazy Skill Loader: registry has no skills array');
    process.exit(0);
  }

  if (registry.skills.length > 500) {
    console.log('Lazy Skill Loader: registry too large (' + registry.skills.length + ' skills, max 500)');
    process.exit(0);
  }

  const lines = ['Lazy Skill Loader: L1 index loaded. ' + registry.skills.length + ' skills available.\n'];
  lines.push('| ID | Description | Methodology |');
  lines.push('|---|---|---|');
  for (const skill of registry.skills) {
    if (!skill || typeof skill !== 'object') continue;
    const id = String(skill.id || '?').substring(0, 40);
    const desc = String(skill.description || '').substring(0, 80);
    const meth = String(skill.methodology || '?').substring(0, 20);
    lines.push(`| ${id} | ${desc} | ${meth} |`);
  }
  lines.push('\nUse the Skill tool to load full instructions for any skill above.');

  // ── Drift detection ──────────────────────────────────────────────────────
  // Compares recorded stub_hash against current file content. SHA-256 only,
  // no full file reads beyond what hashing requires.
  const drift = checkVaultDrift();
  if (drift && drift.length > 0) {
    lines.push('');
    lines.push(`⚠ Lazy Skill Loader: ${drift.length} skill(s) drifted (likely plugin update):`);
    for (const d of drift.slice(0, 10)) {
      lines.push(`  - ${d.stub_id}`);
    }
    if (drift.length > 10) lines.push(`  ... and ${drift.length - 10} more`);
    lines.push('Run: lazy-bootstrap --sync');
  }

  console.log(lines.join('\n'));
} catch (e) {
  console.log('Lazy Skill Loader: could not load registry — ' + e.message);
}

process.exit(0);

// ── Helpers ─────────────────────────────────────────────────────────────────

function checkVaultDrift() {
  try {
    const vaultRoot = path.join(os.homedir(), '.claude', 'lazy-skills');
    const regPath = path.join(vaultRoot, 'vault-registry.json');
    if (!fs.existsSync(regPath)) return null;

    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    if (!reg.entries || !Array.isArray(reg.entries)) return null;
    if (reg.entries.length > 500) return null;

    const { sha256 } = require('../lib/hash');
    const drifted = [];
    for (const entry of reg.entries) {
      try {
        if (!entry.source_path || !entry.stub_hash) continue;
        if (!fs.existsSync(entry.source_path)) {
          drifted.push({ stub_id: entry.stub_id, reason: 'source missing' });
          continue;
        }
        const current = sha256(fs.readFileSync(entry.source_path, 'utf8'));
        if (current !== entry.stub_hash) {
          drifted.push({ stub_id: entry.stub_id });
        }
      } catch {}
    }
    return drifted;
  } catch {
    return null;
  }
}
