'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const result = await req.app.locals.pool.query(
      `SELECT id, email, phone, display_name, status, created_at
         FROM users
        WHERE auth_subject = $1
        LIMIT 1`,
      [req.auth.subject]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'Account profile not initialized.',
        code: 'PROFILE_NOT_INITIALIZED'
      });
    }

    const user = result.rows[0];
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active.' });
    }

    return res.json({ data: user });
  } catch (error) {
    return next(error);
  }
});

router.post('/me/profile', requireAuth, async (req, res, next) => {
  try {
    const displayName = typeof req.body.displayName === 'string'
      ? req.body.displayName.trim().slice(0, 80)
      : null;
    const phone = typeof req.body.phone === 'string'
      ? req.body.phone.trim()
      : null;

    if (phone && !/^(?:\+?254|0)[17]\d{8}$/.test(phone)) {
      return res.status(400).json({ error: 'Invalid Kenyan phone number.' });
    }

    const result = await req.app.locals.pool.query(
      `INSERT INTO users (auth_subject, email, phone, display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (auth_subject) WHERE auth_subject IS NOT NULL
       DO UPDATE SET
         email = COALESCE(EXCLUDED.email, users.email),
         phone = COALESCE(EXCLUDED.phone, users.phone),
         display_name = COALESCE(EXCLUDED.display_name, users.display_name),
         updated_at = NOW()
       RETURNING id, email, phone, display_name, status, created_at`,
      [req.auth.subject, req.auth.email, phone, displayName]
    );

    if (result.rows[0].status !== 'active') {
      return res.status(403).json({ error: 'Account is not active.' });
    }

    return res.status(200).json({ data: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'That email or phone number is already associated with another account.'
      });
    }
    return next(error);
  }
});

module.exports = router;
