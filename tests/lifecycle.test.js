#!/usr/bin/env node
// lifecycle.test.js — Lifecycle manager tests (20 tests)

const { createTestRunner, makeSkill } = require('./helpers');
const { test, assert, results } = createTestRunner();

const { createManager, estimateTokens } = require('../lib/lifecycle');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRegistry(skills) {
  return { version: 1, skills };
}

function skill(id, keywords, opts = {}) {
  return makeSkill({
    id,
    name: id.replace(/-/g, ' '),
    description: `${id} description text here`,
    triggers: {
      keywords,
      file_patterns: opts.file_patterns || [],
      languages: opts.languages || ['any'],
    },
    tags: opts.tags || ['testing'],
    methodology: opts.methodology || 'gate-based',
    token_estimate: opts.token_estimate || 500,
    conflicts: [],
  });
}

// ── Manager Creation ───────────────────────────────────────────────────────

test('valid registry creates manager', () => {
  const reg = makeRegistry([skill('test', ['test'])]);
  const mgr = createManager(reg);
  assert(mgr.error === null, `Unexpected error: ${mgr.error}`);
  assert(mgr.getActive().length === 0, 'Should start with no active skills');
});

test('invalid registry returns error', () => {
  const mgr = createManager({ skills: 'not-array' });
  assert(mgr.error !== null, 'Expected error for invalid registry');
  assert(mgr.error.length > 0, 'Expected error messages');
});

test('manager starts with zero tokens', () => {
  const reg = makeRegistry([skill('test', ['test'])]);
  const mgr = createManager(reg);
  assert(mgr.getTotalTokens() === 0, `Expected 0, got ${mgr.getTotalTokens()}`);
});

// ── Route & Load ───────────────────────────────────────────────────────────

test('routeAndLoad loads matching skill', () => {
  const reg = makeRegistry([skill('debug', ['debug', 'fix', 'error'])]);
  const mgr = createManager(reg);
  const result = mgr.routeAndLoad('fix the bug', []);
  assert(result.loaded.includes('debug'), `Expected debug loaded, got ${result.loaded}`);
  assert(result.active.length === 1, `Expected 1 active, got ${result.active.length}`);
});

test('routeAndLoad skips non-matching message', () => {
  const reg = makeRegistry([skill('database', ['sql', 'query'])]);
  const mgr = createManager(reg);
  const result = mgr.routeAndLoad('build a react component', []);
  assert(result.loaded.length === 0, `Expected 0 loaded, got ${result.loaded}`);
  assert(result.active.length === 0, 'Expected 0 active');
});

test('routeAndLoad returns complexity info', () => {
  const reg = makeRegistry([skill('test', ['test'])]);
  const mgr = createManager(reg);
  const result = mgr.routeAndLoad('fix typo', []);
  assert(result.complexity !== undefined, 'Expected complexity object');
  assert(result.complexity.level === 'simple', `Expected simple, got ${result.complexity.level}`);
});

// ── Token Budget Enforcement ───────────────────────────────────────────────

test('loading tracks token usage', () => {
  const reg = makeRegistry([skill('debug', ['debug'])]);
  const mgr = createManager(reg, null, { maxTokens: 10000 });
  mgr.routeAndLoad('debug this', []);
  assert(mgr.getTotalTokens() > 0, `Expected tokens > 0, got ${mgr.getTotalTokens()}`);
});

test('exceeding budget evicts oldest skill', () => {
  const reg = makeRegistry([
    skill('first', ['first'], { token_estimate: 300 }),
    skill('second', ['second'], { token_estimate: 300 }),
    skill('third', ['third'], { token_estimate: 300 }),
  ]);
  const mgr = createManager(reg, null, { maxTokens: 800, maxSkills: 2 });
  mgr.routeAndLoad('first task', []);
  mgr.routeAndLoad('second task', []);
  mgr.routeAndLoad('third task', []);
  assert(mgr.getActive().length <= 2, `Expected <=2 active, got ${mgr.getActive().length}`);
});

// ── Max Skills Limit ───────────────────────────────────────────────────────

