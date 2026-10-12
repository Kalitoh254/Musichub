'use strict';

const crypto = require('node:crypto');

const TILL = '3480558';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getConfig() {
  const environment = required('MPESA_ENVIRONMENT');
  if (!['sandbox', 'production'].includes(environment)) {
    throw new Error('MPESA_ENVIRONMENT must be sandbox or production.');
  }

  const shortcode = required('MPESA_SHORTCODE');
  const passkey = required('MPESA_PASSKEY');

  return {
    environment,
    shortcode,
    passkey,
    consumerKey: required('MPESA_CONSUMER_KEY'),
    consumerSecret: required('MPESA_CONSUMER_SECRET'),
    callbackUrl: required('MPESA_CALLBACK_URL'),
    baseUrl: environment === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke'
  };
}

function timestamp() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0')
  ].join('');
}

function stkPassword(shortcode, passkey, time) {
  return Buffer.from(`${shortcode}${passkey}${time}`).toString('base64');
}

async function getAccessToken(config) {
  const credentials = Buffer.from(
    `${config.consumerKey}:${config.consumerSecret}`
  ).toString('base64');

  const response = await fetch(
    `${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: { Authorization: `Basic ${credentials}` },
      signal: AbortSignal.timeout(15000)
    }
  );

  const body = await response.json();
  if (!response.ok || !body.access_token) {
    throw new Error('Daraja access-token request failed.');
  }

  return body.access_token;
}

async function initiateStkPush({ phoneNumber, amountKes, merchantReference }) {
  const config = getConfig();

  if (config.shortcode !== TILL) {
    throw new Error(`MPESA_SHORTCODE must match configured Till ${TILL}.`);
  }

  if (!Number.isSafeInteger(amountKes) || amountKes < 1) {
    throw new Error('STK Push amount must be a positive whole number of KES.');
  }

  if (!/^254[17]\d{8}$/.test(phoneNumber)) {
    throw new Error('Invalid normalized Kenyan phone number.');
  }

  const time = timestamp();
  const token = await getAccessToken(config);

  const response = await fetch(
    `${config.baseUrl}/mpesa/stkpush/v1/processrequest`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        BusinessShortCode: config.shortcode,
        Password: stkPassword(config.shortcode, config.passkey, time),
        Timestamp: time,
        TransactionType: 'CustomerPayBillOnline',
        Amount: amountKes,
        PartyA: phoneNumber,
        PartyB: config.shortcode,
        PhoneNumber: phoneNumber,
        CallBackURL: config.callbackUrl,
        AccountReference: merchantReference.slice(0, 12),
        TransactionDesc: 'MusicHub purchase'
      }),
      signal: AbortSignal.timeout(20000)
    }
  );

  const body = await response.json();

  if (!response.ok || body.ResponseCode !== '0' ||
      !body.CheckoutRequestID || !body.MerchantRequestID) {
    throw new Error('Daraja did not accept the STK Push request.');
  }

  return {
    checkoutRequestId: body.CheckoutRequestID,
    merchantRequestId: body.MerchantRequestID,
    customerMessage: 'Check your phone to complete payment.'
  };
}

/*
 * This verifies the callback envelope's shape only.
 * It does NOT authenticate Safaricom's origin.
 * Deploy behind a properly secured callback ingress and reconcile each
 * successful callback against Daraja transaction data before fulfilment.
 */
async function queryStkPushStatus({ checkoutRequestId }) {
  if (typeof checkoutRequestId !== 'string' ||
      !/^ws_CO_[A-Za-z0-9_-]+$/.test(checkoutRequestId)) {
    throw new Error('Invalid STK checkout request ID.');
  }

  const config = getConfig();
  if (config.shortcode !== TILL) {
    throw new Error('Configured Till does not match MusicHub.');
  }

  const time = timestamp();
  const token = await getAccessToken(config);

  const response = await fetch(
    `${config.baseUrl}/mpesa/stkpushquery/v1/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        BusinessShortCode: config.shortcode,
        Password: stkPassword(config.shortcode, config.passkey, time),
        Timestamp: time,
        CheckoutRequestID: checkoutRequestId
      }),
      signal: AbortSignal.timeout(20000)
    }
  );

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('Daraja returned an invalid STK query response.');
  }

  if (!response.ok || body.ResponseCode !== '0') {
    throw new Error('Daraja STK query was not accepted.');
  }

  return {
    responseCode: String(body.ResponseCode),
    resultCode: body.ResultCode == null ? null : String(body.ResultCode),
    resultDescription: String(body.ResultDesc || '').slice(0, 200)
  };
}

function parseCallback(payload) {
  const callback = payload?.Body?.stkCallback;
  if (!callback ||
      typeof callback.CheckoutRequestID !== 'string' ||
      !Number.isInteger(Number(callback.ResultCode))) {
    throw new Error('Malformed Daraja callback.');
  }

  const result = {
    checkoutRequestId: callback.CheckoutRequestID,
    merchantRequestId: callback.MerchantRequestID || null,
    resultCode: Number(callback.ResultCode),
    resultDescription: String(callback.ResultDesc || '').slice(0, 200),
    amountKes: null,
    mpesaReceiptNumber: null,
    phoneNumber: null,
    transactionDate: null
  };

  if (result.resultCode === 0) {
    const items = callback.CallbackMetadata?.Item;
    if (!Array.isArray(items)) throw new Error('Successful callback lacks metadata.');

    const values = Object.create(null);
    for (const item of items) {
      if (item && typeof item.Name === 'string') {
        values[item.Name] = item.Value;
      }
    }

    if (!Number.isFinite(Number(values.Amount)) ||
        typeof values.MpesaReceiptNumber !== 'string' ||
        !/^[A-Z0-9]{8,20}$/.test(values.MpesaReceiptNumber)) {
      throw new Error('Successful callback has invalid payment metadata.');
    }

    result.amountKes = Number(values.Amount);
    result.mpesaReceiptNumber = values.MpesaReceiptNumber;
    result.phoneNumber = String(values.PhoneNumber || '');
    result.transactionDate = String(values.TransactionDate || '');
  }

  return result;
}

function hashCallback(payload) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

module.exports = {
  queryStkPushStatus,
  getConfig,
  initiateStkPush,
  parseCallback,
  hashCallback,
  TILL
};
