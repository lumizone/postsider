#!/usr/bin/env node
/**
 * Post-deploy smoke test for the Public API / MCP surface.
 *
 *   POSTSIDER_API_KEY=... node scripts/smoke-public-api.mjs --yes
 *   POSTSIDER_API_URL=https://api.postsider.com  (default)
 *   --channel <id>   channel to use (default: first enabled one)
 *   --no-media-attach  upload media but do not attach it to posts. Needed when the
 *                    instance stores files on localhost (dev): media URLs must be
 *                    public HTTPS, so attaching would be refused by design.
 *   --schedule       also exercise a QUEUE post (scheduled 30 days ahead, then
 *                    deleted before it can publish) to check workflow re-arming
 *
 * It NEVER publishes: every post is a draft, or a far-future scheduled post that
 * is deleted at the end. Everything it creates (media, library items, posts) is
 * removed again, also when a step fails. Run it against a test organization.
 * Exit code 0 = all steps passed.
 */
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);

const key = process.env.POSTSIDER_API_KEY;
const base = (process.env.POSTSIDER_API_URL || 'https://api.postsider.com').replace(/\/+$/, '') + '/public/v1';
if (!key) {
  console.error('POSTSIDER_API_KEY is not set.');
  process.exit(2);
}
if (!flag('--yes')) {
  console.error(`This writes test data (and deletes it again) in the organization behind this key.\nTarget: ${base}\nRe-run with --yes to continue.`);
  process.exit(2);
}

// 1x1 PNG
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'error',
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

