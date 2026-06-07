#!/usr/bin/env node
// routing.test.js — Router engine tests (25 tests)

const { createSuite, createTestRunner, makeSkill } = require('./helpers');
const { test, assert, results } = createTestRunner();
const { writeRegistry, readRegistry, cleanup } = createSuite('routing');

const { route } = require('../lib/router');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRegistry(skills) {
  return { version: 1, skills };
}

function skill(id, keywords, opts = {}) {
  return makeSkill({
    id,
    name: id.replace(/-/g, ' '),
    description: opts.description || `${id} skill`,
    triggers: {
      keywords,
      file_patterns: opts.file_patterns || [],
      languages: opts.languages || ['any'],
    },
    tags: opts.tags || ['testing'],
    methodology: opts.methodology || 'gate-based',
    token_estimate: opts.token_estimate || 500,
    conflicts: opts.conflicts || [],
  });
}

// ── Basic Keyword Matching (5) ─────────────────────────────────────────────

test('exact keyword match returns skill', () => {
  const reg = makeRegistry([skill('tdd', ['test', 'tdd', 'spec'])]);
  const result = route('implement with TDD', [], reg);
  assert(result.matched.some(s => s.id === 'tdd'), `Expected tdd, got ${JSON.stringify(result.matched)}`);
});

test('case-insensitive keyword match', () => {
  const reg = makeRegistry([skill('security', ['security', 'owasp', 'vulnerability'])]);
  const result = route('Check SECURITY issues', [], reg);
  assert(result.matched.some(s => s.id === 'security'), `Expected security, got ${JSON.stringify(result.matched)}`);
});

test('keyword as whole word in message', () => {
  const reg = makeRegistry([skill('debug', ['debug', 'fix', 'error', 'traceback'])]);
  const result = route('fix the bug in authentication', [], reg);
  assert(result.matched.some(s => s.id === 'debug'), `Expected debug, got ${JSON.stringify(result.matched)}`);
});

test('no match returns empty array', () => {
  const reg = makeRegistry([skill('database', ['sql', 'query', 'migration'])]);
  const result = route('build a react component', [], reg);
  assert(result.matched.length === 0, `Expected empty, got ${JSON.stringify(result.matched)}`);
});

test('substring match scores lower than exact word', () => {
  const reg = makeRegistry([skill('fix', ['fix'])]);
  const result = route('fix the prefix issue', [], reg);
  assert(result.matched.length === 1, `Expected 1 match`);
  assert(result.matched[0]._score >= 10, `Word "fix" should score >=10, got ${result.matched[0]._score}`);
});

// ── Multi-Skill Matching (2) ───────────────────────────────────────────────

test('multiple skills can match', () => {
  const reg = makeRegistry([
    skill('tdd', ['test', 'tdd']),
    skill('security', ['security', 'vulnerability']),
  ]);
  const result = route('write tests for security vulnerability', [], reg);
  assert(result.matched.length === 2, `Expected 2, got ${result.matched.length}`);
});

test('duplicate matches are deduplicated', () => {
  const reg = makeRegistry([
    skill('tdd', ['test', 'spec']),
    skill('review', ['review', 'code review']),
  ]);
  const result = route('test review the code test', [], reg);
  const ids = result.matched.map(s => s.id);
  const unique = new Set(ids);
  assert(ids.length === unique.size, `Duplicates found: ${JSON.stringify(ids)}`);
});

// ── File Pattern Matching (3) ──────────────────────────────────────────────

test('file pattern *.sql matches sql file', () => {
  const reg = makeRegistry([skill('database', ['sql'], { file_patterns: ['**/*.sql'] })]);
  const result = route('optimize this', ['schema.sql'], reg);
  assert(result.matched.some(s => s.id === 'database'), `Expected database, got ${JSON.stringify(result.matched)}`);
});

test('file pattern *.test.* matches test file', () => {
  const reg = makeRegistry([skill('tdd', ['test'], { file_patterns: ['**/*.test.*'] })]);
  const result = route('check this', ['app.test.ts'], reg);
  assert(result.matched.some(s => s.id === 'tdd'), `Expected tdd, got ${JSON.stringify(result.matched)}`);
});

test('file pattern does not match unrelated file', () => {
  const reg = makeRegistry([skill('database', [], { file_patterns: ['**/*.sql'] })]);
  const result = route('check this', ['app.ts'], reg);
  assert(result.matched.length === 0, `Expected empty, got ${JSON.stringify(result.matched)}`);
});

// ── Combined Keyword + File Pattern (1) ────────────────────────────────────

test('keyword OR file pattern triggers match', () => {
  const reg = makeRegistry([skill('frontend', ['react', 'component'], { file_patterns: ['**/*.tsx'] })]);
  const result = route('update the UI', ['button.tsx'], reg);
  assert(result.matched.some(s => s.id === 'frontend'), `Expected frontend from file pattern, got ${JSON.stringify(result.matched)}`);
});

// ── Tag Overlap Scoring (2) ────────────────────────────────────────────────

