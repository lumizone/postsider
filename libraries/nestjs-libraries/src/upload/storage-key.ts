import { randomBytes } from 'crypto';

/**
 * Unguessable object name for a stored file.
 *
 * Media buckets serve objects to anonymous readers by design — X and Meta fetch
 * a post's media over the public URL — so the object name IS the access
 * control. `makeId` cannot provide that: it draws from `Math.random`, a fast
 * non-cryptographic PRNG whose internal state can be recovered from a handful
 * of outputs, which would let anyone who uploads a few files of their own
 * predict the names of files uploaded by other tenants.
 *
 * `randomBytes` is safe to use here: this module is storage/service code, never
 * reachable from the Temporal workflow graph, where importing `crypto` is
 * forbidden (it breaks the deterministic sandbox and takes the workers down).
 *
 * 12 bytes of entropy, base64url so the name stays URL-safe without escaping.
 */
export function randomStorageName(bytes = 12): string {
  return randomBytes(bytes).toString('base64url');
}
