// tests/frontmatter.test.js — frontmatter parse/stringify tests

'use strict';

const { createTestRunner } = require('./helpers');
const { test, assert, results } = createTestRunner();
const { parse, stringify } = require('../lib/frontmatter');

test('parse extracts simple name + description', () => {
  const md = `---
name: audit-pattern
description: PostToolUse hook for logging
---
# Body`;
  const { frontmatter, body } = parse(md);
  assert(frontmatter.name === 'audit-pattern', `name: ${frontmatter.name}`);
  assert(frontmatter.description === 'PostToolUse hook for logging',
    `description: ${frontmatter.description}`);
  assert(body.startsWith('# Body'), 'body should start with # Body');
});

test('parse returns null frontmatter when missing', () => {
  const md = '# Just a body, no frontmatter';
  const { frontmatter, body } = parse(md);
  assert(frontmatter === null, 'frontmatter should be null');
  assert(body === md, 'body should be unchanged');
});

test('parse strips surrounding quotes', () => {
  const md = `---
name: foo
description: "Has quotes"
---`;
  const { frontmatter } = parse(md);
  assert(frontmatter.description === 'Has quotes',
    `expected unquoted, got "${frontmatter.description}"`);
});

test('parse handles description with colon (quoted)', () => {
  const md = `---
name: foo
description: "Plugin: skill with colon"
---`;
  const { frontmatter } = parse(md);
  assert(frontmatter.description === 'Plugin: skill with colon',
    `expected full string, got "${frontmatter.description}"`);
});

test('stringify roundtrips simple frontmatter', () => {
  const fm = { name: 'test', description: 'hello world' };
  const out = stringify(fm, '# Body');
  const reparsed = parse(out);
  assert(reparsed.frontmatter.name === 'test', `name roundtrip failed: ${reparsed.frontmatter.name}`);
  assert(reparsed.frontmatter.description === 'hello world',
    `description roundtrip failed: ${reparsed.frontmatter.description}`);
  assert(reparsed.body.startsWith('# Body'), 'body lost in roundtrip');
});

test('stringify quotes description containing colon', () => {
  const fm = { name: 'test', description: 'plugin: skill description' };
  const out = stringify(fm, '');
  assert(out.includes('description: "plugin: skill description"'),
    'expected description to be quoted');
});

test('stringify handles array values', () => {
  const fm = { name: 'test', keywords: ['a', 'b', 'c'] };
  const out = stringify(fm, '');
  assert(out.includes('keywords:'), 'missing keywords key');
  assert(out.includes('  - a'), 'missing array item a');
  assert(out.includes('  - b'), 'missing array item b');
  assert(out.includes('  - c'), 'missing array item c');
});

test('CRLF line endings are handled', () => {
  const md = '---\r\nname: foo\r\ndescription: bar\r\n---\r\n# Body';
  const { frontmatter, body } = parse(md);
  assert(frontmatter.name === 'foo', `name: ${frontmatter.name}`);
  assert(frontmatter.description === 'bar', `desc: ${frontmatter.description}`);
  assert(body.startsWith('# Body'), 'body should start clean');
});

const code = results();
process.exit(code);
