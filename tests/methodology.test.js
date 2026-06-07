#!/usr/bin/env node
// methodology.test.js — Methodology selector tests (15 tests)

const { createTestRunner, makeSkill } = require('./helpers');
const { test, assert, results } = createTestRunner();

const { detectComplexity, formatChoice } = require('../lib/methodology');

// ── Complexity Detection ───────────────────────────────────────────────────

test('zero signals → simple', () => {
  const result = detectComplexity({ message: 'fix typo', multiMethodology: false, fileCount: 1 });
  assert(result.level === 'simple', `Expected simple, got ${result.level}`);
  assert(result.signals === 0, `Expected 0 signals, got ${result.signals}`);
});

test('multi-methodology alone → medium', () => {
  const result = detectComplexity({ message: 'implement auth', multiMethodology: true, fileCount: 1 });
  assert(result.level === 'medium', `Expected medium, got ${result.level}`);
  assert(result.signals >= 1, `Expected >=1 signals, got ${result.signals}`);
});

test('multi-methodology + 4 files → medium (2 signals)', () => {
  const result = detectComplexity({ message: 'implement auth', multiMethodology: true, fileCount: 4 });
  assert(result.level === 'medium', `Expected medium, got ${result.level}`);
  assert(result.signals >= 2, `Expected >=2 signals, got ${result.signals}`);
});

test('3 files alone → medium', () => {
  const result = detectComplexity({ message: 'refactor this', multiMethodology: false, fileCount: 4 });
  assert(result.level === 'medium', `Expected medium, got ${result.level}`);
});

test('architecture keyword detected', () => {
  const result = detectComplexity({ message: 'design the API architecture for auth', multiMethodology: false, fileCount: 1 });
  assert(result.signals >= 1, `Expected >=1 signals for architecture keyword, got ${result.signals}`);
});

test('ambiguous keyword detected', () => {
  const result = detectComplexity({ message: "I'm not sure how to approach this", multiMethodology: false, fileCount: 1 });
  assert(result.signals >= 1, `Expected >=1 signals for ambiguous keyword, got ${result.signals}`);
});

test('schema change detected', () => {
  const result = detectComplexity({ message: 'add a migration to change the database schema', multiMethodology: false, fileCount: 1 });
  assert(result.signals >= 1, `Expected >=1 signals for schema keyword, got ${result.signals}`);
});

test('production keyword detected', () => {
  const result = detectComplexity({ message: 'deploy to production safely', multiMethodology: false, fileCount: 1 });
  assert(result.signals >= 1, `Expected >=1 signals for production keyword, got ${result.signals}`);
});

// ── Signal Counting ────────────────────────────────────────────────────────

test('multiple signals stack', () => {
  const result = detectComplexity({
    message: 'redesign the API architecture and deploy to production',
    multiMethodology: true,
    fileCount: 5,
  });
  assert(result.signals >= 3, `Expected >=3 stacked signals, got ${result.signals}`);
  assert(result.level === 'high', `Expected high for 3+ signals, got ${result.level}`);
});

test('exactly 2 signals → medium', () => {
  const result = detectComplexity({ message: 'refactor auth module', multiMethodology: false, fileCount: 4 });
  assert(result.level === 'medium', `Expected medium for 2 signals, got ${result.level}`);
});

// ── Format Choice ──────────────────────────────────────────────────────────

test('simple level returns no choice', () => {
  const result = formatChoice({ level: 'simple', signals: 0 });
  assert(result === null, `Expected null for simple, got ${result}`);
});

test('medium level returns 2 options', () => {
  const result = formatChoice({ level: 'medium', signals: 2, reasons: ['scope', 'architecture'] });
  assert(result !== null, 'Expected choice output');
  assert(result.toLowerCase().includes('gate-based'), 'Expected gate-based in output');
  assert(result.toLowerCase().includes('role-based'), 'Expected role-based in output');
  assert(!result.includes('параллельно'), 'Should not include parallel for medium');
});

test('high level returns 3 options', () => {
  const result = formatChoice({ level: 'high', signals: 3, reasons: ['multi-methodology', 'scope', 'architecture'] });
  assert(result !== null, 'Expected choice output');
  assert(result.toLowerCase().includes('gate-based'), 'Expected gate-based in output');
  assert(result.toLowerCase().includes('role-based'), 'Expected role-based in output');
  assert(result.toLowerCase().includes('параллельно'), 'Expected parallel for high');
});

// ── Edge Cases ─────────────────────────────────────────────────────────────

test('null input does not crash', () => {
  const result = detectComplexity(null);
  assert(result.level === 'simple', `Expected simple for null, got ${result.level}`);
});

test('empty message does not crash', () => {
  const result = detectComplexity({ message: '', multiMethodology: false, fileCount: 0 });
  assert(result.level === 'simple', `Expected simple for empty, got ${result.level}`);
});

// ── Summary ────────────────────────────────────────────────────────────────

const code = results();
process.exit(code);
