// lib/hash.js — SHA-256 helpers for vault idempotency and drift detection.

'use strict';

const crypto = require('crypto');

function sha256(content) {
  return 'sha256:' + crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

function hashFile(filePath) {
  const fs = require('fs');
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return sha256(content);
  } catch {
    return null;
  }
}

module.exports = { sha256, hashFile };
