#!/usr/bin/env node
/**
 * One-off migration: encrypt the OAuth secrets already sitting in `Integration`.
 *
 * New writes are encrypted by the Prisma extension
 * (`integration-secrets.extension.ts`) as soon as the app ships; rows written
 * before that stay plaintext and keep working, because the read path only
 * decrypts values carrying the `v2:` marker. This script closes that gap.
 *
 * Safe to run repeatedly: rows already carrying `v2:` are skipped. Every value
 * is decrypted back and compared before the row is written, so a key mismatch
 * aborts the run instead of destroying a token.
 *
 * Usage, from the repo root on the host:
 *   docker exec postsider-app node scripts/encrypt-integration-tokens.cjs --dry-run
 *   docker exec postsider-app node scripts/encrypt-integration-tokens.cjs
 */
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const GCM_PREFIX = 'v2:';
const FIELDS = ['token', 'refreshToken'];
const dryRun = process.argv.includes('--dry-run');

// Mirrors AuthService.encryptSecret / decryptSecret (aes-256-gcm, random IV).
function key() {
  const raw = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || '';
  if (!raw) {
    throw new Error('Neither ENCRYPTION_KEY nor JWT_SECRET is set — aborting.');
  }
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    GCM_PREFIX +
    [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':')
  );
}

function decrypt(value) {
  const [ivB64, tagB64, ctB64] = value.slice(GCM_PREFIX.length).split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key(),
    Buffer.from(ivB64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

(async () => {
  const prisma = new PrismaClient();
  const rows = await prisma.integration.findMany({
    select: { id: true, name: true, providerIdentifier: true, token: true, refreshToken: true },
  });

  let encrypted = 0;
  let skipped = 0;

  for (const row of rows) {
    const data = {};

    for (const field of FIELDS) {
      const value = row[field];
      if (typeof value !== 'string' || value.length === 0) continue;
      if (value.startsWith(GCM_PREFIX)) continue;

      const ciphertext = encrypt(value);
      if (decrypt(ciphertext) !== value) {
        throw new Error(
          `Round-trip check failed for integration ${row.id} (${field}) — nothing written.`
        );
      }
      data[field] = ciphertext;
    }

    if (Object.keys(data).length === 0) {
      skipped += 1;
      continue;
    }

    console.log(
      `${dryRun ? 'would encrypt' : 'encrypting'}  ${row.providerIdentifier.padEnd(12)} ${row.name} [${Object.keys(data).join(', ')}]`
    );
    if (!dryRun) {
      await prisma.integration.update({ where: { id: row.id }, data });
    }
    encrypted += 1;
  }

  console.log(
    `\n${dryRun ? 'DRY RUN — ' : ''}integrations: ${rows.length}, ${dryRun ? 'to encrypt' : 'encrypted'}: ${encrypted}, already done: ${skipped}`
  );
  await prisma.$disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
