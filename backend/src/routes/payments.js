'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createPendingPurchase, fulfillVerifiedPayment, normalizeKenyanPhone } = require('../services/purchases');
const { initiateStkPush, parseCallback, hashCallback } =
  require('../services/daraja');
const { queryStkPushStatus } = require('../services/daraja');

const router = express.Router();

router.post('/stk-push', requireAuth, async (req, res, next) => {
  const pool = req.app.locals.pool;

  try {
    const requestKey = req.get('idempotency-key');
    const songId = Number(req.body.songId);
    const phoneNumber = req.body.phoneNumber;

    if (!Number.isSafeInteger(songId) || songId < 1 ||
        typeof phoneNumber !== 'string') {
      return res.status(400).json({
        error: 'songId and phoneNumber are required.'
      });
    }

    const userResult = await pool.query(
      `SELECT id, status FROM users WHERE auth_subject = $1 LIMIT 1`,
      [req.auth.subject]
    );

    if (!userResult.rowCount || userResult.rows[0].status !== 'active') {
      return res.status(403).json({ error: 'Active MusicHub account required.' });
    }

    const purchase = await createPendingPurchase(pool, {
      userId: userResult.rows[0].id,
      songId,
      phoneNumber,
      requestKey
    });

    if (purchase.reused) {
      return res.status(409).json({
        error: 'This purchase request was already processed.',
        purchaseId: purchase.id,
        status: purchase.status
      });
    }

    const amountKes = Math.round(Number(purchase.amount_kes));
    if (amountKes < 1 || amountKes !== Number(purchase.amount_kes)) {
      return res.status(422).json({
        error: 'STK Push requires a whole-number KES amount.'
      });
    }

    const transaction = await pool.query(
      `SELECT id FROM payment_transactions
        WHERE merchant_reference = $1`,
      [purchase.merchant_reference]
    );

    const stk = await initiateStkPush({
      phoneNumber: require('../services/purchases')
        .normalizeKenyanPhone(phoneNumber),
      amountKes,
      merchantReference: purchase.merchant_reference
    });

    await pool.query(
      `UPDATE payment_transactions
          SET checkout_request_id = $2,
              status = 'pending', updated_at = NOW()
        WHERE id = $1 AND status = 'initiated'`,
      [transaction.rows[0].id, stk.checkoutRequestId]
    );

    return res.status(202).json({
      message: stk.customerMessage,
      purchaseId: purchase.id,
      status: 'pending'
    });
  } catch (error) {
    next(error);
  }
});


router.get('/purchases/:purchaseId', requireAuth, async (req, res, next) => {
  try {
    const purchaseId = req.params.purchaseId;

    if (!/^[1-9][0-9]{0,18}$/.test(purchaseId)) {
      return res.status(400).json({ error: 'Invalid purchase ID.' });
    }

    const result = await req.app.locals.pool.query(
      `SELECT
         p.id AS purchase_id,
         p.song_id,
         p.amount_kes,
         p.currency,
         p.status AS purchase_status,
         p.created_at,
         p.paid_at,
         pt.status AS payment_status,
         CASE
           WHEN de.status = 'active' THEN TRUE
           ELSE FALSE
         END AS download_available
       FROM purchases p
       JOIN users u ON u.id = p.user_id
       LEFT JOIN payment_transactions pt ON pt.purchase_id = p.id
       LEFT JOIN download_entitlements de ON de.purchase_id = p.id
       WHERE p.id = $1
         AND u.auth_subject = $2
       LIMIT 1`,
      [purchaseId, req.auth.subject]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: 'Purchase not found.' });
    }

    const purchase = result.rows[0];

    return res.status(200).json({
      data: {
        purchaseId: String(purchase.purchase_id),
        songId: String(purchase.song_id),
        amountKes: purchase.amount_kes,
        currency: purchase.currency,
        status: purchase.purchase_status,
        paymentStatus: purchase.payment_status,
        downloadAvailable: purchase.download_available,
        createdAt: purchase.created_at,
        paidAt: purchase.paid_at
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/daraja/callback', async (req, res) => {
  const pool = req.app.locals.pool;

  try {
    const callback = parseCallback(req.body);
    const payloadHash = hashCallback(req.body);

    const match = await pool.query(
      `SELECT id, purchase_id, merchant_reference, status,
              amount_kes, phone_number
         FROM payment_transactions
        WHERE checkout_request_id = $1
        LIMIT 1`,
      [callback.checkoutRequestId]
    );

    if (!match.rowCount) {
      console.error('Unmatched Daraja callback:', callback.checkoutRequestId);
      return res.status(200).json({ ResultCode: 0, ResultDesc: 'Received' });
    }

    const tx = match.rows[0];

    if (callback.resultCode === 0) {
      let phoneMatches = false;
      try {
        phoneMatches = normalizeKenyanPhone(callback.phoneNumber) ===
          normalizeKenyanPhone(tx.phone_number);
      } catch {}
      if (callback.amountKes !== Number(tx.amount_kes) ||
          !phoneMatches || !callback.mpesaReceiptNumber) {
        console.error('Daraja callback details do not match stored payment:', tx.id);
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'Received' });
      }
      const verification = await queryStkPushStatus({
        checkoutRequestId: callback.checkoutRequestId
      });
      if (verification.resultCode === '0') {
        const result = await fulfillVerifiedPayment(pool, {
          merchantReference: tx.merchant_reference,
          providerReference: callback.mpesaReceiptNumber,
          amountKes: callback.amountKes,
          resultCode: 0
        });
        console.info('Daraja payment reconciliation result:', result);
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'Received' });
      }
    }

    if (callback.resultCode === 0) {
      /*
       * Do not grant entitlements from an unauthenticated callback.
       * Reconcile the receipt, amount, and transaction with Safaricom's
       * trusted transaction-status/confirmation channel before fulfilment.
       */
      await pool.query(
        `UPDATE payment_transactions
            SET callback_payload_hash = $2, updated_at = NOW()
          WHERE id = $1`,
        [tx.id, payloadHash]
      );

      console.warn(
        'Successful STK callback received; awaiting trusted reconciliation:',
        tx.id
      );
    } else {
      await pool.query(
        `UPDATE payment_transactions
            SET provider_result_code = $2,
                callback_payload_hash = $3,
                updated_at = NOW()
          WHERE id = $1 AND status IN ('initiated', 'pending')`,
        [tx.id, String(callback.resultCode), payloadHash]
      );
    }

    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Received' });
  } catch (error) {
    console.error('Daraja callback rejected:', error.message);
    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Received' });
  }
});

module.exports = router;
