'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { mapEnvelope, verifySignature } = require('../lib/map');

const requested = {
  id: 'evt_1',
  event: 'approval.requested',
  createdAt: '2026-11-05T10:00:00.000Z',
  organizationId: 'org_1',
  data: {
    approvalId: 'appr_1',
    postId: 'post_1',
    status: 'PENDING',
    approval: {
      requestedBy: { type: 'API_KEY', apiKeyId: 'k1' },
      decidedBy: null,
      stage: { position: 1, total: 2, name: 'Reviewer' },
    },
  },
};

const resolved = {
  id: 'evt_2',
  event: 'approval.resolved',
  createdAt: '2026-11-05T11:00:00.000Z',
  organizationId: 'org_1',
  data: {
    approvalId: 'appr_1',
    postId: 'post_1',
    status: 'REJECTED',
    note: 'Needs a rewrite',
    approval: {
      requestedBy: { type: 'API_KEY', apiKeyId: 'k1' },
      decidedBy: { type: 'USER', userId: 'u1' },
      stage: { position: 2, total: 2, name: 'Owner' },
    },
  },
};

test('maps approval.requested to flat keys', () => {
  assert.deepEqual(mapEnvelope(requested), {
    id: 'evt_1',
    event: 'approval.requested',
    eventId: 'evt_1',
    approvalId: 'appr_1',
    postId: 'post_1',
    status: 'PENDING',
    note: null,
    stagePosition: 1,
    stageTotal: 2,
    decidedByType: null,
  });
});

test('maps approval.resolved with note, stage and decider type', () => {
  const out = mapEnvelope(resolved);
  assert.equal(out.event, 'approval.resolved');
  assert.equal(out.status, 'REJECTED');
  assert.equal(out.note, 'Needs a rewrite');
  assert.equal(out.stagePosition, 2);
  assert.equal(out.stageTotal, 2);
  assert.equal(out.decidedByType, 'USER');
});

test('missing approval.stage yields null stage fields', () => {
  const env = JSON.parse(JSON.stringify(requested));
  delete env.data.approval.stage;
  const out = mapEnvelope(env);
  assert.equal(out.stagePosition, null);
  assert.equal(out.stageTotal, null);
  const bare = mapEnvelope({ id: 'e', event: 'approval.requested', data: {} });
  assert.equal(bare.stagePosition, null);
  assert.equal(bare.decidedByType, null);
  assert.equal(bare.approvalId, null);
});

test('mapEnvelope does not leak the actor or organization', () => {
  const out = mapEnvelope(resolved);
  assert.equal('organizationId' in out, false);
  assert.equal('actor' in out, false);
  assert.equal(JSON.stringify(out).includes('apiKeyId'), false);
});

test('outputs contain no en or em dashes', () => {
  const text = JSON.stringify([mapEnvelope(requested), mapEnvelope(resolved)]);
  assert.equal(/[\u2013\u2014]/.test(text), false);
});

const secret = 'whsec_test_secret';
function sign(ts, body, key = secret) {
  return (
    'sha256=' +
    crypto.createHmac('sha256', key).update(`${ts}.${body}`).digest('hex')
  );
}

test('verifySignature accepts a valid signature', () => {
  const body = JSON.stringify(requested);
  const nowMs = 1_800_000_000_000;
  const ts = String(Math.floor(nowMs / 1000));
  assert.equal(verifySignature(body, ts, sign(ts, body), secret, nowMs), true);
});

test('verifySignature rejects a tampered body', () => {
  const body = JSON.stringify(requested);
  const nowMs = 1_800_000_000_000;
  const ts = String(Math.floor(nowMs / 1000));
  const sig = sign(ts, body);
  assert.equal(verifySignature(body + ' ', ts, sig, secret, nowMs), false);
});

test('verifySignature rejects a wrong secret', () => {
  const body = JSON.stringify(requested);
  const nowMs = 1_800_000_000_000;
  const ts = String(Math.floor(nowMs / 1000));
  assert.equal(
    verifySignature(body, ts, sign(ts, body, 'other'), secret, nowMs),
    false
  );
});

test('verifySignature rejects skew of 301 seconds, accepts 300', () => {
  const body = JSON.stringify(requested);
  const nowMs = 1_800_000_000_000;
  const old = String(Math.floor(nowMs / 1000) - 301);
  assert.equal(verifySignature(body, old, sign(old, body), secret, nowMs), false);
  const edge = String(Math.floor(nowMs / 1000) - 300);
  assert.equal(verifySignature(body, edge, sign(edge, body), secret, nowMs), true);
  const future = String(Math.floor(nowMs / 1000) + 301);
  assert.equal(
    verifySignature(body, future, sign(future, body), secret, nowMs),
    false
  );
});

test('verifySignature rejects malformed input without throwing', () => {
  const nowMs = 1_800_000_000_000;
  assert.equal(verifySignature('{}', 'abc', 'sha256=00', secret, nowMs), false);
  assert.equal(verifySignature('{}', '', '', secret, nowMs), false);
  assert.equal(verifySignature('{}', String(nowMs / 1000), undefined, secret, nowMs), false);
  assert.equal(verifySignature('{}', String(nowMs / 1000), 'sha256=zz', secret, nowMs), false);
  assert.equal(verifySignature('{}', String(nowMs / 1000), 'sha256=ab', '', nowMs), false);
});

const { idempotencyKey } = require('../lib/map');

test('idempotencyKey is stable per zap, approval, decision and note', () => {
  const a = idempotencyKey('zap1', 'appr_1', 'approve', 'ok');
  assert.equal(a, idempotencyKey('zap1', 'appr_1', 'approve', 'ok'));
  assert.notEqual(a, idempotencyKey('zap1', 'appr_1', 'reject', 'ok'));
  assert.notEqual(a, idempotencyKey('zap2', 'appr_1', 'approve', 'ok'));
  assert.notEqual(a, idempotencyKey('zap1', 'appr_1', 'approve', 'no'));
  assert.match(a, /^zapier:zap1:[0-9a-f]{32}$/);
  assert.match(idempotencyKey(undefined, 'a', 'approve'), /^zapier:nozap:/);
});
