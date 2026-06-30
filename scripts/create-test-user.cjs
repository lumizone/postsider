/**
 * One-off: create a standalone test user + its own organization.
 *
 * Run INSIDE the postsider-app container (it has the generated Prisma client,
 * bcrypt, and DATABASE_URL). Idempotent: refuses if the email already exists.
 *
 *   docker cp scripts/create-test-user.cjs postsider-app:/tmp/ctu.cjs
 *   docker exec -e NEW_USER_EMAIL=... -e NEW_USER_PASSWORD=... [-e ROLE=ADMIN] \
 *     -w /app postsider-app node /tmp/ctu.cjs
 *
 * Env:
 *   NEW_USER_EMAIL     (default tester.fb@postsider.com)
 *   NEW_USER_PASSWORD  (required)
 *   NEW_USER_ORG       (default "Tester FB")
 *   ROLE               SUPERADMIN | ADMIN | USER (default SUPERADMIN, org-scoped)
 */
const { PrismaClient } = require('@prisma/client');
const { hashSync } = require('bcrypt');

const email = (process.env.NEW_USER_EMAIL || 'tester.fb@postsider.com').trim();
const password = process.env.NEW_USER_PASSWORD;
const orgName = (process.env.NEW_USER_ORG || 'Tester FB').trim();
const role = (process.env.ROLE || 'SUPERADMIN').trim();

const prisma = new PrismaClient();

(async () => {
  if (!password || password.length < 8) {
    console.error('ERROR: NEW_USER_PASSWORD missing or < 8 chars');
    process.exit(2);
  }
  if (!['SUPERADMIN', 'ADMIN', 'USER'].includes(role)) {
    console.error(`ERROR: invalid ROLE ${role}`);
    process.exit(2);
  }

  const existing = await prisma.user.findFirst({
    where: { email, providerName: 'LOCAL' },
  });
  if (existing) {
    console.log('ALREADY_EXISTS userId=' + existing.id + ' — nothing created');
    await prisma.$disconnect();
    process.exit(3);
  }

  const org = await prisma.organization.create({
    data: {
      name: orgName,
      allowTrial: true,
      isTrailing: true,
      users: {
        create: {
          role,
          user: {
            create: {
              activated: true,
              email,
              password: hashSync(password, 10),
              providerName: 'LOCAL',
              providerId: '',
              name: orgName, // non-null → skips the first-run setup screen
              timezone: 0,
              ip: '127.0.0.1',
              agent: 'cli/create-test-user',
            },
          },
        },
      },
    },
    select: { id: true, users: { select: { userId: true, role: true } } },
  });

  console.log('CREATED');
  console.log('  org   : ' + orgName + ' (' + org.id + ')');
  console.log('  user  : ' + email + ' (' + org.users[0].userId + ')');
  console.log('  role  : ' + org.users[0].role + ' (org-scoped; instance isSuperAdmin=false)');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('ERROR', e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
