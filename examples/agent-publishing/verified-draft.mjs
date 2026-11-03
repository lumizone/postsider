#!/usr/bin/env node
/**
 * A safe-by-default PostSider REST demo.
 *
 * Preview: node examples/agent-publishing/verified-draft.mjs
 * Execute: POSTSIDER_API_KEY=... POSTSIDER_CHANNEL_IDS=... POSTSIDER_JOB_ID=...
 *          node examples/agent-publishing/verified-draft.mjs --create-draft
 *
 * Never publishes. No generated idempotency key on a retry; same job = same
 * payload, same key, and stable REQUEST_DATE (persist this before execution).
 */
import { pathToFileURL } from 'node:url';

const API_DEFAULT = 'https://api.postsider.com';
const MAX_CHANNELS = 3;

export function buildDraftRequest({ channelIds, content, date }) {
  if (!Array.isArray(channelIds) || channelIds.length < 1 ||
      channelIds.length > MAX_CHANNELS ||
      new Set(channelIds).size !== channelIds.length ||
      channelIds.some(x => typeof x !== 'string' || !/^[a-zA-Z0-9_-]{6,128}$/.test(x))) {
    throw Error('Choose one to three distinct, real connected channel IDs');
  }
  if (typeof content !== 'string' || !content.trim() || content.length > 800) {
    throw Error('Content must be an approved, nonempty text of at most 800 characters');
  }
  if (typeof date !== 'string' || !Number.isFinite(Date.parse(date)) ||
      !date.endsWith('Z') || new Date(date).toISOString() !== date) {
    throw Error('POSTSIDER_REQUEST_DATE must be one persistent UTC ISO timestamp');
  }
  return {
    type: 'draft',
    date,
    shortLink: false,
    tags: [],
    posts: channelIds.map(id => ({
      integration: { id },
      value: [{ content, image: [] }],
      settings: {},
    })),
    creationMethod: 'API',
  };
}

export function assertDraftReceipt(request, created, readbacks) {
  if (!Array.isArray(created) || created.length !== request.posts.length) {
    throw Error('Create did not return one receipt per requested channel');
  }
  if (readbacks.length !== created.length) throw Error('Missing read-back');
  for (let i = 0; i < created.length; i++) {
    const receipt = created[i], detail = readbacks[i];
    const channelId = request.posts[i].integration.id;
    if (receipt?.integration !== channelId || !/^[a-zA-Z0-9_-]{6,128}$/.test(receipt?.postId || '')) {
      throw Error('Receipt does not match selected channel');
    }
    const records = Array.isArray(detail?.posts) ? detail.posts : [];
    const target = records.find(p => p?.id === receipt.postId) || records[0];
    if (!target || target.state !== 'DRAFT' || target.id !== receipt.postId ||
        target.content !== request.posts[i].value[0].content) {
      throw Error('Saved post read-back failed: id, state or content differs');
    }
    const readChannel = detail?.integration?.id || target?.integration?.id ||
      target?.integrationId || null;
    if (!readChannel || readChannel !== channelId) {
      throw Error('Saved post read-back failed: wrong channel');
    }
  }
  return true;
}

export async function runVerifiedDraft({ env = process.env, fetchFn = fetch, execute = false } = {}) {
  const channelIds = (env.POSTSIDER_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const date = env.POSTSIDER_REQUEST_DATE || '2026-11-15T14:00:00.000Z';
  const content = env.POSTSIDER_DRAFT_TEXT ||
    'Demo only: the agent prepared a draft; a human must approve any publication.';
  // Preview uses only explicitly provided sample channel IDs and never contacts the API.
  const previewIds = channelIds.length ? channelIds : ['TEST_CHANNEL_ID'];
  const request = buildDraftRequest({ channelIds: previewIds, content, date });
  if (!execute) {
    return { mode: 'preview', request, published: false,
      note: 'No API request made. Set actual channel IDs, stable job ID, and API key before --create-draft.' };
  }
  const key = env.POSTSIDER_API_KEY;
  const jobId = env.POSTSIDER_JOB_ID;
  if (!key || key.length < 12 || !/^[a-zA-Z0-9._:-]{8,100}$/.test(jobId || '') ||
      !channelIds.length || previewIds[0] === 'TEST_CHANNEL_ID') {
    throw Error('Set a real POSTSIDER_API_KEY, POSTSIDER_CHANNEL_IDS and persistent POSTSIDER_JOB_ID');
  }
  if (!env.POSTSIDER_REQUEST_DATE) {
    throw Error('Set POSTSIDER_REQUEST_DATE once and reuse on retry; never recompute it');
  }
  const apiBase = env.POSTSIDER_API_BASE || API_DEFAULT;
  if (!/^https:\/\/[a-zA-Z0-9.-]+(?::443)?$/.test(apiBase) ||
      apiBase.includes('..')) throw Error('API base must be an HTTPS origin only');

  const apiFetch = async (path, options) => {
    const response = await fetchFn(apiBase + '/public/v1' + path, {
      ...options,
      headers: {
        Authorization: key,
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options?.headers || {}),
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error('PostSider API request failed with HTTP ' + response.status);
    return response.json();
  };

  const channels = await apiFetch('/integrations');
  if (!Array.isArray(channels)) throw Error('Channel listing response malformed');
  for (const id of channelIds) {
    const connected = channels.find(x => x.id === id && !x.disabled && !x.refreshNeeded);
    if (!connected) throw Error('Channel not connected/active: ' + id);
  }
  const created = await apiFetch('/posts', {
    method: 'POST',
    headers: { 'Idempotency-Key': jobId },
    body: JSON.stringify(request),
  });
  const readbacks = [];
  for (const receipt of created) {
    if (!/^[a-zA-Z0-9_-]{6,128}$/.test(receipt?.postId || '')) {
      throw Error('Missing or invalid post ID in create response');
    }
    readbacks.push(await apiFetch('/posts/' + encodeURIComponent(receipt.postId)));
  }
  assertDraftReceipt(request, created, readbacks);
  return { mode: 'verified-draft', published: false,
    postIds: created.map(x => x.postId), channels: channelIds };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runVerifiedDraft({ execute: process.argv.includes('--create-draft') })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      // NEVER print secrets, request bodies or raw API responses.
      console.error(error instanceof Error ? error.message : 'Demo failed');
      process.exitCode = 1;
    });
}
