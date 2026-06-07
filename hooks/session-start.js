#!/usr/bin/env node
// session-start.js — SessionStart hook: outputs L1 skill index for context injection

'use strict';

const fs = require('fs');
const path = require('path');

const registryPath = path.join(__dirname, '..', 'registry', 'skills-registry.json');

try {
  const raw = fs.readFileSync(registryPath, 'utf8');
  const registry = JSON.parse(raw);

  if (!registry.skills || !Array.isArray(registry.skills)) {
    console.log('Lazy Skill Loader: registry has no skills array');
    process.exit(0);
  }

  const lines = ['Lazy Skill Loader: L1 index loaded. ' + registry.skills.length + ' skills available.\n'];
  lines.push('| ID | Description | Methodology |');
  lines.push('|---|---|---|');
  for (const skill of registry.skills) {
    const desc = (skill.description || '').substring(0, 80);
    lines.push(`| ${skill.id} | ${desc} | ${skill.methodology || '?'} |`);
  }
  lines.push('\nUse the Skill tool to load full instructions for any skill above.');

  console.log(lines.join('\n'));
} catch (e) {
  console.log('Lazy Skill Loader: could not load registry — ' + e.message);
}

process.exit(0);
