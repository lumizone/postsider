/**
 * One-off: grant an organization a subscription tier (manual, lifetime).
 * Mirrors SubscriptionRepository.createOrUpdateSubscription.
 *
 *   sudo docker cp scripts/set-subscription.cjs postsider-app:/app/ss.cjs
 *   sudo docker exec -e ORG_ID=... -e TIER=SAMURAI -e NODE_PATH=/app/node_modules \
 *     -w /app postsider-app node /app/ss.cjs
 *
 * Env: ORG_ID (required), TIER (default SAMURAI), CHANNELS (default 1000000),
 *      PERIOD (MONTHLY|YEARLY, default MONTHLY).
 */
const { PrismaClient } = require('@prisma/client');

const orgId = (process.env.ORG_ID || '').trim();
const tier = (process.env.TIER || 'SAMURAI').trim();
const channels = parseInt(process.env.CHANNELS || '1000000', 10);
const period = (process.env.PERIOD || 'MONTHLY').trim();

const prisma = new PrismaClient();

(async () => {
  if (!orgId) {
    console.error('ERROR: ORG_ID required');
    process.exit(2);
  }
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) {
    console.error('ERROR: org not found: ' + orgId);
    process.exit(3);
  }

  const sub = await prisma.subscription.upsert({
    where: { organizationId: orgId },
    update: {
      subscriptionTier: tier,
      totalChannels: channels,
      period,
      identifier: 'manual-grant',
      isLifetime: true,
      cancelAt: null,
      deletedAt: null,
    },
    create: {
      organizationId: orgId,
      subscriptionTier: tier,
      totalChannels: channels,
      period,
      identifier: 'manual-grant',
      isLifetime: true,
      cancelAt: null,
      deletedAt: null,
    },
    select: { id: true, subscriptionTier: true, totalChannels: true, period: true, isLifetime: true },
  });

  await prisma.organization.update({
    where: { id: orgId },
    data: { isTrailing: false, allowTrial: false },
  });

  console.log('SUBSCRIPTION_SET');
  console.log('  org    : ' + org.name + ' (' + orgId + ')');
  console.log('  tier   : ' + sub.subscriptionTier);
  console.log('  channels: ' + sub.totalChannels + '  period: ' + sub.period + '  lifetime: ' + sub.isLifetime);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('ERROR', e.message);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
