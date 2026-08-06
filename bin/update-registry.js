#!/usr/bin/env node
// update-registry.js — Rebuild skills-registry.json from vault + existing registry

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const vaultRoot = path.join(os.homedir(), '.claude', 'lazy-skills');
const registryPath = path.join(__dirname, '..', 'registry', 'skills-registry.json');
const { parse } = require('../lib/frontmatter');

function readVaultRegistry() {
  const regPath = path.join(vaultRoot, 'vault-registry.json');
  if (!fs.existsSync(regPath)) return null;
  return JSON.parse(fs.readFileSync(regPath, 'utf8'));
}

function readExistingRegistry() {
  if (!fs.existsSync(registryPath)) return { version: 2, skills: [] };
  return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
}

function vaultEntryToRegistry(entry) {
  if (entry.source !== 'custom') return null;

  const vaultMdPath = entry.vault_path || path.join(vaultRoot, 'backups', 'custom', entry.original_name, 'SKILL.md');
  if (!fs.existsSync(vaultMdPath)) return null;

  const content = fs.readFileSync(vaultMdPath, 'utf8');
  const { frontmatter } = parse(content);

  if (!frontmatter || !frontmatter.name) return null;

  return {
    id: entry.stub_id,
    name: frontmatter.name,
    description: frontmatter.description || '',
    source: 'custom',
    path: `skills/${entry.original_name}/SKILL.md`,
    triggers: {
      keywords: [],
      file_patterns: [],
      languages: ['any'],
    },
    tags: ['hooks', 'pattern'],
    methodology: 'gate-based',
    token_estimate: 800,
    conflicts: [],
  };
}

function buildRegistry() {
  const existing = readExistingRegistry();
  const vaultReg = readVaultRegistry();

  if (!vaultReg) {
    console.log('No vault registry found');
    return existing;
  }

  // Keep plugin skills (agent-skills, superpowers, etc.) from existing
  const pluginSkills = existing.skills.filter(s => s.source !== 'custom');

  // Add custom skills from vault
  const customSkills = [];
  for (const entry of vaultReg.entries || []) {
    const reg = vaultEntryToRegistry(entry);
    if (reg) customSkills.push(reg);
  }

  // Combine: plugin skills first, then custom skills
  const combined = [
    ...pluginSkills,
    ...customSkills,
  ];

  const output = {
    version: 2,
    skills: combined,
  };

  return output;
}

function main() {
  const registry = buildRegistry();
  const json = JSON.stringify(registry, null, 2);

  console.log(`Registry: ${registry.skills.length} skills`);
  console.log(`  Plugin skills: ${registry.skills.filter(s => s.source === 'plugin' || s.source === 'agent-skills' || s.source === 'superpowers').length}`);
  console.log(`  Custom skills: ${registry.skills.filter(s => s.source === 'custom').length}`);

  fs.writeFileSync(registryPath, json, 'utf8');
  console.log(`Updated: ${registryPath}`);
}

main();
