// lib/methodology.js — Complexity detection and methodology selection

'use strict';

const COMPLEXITY_KEYWORDS = {
  architecture: ['architecture', 'design the', 'redesign', 'restructure'],
  schema: ['schema', 'migration', 'database change', 'model change'],
  production: ['production', 'prod', 'deploy to prod', 'go live', 'launch'],
  ambiguous: ["not sure", "i'm not sure", "not certain", "unclear", "help me decide"],
  crossCutting: ['cross-cutting', 'cross cutting', 'multiple modules', 'end-to-end', 'full stack'],
  refactoring: ['refactor', 'rewrite', 'restructure', 'overhaul'],
};

function detectComplexity(input) {
  if (!input) return { level: 'simple', signals: 0, reasons: [] };

  const { message = '', multiMethodology = false, fileCount = 1 } = input;
  let signals = 0;
  const reasons = [];

  // Signal 1: multi-methodology match
  if (multiMethodology) {
    signals++;
    reasons.push('multi-methodology match');
  }

  // Signal 2: large scope (>=4 files)
  if (fileCount >= 4) {
    signals++;
    reasons.push(`scope: ${fileCount} files`);
  }

  // Signal 3-7: keyword-based signals
  const msgLower = message.toLowerCase();
  for (const [category, keywords] of Object.entries(COMPLEXITY_KEYWORDS)) {
    if (keywords.some(kw => msgLower.includes(kw))) {
      signals++;
      reasons.push(category);
    }
  }

  const level = signals >= 3 ? 'high' : signals >= 1 ? 'medium' : 'simple';
  return { level, signals, reasons };
}

function formatChoice(complexity) {
  if (!complexity || complexity.level === 'simple') return null;

  const reasons = complexity.reasons || [];
  const lines = [
    `Сложная задача обнаружена (${complexity.signals} сигналов${reasons.length ? ': ' + reasons.join(', ') : ''}).\n`,
    '1. Gate-based — spec → plan → build → test → verify',
    '2. Role-based — CEO → Design → Eng → QA → Ship',
  ];

  if (complexity.level === 'high') {
    lines.push('3. Параллельно — оба метода, сравнение результатов');
  }

  lines.push('\nВыберите: 1 / 2' + (complexity.level === 'high' ? ' / 3' : ''));

  return lines.join('\n');
}

module.exports = { detectComplexity, formatChoice };
