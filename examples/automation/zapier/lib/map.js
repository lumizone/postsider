'use strict';

const crypto = require('node:crypto');

const MAX_SKEW_SECONDS = 300;

function pick(value, fallback) {
  return value === undefined || value === null ? fallback : value;
}

/**
 * Flatten a PostSider webhook envelope into Zapier friendly keys.
 * Envelope: { id, event, createdAt, organizationId, data }.
 * `id` is kept as Zapier's dedupe key and equals `eventId`.
 */
function mapEnvelope(envelope) {
  const env = envelope && typeof envelope === 'object' ? envelope : {};
  const data = env.data && typeof env.data === 'object' ? env.data : {};
  const approval =
    data.approval && typeof data.approval === 'object' ? data.approval : {};
  const stage =
    approval.stage && typeof approval.stage === 'object' ? approval.stage : null;
  const decidedBy =
    approval.decidedBy && typeof approval.decidedBy === 'object'
      ? approval.decidedBy
      : null;
  return {
    id: pick(env.id, null),
    event: pick(env.event, null),
    eventId: pick(env.id, null),
    approvalId: pick(data.approvalId, null),
    postId: pick(data.postId, null),
    status: pick(data.status, null),
    note: pick(data.note, null),
    stagePosition: stage ? pick(stage.position, null) : null,
    stageTotal: stage ? pick(stage.total, null) : null,
    decidedByType: decidedBy ? pick(decidedBy.type, null) : null,
  };
}

/**
 * Verify X-Postsider-Signature: `sha256=<hex>` HMAC-SHA256 over
 * `<timestamp>.<rawBody>` with the subscription secret. Constant time
 * compare; rejects a timestamp more than 300 seconds from `nowMs`.
 */
function verifySignature(rawBody, timestamp, signature, secret, nowMs) {
  if (
    typeof rawBody !== 'string' ||
    typeof timestamp !== 'string' ||
    typeof signature !== 'string' ||
    typeof secret !== 'string' ||
    !secret ||
    !/^\d{1,12}$/.test(timestamp)
  ) {
    return false;
  }
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) {
    return false;
  }
  const expected =
    'sha256=' +
    crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Pull the array out of a list response (bare array or a wrapper object). */
function extractItems(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['approvals', 'items', 'data', 'results']) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  return [];
}

/** Map one GET /approvals item to the same flat shape as mapEnvelope (sample data). */
function mapApprovalItem(item, event) {
  const a = item && typeof item === 'object' ? item : {};
  const stage = a.stage && typeof a.stage === 'object' ? a.stage : null;
  const decidedBy =
    a.decidedBy && typeof a.decidedBy === 'object' ? a.decidedBy : null;
  const id = `sample-${pick(a.id, 'approval')}`;
  return {
    id,
    event,
    eventId: id,
    approvalId: pick(a.id, null),
    postId: pick(a.postId, null),
    status: pick(a.status, null),
    note: pick(a.note, null),
    stagePosition: stage ? pick(stage.position, null) : null,
    stageTotal: stage ? pick(stage.total, null) : null,
    decidedByType: decidedBy ? pick(decidedBy.type, null) : null,
  };
}

/**
 * Idempotency-Key for a decision: stable for the same zap, approval, decision
 * and note, so a Zapier replay of the same step cannot decide twice.
 */
function idempotencyKey(zapId, approvalId, decision, note) {
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify([String(approvalId), String(decision), note || '']))
    .digest('hex')
    .slice(0, 32);
  return `zapier:${zapId || 'nozap'}:${hash}`;
}

module.exports = {
  idempotencyKey,
  mapEnvelope,
  mapApprovalItem,
  extractItems,
  verifySignature,
  MAX_SKEW_SECONDS,
};
