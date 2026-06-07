// lib/router.js — Keyword-based skill router

'use strict';

const { minimatch } = require('minimatch');

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
    if (language) {
      const langs = skill.triggers?.languages || ['any'];
      if (!langs.includes('any') && !langs.includes(language)) {
        continue;
      }
    }

    // Keyword matching
    const keywords = skill.triggers?.keywords || [];
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      // Exact word match
      if (msgWords.has(kwLower)) {
        score += 10;
        matched = true;
      }
      // Substring match in full message
      else if (msgLower.includes(kwLower)) {
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

    if (matched) {
      candidates.push({ ...skill, _score: score });
    }
  }

  // Sort by score descending
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
  const matched = budgeted.slice(0, maxResults);

  // Detect multi-methodology
  const methodologies = new Set(matched.map(s => s.methodology));
  const multiMethodology = methodologies.size > 1;

  return { matched, multiMethodology };
}

module.exports = { route };
