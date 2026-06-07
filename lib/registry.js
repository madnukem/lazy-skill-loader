// lib/registry.js — Registry validation and normalization

'use strict';

const REQUIRED_SKILL_FIELDS = ['id', 'name', 'description', 'path', 'triggers'];

function validateRegistry(registry) {
  const errors = [];

  if (!registry || registry.version === undefined) {
    errors.push('missing required field: version');
  }

  if (!Array.isArray(registry.skills)) {
    errors.push('missing or invalid field: skills (must be array)');
    return errors;
  }

  const ids = new Set();

  for (let i = 0; i < registry.skills.length; i++) {
    const skill = registry.skills[i];
    const prefix = `skills[${i}]`;

    for (const field of REQUIRED_SKILL_FIELDS) {
      if (!skill[field]) {
        errors.push(`${prefix}: missing required field: ${field}`);
      }
    }

    if (skill.id) {
      if (ids.has(skill.id)) {
        errors.push(`${prefix}: duplicate id: "${skill.id}"`);
      }
      ids.add(skill.id);
    }

    if (skill.triggers) {
      if (!Array.isArray(skill.triggers.keywords)) {
        errors.push(`${prefix}.triggers.keywords: must be array`);
      }
      if (!Array.isArray(skill.triggers.file_patterns)) {
        errors.push(`${prefix}.triggers.file_patterns: must be array`);
      }
    }

    if (skill.token_estimate !== undefined && (typeof skill.token_estimate !== 'number' || skill.token_estimate <= 0)) {
      errors.push(`${prefix}.token_estimate: must be positive number`);
    }
  }

  return errors;
}

function normalizeRegistry(registry) {
  if (!registry || !Array.isArray(registry.skills)) return registry;

  registry.skills = registry.skills.map(skill => ({
    token_estimate: 1000,
    tags: [],
    conflicts: [],
    methodology: 'gate-based',
    ...skill,
    triggers: {
      keywords: [],
      file_patterns: [],
      languages: ['any'],
      ...skill.triggers,
    },
  }));

  return registry;
}

module.exports = { validateRegistry, normalizeRegistry };
