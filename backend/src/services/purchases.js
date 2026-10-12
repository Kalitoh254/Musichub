'use strict';

const { randomUUID } = require('node:crypto');

function moneyToCents(value) {
  const match = String(value).match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error('Invalid monetary amount.');
  return Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0') || 0);
}

function normalizeKenyanPhone(value) {
  const digits = String(value || '').replace(/[\s()+-]/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  throw new Error('Enter a valid Kenyan mobile number.');
}

async function createPendingPurchase(pool, {
  userId,
  songId,
  phoneNumber,
  requestKey
}) {
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) < 1) {
    throw new Error('A valid authenticated user is required.');
  }
  if (!Number.isSafeInteger(Number(songId)) || Number(songId) < 1) {
    throw new Error('A valid song is required.');
  }
  if (typeof requestKey !== 'string' ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(requestKey)) {
    throw new Error('A valid idempotency request key is required.');
  }

  const phone = normalizeKenyanPhone(phoneNumber);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT p.id, p.song_id, p.amount_kes, p.status,
              pt.merchant_reference, pt.status AS payment_status
         FROM purchases p
         JOIN payment_transactions pt ON pt.purchase_id = p.id
        WHERE p.user_id = $1 AND p.request_key = $2
        LIMIT 1`,
      [Number(userId), requestKey]
    );

    if (existing.rowCount) {
      const row = existing.rows[0];
      if (String(row.song_id) !== String(songId)) {
        throw new Error('Request key was already used for another song.');
      }
      await client.query('COMMIT');
      return { ...row, reused: true };
    }

    const user = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND status = 'active'
        FOR SHARE`,
      [Number(userId)]
    );
    if (!user.rowCount) throw new Error('Active account not found.');

    const songResult = await client.query(
      `SELECT id, title, download_price_kes
         FROM songs
        WHERE id = $1 AND is_published = TRUE
        FOR SHARE`,
      [Number(songId)]
    );
    if (!songResult.rowCount) throw new Error('Published song not found.');

    const song = songResult.rows[0];
    const amountCents = moneyToCents(song.download_price_kes);
    if (amountCents < 1) throw new Error('Song price must be positive.');

    const purchaseResult = await client.query(
      `INSERT INTO purchases
         (user_id, song_id, amount_kes, currency, status, request_key)
       VALUES ($1, $2, $3, 'KES', 'pending', $4)
       RETURNING id, user_id, song_id, amount_kes, currency, status, created_at`,
      [Number(userId), Number(songId), (amountCents / 100).toFixed(2), requestKey]
    );

    const purchase = purchaseResult.rows[0];
    const merchantReference = `MH-${randomUUID()}`;

    await client.query(
      `INSERT INTO payment_transactions
         (purchase_id, merchant_reference, phone_number, amount_kes, status)
       VALUES ($1, $2, $3, $4, 'initiated')`,
      [purchase.id, merchantReference, phone, (amountCents / 100).toFixed(2)]
    );

    await client.query('COMMIT');
    return {
      ...purchase,
      merchant_reference: merchantReference,
      title: song.title,
      reused: false
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/*
 * Call ONLY after a trusted server-side Daraja callback has been validated
 * against the expected merchant reference, amount, and provider transaction.
 * Never call this directly from a browser request.
 */
async function fulfillVerifiedPayment(pool, {
  merchantReference,
  providerReference,
  amountKes,
  resultCode
}) {
  if (typeof merchantReference !== 'string' ||
      typeof providerReference !== 'string' ||
      !providerReference.trim()) {
    throw new Error('Verified provider references are required.');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `SELECT pt.id AS transaction_id, pt.purchase_id,
              pt.provider_reference, pt.status AS payment_status,
              pt.amount_kes AS payment_amount, p.user_id, p.song_id,
              p.amount_kes AS purchase_amount, p.status AS purchase_status
         FROM payment_transactions pt
         JOIN purchases p ON p.id = pt.purchase_id
        WHERE pt.merchant_reference = $1
        FOR UPDATE OF pt, p`,
      [merchantReference]
    );

    if (!result.rowCount) throw new Error('Payment transaction not found.');
    const row = result.rows[0];

    if (
      moneyToCents(row.payment_amount) !== moneyToCents(amountKes) ||
      moneyToCents(row.purchase_amount) !== moneyToCents(amountKes)
    ) {
      throw new Error('Payment amount mismatch; fulfilment refused.');
    }

    if (String(resultCode) !== '0') {
      if (row.purchase_status !== 'paid') {
        await client.query(
          `UPDATE payment_transactions
              SET status = 'failed', provider_result_code = $2,
                  processed_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND status <> 'successful'`,
          [row.transaction_id, String(resultCode).slice(0, 100)]
        );
        await client.query(
          `UPDATE purchases SET status = 'failed'
            WHERE id = $1 AND status = 'pending'`,
          [row.purchase_id]
        );
      }
      await client.query('COMMIT');
      return { fulfilled: false, reason: 'provider_payment_not_successful' };
    }

    if (row.payment_status === 'successful' && row.purchase_status === 'paid') {
      if (row.provider_reference !== providerReference) {
        throw new Error('Conflicting provider transaction reference.');
      }
      await client.query('COMMIT');
      return { fulfilled: true, duplicate: true, purchaseId: row.purchase_id };
    }

    if (row.purchase_status !== 'pending' ||
        !['initiated', 'pending'].includes(row.payment_status)) {
      throw new Error('Payment is not eligible for fulfilment.');
    }

    await client.query(
      `UPDATE payment_transactions
          SET status = 'successful', provider_reference = $2,
              provider_result_code = '0', verified_at = NOW(),
              processed_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [row.transaction_id, providerReference]
    );

    await client.query(
      `UPDATE purchases SET status = 'paid', paid_at = NOW()
        WHERE id = $1 AND status = 'pending'`,
      [row.purchase_id]
    );

    await client.query(
      `INSERT INTO download_entitlements (purchase_id, user_id, song_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (purchase_id) DO NOTHING`,
      [row.purchase_id, row.user_id, row.song_id]
    );

    await client.query('COMMIT');
    return { fulfilled: true, duplicate: false, purchaseId: row.purchase_id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  createPendingPurchase,
  fulfillVerifiedPayment,
  normalizeKenyanPhone
};
