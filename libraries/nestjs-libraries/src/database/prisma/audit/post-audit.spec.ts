import { recordPostEvent } from './post-audit';

const entry = {
  organizationId: 'o1',
  event: 'post.created' as const,
  targetType: 'post' as const,
  targetId: 'p1',
};

describe('recordPostEvent', () => {
  it('resolves when audit is undefined', async () => {
    await expect(recordPostEvent(undefined, entry)).resolves.toBeUndefined();
  });
  it('swallows a synchronous throw', async () => {
    const audit: any = {
      logResourceEvent: () => {
        throw new Error('boom');
      },
    };
    await expect(recordPostEvent(audit, entry)).resolves.toBeUndefined();
  });
  it('swallows a rejection', async () => {
    const audit: any = { logResourceEvent: () => Promise.reject(new Error('boom')) };
    await expect(recordPostEvent(audit, entry)).resolves.toBeUndefined();
  });
  it('forwards the entry', async () => {
    const logResourceEvent = jest.fn().mockResolvedValue(undefined);
    await recordPostEvent({ logResourceEvent } as any, entry);
    expect(logResourceEvent).toHaveBeenCalledWith(entry);
  });
});
