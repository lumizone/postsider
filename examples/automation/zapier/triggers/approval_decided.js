'use strict';

const { mapEnvelope, mapApprovalItem, extractItems } = require('../lib/map');

// REST hook. Required scopes: webhooks:write (subscribe), approvals:read (sample data).
const performSubscribe = async (z, bundle) => {
  const response = await z.request({
    method: 'POST',
    url: '/public/v1/webhook-subscriptions',
    body: {
      name: 'Zapier: approval decided',
      url: bundle.targetUrl,
      events: ['approval.resolved'],
    },
  });
  // Keep the whole subscription (id) so unsubscribe can delete it. The
  // `secret` is intentionally not used: Zapier hook URLs are unguessable,
  // see README for how to verify signatures if you add a catch step.
  return { id: response.data.id };
};

const performUnsubscribe = async (z, bundle) => {
  await z.request({
    method: 'DELETE',
    url: `/public/v1/webhook-subscriptions/${encodeURIComponent(
      bundle.subscribeData.id
    )}`,
  });
  return {};
};

const perform = async (z, bundle) => [mapEnvelope(bundle.cleanedRequest)];

const performList = async (z) => {
  const out = [];
  for (const status of ['APPROVED', 'REJECTED']) {
    const response = await z.request({
      method: 'GET',
      url: '/public/v1/approvals',
      params: { status, limit: 3 },
    });
    for (const a of extractItems(response.data)) {
      out.push(mapApprovalItem(a, 'approval.resolved'));
    }
  }
  return out.slice(0, 3);
};

module.exports = {
  key: 'approval_decided',
  noun: 'Approval',
  display: {
    label: 'Approval Decided',
    description: 'Triggers when an approval becomes final in PostSider (approved after the last stage, or rejected at any stage).',
  },
  operation: {
    type: 'hook',
    performSubscribe,
    performUnsubscribe,
    perform,
    performList,
    sample: {
      id: 'evt_example',
      event: 'approval.resolved',
      eventId: 'evt_example',
      approvalId: 'approval_example',
      postId: 'post_example',
      status: 'APPROVED',
      note: null,
      stagePosition: 2,
      stageTotal: 2,
      decidedByType: 'USER',
    },
    outputFields: [
      { key: 'eventId', label: 'Event ID' },
      { key: 'event', label: 'Event' },
      { key: 'approvalId', label: 'Approval ID' },
      { key: 'postId', label: 'Post ID' },
      { key: 'status', label: 'Status' },
      { key: 'note', label: 'Note' },
      { key: 'stagePosition', label: 'Stage position', type: 'integer' },
      { key: 'stageTotal', label: 'Stage total', type: 'integer' },
      { key: 'decidedByType', label: 'Decided by type' },
    ],
  },
};
