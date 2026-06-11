import { createHmac, timingSafeEqual } from 'crypto';

export const WEBHOOK_SIGNATURE_HEADER = 'x-postsider-signature';

/**
 * Compute the HMAC-SHA256 signature of a webhook body (Requirement 19.2).
 * Returns a value in the form `sha256=<hex>`.
 */
export function signWebhook(body: string, secret: string): string {
  const hmac = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hmac}`;
}

/**
 * Verify a webhook signature against the body and secret using a constant-time
 * comparison (Requirement 19.3).
 *
 * Round-trip property (Correctness Property 9):
 *   verify(sign(B, S), B, S) === true
 *   verify(sign(B, S), B', S) === false  for B' !== B
 */
export function verifyWebhook(
  signature: string,
  body: string,
  secret: string
): boolean {
  if (!signature) {
    return false;
  }
  const expected = signWebhook(body, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
