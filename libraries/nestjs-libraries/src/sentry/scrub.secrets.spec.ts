import { scrubSecrets } from '@postsider/nestjs-libraries/sentry/initialize.sentry';

describe('scrubSecrets (Sentry redaction)', () => {
  it('redacts agent/oauth/api token values in strings', () => {
    expect(scrubSecrets('using agt_ABC123def as token')).toBe(
      'using [redacted] as token'
    );
    expect(scrubSecrets('pos_xyz789 and ps_key000')).toBe(
      '[redacted] and [redacted]'
    );
  });

  it('redacts sensitive object keys regardless of value', () => {
    const event = {
      request: {
        headers: { Authorization: 'Bearer agt_secret', 'content-type': 'json' },
      },
      extra: { password: 'hunter2', clientSecret: 'abc', note: 'fine' },
    };
    const scrubbed = scrubSecrets(event) as any;
    expect(scrubbed.request.headers.Authorization).toBe('[redacted]');
    expect(scrubbed.request.headers['content-type']).toBe('json');
    expect(scrubbed.extra.password).toBe('[redacted]');
    expect(scrubbed.extra.clientSecret).toBe('[redacted]');
    expect(scrubbed.extra.note).toBe('fine');
  });

  it('handles nested arrays and null safely', () => {
    const obj = { list: ['agt_tok1', { token: 'pos_x' }], empty: null };
    const scrubbed = scrubSecrets(obj) as any;
    expect(scrubbed.list[0]).toBe('[redacted]');
    expect(scrubbed.list[1].token).toBe('[redacted]');
    expect(scrubbed.empty).toBeNull();
  });
});