test('tag overlap adds score bonus', () => {
  const reg = makeRegistry([
    skill('perf-test', ['test'], { tags: ['testing', 'performance'] }),
    skill('unit-test', ['test'], { tags: ['testing'] }),
  ]);
  const result = route('run performance test', [], reg);
  assert(result.matched.length === 2, `Expected 2, got ${result.matched.length}`);
  assert(result.matched[0].id === 'perf-test', `Expected perf-test first (tag bonus), got ${result.matched[0].id}`);
});

test('no tag overlap still matches', () => {
  const reg = makeRegistry([skill('basic', ['test'], { tags: ['unrelated'] })]);
  const result = route('write a test', [], reg);
  assert(result.matched.length === 1, `Expected 1 match`);
});

// ── Max Results (1) ────────────────────────────────────────────────────────

test('maxResults limits returned skills', () => {
  const reg = makeRegistry([
    skill('a', ['code']),
    skill('b', ['code']),
    skill('c', ['code']),
    skill('d', ['code']),
    skill('e', ['code']),
  ]);
  const result = route('write code', [], reg, { maxResults: 3 });
  assert(result.matched.length <= 3, `Expected <=3, got ${result.matched.length}`);
});

// ── Edge Cases (4) ─────────────────────────────────────────────────────────

test('empty message returns no matches', () => {
  const reg = makeRegistry([skill('debug', ['error', 'fix'])]);
  const result = route('', [], reg);
  assert(result.matched.length === 0, `Expected empty for empty message`);
});

test('empty keywords array — skill never matches by keyword', () => {
  const reg = makeRegistry([skill('orphan', [])]);
  const result = route('anything goes here', [], reg);
  assert(result.matched.length === 0, `Expected no match for skill with empty keywords`);
});

test('special regex characters in keywords do not crash', () => {
  const reg = makeRegistry([skill('cpp', ['c++'])]);
  const result = route('write c++ code', [], reg);
  assert(result.matched.length >= 0, 'Should not crash on special chars');
});

test('very long message does not crash', () => {
  const reg = makeRegistry([skill('test', ['test'])]);
  const longMsg = 'test '.repeat(10000);
  const result = route(longMsg, [], reg);
  assert(result.matched.length >= 1, 'Should handle long messages');
});

// ── Language Filter (3) ────────────────────────────────────────────────────

test('language any always matches', () => {
  const reg = makeRegistry([skill('general', ['code'], { languages: ['any'] })]);
  const result = route('write some code', [], reg, { language: 'python' });
  assert(result.matched.some(s => s.id === 'general'), `Expected general to match`);
});

test('language filter excludes non-matching', () => {
  const reg = makeRegistry([skill('python-only', ['code'], { languages: ['python'] })]);
  const result = route('write some code', [], reg, { language: 'typescript' });
  assert(result.matched.length === 0, `Expected no match for typescript`);
});

test('language filter includes matching', () => {
  const reg = makeRegistry([skill('python-only', ['code'], { languages: ['python'] })]);
  const result = route('write some code', [], reg, { language: 'python' });
  assert(result.matched.some(s => s.id === 'python-only'), `Expected python-only to match`);
});

// ── Token Budget (1) ───────────────────────────────────────────────────────

test('token budget prunes low-relevance skills', () => {
  const reg = makeRegistry([
    skill('high', ['exact-match'], { token_estimate: 300 }),
    skill('low', ['maybe'], { token_estimate: 2000 }),
    skill('mid', ['exact-match', 'extra'], { token_estimate: 500 }),
  ]);
  const result = route('exact-match something', [], reg, { tokenBudget: 1000 });
  const totalTokens = result.matched.reduce((sum, s) => sum + s.token_estimate, 0);
  assert(totalTokens <= 1000, `Token budget exceeded: ${totalTokens}`);
});

// ── Complex Task Detection (2) ─────────────────────────────────────────────

test('detects complex task by methodology count', () => {
  const reg = makeRegistry([
    skill('tdd', ['implement'], { methodology: 'gate-based' }),
    skill('gstack-review', ['implement'], { methodology: 'role-based' }),
  ]);
  const result = route('implement a new auth system with database', [], reg);
  assert(result.multiMethodology === true, `Expected multiMethodology flag`);
});

test('simple task does not flag multi-methodology', () => {
  const reg = makeRegistry([
    skill('tdd', ['test'], { methodology: 'gate-based' }),
  ]);
  const result = route('write a test', [], reg);
  assert(result.multiMethodology === false, `Should not flag single methodology`);
});

// ── Performance Benchmark (1) ──────────────────────────────────────────────

test('routes 50 skills × 10 files under 5ms', () => {
  const skills = [];
  for (let i = 0; i < 50; i++) {
    skills.push(skill(`skill-${i}`, [`keyword-${i}`, 'common'], {
      file_patterns: i % 2 === 0 ? [`**/*.ext${i}`] : [],
      token_estimate: 500,
    }));
  }
  const reg = makeRegistry(skills);
  const files = Array.from({ length: 10 }, (_, i) => `file${i}.ext${i * 5}`);

  const start = process.hrtime.bigint();
  const result = route('common keyword-25 task', files, reg);
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;

  assert(elapsed < 5, `Routing took ${elapsed.toFixed(2)}ms, expected < 5ms`);
  assert(result.matched.length >= 1, `Expected at least 1 match`);
});

// ── Summary ────────────────────────────────────────────────────────────────

const code = results();
cleanup();
process.exit(code);
