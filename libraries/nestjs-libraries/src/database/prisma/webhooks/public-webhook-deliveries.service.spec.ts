import { PublicWebhookDeliveriesService } from './public-webhook-deliveries.service';

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  eventId: 'evt_1',
  event: 'post.failed',
  status: 'FAILED',
  attempts: 3,
  nextAttemptAt: null,
  lastStatusCode: 500,
  lastError: 'HTTP 500',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  deliveredAt: null,
  ...extra,
});

function setup(owned = true) {
  const prisma: any = {
    publicWebhookSubscription: {
      findFirst: jest.fn().mockResolvedValue(owned ? { id: 's1' } : null),
    },
    publicWebhookDelivery: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      update: jest.fn(),
    },
  };
  const delivery: any = {
    enqueue: jest.fn().mockResolvedValue({ eventId: 'e', deliveryIds: ['d9'] }),
    claimDue: jest.fn().mockResolvedValue([{ id: 'claimed' }]),
    attempt: jest.fn().mockResolvedValue('SUCCEEDED'),
  };
  return { prisma, delivery, svc: new PublicWebhookDeliveriesService(prisma, delivery) };
}

describe('PublicWebhookDeliveriesService', () => {
  describe('list', () => {
    it('404s a foreign subscription without querying deliveries', async () => {
      const { svc, prisma } = setup(false);
      await expect(svc.list('org-1', 's1', {})).rejects.toMatchObject({ status: 404 });
      expect(prisma.publicWebhookDelivery.findMany).not.toHaveBeenCalled();
    });

    it('scopes by subscription and org, newest first, without payload', async () => {
      const { svc, prisma } = setup();
      await svc.list('org-1', 's1', {});
      const arg = prisma.publicWebhookDelivery.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({ subscriptionId: 's1', organizationId: 'org-1' });
      expect(arg.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
      expect(arg.take).toBe(26);
      expect(arg.select).not.toHaveProperty('payload');
      expect(arg.cursor).toBeUndefined();
    });

    it('returns nextCursor when an extra row exists', async () => {
      const { svc, prisma } = setup();
      prisma.publicWebhookDelivery.findMany.mockResolvedValue(
        Array.from({ length: 27 }, (_, i) => row(`d${i}`))
      );
      const result = await svc.list('org-1', 's1', {});
      expect(result.deliveries).toHaveLength(25);
      expect(result.nextCursor).toBe('d24');
    });

    it('returns null cursor on the last page', async () => {
      const { svc, prisma } = setup();
      prisma.publicWebhookDelivery.findMany.mockResolvedValue([row('a')]);
      expect((await svc.list('org-1', 's1', {})).nextCursor).toBeNull();
    });

    it.each([
      ['1000', 101],
      ['abc', 26],
      ['0', 2],
    ])('limit %s -> take %i', async (limit, take) => {
      const { svc, prisma } = setup();
      await svc.list('org-1', 's1', { limit });
      expect(prisma.publicWebhookDelivery.findMany.mock.calls[0][0].take).toBe(take);
    });

    it('passes the cursor with skip 1', async () => {
      const { svc, prisma } = setup();
      await svc.list('org-1', 's1', { cursor: 'c1' });
      const arg = prisma.publicWebhookDelivery.findMany.mock.calls[0][0];
      expect(arg.cursor).toEqual({ id: 'c1' });
      expect(arg.skip).toBe(1);
    });

    it('truncates lastError to 500 chars', async () => {
      const { svc, prisma } = setup();
      prisma.publicWebhookDelivery.findMany.mockResolvedValue([
        row('a', { lastError: 'x'.repeat(900) }),
      ]);
      expect((await svc.list('org-1', 's1', {})).deliveries[0].lastError).toHaveLength(500);
    });
  });

  describe('replay', () => {
    it('404s a foreign subscription and creates nothing', async () => {
      const { svc, prisma } = setup(false);
      await expect(svc.replay('org-1', 's1', 'd1')).rejects.toMatchObject({ status: 404 });
      expect(prisma.publicWebhookDelivery.create).not.toHaveBeenCalled();
    });

    it('404s a delivery outside the subscription or org', async () => {
      const { svc, prisma } = setup();
      prisma.publicWebhookDelivery.findFirst.mockResolvedValue(null);
      await expect(svc.replay('org-1', 's1', 'd1')).rejects.toMatchObject({
        status: 404,
        message: 'Delivery not found',
      });
      expect(prisma.publicWebhookDelivery.findFirst.mock.calls[0][0].where).toEqual({
        id: 'd1',
        subscriptionId: 's1',
        organizationId: 'org-1',
      });
      expect(prisma.publicWebhookDelivery.create).not.toHaveBeenCalled();
    });

    it('409s a pending delivery', async () => {
      const { svc, prisma } = setup();
      prisma.publicWebhookDelivery.findFirst.mockResolvedValue(
        row('d1', { status: 'PENDING', payload: {} })
      );
      await expect(svc.replay('org-1', 's1', 'd1')).rejects.toMatchObject({ status: 409 });
      expect(prisma.publicWebhookDelivery.create).not.toHaveBeenCalled();
    });

    it('clones a failed delivery into one new row, attempts it and returns the new summary', async () => {
      const { svc, prisma, delivery } = setup();
      const payload = { id: 'evt_1', data: { a: 1 } };
      prisma.publicWebhookDelivery.findFirst
        .mockResolvedValueOnce(row('d1', { payload, organizationId: 'org-1' }))
        .mockResolvedValueOnce(row('new', { status: 'SUCCEEDED' }));
      const result = await svc.replay('org-1', 's1', 'd1');

      expect(prisma.publicWebhookDelivery.create).toHaveBeenCalledTimes(1);
      const data = prisma.publicWebhookDelivery.create.mock.calls[0][0].data;
      expect(data.id).not.toBe('d1');
      expect(data).toMatchObject({
        organizationId: 'org-1',
        subscriptionId: 's1',
        eventId: 'evt_1',
        event: 'post.failed',
        payload,
        attempts: 0,
        status: 'PENDING',
      });
      expect(data.nextAttemptAt).toBeInstanceOf(Date);
      expect(delivery.claimDue).toHaveBeenCalledWith({ limit: 1, ids: [data.id] });
      expect(delivery.attempt).toHaveBeenCalledWith({ id: 'claimed' });
      expect(prisma.publicWebhookDelivery.update).not.toHaveBeenCalled();
      expect(result.id).toBe('new');
      expect(result).not.toHaveProperty('payload');
    });
  });

  describe('sendTest', () => {
    it('404s a foreign subscription without enqueueing', async () => {
      const { svc, delivery } = setup(false);
      await expect(svc.sendTest('org-1', 's1')).rejects.toMatchObject({ status: 404 });
      expect(delivery.enqueue).not.toHaveBeenCalled();
    });

    it('enqueues a test event, attempts it and returns the summary', async () => {
      const { svc, prisma, delivery } = setup();
      prisma.publicWebhookDelivery.findFirst.mockResolvedValue(row('d9', { status: 'SUCCEEDED' }));
      const result = await svc.sendTest('org-1', 's1');
      expect(delivery.enqueue).toHaveBeenCalledWith(
        'org-1',
        'webhook.test',
        expect.objectContaining({ subscriptionId: 's1' }),
        { subscriptionId: 's1' }
      );
      expect(delivery.claimDue).toHaveBeenCalledWith({ limit: 1, ids: ['d9'] });
      expect(delivery.attempt).toHaveBeenCalled();
      expect(result.id).toBe('d9');
    });

    it('404s when no row was created', async () => {
      const { svc, delivery } = setup();
      delivery.enqueue.mockResolvedValue({ eventId: 'e', deliveryIds: [] });
      await expect(svc.sendTest('org-1', 's1')).rejects.toMatchObject({ status: 404 });
    });
  });
});
