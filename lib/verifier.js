/*
 * Evinor delivery verifier.
 *
 * Vendored from evinor-ai/n8n-nodes-evinor, nodes/EvinorTrigger/verifier.ts at
 * c45220b65d4f063082dd38badb39a93213f79565 (https://github.com/evinor-ai/n8n-nodes-evinor).
 * Copyright (c) 2026 Evinor. MIT License.
 *
 * Changes from the original:
 * - Ported from TypeScript to CommonJS JavaScript.
 * - Step 2 (`header-mismatch`): an ABSENT signature header is not a failure.
 *   The header is only a consistency check (the MAC covers the body's
 *   `sender.signature`), and Zapier does not guarantee that every header is
 *   forwarded on every delivery. A header that is present but differs still
 *   fails. See the zapier-integration design, Decision 4.
 */
'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');

const SIGNATURE_FORMAT = /^[A-Za-z0-9+/]{43}=$/;
const TIMESTAMP_FORMAT =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Why a delivery was rejected, in check order:
 * 'missing-field' | 'header-mismatch' | 'malformed-signature' |
 * 'key-id-mismatch' | 'bad-mac' | 'bad-timestamp'.
 */

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

/**
 * RFC 8785 (JCS) serialization of a parsed JSON value.
 *
 * Numbers and strings use `JSON.stringify`, which is what the RFC specifies and
 * what Evinor's signer does. Keys sort by UTF-16 code unit (the default `sort`),
 * and `Object.keys` keeps an own `__proto__` key produced by `JSON.parse`.
 */
function canonicalizeJcs(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('JCS cannot represent a non-finite number');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((element) => canonicalizeJcs(element)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const members = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJcs(value[key])}`);
    return `{${members.join(',')}}`;
  }
  throw new TypeError('JCS input is not JSON data');
}

/** The UTF-8 bytes Evinor signs: the envelope minus `sender.signature` only. */
function signedBytes(envelope) {
  const copy = structuredClone(envelope);
  delete copy.sender.signature;
  return Buffer.from(canonicalizeJcs(copy), 'utf8');
}

function isTimestampFresh(timestamp, nowMs) {
  const match = TIMESTAMP_FORMAT.exec(timestamp);
  if (match === null) {
    return false;
  }
  const [, year, month, day] = match;
  // V8 rolls an impossible day such as Feb 31 forward instead of rejecting it.
  const lastDayOfMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(day) < 1 || Number(day) > lastDayOfMonth) {
    return false;
  }
  const parsedMs = Date.parse(timestamp);
  return !Number.isNaN(parsedMs) && Math.abs(nowMs - parsedMs) <= MAX_CLOCK_SKEW_MS;
}

/**
 * Applies the ordered checks and names the first one that fails, or returns
 * `null` for an authentic delivery. `signatureHeader` is `undefined` when the
 * request carried no signature header. Can throw on hostile input (for
 * example very deep nesting); callers outside tests use `isAuthenticDelivery`.
 */
function findRejectionReason({ body, signatureHeader, secret, keyId, nowMs }) {
  // 1. The secret and fields are present, and the body and sender are plain objects.
  if (
    typeof secret !== 'string' ||
    secret.trim().length === 0 ||
    !isPlainObject(body) ||
    !isPlainObject(body.sender)
  ) {
    return 'missing-field';
  }
  const { keyId: senderKeyId, signature } = body.sender;
  const { timestamp } = body;
  if (
    typeof senderKeyId !== 'string' ||
    typeof signature !== 'string' ||
    typeof timestamp !== 'string'
  ) {
    return 'missing-field';
  }

  // 2. A present header must equal the body's signature; an absent one is skipped.
  if (signatureHeader !== undefined && signatureHeader !== signature) {
    return 'header-mismatch';
  }

  // 3. Strict base64. Buffer.from(x, 'base64') silently drops invalid
  // characters, so the format is enforced before decoding.
  if (!SIGNATURE_FORMAT.test(signature)) {
    return 'malformed-signature';
  }
  // The final character carries unused bits, so several spellings decode alike.
  if (Buffer.from(signature, 'base64').toString('base64') !== signature) {
    return 'malformed-signature';
  }

  // 4. The key id it was issued, checked before the MAC.
  if (senderKeyId !== keyId) {
    return 'key-id-mismatch';
  }

  // 5. Constant-time HMAC over the JCS form, rebuilt from the parsed body.
  const expected = createHmac('sha256', secret).update(signedBytes(body)).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'base64'))) {
    return 'bad-mac';
  }

  // 6. Strict ISO-8601 and within ±5 minutes.
  return isTimestampFresh(timestamp, nowMs) ? null : 'bad-timestamp';
}

/** Like findRejectionReason, but never throws: a throw becomes 'unverifiable'. */
function safeRejectionReason(delivery) {
  try {
    return findRejectionReason(delivery);
  } catch {
    return 'unverifiable';
  }
}

/** True only for an authentic, fresh delivery. Never throws. */
function isAuthenticDelivery(delivery) {
  return safeRejectionReason(delivery) === null;
}

module.exports = {
  canonicalizeJcs,
  signedBytes,
  findRejectionReason,
  safeRejectionReason,
  isAuthenticDelivery,
};
