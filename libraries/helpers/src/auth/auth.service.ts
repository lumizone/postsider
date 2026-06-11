import { sign, verify } from 'jsonwebtoken';
import { hashSync, compareSync } from 'bcrypt';
import crypto from 'crypto';
// @ts-ignore
import EVP_BytesToKey from 'evp_bytestokey';
const algorithm = 'aes-256-cbc';
const { keyLength, ivLength } = crypto.getCipherInfo(algorithm)!;

function deriveLegacyKeyIv(secret: string) {
  const { keyLength, ivLength } = crypto.getCipherInfo(algorithm)!; // 32, 16
  const pass = Buffer.isBuffer(secret) ? secret : Buffer.from(secret ?? '', 'utf8');

  // evp_bytestokey: key length in **bits**, IV length in **bytes**
  const { key, iv } = EVP_BytesToKey(pass, null, keyLength * 8, ivLength, 'md5');

  if (key.length !== keyLength || iv.length !== ivLength) {
    throw new Error(`Derived wrong sizes (key=${key.length}, iv=${iv.length})`);
  }
  return { key, iv };
}

export function decrypt_legacy_using_IV(hexCiphertext: string) {
  const { key, iv } = deriveLegacyKeyIv(process.env.JWT_SECRET!);
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  const out = Buffer.concat([decipher.update(hexCiphertext, 'hex'), decipher.final()]);
  return out.toString('utf8');
}

export function encrypt_legacy_using_IV(utf8Plaintext: string) {
  const { key, iv } = deriveLegacyKeyIv(process.env.JWT_SECRET!);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const out = Buffer.concat([cipher.update(utf8Plaintext, 'utf8'), cipher.final()]);
  return out.toString('hex');
}

// === AES-256-GCM authenticated encryption (preferred for reversible secrets) ===
//
// Unlike the legacy CBC helper (deterministic, fixed IV derived from
// JWT_SECRET), GCM uses a random per-record IV and an authentication tag, so it
// is NOT suitable for values that are looked up by deterministic equality
// (e.g. OAuth tokens/codes, org API keys). Use it only for reversible secrets.
//
// Migration is opt-in: when ENCRYPTION_KEY is set, new reversible secrets are
// encrypted with GCM (prefixed `v2:`). When it is unset, encryption falls back
// to the legacy CBC scheme so existing deployments are unchanged. Decryption is
// always version-aware, so old CBC ciphertext keeps working either way.
const GCM_ALGORITHM = 'aes-256-gcm';
const GCM_PREFIX = 'v2:';

/** 32-byte key for GCM. Prefers ENCRYPTION_KEY, else derives from JWT_SECRET. */
function deriveGcmKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || '';
  // sha256 always yields exactly 32 bytes regardless of the source length.
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

export function encrypt_gcm(utf8Plaintext: string): string {
  const key = deriveGcmKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(GCM_ALGORITHM, key, iv);
  const ct = Buffer.concat([
    cipher.update(utf8Plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return (
    GCM_PREFIX +
    [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(
      ':'
    )
  );
}

export function decrypt_gcm(value: string): string {
  const payload = value.slice(GCM_PREFIX.length);
  const [ivB64, tagB64, ctB64] = payload.split(':');
  const key = deriveGcmKey();
  const decipher = crypto.createDecipheriv(
    GCM_ALGORITHM,
    key,
    Buffer.from(ivB64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const out = Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]);
  return out.toString('utf8');
}

export class AuthService {
  static hashPassword(password: string) {
    return hashSync(password, 10);
  }
  static comparePassword(password: string, hash: string) {
    return compareSync(password, hash);
  }
  static signJWT(value: object) {
    return sign(value, process.env.JWT_SECRET!);
  }

  /**
   * Sign a JWT with expiration — used ONLY for user session tokens.
   * Provider tokens, extension tokens, and encryption JWTs must use
   * signJWT() without expiration to avoid breaking long-running flows.
   */
  static signSessionJWT(value: object, expiresIn: number = 7 * 24 * 60 * 60) {
    return sign(value, process.env.JWT_SECRET!, { expiresIn });
  }
  static verifyJWT(token: string) {
    return verify(token, process.env.JWT_SECRET!);
  }

  /**
   * Deterministic, fixed-IV CBC encryption. KEEP using this for values that are
   * later looked up by equality (OAuth tokens/codes, org API keys, redemption
   * codes). Do NOT use for new reversible secrets — use encryptSecret instead.
   */
  static fixedEncryption(value: string) {
    return encrypt_legacy_using_IV(value);
  }

  static fixedDecryption(hash: string) {
    return decrypt_legacy_using_IV(hash);
  }

  /**
   * Encrypt a reversible secret (provider credentials, instance details, etc.).
   * Uses authenticated AES-256-GCM when ENCRYPTION_KEY is configured, otherwise
   * falls back to the legacy CBC scheme so existing deployments are unchanged.
   */
  static encryptSecret(value: string) {
    return process.env.ENCRYPTION_KEY
      ? encrypt_gcm(value)
      : encrypt_legacy_using_IV(value);
  }

  /**
   * Decrypt a reversible secret. Version-aware: GCM ciphertext (prefixed `v2:`)
   * is decrypted with GCM; anything else is treated as legacy CBC. This lets
   * GCM and CBC ciphertext coexist during/after migration.
   */
  static decryptSecret(value: string) {
    return value?.startsWith(GCM_PREFIX)
      ? decrypt_gcm(value)
      : decrypt_legacy_using_IV(value);
  }
}
