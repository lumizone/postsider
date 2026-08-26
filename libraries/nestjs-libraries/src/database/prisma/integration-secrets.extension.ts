import { AuthService } from '@postsider/helpers/auth/auth.service';

/**
 * Transparent encryption for the OAuth secrets on `Integration`.
 *
 * `token` and `refreshToken` are the crown jewels of this product: with them a
 * database dump is a takeover of every customer's social accounts. They used to
 * be stored in plaintext while the sibling secrets (webhook secrets, BYO client
 * secrets, custom instance details) were already encrypted.
 *
 * This is wired as a Prisma client extension rather than at the repository
 * boundary ON PURPOSE. Integrations are read through a dozen paths — the
 * integration service, the posts service, `include: { integration: true }` from
 * post queries, the Temporal publish activity — and a single missed read would
 * hand a provider a ciphertext instead of a token, i.e. a silent publishing
 * outage for one platform. One choke point cannot be missed.
 *
 * Format: `AuthService.encryptSecret` (AES-256-GCM, `v2:` prefix, random IV).
 * Nothing looks integrations up by token equality, so a non-deterministic
 * scheme is safe here.
 *
 * Migration is lazy and non-breaking: only values carrying the `v2:` marker are
 * decrypted, so rows written before this shipped keep working as plaintext
 * until `scripts/encrypt-integration-tokens.cjs` rewrites them.
 */

const SECRET_FIELDS = ['token', 'refreshToken'] as const;
const ENCRYPTED_MARKER = 'v2:';

/** Ciphertext we wrote ourselves — anything else is legacy plaintext. */
function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_MARKER);
}

/** Encrypt a value unless it is empty or already encrypted. */
export function encryptField(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (isEncrypted(value)) return value;
  return AuthService.encryptSecret(value);
}

/** Decrypt a value we encrypted; leave legacy plaintext untouched. */
export function decryptField(value: unknown): unknown {
  if (!isEncrypted(value)) return value;
  try {
    return AuthService.decryptSecret(value);
  } catch {
    // A key rotation without a re-encryption pass would land here. Returning
    // the ciphertext (rather than throwing) keeps the rest of the row usable:
    // the channel then fails its next API call and surfaces as "reconnect
    // needed", which is a far better failure mode than a 500 on every read.
    return value;
  }
}

/**
 * Encrypt the secret fields inside a Prisma write payload. Handles the plain
 * `data` object, `upsert`'s `create`/`update` halves, and `createMany`'s array.
 */
export function encryptWritePayload(payload: any): any {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return payload.map(encryptWritePayload);

  const out = { ...payload };
  for (const field of SECRET_FIELDS) {
    const value = out[field];
    if (value === undefined) continue;
    // Prisma update syntax allows `{ set: value }` as well as a bare value.
    if (value && typeof value === 'object' && 'set' in value) {
      out[field] = { ...value, set: encryptField(value.set) };
    } else {
      out[field] = encryptField(value);
    }
  }
  return out;
}

/**
 * Walk a query result and decrypt every Integration row in it, however deeply
 * nested.
 *
 * A row counts as an Integration when any of these holds:
 *  - the query itself targeted the Integration model (`isIntegrationModel`),
 *    which covers `select: { token: true }` — a shape that carries no other
 *    identifying field and silently returned ciphertext in the first cut;
 *  - it arrived under a relation field named `integration(s)`;
 *  - it carries `providerIdentifier`, which no other model in the schema has.
 */
export function decryptResult<T>(
  result: T,
  isIntegrationModel = false,
  depth = 0
): T {
  if (result == null || typeof result !== 'object' || depth > 8) return result;

  if (Array.isArray(result)) {
    return result.map((item) =>
      decryptResult(item, isIntegrationModel, depth + 1)
    ) as unknown as T;
  }

  // Dates, Decimals and Buffers are objects too — never rebuild those.
  if (
    result instanceof Date ||
    Buffer.isBuffer(result) ||
    result.constructor !== Object
  ) {
    return result;
  }

  const row = result as Record<string, unknown>;
  const isIntegration =
    isIntegrationModel ||
    ('providerIdentifier' in row && SECRET_FIELDS.some((f) => f in row));

  let changed = false;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    if (isIntegration && (SECRET_FIELDS as readonly string[]).includes(key)) {
      const decrypted = decryptField(value);
      if (decrypted !== value) changed = true;
      out[key] = decrypted;
      continue;
    }
    const walked = decryptResult(
      value as unknown,
      /^integrations?$/i.test(key),
      depth + 1
    );
    if (walked !== value) changed = true;
    out[key] = walked;
  }

  // Returning the original object when nothing changed keeps identity stable
  // for callers that compare references (and avoids pointless allocation).
  return (changed ? out : result) as T;
}

const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
]);

/** The extension object handed to `PrismaClient.$extends`. */
export const integrationSecretsExtension = {
  name: 'integration-secrets',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }: any) {
        const isIntegrationWrite =
          model === 'Integration' && WRITE_OPERATIONS.has(operation);

        const nextArgs =
          isIntegrationWrite && args
            ? {
                ...args,
                ...(args.data ? { data: encryptWritePayload(args.data) } : {}),
                ...(args.create
                  ? { create: encryptWritePayload(args.create) }
                  : {}),
                ...(args.update
                  ? { update: encryptWritePayload(args.update) }
                  : {}),
              }
            : args;

        return decryptResult(await query(nextArgs), model === 'Integration');
      },
    },
  },
};
