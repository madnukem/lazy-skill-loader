#!/usr/bin/env node
// registry.test.js — Registry validation tests (20 tests)

const { createSuite, createTestRunner, makeSkill } = require('./helpers');
const { test, assert, results } = createTestRunner();
const { writeRegistry, readRegistry, cleanup } = createSuite('registry');

// ── Schema Validation ──────────────────────────────────────────────────────

test('valid registry parses without error', () => {
  writeRegistry({ version: 1, skills: [makeSkill()] });
  const reg = readRegistry();
  assert(reg !== null, 'Registry should parse');
  assert(reg.version === 1, 'Version should be 1');
});

test('registry requires version field', () => {
  writeRegistry({ skills: [makeSkill()] });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.some(e => e.includes('version')), `Expected version error, got: ${errors}`);
});

test('registry requires skills array', () => {
  writeRegistry({ version: 1 });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.some(e => e.includes('skills')), `Expected skills error, got: ${errors}`);
});

test('empty skills array is valid', () => {
  writeRegistry({ version: 1, skills: [] });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.length === 0, `Expected no errors, got: ${errors}`);
});

// ── Null / Malformed Guard ─────────────────────────────────────────────────

test('null skill entry does not crash', () => {
  writeRegistry({ version: 1, skills: [null, undefined] });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.length >= 2, `Expected errors for null entries, got ${errors.length}`);
});

test('null registry returns version error', () => {
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(null);
  assert(errors.some(e => e.includes('version')), `Expected version error for null, got: ${errors}`);
});

// ── Required Fields ────────────────────────────────────────────────────────

test('skill requires id', () => {
  const skill = makeSkill();
  delete skill.id;
  writeRegistry({ version: 1, skills: [skill] });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.some(e => e.includes('id')), `Expected id error, got: ${errors}`);
});

test('skill requires name', () => {
  const skill = makeSkill();
  delete skill.name;
  writeRegistry({ version: 1, skills: [skill] });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.some(e => e.includes('name')), `Expected name error, got: ${errors}`);
});

test('skill requires description', () => {
  const skill = makeSkill();
  delete skill.description;
  writeRegistry({ version: 1, skills: [skill] });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.some(e => e.includes('description')), `Expected description error, got: ${errors}`);
});

test('skill requires path', () => {
  const skill = makeSkill();
  delete skill.path;
  writeRegistry({ version: 1, skills: [skill] });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.some(e => e.includes('path')), `Expected path error, got: ${errors}`);
});

test('skill requires triggers', () => {
  const skill = makeSkill();
  delete skill.triggers;
  writeRegistry({ version: 1, skills: [skill] });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.some(e => e.includes('triggers')), `Expected triggers error, got: ${errors}`);
});

// ── Uniqueness ─────────────────────────────────────────────────────────────

test('duplicate skill ids are rejected', () => {
  writeRegistry({
    version: 1,
    skills: [makeSkill({ id: 'test-plugin:same' }), makeSkill({ id: 'test-plugin:same', name: 'Other' })],
  });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.some(e => e.includes('duplicate')), `Expected duplicate error, got: ${errors}`);
});

// ── Triggers Validation ────────────────────────────────────────────────────

test('triggers.keywords must be array', () => {
  const skill = makeSkill({ triggers: { keywords: 'not-array', file_patterns: [], languages: [] } });
  writeRegistry({ version: 1, skills: [skill] });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.some(e => e.includes('keywords')), `Expected keywords error, got: ${errors}`);
});

test('triggers.file_patterns must be array', () => {
  const skill = makeSkill({ triggers: { keywords: [], file_patterns: '*.js', languages: [] } });
  writeRegistry({ version: 1, skills: [skill] });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.some(e => e.includes('file_patterns')), `Expected file_patterns error, got: ${errors}`);
});

test('triggers.languages must be array if present', () => {
  const skill = makeSkill({ triggers: { keywords: [], file_patterns: [], languages: 'python' } });
  writeRegistry({ version: 1, skills: [skill] });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.some(e => e.includes('languages')), `Expected languages error, got: ${errors}`);
});

test('empty keywords array is valid', () => {
  const skill = makeSkill({ triggers: { keywords: [], file_patterns: [], languages: ['any'] } });
  writeRegistry({ version: 1, skills: [skill] });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.length === 0, `Expected no errors, got: ${errors}`);
});