test('maxSkills limits concurrent active skills', () => {
  const reg = makeRegistry([
    skill('a', ['a']),
    skill('b', ['b']),
    skill('c', ['c']),
    skill('d', ['d']),
  ]);
  const mgr = createManager(reg, null, { maxTokens: 50000, maxSkills: 2 });
  mgr.routeAndLoad('a and b task', []);
  mgr.routeAndLoad('c task', []);
  assert(mgr.getActive().length <= 2, `Expected <=2, got ${mgr.getActive().length}`);
});

// ── Eviction ───────────────────────────────────────────────────────────────

test('evict removes specific skill', () => {
  const reg = makeRegistry([skill('debug', ['debug'])]);
  const mgr = createManager(reg);
  mgr.routeAndLoad('debug this', []);
  assert(mgr.getActive().length === 1, 'Expected 1 active before evict');
  const result = mgr.evict('debug');
  assert(result === true, 'Expected true from evict');
  assert(mgr.getActive().length === 0, `Expected 0 active after evict, got ${mgr.getActive().length}`);
  assert(mgr.getTotalTokens() === 0, `Expected 0 tokens after evict, got ${mgr.getTotalTokens()}`);
});

test('evict non-existent returns false', () => {
  const reg = makeRegistry([skill('test', ['test'])]);
  const mgr = createManager(reg);
  assert(mgr.evict('nonexistent') === false, 'Expected false for missing skill');
});

test('evictAll clears everything', () => {
  const reg = makeRegistry([
    skill('a', ['a']),
    skill('b', ['b']),
  ]);
  const mgr = createManager(reg, null, { maxTokens: 50000, maxSkills: 10 });
  mgr.routeAndLoad('a and b', []);
  assert(mgr.getActive().length === 2, 'Expected 2 active before evictAll');
  const evicted = mgr.evictAll();
  assert(evicted.length === 2, `Expected 2 evicted, got ${evicted.length}`);
  assert(mgr.getActive().length === 0, 'Expected 0 active after evictAll');
  assert(mgr.getTotalTokens() === 0, 'Expected 0 tokens after evictAll');
});

// ── Already Active Skill ──────────────────────────────────────────────────

test('already active skill is not loaded again', () => {
  const reg = makeRegistry([skill('debug', ['debug'])]);
  const mgr = createManager(reg);
  const r1 = mgr.routeAndLoad('debug this', []);
  const r2 = mgr.routeAndLoad('debug more', []);
  assert(r1.loaded.includes('debug'), 'First call should load');
  assert(!r2.loaded.includes('debug'), 'Second call should skip (already active)');
  assert(mgr.getActive().length === 1, 'Should still have exactly 1 active');
});

// ── Multi-Methodology Detection ────────────────────────────────────────────

test('multi-methodology triggers high complexity', () => {
  const reg = makeRegistry([
    skill('tdd', ['implement'], { methodology: 'gate-based' }),
    skill('gstack', ['implement'], { methodology: 'role-based' }),
  ]);
  const mgr = createManager(reg, null, { maxTokens: 50000 });
  const result = mgr.routeAndLoad('implement auth with architecture redesign', []);
  assert(result.complexity.level !== 'simple', `Expected non-simple, got ${result.complexity.level}`);
});

// ── Token Estimation ───────────────────────────────────────────────────────

test('estimateTokens for empty string is 0', () => {
  assert(estimateTokens('') === 0, 'Expected 0 for empty string');
});

test('estimateTokens for null is 0', () => {
  assert(estimateTokens(null) === 0, 'Expected 0 for null');
});

test('estimateTokens for content is positive', () => {
  const tokens = estimateTokens('This is a test skill with some content to measure');
  assert(tokens > 0, `Expected positive, got ${tokens}`);
  assert(tokens < 100, `Expected reasonable estimate, got ${tokens}`);
});

// ── Re-load After Eviction ─────────────────────────────────────────────────

test('evicted skill can be re-loaded', () => {
  const reg = makeRegistry([skill('debug', ['debug'])]);
  const mgr = createManager(reg);
  mgr.routeAndLoad('debug this', []);
  mgr.evict('debug');
  assert(mgr.getActive().length === 0, 'Expected 0 after evict');
  const result = mgr.routeAndLoad('debug again', []);
  assert(result.loaded.includes('debug'), 'Should re-load after eviction');
  assert(mgr.getActive().length === 1, 'Expected 1 active after re-load');
});

// ── Summary ────────────────────────────────────────────────────────────────

const code = results();
process.exit(code);
