// helpers.js — Shared test utilities for lazy-skill-loader test suites.
// Creates an isolated temp directory per suite via LSL_STATE_DIR.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function createSuite(prefix) {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), `lsl-${prefix}-`));
  const registryFile = path.join(testDir, 'skills-registry.json');
  process.on('exit', () => { try { fs.rmSync(testDir, { recursive: true }); } catch {} });

  function writeRegistry(data) {
    fs.writeFileSync(registryFile, JSON.stringify(data, null, 2));
  }

  function readRegistry() {
    try { return JSON.parse(fs.readFileSync(registryFile, 'utf8')); }
    catch { return null; }
  }

  function cleanup() {
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  }

  return { testDir, registryFile, writeRegistry, readRegistry, cleanup };
}

function createTestRunner() {
  let passed = 0, failed = 0, total = 0;

  function test(name, fn) {
    total++;
    try { fn(); console.log(`  PASS: ${name}`); passed++; }
    catch (e) { console.log(`  FAIL: ${name} — ${e.message}`); failed++; }
  }

  function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

  function results() {
    console.log(`\nResults: ${passed} passed, ${failed} failed, ${total} total\n`);
    return failed;
  }

  return { test, assert, results, passed: () => passed, failed: () => failed, total: () => total };
}

/** Generate a valid minimal skill entry for testing. */
function makeSkill(overrides = {}) {
  return {
    id: 'test-plugin:test-skill',
    name: 'Test Skill',
    description: 'A test skill for unit testing',
    source: 'test-plugin',
    path: 'skills/test-skill/SKILL.md',
    triggers: {
      keywords: ['test'],
      file_patterns: [],
      languages: ['any'],
    },
    tags: ['testing'],
    methodology: 'gate-based',
    token_estimate: 500,
    conflicts: [],
    ...overrides,
  };
}

module.exports = { createSuite, createTestRunner, makeSkill };
