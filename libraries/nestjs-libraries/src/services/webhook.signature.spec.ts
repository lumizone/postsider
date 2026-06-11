import fc from 'fast-check';
import {
  signWebhook,
  verifyWebhook,
} from '@postsider/nestjs-libraries/services/webhook.signature';

describe('webhook HMAC signature', () => {
  it('Property 9: verify(sign(B,S),B,S) is true and verify(sign(B,S),B\u2032,S) is false', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string({ minLength: 1 }),
        fc.string(),
        (body, secret, otherBody) => {
          const sig = signWebhook(body, secret);
          expect(verifyWebhook(sig, body, secret)).toBe(true);
          if (otherBody !== body) {
            expect(verifyWebhook(sig, otherBody, secret)).toBe(false);
          }
        }
      )
    );
  });

  it('rejects a signature made with a different secret', () => {
    const sig = signWebhook('payload', 'secret-a');
    expect(verifyWebhook(sig, 'payload', 'secret-b')).toBe(false);
  });

  it('rejects an empty signature', () => {
    expect(verifyWebhook('', 'payload', 'secret')).toBe(false);
  });

  it('produces the sha256=<hex> format', () => {
    expect(signWebhook('x', 's')).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});
