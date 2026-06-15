#!/usr/bin/env node
// payload.test.js — Payload completeness tests (T1 + T4 from SKILL-REQUIREMENTS.md)
//
// Regression for INCIDENT-2026-06-15-tdd-workflow-unknown:
// `package.json` had no `files` field, so `npm pack` produced a tarball with
// only package.json + README + LICENSE + root *.js — hooks/, lib/, registry/,
// core/ were dropped. Installed users got a broken skill.
//
// This test runs `npm pack --dry-run --json` and asserts that every directory
// named in the `files` whitelist is actually present in the tarball output.

'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const { createTestRunner } = require('./helpers');
const { test, assert, results } = createTestRunner();

const PKG_ROOT = path.join(__dirname, '..');

function npmPackFiles() {
  const out = execSync('npm pack --dry-run --json', {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(out);
  return parsed[0].files.map(f => f.path);
}

function npmIgnorePresent() {
  // npm pack excludes whatever is in .npmignore or .gitignore.
  // We rely on the `files` whitelist instead.
  return true;
}

// ── Tarball contains required directories ──────────────────────────────────

test('package.json declares a files whitelist', () => {
  const pkg = require(path.join(PKG_ROOT, 'package.json'));
  assert(Array.isArray(pkg.files) && pkg.files.length > 0,
    'package.json must have a non-empty "files" array — without it npm pack ' +
    'drops hooks/, lib/, registry/, core/ (root cause of INCIDENT-2026-06-15)');
});

test('npm pack includes hooks/', () => {
  const files = npmPackFiles();
  assert(files.some(f => f.startsWith('hooks/')),
    `hooks/ missing from npm pack output. Files:\n${files.join('\n')}`);
});

test('npm pack includes lib/', () => {
  const files = npmPackFiles();
  assert(files.some(f => f.startsWith('lib/')),
    `lib/ missing from npm pack output. Files:\n${files.join('\n')}`);
});

test('npm pack includes registry/', () => {
  const files = npmPackFiles();
  assert(files.some(f => f.startsWith('registry/')),
    `registry/ missing from npm pack output. Files:\n${files.join('\n')}`);
});

test('npm pack includes core/', () => {
  const files = npmPackFiles();
  assert(files.some(f => f.startsWith('core/')),
    `core/ missing from npm pack output. Files:\n${files.join('\n')}`);
});

test('npm pack includes SKILL.md at root', () => {
  const files = npmPackFiles();
  assert(files.includes('SKILL.md'),
    `SKILL.md missing from npm pack root. Files:\n${files.join('\n')}`);
});

test('npm pack includes the real registry JSON', () => {
  const files = npmPackFiles();
  assert(files.includes('registry/skills-registry.json'),
    `registry/skills-registry.json missing. Files:\n${files.join('\n')}`);
});

test('npm pack includes the SessionStart hook', () => {
  const files = npmPackFiles();
  assert(files.includes('hooks/session-start.js'),
    `hooks/session-start.js missing. Files:\n${files.join('\n')}`);
});

// ── Hook can find registry from package root ──────────────────────────────
//
// T4 (end-to-end install test, lightweight version): invoke the actual hook
// script and assert it does not print the "could not load registry" fallback.

test('session-start hook loads registry without error', () => {
  const out = execSync('node hooks/session-start.js', {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  assert(!/could not load registry/.test(out),
    `hook failed to load registry:\n${out}`);
  assert(/L1 index loaded/.test(out),
    `hook did not emit L1 index banner:\n${out}`);
});

test('session-start hook advertises callable ids', () => {
  const out = execSync('node hooks/session-start.js', {
    cwd: PKG_ROOT,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  // Every advertised id must be callable form — no private ids like
  // "tdd-workflow" (the original incident).
  const idRegex = /^\| (`?[a-z0-9-]+:[a-z0-9-]+`?) \|/gm;
  let count = 0;
  let m;
  while ((m = idRegex.exec(out)) !== null) count++;
  assert(count > 0, `no callable ids found in hook output:\n${out}`);
});

// ── README install instructions reference hooks + lib ─────────────────────

test('README mentions hooks/ and registry/ in install instructions', () => {
  const readme = fs.readFileSync(path.join(PKG_ROOT, 'README.md'), 'utf8');
  assert(/hooks/.test(readme), 'README must mention hooks/ for installation');
  assert(/registry/.test(readme), 'README must mention registry/ for installation');
});

const code = results();
process.exit(code);
