const crypto = require('crypto');

const config = require('../config');

function _normalizeKeyBytes(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;

  // base64 (preferred)
  try {
    const b = Buffer.from(s, 'base64');
    if (b.length === 32) return b;
  } catch {
    // ignore
  }

  // hex
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    return Buffer.from(s, 'hex');
  }

  // fallback: derive from passphrase
  return crypto.createHash('sha256').update(s).digest();
}

function _getSecretsKey() {
  const raw = config?.limbopet?.secretsKey;
  const key = _normalizeKeyBytes(raw);
  if (key) return key;

  // Dev fallback (keeps local dev simple; production must set LIMBOPET_SECRETS_KEY)
  const fallback = String(config?.jwtSecret || 'development-secret-change-in-production');
  return crypto.createHash('sha256').update(fallback).digest();
}

function encryptSecret(plaintext) {
  const key = _getSecretsKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext || ''), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptSecret(ciphertextB64) {
  const key = _getSecretsKey();
  const buf = Buffer.from(String(ciphertextB64 || ''), 'base64');
  if (buf.length < 12 + 16 + 1) throw new Error('Invalid ciphertext');

  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

module.exports = {
  encryptSecret,
  decryptSecret
};