const results = [];
const cleanups = [];
async function step(name, fn) {
  try {
    const note = await fn();
    results.push({ name, ok: true, note });
    console.log(`  ok    ${name}${note ? ` (${note})` : ''}`);
  } catch (e) {
    results.push({ name, ok: false, note: e.message });
    console.log(`  FAIL  ${name}: ${e.message}`);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const expectStatus = (r, ...codes) =>
  expect(codes.includes(r.status), `HTTP ${r.status}: ${typeof r.json === 'string' ? r.json : JSON.stringify(r.json)}`);

let channel, media, draftId;
const attach = !flag('--no-media-attach');

// Provider settings the Public API demands even for drafts. Extend as needed.
const REQUIRED_SETTINGS = { x: { who_can_reply_post: 'everyone' } };
const settingsFor = () => REQUIRED_SETTINGS[channel.identifier] ?? {};

console.log(`Smoke test against ${base}\n`);

await step('list channels, find a usable one', async () => {
  const r = await call('GET', '/integrations');
  expectStatus(r, 200);
  expect(Array.isArray(r.json) && r.json.length, 'no channels connected');
  const wanted = opt('--channel');
  channel = wanted ? r.json.find((c) => c.id === wanted) : r.json.find((c) => !c.disabled && !c.refreshNeeded);
  expect(channel, 'no enabled channel without refreshNeeded (pass --channel)');
  expect('refreshNeeded' in channel, 'integrations response lacks refreshNeeded');
  return `${channel.identifier} / ${channel.name}`;
});

await step('channel rules', async () => {
  const r = await call('GET', `/integration-settings/${channel.id}`);
  expectStatus(r, 200);
  return `maxLength ${r.json?.output?.maxLength}`;
});

await step('queue plan and smart slots', async () => {
  const q = await call('GET', `/integrations/${channel.id}/queue-plan`);
  expectStatus(q, 200);
  expect(Array.isArray(q.json.slots) && q.json.timezone, 'queue plan shape');
  const s = await call('GET', `/integrations/${channel.id}/smart-slots?count=2`);
  expectStatus(s, 200);
  return `${q.json.slots.length} slots, ${q.json.timezone}`;
});

await step('upload a file as base64 (body above the 100 KB default limit)', async () => {
  // Pad the PNG with trailing bytes so the JSON body is well over 100 KB while
  // the file stays a valid image. Catches the body-size-limit regression.
  const padded = Buffer.concat([Buffer.from(PNG_B64, 'base64'), Buffer.alloc(150 * 1024, 0)]).toString('base64');
  const r = await call('POST', '/upload-base64', { data: padded, filename: 'smoke.png' });
  expectStatus(r, 200, 201);
  media = r.json;
  expect(media?.id && media?.path, 'no media id/path returned');
  cleanups.push(() => call('DELETE', `/media/${media.id}`));
  return media.id;
});

await step('media library lists the upload', async () => {
  const r = await call('GET', '/media?search=smoke');
  expectStatus(r, 200);
  expect(JSON.stringify(r.json).includes(media.id), 'uploaded file not in the library');
});

await step('create a draft with the media', async () => {
  const r = await call('POST', '/posts', {
    type: 'draft',
    date: new Date().toISOString(),
    shortLink: false,
    tags: [],
    posts: [{ integration: { id: channel.id }, value: [{ content: 'PostSider smoke test (draft, safe to delete)', image: attach ? [{ id: media.id, path: media.path }] : [] }], settings: settingsFor() }],
  });
  expectStatus(r, 200, 201);
  draftId = r.json?.[0]?.postId;
  expect(draftId, 'no postId returned');
  cleanups.push(() => call('DELETE', `/posts/${draftId}`));
  return draftId;
});

await step('edit the draft: text, then drop the media, then add it back', async () => {
  let r = await call('PUT', `/posts/${draftId}`, { content: 'smoke test, edited' });
  expectStatus(r, 200, 201);
  r = await call('PUT', `/posts/${draftId}`, { images: [] });
  expectStatus(r, 200, 201);
  let got = await call('GET', `/posts/${draftId}`);
  expectStatus(got, 200);
  expect(got.json.posts[0].content.includes('edited'), 'text edit lost when only images changed');
  expect((got.json.posts[0].image || []).length === 0, 'media not removed');
  if (!attach) return 'text only (--no-media-attach)';
  // After an edit the group changes; the post id stays the same.
  r = await call('PUT', `/posts/${draftId}`, { images: [{ id: media.id, path: media.path }] });
  expectStatus(r, 200, 201);
  got = await call('GET', `/posts/${draftId}`);
  expect((got.json.posts[0].image || []).length === 1, 'media not re-attached');
});

await step('an empty edit is refused', async () => {
  expectStatus(await call('PUT', `/posts/${draftId}`, {}), 400);
});

await step('duplicate the draft', async () => {
  const r = await call('POST', `/posts/${draftId}/duplicate`, {});
  expectStatus(r, 200, 201);
  const id = r.json?.target?.postId;
  expect(id, 'no duplicate id');
  cleanups.push(() => call('DELETE', `/posts/${id}`));
  return id;
});

await step('list posts filtered by state with paging', async () => {
  const from = new Date(Date.now() - 86400e3).toISOString();
  const to = new Date(Date.now() + 86400e3 * 60).toISOString();
  const r = await call('GET', `/posts?startDate=${from}&endDate=${to}&state=DRAFT&limit=5&page=1`);
  expectStatus(r, 200);
  expect(typeof r.json.total === 'number' && 'hasMore' in r.json, 'paging fields missing');
  expect(r.json.posts.every((p) => p.state === 'DRAFT'), 'state filter not applied');
});

await step('library create, update, list, delete', async () => {
  const c = await call('POST', '/library/hashtag-groups', { name: 'smoke-test', hashtags: ['#smoke'] });
  expectStatus(c, 200, 201);
  const id = c.json.id;
  cleanups.push(() => call('DELETE', `/library/hashtag-groups/${id}`));
  expectStatus(await call('PUT', `/library/hashtag-groups/${id}`, { name: 'smoke-test', hashtags: ['#smoke', '#two'] }), 200);
  const l = await call('GET', '/library');
  expectStatus(l, 200);
  expect(JSON.stringify(l.json).includes('#two'), 'update not visible');
  expectStatus(await call('POST', '/library/nope', { name: 'x' }), 400);
});

await step('workspace endpoints answer for an owner key', async () => {
  const r = await call('GET', '/publishing/state');
  expectStatus(r, 200);
});

if (flag('--schedule')) {
  await step('QUEUE post: schedule 30 days ahead, edit it, delete it', async () => {
    const when = new Date(Date.now() + 30 * 86400e3).toISOString();
    const c = await call('POST', '/posts', {
      type: 'schedule', date: when, shortLink: false, tags: [],
      posts: [{ integration: { id: channel.id }, value: [{ content: 'PostSider smoke test (scheduled, deleted before it runs)', image: [] }], settings: settingsFor() }],
    });
    expectStatus(c, 200, 201);
    const id = c.json[0].postId;
    cleanups.push(() => call('DELETE', `/posts/${id}`));
    const later = new Date(Date.now() + 31 * 86400e3).toISOString();
    const e = await call('PUT', `/posts/${id}`, { date: later, content: 'smoke test, rescheduled' });
    expectStatus(e, 200, 201);
    const got = await call('GET', `/posts/${id}`);
    expect(got.json.posts[0].publishDate?.startsWith(later.slice(0, 10)), 'new date not stored');
    return 'check Temporal: post_<id> should be running with the new date';
  });
}

console.log('\nCleaning up...');
for (const undo of cleanups.reverse()) {
  try { await undo(); } catch (e) { console.log(`  cleanup failed: ${e.message}`); }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} steps passed.`);
process.exit(failed.length ? 1 : 0);
