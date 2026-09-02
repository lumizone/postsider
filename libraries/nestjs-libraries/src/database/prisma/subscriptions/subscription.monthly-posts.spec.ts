import {
  MonthlyPostQuotaExceededError,
  SubscriptionService,
} from './subscription.service';
import { SubscriptionRepository } from './subscription.repository';

describe('SubscriptionService monthly post reservations', () => {
  // reserveMonthlyPostSlots short-circuits to null when billing is disabled
  // (isBillingEnabled checks POLAR_ACCESS_TOKEN). Deterministically enable it
  // so the quota logic under test actually runs — no real Polar token needed.
  beforeAll(() => {
    process.env.POLAR_ACCESS_TOKEN = 'test-token';
  });

  afterAll(() => {
    delete process.env.POLAR_ACCESS_TOKEN;
  });

  it('reserves the requested number of monthly post slots for the subscription period', async () => {
    const createdAt = new Date('2026-08-01T00:00:00.000Z');
    const repository = {
      getSubscriptionByOrganizationId: jest.fn().mockResolvedValue({
        subscriptionTier: 'STANDARD',
        createdAt,
      }),
      reserveMonthlyPostSlots: jest
        .fn()
        .mockResolvedValue({ id: 'reservation-1' }),
    };
    const service = new SubscriptionService(
      repository as any,
      {} as any,
      {} as any
    );

    await expect(service.reserveMonthlyPostSlots('org-1', 3)).resolves.toBe(
      'reservation-1'
    );
    expect(repository.reserveMonthlyPostSlots).toHaveBeenCalledWith(
      'org-1',
      createdAt,
      3,
      400
    );
  });

  it('rejects a reservation when the plan has no remaining monthly post slots', async () => {
    const repository = {
      getSubscriptionByOrganizationId: jest.fn().mockResolvedValue({
        subscriptionTier: 'STANDARD',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
      reserveMonthlyPostSlots: jest.fn().mockResolvedValue(null),
    };
    const service = new SubscriptionService(
      repository as any,
      {} as any,
      {} as any
    );

    await expect(
      service.reserveMonthlyPostSlots('org-1', 1)
    ).rejects.toBeInstanceOf(MonthlyPostQuotaExceededError);
  });

  it('counts durable usage by server-controlled creation time, not publish date', async () => {
    const from = new Date('2026-08-01T00:00:00.000Z');
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      post: { count: jest.fn().mockResolvedValue(0) },
      credits: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { credits: 0 } }),
        create: jest.fn().mockResolvedValue({ id: 'reservation-1' }),
      },
    };
    const repository = new SubscriptionRepository(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { $transaction: jest.fn((callback) => callback(tx)) } as any
    );

    await repository.reserveMonthlyPostSlots('org-1', from, 1, 400);

    expect(tx.post.count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        createdAt: { gte: from },
        OR: [
          { deletedAt: null, state: { in: ['QUEUE'] } },
          { state: 'PUBLISHED' },
        ],
      },
    });
  });
});
