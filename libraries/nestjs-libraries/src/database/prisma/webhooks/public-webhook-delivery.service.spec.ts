jest.mock(
  '@postsider/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher',
  () => ({
    ssrfSafeDispatcher: {},
  })
);

import { Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import {
  PublicWebhookDeliveryService,
  WEBHOOK_BACKOFF_MS,
  WEBHOOK_MAX_ATTEMPTS,
  ClaimedDelivery,
} from './public-webhook-delivery.service';

const SUB = {
  id: 'hook-1',
  url: 'https://hooks.example.com/postsider',
  secretVersion: 'version-1',
  active: true,
};

function claimed(over: Partial<ClaimedDelivery> = {}): ClaimedDelivery {
  return {
    id: 'del-1',
    organizationId: 'org-1',
    subscriptionId: 'hook-1',
    eventId: 'evt_abc',
    event: 'post.published',
    payload: {
      id: 'evt_abc',
      event: 'post.published',
      createdAt: '2026-11-04T00:00:00.000Z',
      organizationId: 'org-1',
      data: { postId: 'post-1' },
    },
    attempts: 1,
    createdAt: new Date(),
    ...over,
  };
}

function makeService(
  opts: {
    subscription?: any;
    subUpdate?: jest.Mock;
    rowUpdate?: jest.Mock;
    findMany?: jest.Mock;
    createMany?: jest.Mock;
    queryRaw?: jest.Mock;
  } = {}
) {
  const prisma = {
    publicWebhookSubscription: {
      findMany: opts.findMany ?? jest.fn().mockResolvedValue([]),
      findUnique: jest
        .fn()
        .mockResolvedValue('subscription' in opts ? opts.subscription : SUB),
      update: opts.subUpdate ?? jest.fn().mockResolvedValue({}),
    },
    publicWebhookDelivery: {
      createMany: opts.createMany ?? jest.fn().mockResolvedValue({ count: 0 }),
      update: opts.rowUpdate ?? jest.fn().mockResolvedValue({}),
    },
    $queryRaw: opts.queryRaw ?? jest.fn().mockResolvedValue([]),
  };
  const subscriptions = {
    deriveSecret: jest.fn().mockReturnValue('pwhsec_test'),
  };
  return {
    service: new PublicWebhookDeliveryService(prisma as any, subscriptions as any),
    prisma,
  };
}

describe('PublicWebhookDeliveryService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('exposes the backoff schedule and limits', () => {
    expect(WEBHOOK_BACKOFF_MS).toEqual([
      60000, 300000, 1800000, 7200000, 21600000, 43200000,
    ]);
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(7);
  });

  it('uses tenant and event filters before delivery', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const createMany = jest.fn();
    const { service } = makeService({ findMany, createMany });

    await expect(
      service.deliver('org-1', 'post.published', { postId: 'post-1' })
    ).resolves.toMatchObject({ attempted: 0, delivered: 0, failed: 0 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org-1',
          active: true,
          events: { has: 'post.published' },
        },
      })
    );
    expect(createMany).not.toHaveBeenCalled();
  });

  it('enqueue writes one PENDING row per target', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const { service } = makeService({
      findMany: jest.fn().mockResolvedValue([{ id: 'hook-1' }]),
      createMany,
    });

    const result = await service.enqueue('org-1', 'post.published', {
      postId: 'post-1',
    });

    const row = createMany.mock.calls[0][0].data[0];
    expect(row).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        organizationId: 'org-1',
        subscriptionId: 'hook-1',
        eventId: expect.stringMatching(/^evt_/),
        event: 'post.published',
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: expect.any(Date),
      })
    );
    expect(row.payload).toEqual({
      id: row.eventId,
      event: 'post.published',
      createdAt: expect.any(String),
      organizationId: 'org-1',
      data: { postId: 'post-1' },
    });
    expect(result).toEqual({ eventId: row.eventId, deliveryIds: [row.id] });
  });

  it('deliver sends a signed envelope and records success', async () => {
    const rowUpdate = jest.fn().mockResolvedValue({});
    const subUpdate = jest.fn().mockResolvedValue({});
    const row = claimed();
    const { service } = makeService({
      findMany: jest.fn().mockResolvedValue([{ id: 'hook-1' }]),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      queryRaw: jest.fn().mockResolvedValue([row]),
      rowUpdate,
      subUpdate,
    });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 }) as any;

    const result = await service.deliver('org-1', 'post.published', {
      postId: 'post-1',
    });

    expect(result).toMatchObject({ attempted: 1, delivered: 1, failed: 0 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, request] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe(SUB.url);
    expect(request.redirect).toBe('error');
    expect(request.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'application/json',
        'User-Agent': 'PostSider-Webhooks/1.0',
        'X-Webhook-Attempt': '1',
        'X-Postsider-Event': 'post.published',
        'X-Postsider-Event-Id': row.payload.id,
        'X-Postsider-Timestamp': expect.any(String),
        'X-Postsider-Signature': expect.stringMatching(/^sha256=/),
      })
    );
    expect(request.body).toBe(JSON.stringify(row.payload));
    const ts = request.headers['X-Postsider-Timestamp'];
    expect(request.headers['X-Postsider-Signature']).toBe(
      `sha256=${createHmac('sha256', 'pwhsec_test').update(`${ts}.${request.body}`).digest('hex')}`
    );
    expect(rowUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'del-1' },
        data: expect.objectContaining({
          status: 'SUCCEEDED',
          lastStatusCode: 204,
          deliveredAt: expect.any(Date),
          nextAttemptAt: null,
        }),
      })
    );
    expect(subUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'hook-1' },
        data: expect.objectContaining({ consecutiveFailures: 0 }),
      })
    );
  });

  it('retries a 500 with the first backoff and does not touch the counter', async () => {
    const rowUpdate = jest.fn().mockResolvedValue({});
    const subUpdate = jest.fn().mockResolvedValue({});
    const { service } = makeService({ rowUpdate, subUpdate });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as any;

    await expect(service.attempt(claimed())).resolves.toBe('RETRY');

    const data = rowUpdate.mock.calls[0][0].data;
    expect(data.status).not.toBe('FAILED');
    expect(Math.abs(data.nextAttemptAt.getTime() - (Date.now() + 60000))).toBeLessThan(2000);
    expect(data.lastStatusCode).toBe(500);
    expect(data.lastError).toBe('HTTP 500');
    expect(subUpdate).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3, 4, 5, 6])('attempt %i schedules the matching backoff', async (n) => {
    const rowUpdate = jest.fn().mockResolvedValue({});
    const { service } = makeService({ rowUpdate });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as any;

    await expect(service.attempt(claimed({ attempts: n }))).resolves.toBe('RETRY');

    const next = rowUpdate.mock.calls[0][0].data.nextAttemptAt as Date;
    expect(Math.abs(next.getTime() - (Date.now() + WEBHOOK_BACKOFF_MS[n - 1]))).toBeLessThan(2000);
  });

  it('fails permanently on the last attempt and counts one failure', async () => {
    const rowUpdate = jest.fn().mockResolvedValue({});
    const subUpdate = jest.fn().mockResolvedValue({ consecutiveFailures: 1 });
    const { service } = makeService({ rowUpdate, subUpdate });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as any;

    await expect(service.attempt(claimed({ attempts: 7 }))).resolves.toBe('FAILED');

    expect(rowUpdate.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ status: 'FAILED', nextAttemptAt: null })
    );
    expect(subUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consecutiveFailures: { increment: 1 } }),
      })
    );
  });

  it('fails a 400 immediately and treats 429 as retryable', async () => {
    const rowUpdate = jest.fn().mockResolvedValue({});
    const subUpdate = jest.fn().mockResolvedValue({ consecutiveFailures: 1 });
    const { service } = makeService({ rowUpdate, subUpdate });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400 }) as any;

    await expect(service.attempt(claimed())).resolves.toBe('FAILED');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(subUpdate).toHaveBeenCalledTimes(1);
    expect(subUpdate.mock.calls[0][0].data.consecutiveFailures).toEqual({ increment: 1 });

    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 }) as any;
    await expect(service.attempt(claimed())).resolves.toBe('RETRY');
  });

  it('retries when fetch throws and records the error text', async () => {
    const rowUpdate = jest.fn().mockResolvedValue({});
    const { service } = makeService({ rowUpdate });
    global.fetch = jest.fn().mockRejectedValue(new Error('socket hang up')) as any;

    await expect(service.attempt(claimed())).resolves.toBe('RETRY');
    const data = rowUpdate.mock.calls[0][0].data;
    expect(data.lastError).toContain('socket hang up');
    expect(data.lastStatusCode).toBeNull();
  });

  it('sends the attempt counter of the claimed row', async () => {
    const { service } = makeService();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as any;

    await service.attempt(claimed({ attempts: 3 }));
    expect((global.fetch as jest.Mock).mock.calls[0][1].headers['X-Webhook-Attempt']).toBe('3');
  });

  it('does not throw or resend when persisting success fails', async () => {
    const rowUpdate = jest.fn().mockRejectedValue(new Error('database unavailable'));
    const { service } = makeService({ rowUpdate });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 204 }) as any;

    await expect(service.attempt(claimed())).resolves.toBe('SUCCEEDED');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('deactivates the subscription on the 10th consecutive failure', async () => {
    const subUpdate = jest
      .fn()
      .mockResolvedValueOnce({ consecutiveFailures: 10 })
      .mockResolvedValue({});
    const { service } = makeService({ subUpdate });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400 }) as any;

    await service.attempt(claimed());
    expect(subUpdate).toHaveBeenCalledTimes(2);
    expect(subUpdate.mock.calls[1][0].data).toEqual({
      active: false,
      disabledAt: expect.any(Date),
    });
  });

  it('webhook.test fails on first error, skips counters, works when inactive', async () => {
    const rowUpdate = jest.fn().mockResolvedValue({});
    const subUpdate = jest.fn().mockResolvedValue({});
    const { service } = makeService({
      subscription: { ...SUB, active: false },
      rowUpdate,
      subUpdate,
    });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as any;

    await expect(
      service.attempt(claimed({ event: 'webhook.test' }))
    ).resolves.toBe('FAILED');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(rowUpdate.mock.calls[0][0].data.status).toBe('FAILED');
    expect(subUpdate).not.toHaveBeenCalled();
  });

  it('skips an inactive subscription for normal events without fetching', async () => {
    const rowUpdate = jest.fn().mockResolvedValue({});
    const subUpdate = jest.fn();
    const { service } = makeService({
      subscription: { ...SUB, active: false },
      rowUpdate,
      subUpdate,
    });
    global.fetch = jest.fn() as any;

    await expect(service.attempt(claimed())).resolves.toBe('SKIPPED');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(rowUpdate.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        status: 'FAILED',
        nextAttemptAt: null,
        lastError: 'subscription_inactive',
      })
    );
    expect(subUpdate).not.toHaveBeenCalled();
  });

  it('processDue claims once and attempts every claimed row', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValue([claimed({ id: 'a' }), claimed({ id: 'b' })]);
    const { service } = makeService({ queryRaw });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as any;

    await expect(service.processDue(10)).resolves.toEqual({
      claimed: 2,
      succeeded: 2,
      retried: 0,
      failed: 0,
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('enqueue with only targets one subscription by id and organization', async () => {
    const findMany = jest.fn();
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const { service, prisma } = makeService({ findMany, createMany });

    const result = await service.enqueue('org-1', 'webhook.test', { ok: true }, {
      subscriptionId: 's1',
    });
    expect(findMany).not.toHaveBeenCalled();
    expect(prisma.publicWebhookSubscription.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1', organizationId: 'org-1' } })
    );
    expect(result.deliveryIds).toHaveLength(1);

    const missing = makeService({ subscription: null, createMany: jest.fn() });
    await expect(
      missing.service.enqueue('org-1', 'webhook.test', {}, { subscriptionId: 'nope' })
    ).resolves.toMatchObject({ deliveryIds: [] });
  });

  it('does not throw when recording a permanent failure fails', async () => {
    const subUpdate = jest.fn().mockRejectedValue(new Error('db down'));
    const { service } = makeService({ subUpdate });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400 }) as any;

    await expect(service.attempt(claimed())).resolves.toBe('FAILED');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns RETRY instead of rejecting when the subscription lookup throws', async () => {
    const { service, prisma } = makeService();
    prisma.publicWebhookSubscription.findUnique.mockRejectedValue(new Error('db down'));
    global.fetch = jest.fn() as any;

    await expect(service.attempt(claimed())).resolves.toBe('RETRY');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns RETRY without fetching when secret derivation throws', async () => {
    const { service } = makeService();
    (service as any).subscriptions.deriveSecret.mockImplementation(() => {
      throw new Error('bad secret');
    });
    global.fetch = jest.fn() as any;

    await expect(service.attempt(claimed())).resolves.toBe('RETRY');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('processDue and deliver survive a crashing attempt', async () => {
    const queryRaw = jest
      .fn()
      .mockResolvedValue([claimed({ id: 'a' }), claimed({ id: 'b' })]);
    const { service, prisma } = makeService({
      queryRaw,
      findMany: jest.fn().mockResolvedValue([{ id: 'hook-1' }]),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    });
    prisma.publicWebhookSubscription.findUnique
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(SUB);
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as any;

    await expect(service.processDue(10)).resolves.toEqual({
      claimed: 2,
      succeeded: 1,
      retried: 1,
      failed: 0,
    });

    prisma.publicWebhookSubscription.findUnique.mockRejectedValueOnce(new Error('x'));
    queryRaw.mockResolvedValue([claimed()]);
    await expect(service.deliver('org-1', 'post.published', {})).resolves.toMatchObject({
      attempted: 1,
      delivered: 0,
      failed: 1,
    });
  });
});
