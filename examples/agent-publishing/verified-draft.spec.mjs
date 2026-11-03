import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDraftRequest, assertDraftReceipt, runVerifiedDraft } from './verified-draft.mjs';

const date = '2026-11-15T14:00:00.000Z';
const text = 'Review this sample before scheduling.';
const ids = ['channel_123456', 'channel_abcdef'];
function req() { return buildDraftRequest({ channelIds: ids, date, content: text }); }

test('preview makes no network calls and cannot publish', async () => {
  const r = await runVerifiedDraft({ env: {}, fetchFn: () => { throw Error('network used'); } });
  assert.equal(r.mode, 'preview');
  assert.equal(r.request.type, 'draft');
  assert.equal(r.request.posts.length, 1);
  assert.equal(r.published, false);
});

test('typed API payload has required nested fields, not flat MCP tool parameters', () => {
  const x = req();
  assert.deepEqual(Object.keys(x.posts[0]), ['integration', 'value', 'settings']);
  assert.deepEqual(x.posts[0].value, [{ content: text, image: [] }]);
  assert.equal(x.type, 'draft');
  assert.equal(x.date, date);
  assert.equal(x.shortLink, false);
  assert.deepEqual(x.tags, []);
});

test('rejects duplicate channels, unsafe or ambiguous inputs', () => {
  assert.throws(() => buildDraftRequest({ channelIds: [ids[0], ids[0]], date, content: text }));
  assert.throws(() => buildDraftRequest({ channelIds: ids, date: 'tomorrow', content: text }));
  assert.throws(() => buildDraftRequest({ channelIds: ids, date, content: '' }));
  assert.throws(() => buildDraftRequest({ channelIds: Array(4).fill('channel_123456'), date, content: text }));
});

test('rejects missing key or nonpersistent idempotency before a write', async () => {
  const env = { POSTSIDER_CHANNEL_IDS: ids.join(','), POSTSIDER_REQUEST_DATE: date };
  await assert.rejects(() => runVerifiedDraft({ env, execute: true }), /API_KEY/);
});

test('creates one draft per selected channel and verifies state, content and owner', async () => {
  const calls = [];
  const env = {
    POSTSIDER_API_KEY: 'test_key_used_only_in_unit_tests',
    POSTSIDER_CHANNEL_IDS: ids.join(','),
    POSTSIDER_REQUEST_DATE: date,
    POSTSIDER_JOB_ID: 'demo-stable-key-00001',
    POSTSIDER_DRAFT_TEXT: text,
  };
  const receipt = ids.map((id,i) => ({ postId: 'post_number_' + i, integration: id }));
  const fetchFn = async (url, opts) => {
    calls.push({ url, opts });
    let data;
    if (url.endsWith('/integrations')) data = ids.map(id => ({ id, disabled: false }));
    else if (url.endsWith('/posts')) data = receipt;
    else {
      const i = Number(url.slice(-1));
      data = { integration: { id: ids[i] },
        posts: [{ id: receipt[i].postId, state: 'DRAFT', content: text }] };
    }
    return { ok: true, json: async () => data };
  };
  const result = await runVerifiedDraft({ env, fetchFn, execute: true });
  assert.equal(result.mode, 'verified-draft');
  assert.deepEqual(result.postIds, receipt.map(x => x.postId));
  assert.equal(result.published, false);
  assert.equal(calls.length, 4);
  assert.equal(calls[1].opts.method, 'POST');
  assert.equal(calls[1].opts.headers['Idempotency-Key'], env.POSTSIDER_JOB_ID);
  assert.equal(JSON.parse(calls[1].opts.body).type, 'draft');
});

test('readback rejects wrong post state, content, channel or receipt', () => {
  const x = req();
  const receipt = ids.map((id,i) => ({ postId: 'post_number_' + i, integration: id }));
  const details = ids.map((id,i) => ({ integration: { id }, posts: [
    { id: receipt[i].postId, state: 'DRAFT', content: text },
  ] }));
  assert.equal(assertDraftReceipt(x, receipt, details), true);
  assert.throws(() => assertDraftReceipt(x, receipt, [
    { ...details[0], posts: [{ ...details[0].posts[0], state: 'QUEUE' }] },
    details[1],
  ]));
  assert.throws(() => assertDraftReceipt(x, receipt, [
    { ...details[0], integration: { id: 'other_channel' } }, details[1],
  ]));
});
