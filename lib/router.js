// lib/router.js — Keyword-based skill router

'use strict';

const { Minimatch } = require('minimatch');

/**
 * Route a user message to relevant skills.
 *
 * @param {string} message - User's message
 * @param {string[]} openFiles - Currently open file paths
 * @param {object} registry - Parsed + normalized skills-registry.json
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

  // Cap message length to prevent DoS
  const msgRaw = message.length > 5000 ? message.substring(0, 5000) : message;
  const msgLower = msgRaw.toLowerCase();
  const msgWords = new Set(msgLower.split(/\s+/));

  // Compile minimatch patterns (cached on registry object)
  const compiledPatterns = registry._compiledPatterns || compilePatterns(registry);

  const candidates = [];

  for (const skill of registry.skills) {
    let score = 0;
    let matched = false;

    // Language filter
    const langs = skill.triggers?.languages || ['any'];
    if (language && !langs.includes('any') && !langs.includes(language)) {
      continue;
    }

    // Keyword matching — use precomputed lowercase keywords
    const keywordsLower = skill._keywordsLower || (skill.triggers?.keywords || []).map(kw => kw.toLowerCase());
    for (const kwLower of keywordsLower) {
      // Multi-word keyword: substring match with word-boundary bonus
      if (kwLower.includes(' ')) {
        if (msgLower.includes(kwLower)) {
          score += 5;
          matched = true;
          // Bonus if the multi-word keyword starts/ends on word boundaries
          const idx = msgLower.indexOf(kwLower);
          const startOk = idx === 0 || /\s/.test(msgRaw[idx - 1]);
          const endOk = idx + kwLower.length === msgLower.length || /\s/.test(msgRaw[idx + kwLower.length]);
          if (startOk && endOk) score += 5;
        }
      } else {
        // Single-word keyword: exact word match first, substring fallback
        if (msgWords.has(kwLower)) {
          score += 10;
          matched = true;
        } else if (msgLower.includes(kwLower)) {
          score += 5;
          matched = true;
        }
      }
    }

    // File pattern matching (compiled minimatch)
    const patterns = skill.triggers?.file_patterns || [];
    for (const pattern of patterns) {
      const mm = compiledPatterns.get(pattern);
      if (!mm) continue;
      for (const file of openFiles) {
        if (mm.match(file)) {
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

  const finalMatched = budgeted.slice(0, maxResults);

  const methodologies = new Set(finalMatched.map(s => s.methodology));
  const multiMethodology = methodologies.size > 1;

  return { matched: finalMatched, multiMethodology };
}

function compilePatterns(registry) {
  const cache = new Map();
  for (const skill of registry.skills) {
    const patterns = skill.triggers?.file_patterns || [];
    for (const p of patterns) {
      if (!cache.has(p)) {
        try {
          cache.set(p, new Minimatch(p, { nocase: true }));
        } catch {
          // Invalid pattern — skip
        }
      }
    }
  }
  registry._compiledPatterns = cache;
  return cache;
}

module.exports = { route };
