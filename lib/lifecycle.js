// lib/lifecycle.js — Skill lifecycle manager: load, track, evict L2 skills

'use strict';

const { validateRegistry, normalizeRegistry } = require('./registry');
const { route } = require('./router');
const { detectComplexity } = require('./methodology');
const fs = require('fs');
const path = require('path');

const MAX_LOADED_TOKENS = 6000;
const MAX_LOADED_SKILLS = 3;

/**
 * Create a lifecycle manager bound to a registry.
 *
 * @param {object} registry - Parsed + normalized skills-registry.json
 * @param {string} [skillsRoot] - Root directory for resolving skill paths
 * @param {object} [options]
 * @param {number} [options.maxTokens=6000]
 * @param {number} [options.maxSkills=3]
 */
function createManager(registry, skillsRoot, options = {}) {
  const maxTokens = options.maxTokens || MAX_LOADED_TOKENS;
  const maxSkills = options.maxSkills || MAX_LOADED_SKILLS;

  const errors = validateRegistry(registry);
  if (errors.length > 0) {
    return { error: errors };
  }
  const norm = normalizeRegistry(registry);

  // Active L2 skills: Map<id, { skill, content, loadedAt, tokensUsed }>
  const active = new Map();
  let totalTokens = 0;

  function getActive() {
    return Array.from(active.values()).map(e => ({
      id: e.skill.id,
      name: e.skill.name,
      tokensUsed: e.tokensUsed,
      loadedAt: e.loadedAt,
    }));
  }

  function getTotalTokens() {
    return totalTokens;
  }

  /**
   * Route a message and load L2 for matched skills.
   * Evicts lowest-score skills if budget exceeded.
   *
   * @param {string} message
   * @param {string[]} openFiles
   * @param {object} [routeOptions]
   * @returns {{ loaded: string[], evicted: string[], active: object[], complexity: object }}
   */
  function routeAndLoad(message, openFiles, routeOptions = {}) {
    const result = route(message, openFiles, norm, {
      maxResults: maxSkills,
      tokenBudget: maxTokens,
      ...routeOptions,
    });

    const loaded = [];
    const evicted = [];

    for (const skill of result.matched) {
      // Already active — skip
      if (active.has(skill.id)) continue;

      const content = loadL2(skill);
      const tokensUsed = estimateTokens(content);

      // Need to evict?
      while (totalTokens + tokensUsed > maxTokens && active.size > 0) {
        const victim = findEvictionCandidate();
        if (victim) {
          active.delete(victim.id);
          totalTokens -= victim.tokensUsed;
          evicted.push(victim.id);
        } else {
          break;
        }
      }

      // Check skill count limit
      while (active.size >= maxSkills && active.size > 0) {
        const victim = findEvictionCandidate();
        if (victim) {
          active.delete(victim.id);
          totalTokens -= victim.tokensUsed;
          evicted.push(victim.id);
        } else {
          break;
        }
      }

      if (totalTokens + tokensUsed <= maxTokens) {
        active.set(skill.id, {
          skill,
          content,
          tokensUsed,
          loadedAt: Date.now(),
        });
        totalTokens += tokensUsed;
        loaded.push(skill.id);
      }
    }

    const complexity = detectComplexity({
      message,
      multiMethodology: result.multiMethodology,
      fileCount: openFiles.length,
    });

    return {
      loaded,
      evicted,
      active: getActive(),
      complexity,
    };
  }

  function loadL2(skill) {
    if (!skillsRoot) return skill.description || '';
    const fullPath = path.join(skillsRoot, skill.path);
    try {
      return fs.readFileSync(fullPath, 'utf8');
    } catch {
      return skill.description || '';
    }
  }

  function findEvictionCandidate() {
    // Evict oldest loaded skill
    let oldest = null;
    for (const entry of active.values()) {
      if (!oldest || entry.loadedAt < oldest.loadedAt) {
        oldest = entry;
      }
    }
    return oldest ? { id: oldest.skill.id, tokensUsed: oldest.tokensUsed } : null;
  }

  function evict(skillId) {
    const entry = active.get(skillId);
    if (!entry) return false;
    active.delete(skillId);
    totalTokens -= entry.tokensUsed;
    return true;
  }

  function evictAll() {
    const ids = Array.from(active.keys());
    active.clear();
    totalTokens = 0;
    return ids;
  }

  return {
    getActive,
    getTotalTokens,
    routeAndLoad,
    evict,
    evictAll,
    error: null,
  };
}

function estimateTokens(content) {
  if (!content) return 0;
  // Rough estimate: ~4 chars per token for English, ~2 for code-heavy content
  return Math.ceil(content.length / 3);
}

module.exports = { createManager, estimateTokens, MAX_LOADED_TOKENS, MAX_LOADED_SKILLS };
