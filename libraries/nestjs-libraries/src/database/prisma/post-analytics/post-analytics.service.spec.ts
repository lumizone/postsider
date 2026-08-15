import { PostAnalyticsService } from './post-analytics.service';

describe('PostAnalyticsService', () => {
  it('normalizes valid provider points and ignores malformed values', async () => {
    const repository = { upsertMany: jest.fn().mockResolvedValue(undefined) };
    const service = new PostAnalyticsService(repository as any);

    await service.record('org-1', 'post-1', [
      {
        label: 'Likes',
        data: [
          { total: '12', date: '2026-08-12T00:00:00.000Z' },
          { total: 'not-a-number', date: '2026-08-12T01:00:00.000Z' },
          { total: '4', date: 'invalid' },
        ],
      },
    ]);

    expect(repository.upsertMany).toHaveBeenCalledWith('org-1', 'post-1', [
      {
        metric: 'Likes',
        value: 12,
        measuredAt: new Date('2026-08-12T00:00:00.000Z'),
      },
    ]);
  });

  it('does not write when the provider returns no usable points', async () => {
    const repository = { upsertMany: jest.fn() };
    const service = new PostAnalyticsService(repository as any);

    await service.record('org-1', 'post-1', []);

    expect(repository.upsertMany).not.toHaveBeenCalled();
  });
});
