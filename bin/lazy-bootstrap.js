#!/usr/bin/env node
// bin/lazy-bootstrap.js — CLI entrypoint for lazy-skill-loader vault operations.
//
// Usage:
//   lazy-bootstrap --apply [opts]     backup + patch all skills (default action)
//   lazy-bootstrap --check            report drift only, no changes
//   lazy-bootstrap --sync             re-apply stubs for drifted entries
//   lazy-bootstrap --restore [glob]   restore originals from vault
//   lazy-bootstrap --list             show all vault entries

'use strict';

const fs = require('fs');
const path = require('path');

const vault = require('../lib/vault');

function parseArgs(argv) {
  const out = { action: null, filter: null, includeCustom: true, includePlugins: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.action = 'apply';
    else if (a === '--check') out.action = 'check';
    else if (a === '--sync') out.action = 'sync';
    else if (a === '--restore') out.action = 'restore';
    else if (a === '--list') out.action = 'list';
    else if (a === '--force') out.force = true;
    else if (a === '--no-custom') out.includeCustom = false;
    else if (a === '--no-plugins') out.includePlugins = false;
    else if (a === '--help' || a === '-h') out.action = 'help';
    else if (!a.startsWith('--')) out.filter = a;
  }
  if (!out.action) out.action = 'apply';
  return out;
}

function usage() {
  return [
    'lazy-bootstrap — manage lazy-skills vault',
    '',
    'Usage:',
    '  lazy-bootstrap --apply [--no-custom] [--no-plugins]',
    '      Backup + patch all SKILL.md files (default).',
    '  lazy-bootstrap --check',
    '      Report drift only; no filesystem changes.',
    '  lazy-bootstrap --sync [--force]',
    '      Re-apply stubs to drifted entries. --force re-applies all.',
    '  lazy-bootstrap --restore [glob]',
    '      Restore originals from vault. Optional glob filters by stub_id.',
    '  lazy-bootstrap --list',
    '      Show all vault entries.',
    '',
    'Examples:',
    '  lazy-bootstrap --apply',
    '  lazy-bootstrap --check',
    '  lazy-bootstrap --restore "agent-skills:*"',
    '  lazy-bootstrap --list | head',
  ].join('\n');
}

function fmtSummary(s) {
  const parts = [];
  if ('applied' in s) parts.push(`applied=${s.applied}`);
  if ('skipped' in s) parts.push(`skipped=${s.skipped}`);
  if ('synced' in s) parts.push(`synced=${s.synced}`);
  if ('restored' in s) parts.push(`restored=${s.restored}`);
  if ('drifted' in s) parts.push(`drifted=${s.drifted}`);
  if (s.errors && s.errors.length) parts.push(`errors=${s.errors.length}`);
  return parts.join(' ');
}

function printErrors(errors) {
  if (!errors || !errors.length) return;
  console.error('Errors:');
  for (const e of errors) {
    console.error(`  ${e.stub_id || '?'}: ${e.reason}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.action === 'help') {
    console.log(usage());
    process.exit(0);
  }

  const vaultRoot = vault.defaultVaultRoot();

  if (args.action === 'list') {
    const reg = vault.loadRegistry(vaultRoot);
    if (!reg.entries.length) {
      console.log('(vault empty)');
      process.exit(0);
    }
    console.log(`Vault: ${vault.toDisplayPath(vaultRoot)}`);
    console.log(`Entries: ${reg.entries.length}\n`);
    for (const e of reg.entries) {
      const tag = e.source === 'plugin' ? `[${e.plugin}@${e.version}]` : '[custom]';
      console.log(`  ${e.stub_id.padEnd(50)} ${tag}`);
    }
    process.exit(0);
  }

  if (args.action === 'check') {
    const drifted = vault.checkDrift({ vaultRoot });
    if (!drifted.length) {
      console.log('No drift detected.');
      process.exit(0);
    }
    console.log(`Drifted entries: ${drifted.length}`);
    for (const d of drifted) {
      console.log(`  ${d.stub_id}: ${d.reason}`);
    }
    console.log('\nRun: lazy-bootstrap --sync');
    process.exit(1);
  }

  if (args.action === 'restore') {
    const summary = vault.restore({ vaultRoot, filter: args.filter });
    console.log(`Restore complete: ${fmtSummary(summary)}`);
    printErrors(summary.errors);
    process.exit(summary.errors.length ? 1 : 0);
  }

  if (args.action === 'sync') {
    const summary = vault.sync({ vaultRoot, force: args.force === true });
    console.log(`Sync complete: ${fmtSummary(summary)}`);
    printErrors(summary.errors);
    process.exit(summary.errors.length ? 1 : 0);
  }

  // Default: apply
  const summary = vault.bootstrap({
    vaultRoot,
    skillsDir: vault.defaultSkillsDir(),
    pluginsDir: vault.defaultPluginsDir(),
    includeCustom: args.includeCustom,
    includePlugins: args.includePlugins,
  });
  console.log(`Bootstrap complete: ${fmtSummary(summary)}`);
  printErrors(summary.errors);
  process.exit(summary.errors.length ? 1 : 0);
}

try {
  main();
} catch (err) {
  console.error(`Fatal: ${err.message}`);
  console.error(err.stack);
  process.exit(2);
}
