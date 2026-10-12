'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fulfillVerifiedPayment } = require('../src/services/purchases');

function mockPool(row, options = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      calls.push({ q, params });

      if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') {
        return { rowCount: 0, rows: [] };
      }
      if (q.startsWith('SELECT pt.id AS transaction_id')) {
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }
      if (q.startsWith('UPDATE payment_transactions') ||
          q.startsWith('UPDATE purchases') ||
          q.startsWith('INSERT INTO download_entitlements')) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error('Unexpected SQL in test: ' + q);
    },
    release() {}
  };

  return {
    calls,
    async connect() { return client; }
  };
}

const pending = {
  transaction_id: 'tx-1',
  purchase_id: 'purchase-1',
  provider_reference: null,
  payment_status: 'pending',
  payment_amount: '120.00',
  user_id: 'user-1',
  song_id: 7,
  purchase_amount: '120.00',
  purchase_status: 'pending'
};

test('successful verified payment grants an entitlement transactionally', async () => {
  const pool = mockPool(pending);
  const result = await fulfillVerifiedPayment(pool, {
    merchantReference: 'MH-PURCHASE-1',
    providerReference: 'QWE12345678',
    amountKes: 120,
    resultCode: 0
  });

  assert.equal(result.fulfilled, true);
  assert.equal(result.duplicate, false);
  assert.ok(pool.calls.some(c => c.q.startsWith('INSERT INTO download_entitlements')));
  assert.equal(pool.calls[0].q, 'BEGIN');
  assert.equal(pool.calls.at(-1).q, 'COMMIT');
});

test('amount mismatch refuses fulfilment and rolls back', async () => {
  const pool = mockPool(pending);
  await assert.rejects(
    fulfillVerifiedPayment(pool, {
      merchantReference: 'MH-PURCHASE-1',
      providerReference: 'QWE12345678',
      amountKes: 99,
      resultCode: 0
    }),
    /amount mismatch/i
  );
  assert.equal(pool.calls.at(-1).q, 'ROLLBACK');
  assert.ok(!pool.calls.some(c => c.q.startsWith('INSERT INTO download_entitlements')));
});

test('missing transaction refuses fulfilment', async () => {
  const pool = mockPool(null);
  await assert.rejects(
    fulfillVerifiedPayment(pool, {
      merchantReference: 'UNKNOWN',
      providerReference: 'QWE12345678',
      amountKes: 120,
      resultCode: 0
    }),
    /transaction not found/i
  );
  assert.equal(pool.calls.at(-1).q, 'ROLLBACK');
});
