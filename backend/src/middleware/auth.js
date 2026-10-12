'use strict';

const { createRemoteJWKSet, jwtVerify } = require('jose');

const baseUrl = process.env.NEON_AUTH_BASE_URL;
if (!baseUrl) {
  console.warn('NEON_AUTH_BASE_URL is not configured; authenticated routes will reject requests.');
}

const jwks = baseUrl
  ? createRemoteJWKSet(
      new URL(`${baseUrl.replace(/\/+$/, '')}/.well-known/jwks.json`)
    )
  : null;

async function requireAuth(req, res, next) {
  try {
    const header = req.get('authorization') || '';
    const match = header.match(/^Bearer ([^\s]+)$/i);

    if (!match || !jwks) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const options = {};
    if (process.env.NEON_AUTH_ISSUER) {
      options.issuer = process.env.NEON_AUTH_ISSUER;
    }

    const { payload } = await jwtVerify(match[1], jwks, options);

    const subject = payload.sub;
    if (typeof subject !== 'string' || !subject.trim()) {
      return res.status(401).json({ error: 'Invalid authentication token.' });
    }

    req.auth = {
      subject,
      email: typeof payload.email === 'string' ? payload.email : null
    };

    return next();
  } catch (_error) {
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
}

module.exports = { requireAuth };
