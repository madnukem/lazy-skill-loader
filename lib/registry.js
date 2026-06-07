// lib/registry.js — Registry validation and normalization

'use strict';

const path = require('path');

const REQUIRED_SKILL_FIELDS = ['id', 'name', 'description', 'path', 'triggers'];
const VALID_METHODOLOGIES = ['gate-based', 'role-based', 'utility'];
const MAX_SKILLS = 500;
const MAX_KEYWORDS = 50;
const MAX_FILE_PATTERNS = 20;
const MAX_TOKEN_ESTIMATE = 100000;
const MAX_PATH_LENGTH = 255;
const MAX_KEYWORD_LENGTH = 100;
const MAX_PATTERN_LENGTH = 100;

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

  if (registry.skills.length > MAX_SKILLS) {
    errors.push(`skills array exceeds maximum of ${MAX_SKILLS}`);
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
      if (skill[field] === undefined || skill[field] === null) {
        errors.push(`${prefix}: missing required field: ${field}`);
      }
    }

    if (skill.path && typeof skill.path === 'string') {
      if (skill.path.length > MAX_PATH_LENGTH) {
        errors.push(`${prefix}.path: exceeds maximum length of ${MAX_PATH_LENGTH}`);
      }
      // Reject URL-encoded or whitespace-only paths
      const trimmed = skill.path.trim();
      if (trimmed.length === 0) {
        errors.push(`${prefix}.path: must not be empty or whitespace`);
      } else if (trimmed.includes('%')) {
        errors.push(`${prefix}.path: URL-encoded characters not allowed`);
      } else {
        const normalized = path.normalize(trimmed).replace(/\\/g, '/');
        if (normalized.startsWith('../') || path.isAbsolute(trimmed)) {
          errors.push(`${prefix}.path: must be relative and not escape skills directory`);
        }
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
      } else {
        if (skill.triggers.keywords.length > MAX_KEYWORDS) {
          errors.push(`${prefix}.triggers.keywords: exceeds maximum of ${MAX_KEYWORDS}`);
        }
        for (const kw of skill.triggers.keywords) {
          if (typeof kw === 'string' && kw.length > MAX_KEYWORD_LENGTH) {
            errors.push(`${prefix}.triggers.keywords: keyword exceeds ${MAX_KEYWORD_LENGTH} chars`);
            break;
          }
        }
      }
      if (!Array.isArray(skill.triggers.file_patterns)) {
        errors.push(`${prefix}.triggers.file_patterns: must be array`);
      } else {
        if (skill.triggers.file_patterns.length > MAX_FILE_PATTERNS) {
          errors.push(`${prefix}.triggers.file_patterns: exceeds maximum of ${MAX_FILE_PATTERNS}`);
        }
        for (const p of skill.triggers.file_patterns) {
          if (typeof p === 'string' && p.length > MAX_PATTERN_LENGTH) {
            errors.push(`${prefix}.triggers.file_patterns: pattern exceeds ${MAX_PATTERN_LENGTH} chars`);
            break;
          }
        }
      }
      if (skill.triggers.languages !== undefined && !Array.isArray(skill.triggers.languages)) {
        errors.push(`${prefix}.triggers.languages: must be array if present`);
      }
    }

    if (skill.token_estimate !== undefined) {
      if (typeof skill.token_estimate !== 'number' || !Number.isFinite(skill.token_estimate) || skill.token_estimate <= 0) {
        errors.push(`${prefix}.token_estimate: must be a finite positive number`);
      } else if (skill.token_estimate > MAX_TOKEN_ESTIMATE) {
        errors.push(`${prefix}.token_estimate: exceeds maximum of ${MAX_TOKEN_ESTIMATE}`);
      }
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
      // Precompute lowercase keywords for faster routing
      _keywordsLower: (skill.triggers?.keywords || []).map(kw => kw.toLowerCase()),
    })),
  };
}

module.exports = {
  validateRegistry,
  normalizeRegistry,
  MAX_SKILLS,
  MAX_KEYWORDS,
  MAX_FILE_PATTERNS,
};
