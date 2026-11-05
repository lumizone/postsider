import { AUDIT_EVENT_TYPES, sanitizeAuditMetadata } from './audit-events';

describe('audit events', () => {
  it('lists exactly the ten event names in order', () => {
    expect([...AUDIT_EVENT_TYPES]).toEqual([
      'post.created',
      'post.updated',
      'post.deleted',
      'post.status_changed',
      'post.approval_requested',
      'post.approval_resolved',
      'post.published',
      'post.failed',
      'post.retry_requested',
      'post.policy_evaluated',
      'policy.changed',
    ]);
  });

  it('keeps primitives only, cuts strings and drops sensitive keys', () => {
    expect(
      sanitizeAuditMetadata({
        a: 'x'.repeat(300),
        b: { n: 1 },
        c: [1],
        content: 'secret',
        d: 5,
        e: null,
        f: true,
      })
    ).toEqual({ a: 'x'.repeat(200), d: 5, e: null, f: true });
  });

  it('drops text, error, token, secret, password and email keys', () => {
    expect(
      sanitizeAuditMetadata({ text: 'a', error: 'b', token: 'c', secret: 'd', password: 'e', email: 'f', ok: 'y' })
    ).toEqual({ ok: 'y' });
  });

  it('caps at 12 keys', () => {
    const input: Record<string, string> = {};
    for (let i = 0; i < 15; i++) input[`k${i}`] = 'v';
    expect(Object.keys(sanitizeAuditMetadata(input))).toHaveLength(12);
  });

  it('returns an empty object for non-object input', () => {
    expect(sanitizeAuditMetadata('x')).toEqual({});
    expect(sanitizeAuditMetadata(null)).toEqual({});
    expect(sanitizeAuditMetadata(undefined)).toEqual({});
    expect(sanitizeAuditMetadata([1, 2])).toEqual({});
  });
});
