// lib/frontmatter.js — Minimal YAML frontmatter parser/stringifier.
//
// Scope: parse the small subset of YAML used in SKILL.md frontmatter
// (key: value pairs, possibly multi-line via "|", ">", or trailing newline).
// We deliberately do NOT pull in a full YAML library — keeps the package
// dependency-free and the parser small enough to read.

'use strict';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/;

function parse(content) {
  if (typeof content !== 'string') return { frontmatter: null, body: String(content || '') };
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: null, body: content };

  const raw = m[1];
  const body = m[2];
  const fm = {};
  let currentKey = null;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;

    // Multi-line value continuation: indented line under currentKey
    if ((line.startsWith(' ') || line.startsWith('\t')) && currentKey) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) {
        const arr = Array.isArray(fm[currentKey]) ? fm[currentKey] : (fm[currentKey] ? [fm[currentKey]] : []);
        arr.push(trimmed.slice(2).trim());
        fm[currentKey] = arr;
      } else {
        fm[currentKey] = (fm[currentKey] ? fm[currentKey] + ' ' : '') + trimmed;
      }
      continue;
    }

    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_\-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2];

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Block scalar markers — treat as empty, body will continue as indented
    if (value === '|' || value === '>') value = '';

    fm[key] = value;
    currentKey = key;
  }

  return { frontmatter: fm, body };
}

function stringify(frontmatter, body) {
  if (!frontmatter || typeof frontmatter !== 'object') {
    return body || '';
  }
  const lines = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${escapeValue(item)}`);
    } else if (value === null || value === undefined) {
      lines.push(`${key}:`);
    } else {
      lines.push(`${key}: ${escapeValue(value)}`);
    }
  }
  lines.push('---');
  lines.push('');
  return lines.join('\n') + (body || '');
}

function escapeValue(value) {
  const str = String(value);
  // Quote if it contains special chars that would break YAML parse
  if (/[:#?@{}\[\],&*!|>'"%`]/.test(str) || str.includes('\n') ||
      str.startsWith(' ') || str.endsWith(' ')) {
    // Use double quotes, escape backslashes and double quotes
    return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return str;
}

module.exports = { parse, stringify };
