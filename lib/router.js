// lib/router.js — Keyword-based skill router

'use strict';

const { minimatch } = require('minimatch');

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Route a user message to relevant skills.
 *
 * @param {string} message - User's message
 * @param {string[]} openFiles - Currently open file paths
 * @param {object} registry - Parsed skills-registry.json
 * @param {object} [options] - Routing options
 * @param {number} [options.maxResults=5] - Max skills to return
 * @param {string} [options.language] - Current language context
 * @param {number} [options.tokenBudget=Infinity] - Max total tokens for matched skills
 * @returns {{ matched: object[], multiMethodology: boolean }}
 */
function route(message, openFiles, registry, options = {}) {
  const {
    maxResults = 5,
    language,
    tokenBudget = Infinity,
  } = options;

  if (!message || !registry || !Array.isArray(registry.skills)) {
    return { matched: [], multiMethodology: false };
  }

  const msgLower = message.toLowerCase();
  const msgWords = new Set(msgLower.split(/\s+/));

  const candidates = [];

  for (const skill of registry.skills) {
    let score = 0;
    let matched = false;

    // Language filter
    const langs = skill.triggers?.languages || ['any'];
    if (language && !langs.includes('any') && !langs.includes(language)) {
      continue;
    }

    // Keyword matching — word boundary first, substring fallback
    const keywords = skill.triggers?.keywords || [];
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      if (msgWords.has(kwLower)) {
        score += 10;
        matched = true;
      } else if (msgLower.includes(kwLower)) {
        score += 5;
        matched = true;
      }
    }

    // File pattern matching
    const patterns = skill.triggers?.file_patterns || [];
    for (const pattern of patterns) {
      for (const file of openFiles) {
        if (minimatch(file, pattern)) {
          score += 8;
          matched = true;
          break;
        }
      }
    }

    // Tag overlap bonus
    if (matched && Array.isArray(skill.tags)) {
      const msgTagHits = skill.tags.filter(tag => msgLower.includes(tag.toLowerCase())).length;
      score += msgTagHits * 2;
    }

    if (matched) {
      candidates.push({ ...skill, _score: score });
    }
  }

  // Sort by score descending, stable (array order = registry order on tie)
  candidates.sort((a, b) => b._score - a._score);

  // Apply token budget
  let budgetUsed = 0;
  const budgeted = [];
  for (const c of candidates) {
    if (budgetUsed + c.token_estimate <= tokenBudget) {
      budgeted.push(c);
      budgetUsed += c.token_estimate;
    }
  }

  // Apply maxResults
  const finalMatched = budgeted.slice(0, maxResults);

  // Detect multi-methodology
  const methodologies = new Set(finalMatched.map(s => s.methodology));
  const multiMethodology = methodologies.size > 1;

  return { matched: finalMatched, multiMethodology };
}

module.exports = { route };
