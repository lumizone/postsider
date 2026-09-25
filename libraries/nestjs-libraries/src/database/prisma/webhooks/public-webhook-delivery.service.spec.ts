jest.mock(
  '@postsider/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher',
  () => ({
    ssrfSafeDispatcher: {},
  })
);

import { PublicWebhookDeliveryService } from './public-webhook-delivery.service';

function makeService(model: Record<string, jest.Mock>) {
  const subscriptions = {
    deriveSecret: jest.fn().mockReturnValue('pwhsec_test'),
  };
  return {
    service: new PublicWebhookDeliveryService(
      { publicWebhookSubscription: model } as any,
      subscriptions as any
    ),
    subscriptions,
  };
}

describe('PublicWebhookDeliveryService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses tenant and event filters before delivery', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = makeService({ findMany });

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
  });

  it('sends a signed stable envelope and resets failure state on success', async () => {
    const update = jest.fn().mockResolvedValue({});
    const { service } = makeService({
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'hook-1',
          url: 'https://hooks.example.com/postsider',
          secretVersion: 'version-1',
        },
      ]),
      update,
    });
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 204 }) as any;

    const result = await service.deliver('org-1', 'post.published', {
      postId: 'post-1',
    });

    expect(result).toMatchObject({ attempted: 1, delivered: 1, failed: 0 });
    const [url, request] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://hooks.example.com/postsider');
    expect(request.headers).toEqual(
      expect.objectContaining({
        'X-Postsider-Event': 'post.published',
        'X-Postsider-Event-Id': expect.stringMatching(/^evt_/),
        'X-Postsider-Signature': expect.stringMatching(/^sha256=/),
      })
    );
    expect(JSON.parse(request.body)).toEqual(
      expect.objectContaining({
        event: 'post.published',
        organizationId: 'org-1',
        data: { postId: 'post-1' },
      })
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'hook-1' },
        data: expect.objectContaining({ consecutiveFailures: 0 }),
      })
    );
  });

  it('does not retry a non-429 client error and records one delivery failure', async () => {
    const update = jest.fn().mockResolvedValueOnce({ consecutiveFailures: 1 });
    const { service } = makeService({
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'hook-1',
          url: 'https://hooks.example.com/postsider',
          secretVersion: 'version-1',
        },
      ]),
      update,
    });
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 400 }) as any;

    await expect(
      service.deliver('org-1', 'post.failed', { postId: 'post-1' })
    ).resolves.toMatchObject({ attempted: 1, delivered: 0, failed: 1 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          consecutiveFailures: { increment: 1 },
        }),
      })
    );
  });
});
