import { buildSlackBody, isSlackWebhookUrl } from './slack-message';

const FRONT = 'https://app.postsider.com';

function buttonUrl(body: { blocks: any[] }) {
  const actions = body.blocks.find((b) => b.type === 'actions');
  return actions?.elements?.[0]?.url;
}

const NOISY = {
  postId: 'post-id-123456',
  approvalId: 'approval-id-987',
  content: 'SECRET POST CONTENT',
  actor: { type: 'API_KEY', apiKeyId: 'apikey-abc', userId: 'user-xyz' },
  provenance: { agentName: 'agent-007', runId: 'run-555' },
  error: 'raw provider error with token=zzz',
  post: {
    id: 'post-id-123456',
    content: 'SECRET POST CONTENT',
    state: 'PUBLISHED',
    releaseURL: 'https://social.example.com/p/1',
  },
  approval: {
    requestedBy: { type: 'USER', userId: 'user-xyz' },
    decidedBy: { type: 'USER', userId: 'user-xyz' },
    stage: { position: 1, total: 2, name: 'Reviewer' },
  },
  status: 'APPROVED',
  note: 'Looks good',
  errorCategory: 'RATE_LIMITED',
};

describe('isSlackWebhookUrl', () => {
  it('accepts a real incoming webhook url', () => {
    expect(isSlackWebhookUrl('https://hooks.slack.com/services/T0/B0/XXXX')).toBe(true);
  });
  it('accepts the explicit default https port', () => {
    expect(isSlackWebhookUrl('https://hooks.slack.com:443/services/T0/B0/XXXX')).toBe(true);
  });
  it.each([
    'https://hooks.slack.com.evil.com/services/T0/B0/X',
    'http://hooks.slack.com/services/T0/B0/X',
    'https://hooks.slack.com/other',
    'https://evil.com/hooks.slack.com/services/x',
    'https://user@evil.com/services/x',
    'https://hooks.slack.com:8443/services/T0/B0/X',
    'https://hooks.slack.com:444/services/T0/B0/X',
    'not a url',
    '',
  ])('rejects %s', (url) => {
    expect(isSlackWebhookUrl(url)).toBe(false);
  });
});

describe('buildSlackBody', () => {
  it('approval.requested renders stage text and the approval button', () => {
    const body = buildSlackBody({ event: 'approval.requested', data: NOISY }, FRONT);
    expect(body.text).toBe('A post is waiting for approval (stage 1 of 2: Reviewer).');
    expect(buttonUrl(body as any)).toBe(`${FRONT}/approval`);
    expect(JSON.stringify(body)).toContain('Review in PostSider');
  });

  it('approval.requested without a stage still renders', () => {
    const body = buildSlackBody(
      { event: 'approval.requested', data: { approval: {} } },
      FRONT + '/'
    );
    expect(body.text).toBe('A post is waiting for approval.');
    expect(buttonUrl(body as any)).toBe(`${FRONT}/approval`);
  });

  it('approval.resolved renders approved, rejected and the note', () => {
    const ok = buildSlackBody({ event: 'approval.resolved', data: NOISY }, FRONT);
    expect(ok.text).toContain('A post was approved.');
    expect(ok.text).toContain('Looks good');
    expect(buttonUrl(ok as any)).toBe(`${FRONT}/agents`);
    const no = buildSlackBody(
      { event: 'approval.resolved', data: { status: 'REJECTED', note: null } },
      FRONT
    );
    expect(no.text).toBe('A post was rejected.');
  });

  it('post.failed renders the error category and the agents button', () => {
    const body = buildSlackBody({ event: 'post.failed', data: NOISY }, FRONT);
    expect(body.text).toBe('A post failed to publish (RATE_LIMITED).');
    expect(buttonUrl(body as any)).toBe(`${FRONT}/agents`);
  });

  it('post.published uses the https releaseURL as the button', () => {
    const body = buildSlackBody({ event: 'post.published', data: NOISY }, FRONT);
    expect(body.text).toBe('A post was published.');
    expect(buttonUrl(body as any)).toBe('https://social.example.com/p/1');
  });

  it('post.published drops a non https or invalid releaseURL', () => {
    for (const releaseURL of ['http://x.example.com/p', 'javascript:alert(1)', 'nope', 42]) {
      const body = buildSlackBody(
        { event: 'post.published', data: { post: { releaseURL } } },
        FRONT
      );
      expect(buttonUrl(body as any)).toBeUndefined();
    }
  });

  it('escapes Slack control characters', () => {
    const body = buildSlackBody(
      {
        event: 'approval.resolved',
        data: { status: 'APPROVED', note: '<script>&<!channel>' },
      },
      FRONT
    );
    expect(body.text).toContain('&lt;script&gt;&amp;&lt;!channel&gt;');
    expect(JSON.stringify(body)).not.toContain('<script>');
    expect(JSON.stringify(body)).not.toContain('<!channel>');
  });

  it('cuts long values to 200 characters', () => {
    const body = buildSlackBody(
      { event: 'approval.resolved', data: { status: 'APPROVED', note: 'a'.repeat(500) } },
      FRONT
    );
    expect(body.text).toContain('a'.repeat(200));
    expect(body.text).not.toContain('a'.repeat(201));
  });

  it('never leaks content, ids or actor fields', () => {
    for (const event of ['approval.requested', 'approval.resolved', 'post.failed', 'post.published']) {
      const json = JSON.stringify(buildSlackBody({ event, data: NOISY }, FRONT));
      for (const banned of [
        'content',
        'SECRET',
        'post-id-123456',
        'approval-id-987',
        'apikey',
        'apiKeyId',
        'userId',
        'user-xyz',
        'agent-007',
        'run-555',
        'token=zzz',
      ]) {
        expect(json).not.toContain(banned);
      }
    }
  });

  it('unknown events and webhook.test get a generic line', () => {
    const t = buildSlackBody({ event: 'webhook.test', data: NOISY }, FRONT);
    expect(t.text).toBe('PostSider event: webhook.test.');
    expect(JSON.stringify(t)).not.toContain('SECRET');
    const u = buildSlackBody({ event: 'x<y>', data: null }, FRONT);
    expect(u.text).toBe('PostSider event: x&lt;y&gt;.');
  });

  it('omits the button when FRONTEND_URL is empty', () => {
    const body = buildSlackBody({ event: 'post.failed', data: NOISY }, '');
    expect(buttonUrl(body as any)).toBeUndefined();
  });

  it('survives malformed data', () => {
    for (const data of [null, undefined, 'str', 5, [], { approval: 'x', post: null }]) {
      expect(() => buildSlackBody({ event: 'approval.requested', data }, FRONT)).not.toThrow();
      expect(() => buildSlackBody({ event: 'post.published', data }, FRONT)).not.toThrow();
    }
  });
});
