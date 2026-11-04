import { PrismaClient } from '@prisma/client';
import { PublicWebhookDeliveryService } from './public-webhook-delivery.service';

const url = process.env.PS_TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('PublicWebhookDeliveryService.claimDue (real Postgres)', () => {
  let prisma: PrismaClient;
  let orgId: string;
  let subscriptionId: string;
  let deliveryIds: string[];

  const makeService = () =>
    new PublicWebhookDeliveryService(prisma as never, {} as never);

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const org = await prisma.organization.create({
      data: { name: 'claim-test' },
    });
    orgId = org.id;
    const sub = await prisma.publicWebhookSubscription.create({
      data: {
        organizationId: orgId,
        name: 'claim-test',
        url: 'https://example.com/h',
        events: ['post.published'],
        secretVersion: 'v',
      },
    });
    subscriptionId = sub.id;
    const past = new Date(Date.now() - 60_000);
    deliveryIds = Array.from({ length: 40 }, (_, i) => `claim-test-${i}-${orgId}`);
    await prisma.publicWebhookDelivery.createMany({
      data: deliveryIds.map((id, i) => ({
        id,
        organizationId: orgId,
        subscriptionId,
        eventId: `evt-${i}`,
        event: 'post.published',
        payload: {},
        status: 'PENDING' as const,
        nextAttemptAt: past,
      })),
    });
  });

  afterAll(async () => {
    await prisma.publicWebhookDelivery.deleteMany({
      where: { organizationId: orgId },
    });
    await prisma.publicWebhookSubscription.deleteMany({
      where: { organizationId: orgId },
    });
    await prisma.organization.delete({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('never hands one row to two concurrent claimers and leases claimed rows', async () => {
    const a = makeService();
    const b = makeService();
    const results = await Promise.all([
      a.claimDue({ limit: 25 }),
      b.claimDue({ limit: 25 }),
      a.claimDue({ limit: 25 }),
    ]);
    const claimed = results.flat().filter((r) => r.organizationId === orgId);
    const ids = claimed.map((r) => r.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids).size).toBe(40);
    expect(claimed.every((r) => r.attempts === 1)).toBe(true);

    const again = await a.claimDue({ limit: 50 });
    expect(again.filter((r) => r.organizationId === orgId)).toEqual([]);

    const sample = await prisma.publicWebhookDelivery.findUniqueOrThrow({
      where: { id: deliveryIds[0] },
    });
    const aheadMs = sample.nextAttemptAt!.getTime() - Date.now();
    expect(aheadMs).toBeGreaterThan(4 * 60_000);
    expect(aheadMs).toBeLessThanOrEqual(5 * 60_000 + 5_000);
  });

  it('reclaims a row once its lease has expired', async () => {
    await prisma.publicWebhookDelivery.update({
      where: { id: deliveryIds[0] },
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
    });
    const rows = (await makeService().claimDue({ limit: 50 })).filter(
      (r) => r.organizationId === orgId
    );
    expect(rows.map((r) => r.id)).toEqual([deliveryIds[0]]);
    expect(rows[0].attempts).toBe(2);
  });
});
