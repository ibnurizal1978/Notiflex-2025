const crypto = require('crypto');

const SECRET = process.env.ID_ENCRYPT_SECRET || 'notiflex_secret';

function encryptId(id) {
  // Simple: id + secret, then base64url
  const str = `${id}:${SECRET}`;
  return Buffer.from(str).toString('base64url');
}

function decryptId(enc) {
  try {
    const decoded = Buffer.from(enc, 'base64url').toString('utf8');
    const [id, secret] = decoded.split(':');
    if (secret !== SECRET) return null;
    return id;
  } catch (e) {
    return null;
  }
}

module.exports = { encryptId, decryptId }; 