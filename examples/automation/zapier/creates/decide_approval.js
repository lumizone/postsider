'use strict';

const crypto = require('crypto');
const { idempotencyKey } = require('../lib/map');

// Required scope: approvals:decide (never granted by default).
// The server decides who may approve: a key cannot decide a post it created
// or requested, and the stage must allow automation.
const perform = async (z, bundle) => {
  const { approvalId, decision } = bundle.inputData;
  const note = bundle.inputData.note ? String(bundle.inputData.note).slice(0, 500) : undefined;
  if (decision !== 'approve' && decision !== 'reject') {
    throw new z.errors.Error('Decision must be approve or reject.', 'InvalidDecision', 400);
  }
  const zapId =
    bundle.meta && bundle.meta.zap && bundle.meta.zap.id ? bundle.meta.zap.id : undefined;
  // Read the approval to bind the key and expectStage to its current stage and
  // round. If the read fails, use a random per-call key (never a stale one) and
  // send no expectStage.
  let stagePosition;
  let requestedAt;
  try {
    const current = await z.request({
      method: 'GET',
      url: `/public/v1/approvals/${encodeURIComponent(approvalId)}`,
      skipThrowForStatus: true,
    });
    const item = current && current.status === 200 ? current.data : null;
    const position = item && item.stage ? item.stage.position : undefined;
    if (Number.isInteger(position) && position >= 1 && item && typeof item.requestedAt === 'string') {
      stagePosition = position;
      requestedAt = item.requestedAt;
    }
  } catch (e) {
    // fall through to the nonce key
  }
  const bound = stagePosition !== undefined;
  const key = bound
    ? idempotencyKey(zapId, approvalId, decision, note, stagePosition, requestedAt)
    : `zapier:${zapId || 'nozap'}:nonce-${crypto.randomBytes(16).toString('hex')}`;
  const body = {};
  if (note) body.note = note;
  if (bound) body.expectStage = stagePosition;
  const response = await z.request({
    method: 'POST',
    url: `/public/v1/approvals/${encodeURIComponent(approvalId)}/${decision}`,
    headers: { 'Idempotency-Key': key },
    body,
    skipThrowForStatus: true,
  });
  if (response.status === 409 && response.data && response.data.error === 'stage_changed') {
    throw new z.errors.Error(
      'This approval has already moved to another stage. Check it before deciding again.',
      'stage_changed',
      409
    );
  }
  if (response.status === 409) {
    throw new z.errors.Error(
      'This approval was already decided the other way.',
      'approval_already_resolved',
      409
    );
  }
  response.throwForStatus();
  return response.data;
};

module.exports = {
  key: 'decide_approval',
  noun: 'Approval',
  display: {
    label: 'Approve or Reject',
    description: 'Approves or rejects a pending approval. Needs an API key with the approvals:decide scope.',
  },
  operation: {
    inputFields: [
      { key: 'approvalId', label: 'Approval ID', type: 'string', required: true },
      {
        key: 'decision',
        label: 'Decision',
        required: true,
        choices: { approve: 'Approve', reject: 'Reject' },
      },
      { key: 'note', label: 'Note', type: 'text', required: false, helpText: 'Up to 500 characters.' },
    ],
    perform,
    sample: {
      approvalId: 'approval_example',
      postId: 'post_example',
      status: 'APPROVED',
      changed: true,
      stage: { position: 1, total: 1 },
      final: true,
    },
  },
};
