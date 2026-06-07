// lib/registry.js — Registry validation and normalization

'use strict';

const path = require('path');

const REQUIRED_SKILL_FIELDS = ['id', 'name', 'description', 'path', 'triggers'];
const VALID_METHODOLOGIES = ['gate-based', 'role-based', 'utility'];

function validateRegistry(registry) {
  const errors = [];

  if (!registry || typeof registry !== 'object' || registry.version === undefined) {
    errors.push('missing required field: version');
    return errors;
  }

  if (!Array.isArray(registry.skills)) {
    errors.push('missing or invalid field: skills (must be array)');
    return errors;
  }

  const ids = new Set();

  for (let i = 0; i < registry.skills.length; i++) {
    const skill = registry.skills[i];
    const prefix = `skills[${i}]`;

    if (!skill || typeof skill !== 'object') {
      errors.push(`${prefix}: must be an object, got ${skill}`);
      continue;
    }

    for (const field of REQUIRED_SKILL_FIELDS) {
      if (!skill[field]) {
        errors.push(`${prefix}: missing required field: ${field}`);
      }
    }

    if (skill.path && typeof skill.path === 'string') {
      const normalized = path.normalize(skill.path).replace(/\\/g, '/');
      if (normalized.startsWith('../') || path.isAbsolute(skill.path)) {
        errors.push(`${prefix}.path: must be relative and not escape skills directory`);
      }
    }

    if (skill.id != null) {
      if (typeof skill.id !== 'string') {
        errors.push(`${prefix}.id: must be string, got ${typeof skill.id}`);
      } else if (ids.has(skill.id)) {
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
      if (skill.triggers.languages !== undefined && !Array.isArray(skill.triggers.languages)) {
        errors.push(`${prefix}.triggers.languages: must be array if present`);
      }
    }

    if (skill.token_estimate !== undefined && (typeof skill.token_estimate !== 'number' || skill.token_estimate <= 0)) {
      errors.push(`${prefix}.token_estimate: must be positive number`);
    }

    if (skill.methodology !== undefined && !VALID_METHODOLOGIES.includes(skill.methodology)) {
      errors.push(`${prefix}.methodology: must be one of ${VALID_METHODOLOGIES.join(', ')}`);
    }
  }

  return errors;
}

function normalizeRegistry(registry) {
  if (!registry || !Array.isArray(registry.skills)) return registry;

  return {
    ...registry,
    skills: registry.skills.map(skill => ({
      token_estimate: 1000,
      tags: [],
      conflicts: [],
      methodology: 'gate-based',
      ...skill,
      triggers: {
        keywords: [],
        file_patterns: [],
        languages: ['any'],
        ...(skill.triggers || {}),
      },
    })),
  };
}

module.exports = { validateRegistry, normalizeRegistry };
