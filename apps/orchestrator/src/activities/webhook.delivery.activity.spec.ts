import {
  AUDIT_RESOURCE_RETENTION_DAYS,
  DELIVERY_RETENTION_DAYS,
  IDEMPOTENCY_RETENTION_DAYS,
  PURGE_BATCH,
  WebhookDeliveryActivity,
} from './webhook.delivery.activity';

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id${i}` }));

const build = () => {
  const delivery = { processDue: jest.fn() };
  const prisma = {
    publicWebhookDelivery: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    publicApiIdempotency: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const activity = new WebhookDeliveryActivity(delivery as never, prisma as never);
  return { activity, delivery, prisma };
};

describe('WebhookDeliveryActivity', () => {
  it('delegates to processDue with no arguments and returns its result', async () => {
    const { activity, delivery } = build();
    const result = { claimed: 4, succeeded: 3, retried: 1, failed: 0 };
    delivery.processDue.mockResolvedValue(result);

    await expect(activity.processDueWebhookDeliveries()).resolves.toEqual(
      result
    );
    expect(delivery.processDue).toHaveBeenCalledTimes(1);
    expect(delivery.processDue).toHaveBeenCalledWith();
  });

  describe('purgeExpiredPublicApiRecords', () => {
    const now = new Date('2026-11-04T00:00:00Z');

    it('exports the retention constants', () => {
      expect(DELIVERY_RETENTION_DAYS).toBe(30);
      expect(IDEMPOTENCY_RETENTION_DAYS).toBe(7);
      expect(PURGE_BATCH).toBe(5000);
    });

    it('uses the 30 and 7 day cutoffs and never selects PENDING deliveries', async () => {
      const { activity, prisma } = build();
      await activity.purgeExpiredPublicApiRecords(now);

      expect(prisma.publicWebhookDelivery.findMany).toHaveBeenCalledWith({
        where: {
          createdAt: { lt: new Date('2026-10-05T00:00:00Z') },
          status: { not: 'PENDING' },
        },
        select: { id: true },
        take: 5000,
      });
      expect(prisma.publicApiIdempotency.findMany).toHaveBeenCalledWith({
        where: { createdAt: { lt: new Date('2026-10-28T00:00:00Z') } },
        select: { id: true },
        take: 5000,
      });
    });

    it('loops full batches and sums the deleted counts', async () => {
      const { activity, prisma } = build();
      prisma.publicWebhookDelivery.findMany
        .mockResolvedValueOnce(ids(5000))
        .mockResolvedValueOnce(ids(3));
      prisma.publicWebhookDelivery.deleteMany
        .mockResolvedValueOnce({ count: 5000 })
        .mockResolvedValueOnce({ count: 3 });

      const out = await activity.purgeExpiredPublicApiRecords(now);

      expect(prisma.publicWebhookDelivery.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.publicWebhookDelivery.deleteMany).toHaveBeenCalledTimes(2);
      expect(prisma.publicWebhookDelivery.deleteMany).toHaveBeenLastCalledWith({
        where: { id: { in: ['id0', 'id1', 'id2'] } },
      });
      expect(out).toMatchObject({ deliveries: 5003, idempotency: 0 });
    });

    it('purges idempotency rows and returns both counts', async () => {
      const { activity, prisma } = build();
      prisma.publicWebhookDelivery.findMany.mockResolvedValueOnce(ids(2));
      prisma.publicWebhookDelivery.deleteMany.mockResolvedValueOnce({ count: 2 });
      prisma.publicApiIdempotency.findMany.mockResolvedValueOnce(ids(4));
      prisma.publicApiIdempotency.deleteMany.mockResolvedValueOnce({ count: 4 });

      await expect(activity.purgeExpiredPublicApiRecords(now)).resolves.toMatchObject({
        deliveries: 2,
        idempotency: 4,
      });
    });

    it('does not delete when nothing is expired', async () => {
      const { activity, prisma } = build();
      await expect(activity.purgeExpiredPublicApiRecords(now)).resolves.toEqual({
        deliveries: 0,
        idempotency: 0,
        auditEvents: 0,
      });
      expect(prisma.publicWebhookDelivery.deleteMany).not.toHaveBeenCalled();
      expect(prisma.publicApiIdempotency.deleteMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.deleteMany).not.toHaveBeenCalled();
    });

    describe('audit retention', () => {
      const DAY = 24 * 60 * 60 * 1000;

      it('exports 365 days', () => {
        expect(AUDIT_RESOURCE_RETENTION_DAYS).toBe(365);
      });

      it('filters only resource events older than 365 days, exactly', async () => {
        const { activity, prisma } = build();
        await activity.purgeExpiredPublicApiRecords(now);
        const cutoff = new Date(now.getTime() - 365 * DAY);
        expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
          where: { type: 'resource', createdAt: { lt: cutoff } },
          select: { id: true },
          take: PURGE_BATCH,
        });
        const where = prisma.auditLog.findMany.mock.calls[0][0].where;
        expect(Object.keys(where).sort()).toEqual(['createdAt', 'type']);
        expect(where.createdAt.lt.getTime()).toBe(Date.parse('2025-11-04T00:00:00Z'));
        // a row 364 days old is newer than the cutoff, so it is outside the filter
        expect(new Date(now.getTime() - 364 * DAY) < where.createdAt.lt).toBe(false);
        expect(new Date(now.getTime() - 366 * DAY) < where.createdAt.lt).toBe(true);
      });

      it('returns the deleted count as auditEvents', async () => {
        const { activity, prisma } = build();
        prisma.auditLog.findMany.mockResolvedValueOnce(ids(3));
        prisma.auditLog.deleteMany.mockResolvedValueOnce({ count: 3 });
        await expect(activity.purgeExpiredPublicApiRecords(now)).resolves.toEqual({
          deliveries: 0,
          idempotency: 0,
          auditEvents: 3,
        });
      });

      it('loops on full batches and stops on a short one', async () => {
        const { activity, prisma } = build();
        prisma.auditLog.findMany
          .mockResolvedValueOnce(ids(PURGE_BATCH))
          .mockResolvedValueOnce(ids(2));
        prisma.auditLog.deleteMany
          .mockResolvedValueOnce({ count: PURGE_BATCH })
          .mockResolvedValueOnce({ count: 2 });
        const out = await activity.purgeExpiredPublicApiRecords(now);
        expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(2);
        expect(out.auditEvents).toBe(PURGE_BATCH + 2);
      });

      it('rethrows an audit failure after deliveries and idempotency ran', async () => {
        const { activity, prisma } = build();
        prisma.publicWebhookDelivery.findMany.mockResolvedValueOnce(ids(1));
        prisma.publicWebhookDelivery.deleteMany.mockResolvedValueOnce({ count: 1 });
        prisma.publicApiIdempotency.findMany.mockResolvedValueOnce(ids(1));
        prisma.publicApiIdempotency.deleteMany.mockResolvedValueOnce({ count: 1 });
        prisma.auditLog.findMany.mockResolvedValueOnce(ids(1));
        prisma.auditLog.deleteMany.mockRejectedValueOnce(new Error('db down'));
        await expect(activity.purgeExpiredPublicApiRecords(now)).rejects.toThrow('db down');
        expect(prisma.publicWebhookDelivery.deleteMany).toHaveBeenCalledTimes(1);
        expect(prisma.publicApiIdempotency.deleteMany).toHaveBeenCalledTimes(1);
      });
    });
  });
});