// ── Token Estimate ─────────────────────────────────────────────────────────

test('token_estimate must be positive number', () => {
  const skill = makeSkill({ token_estimate: -100 });
  writeRegistry({ version: 1, skills: [skill] });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.some(e => e.includes('token_estimate')), `Expected token_estimate error, got: ${errors}`);
});

test('missing token_estimate defaults to 1000', () => {
  const skill = makeSkill();
  delete skill.token_estimate;
  writeRegistry({ version: 1, skills: [skill] });
  const { normalizeRegistry } = require('../lib/registry');
  const reg = normalizeRegistry(readRegistry());
  assert(reg.skills[0].token_estimate === 1000, `Expected 1000, got ${reg.skills[0].token_estimate}`);
});

// ── Normalize Does Not Mutate ──────────────────────────────────────────────

test('normalizeRegistry does not mutate original', () => {
  const original = { version: 1, skills: [makeSkill()] };
  const originalSkillsRef = original.skills;
  const { normalizeRegistry } = require('../lib/registry');
  normalizeRegistry(original);
  assert(original.skills === originalSkillsRef, 'normalizeRegistry mutated the input');
});

test('normalizeRegistry fills missing triggers.languages', () => {
  const skill = makeSkill();
  delete skill.triggers.languages;
  writeRegistry({ version: 1, skills: [skill] });
  const { normalizeRegistry } = require('../lib/registry');
  const reg = normalizeRegistry(readRegistry());
  assert(reg.skills[0].triggers.languages.length === 1, `Expected 1 lang, got ${reg.skills[0].triggers.languages}`);
  assert(reg.skills[0].triggers.languages[0] === 'any', `Expected 'any', got ${reg.skills[0].triggers.languages[0]}`);
});

// ── Smoke Test: Real Registry ──────────────────────────────────────────────

test('real skills-registry.json is valid', () => {
  const real = require('../registry/skills-registry.json');
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(real);
  assert(errors.length === 0, `Real registry has errors: ${JSON.stringify(errors)}`);
});

test('real registry uses callable plugin:skill ids', () => {
  const real = require('../registry/skills-registry.json');
  for (const skill of real.skills) {
    assert(/^[a-z0-9-]+:[a-z0-9-]+$/.test(skill.id),
      `id "${skill.id}" is not callable form "<plugin>:<skill>"`);
  }
});

test('real registry has no phantom (non-callable) entries', () => {
  // Regression for INCIDENT-2026-06-15-tdd-workflow-unknown:
  // gstack-*, caveman, planning-files were advertised but not installed.
  const real = require('../registry/skills-registry.json');
  const knownPhantoms = ['gstack-office-hours', 'gstack-design-review',
    'gstack-eng-review', 'gstack-cso', 'gstack-ship', 'gstack-benchmark',
    'gstack-canary', 'caveman', 'planning-files'];
  for (const skill of real.skills) {
    assert(!knownPhantoms.includes(skill.id),
      `phantom id "${skill.id}" must not be in registry`);
  }
});

// ── Path Traversal Guard ───────────────────────────────────────────────────

test('path with ../ is rejected', () => {
  const skill = makeSkill({ path: '../../etc/passwd' });
  writeRegistry({ version: 1, skills: [skill] });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.some(e => e.includes('path') && e.includes('escape')), `Expected path traversal error, got: ${errors}`);
});

test('absolute path is rejected', () => {
  const skill = makeSkill({ path: '/etc/passwd' });
  writeRegistry({ version: 1, skills: [skill] });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.some(e => e.includes('path') && e.includes('escape')), `Expected absolute path error, got: ${errors}`);
});

test('valid relative path is accepted', () => {
  const skill = makeSkill({ path: 'skills/test/SKILL.md' });
  writeRegistry({ version: 1, skills: [skill] });
  const { validateRegistry } = require('../lib/registry');
  const errors = validateRegistry(readRegistry());
  assert(errors.length === 0, `Expected no errors, got: ${errors}`);
});

// ── Summary ────────────────────────────────────────────────────────────────

const code = results();
cleanup();
process.exit(code);
