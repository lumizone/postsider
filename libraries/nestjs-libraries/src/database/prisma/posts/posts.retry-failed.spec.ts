jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { NotFoundException } from '@nestjs/common';
import { PostsService } from './posts.service';

const row = (id: string, state: string, extra: Record<string, unknown> = {}) => ({
  id,
  state,
  integrationId: `int-${id}`,
  errorCategory: null,
  releaseId: null,
  integration: { providerIdentifier: 'x' },
  ...extra,
});

const rows = () => [
  row('A', 'ERROR', { errorCategory: 'RATE_LIMITED' }),
  row('B', 'PUBLISHED'),
  row('C', 'ERROR', { errorCategory: 'UNKNOWN_OUTCOME' }),
  row('D', 'QUEUE'),
  row('E', 'ERROR', { releaseId: 'rel9' }),
  row('F', 'ERROR', { errorCategory: null }),
];

describe('PostsService.retryFailedByGroup', () => {
  let svc: any;
  const stubs = {
    getTopLevelPostsByGroup: jest.fn(),
    claimErrorForRetry: jest.fn(),
    startWorkflow: jest.fn(),
    assertOrgNotPausedForSchedule: jest.fn(),
    tiktokProblemsForStoredPost: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    svc = Object.create(PostsService.prototype);
    Object.assign(svc, stubs, { _logger: { error: jest.fn(), warn: jest.fn() } });
    stubs.getTopLevelPostsByGroup.mockResolvedValue(rows());
    stubs.claimErrorForRetry.mockResolvedValue(true);
    stubs.startWorkflow.mockResolvedValue(undefined);
    stubs.assertOrgNotPausedForSchedule.mockResolvedValue(undefined);
    stubs.tiktokProblemsForStoredPost.mockResolvedValue([]);
  });

  const byId = (res: any, id: string) => res.results.find((r: any) => r.postId === id);

  it('requeues retryable rows and skips the rest with reasons', async () => {
    const res = await svc.retryFailedByGroup('o1', 'g1', { includeUnknownOutcome: false });
    expect(Object.keys(res).sort()).toEqual(['group', 'results']);
    expect(res.group).toBe('g1');
    expect(byId(res, 'A')).toMatchObject({ action: 'requeued', previousState: 'ERROR', integrationId: 'int-A' });
    expect(byId(res, 'B')).toMatchObject({ action: 'skipped', reason: 'not_in_error_state', previousState: 'PUBLISHED' });
    expect(byId(res, 'C')).toMatchObject({ action: 'skipped', reason: 'unknown_outcome_requires_confirmation' });
    expect(byId(res, 'D')).toMatchObject({ action: 'skipped', reason: 'not_in_error_state' });
    expect(byId(res, 'E')).toMatchObject({ action: 'skipped', reason: 'already_published' });
    expect(byId(res, 'F')).toMatchObject({ action: 'requeued' });
    expect(stubs.claimErrorForRetry.mock.calls.map((c) => c[1])).toEqual(['A', 'F']);
    expect(stubs.startWorkflow).toHaveBeenCalledTimes(2);
    expect(stubs.startWorkflow).toHaveBeenCalledWith('x', 'A', 'o1', 'QUEUE');
  });

  it('requeues unknown-outcome rows when confirmed', async () => {
    const res = await svc.retryFailedByGroup('o1', 'g1', { includeUnknownOutcome: true });
    expect(byId(res, 'C').action).toBe('requeued');
  });

  it('skips a row whose claim was won by another call', async () => {
    stubs.claimErrorForRetry.mockImplementation(async (_o: string, id: string) => id !== 'A');
    const res = await svc.retryFailedByGroup('o1', 'g1', { includeUnknownOutcome: false });
    expect(byId(res, 'A')).toMatchObject({ action: 'skipped', reason: 'not_in_error_state' });
    expect(stubs.startWorkflow).not.toHaveBeenCalledWith('x', 'A', 'o1', 'QUEUE');
    expect(byId(res, 'F').action).toBe('requeued');
  });

  it('reports rearm_failed when startWorkflow rejects, others unaffected', async () => {
    stubs.startWorkflow.mockImplementation(async (_q: string, id: string) => {
      if (id === 'A') throw new Error('temporal down');
    });
    const res = await svc.retryFailedByGroup('o1', 'g1', { includeUnknownOutcome: false });
    expect(byId(res, 'A')).toMatchObject({ action: 'skipped', reason: 'rearm_failed' });
    expect(byId(res, 'F').action).toBe('requeued');
    expect(svc._logger.error).toHaveBeenCalled();
  });

  it('derives the task queue from the provider identifier', async () => {
    stubs.getTopLevelPostsByGroup.mockResolvedValue([
      row('T', 'ERROR', { integration: { providerIdentifier: 'LinkedIn-Page' } }),
    ]);
    await svc.retryFailedByGroup('o1', 'g1', { includeUnknownOutcome: false });
    expect(stubs.startWorkflow).toHaveBeenCalledWith('linkedin', 'T', 'o1', 'QUEUE');
  });

  it('refuses TikTok rows with stored problems without claiming', async () => {
    stubs.getTopLevelPostsByGroup.mockResolvedValue([
      row('T', 'ERROR', { integration: { providerIdentifier: 'tiktok' } }),
    ]);
    stubs.tiktokProblemsForStoredPost.mockResolvedValue(['bad']);
    const res = await svc.retryFailedByGroup('o1', 'g1', { includeUnknownOutcome: false });
    expect(byId(res, 'T')).toMatchObject({ action: 'skipped', reason: 'rearm_failed' });
    expect(stubs.claimErrorForRetry).not.toHaveBeenCalled();
  });

  it('throws NotFoundException for an empty group', async () => {
    stubs.getTopLevelPostsByGroup.mockResolvedValue([]);
    await expect(svc.retryFailedByGroup('o1', 'g1', { includeUnknownOutcome: false })).rejects.toThrow(
      new NotFoundException('Group not found')
    );
  });

  it('does not check the pause when no row is in ERROR', async () => {
    stubs.getTopLevelPostsByGroup.mockResolvedValue([row('B', 'PUBLISHED')]);
    await svc.retryFailedByGroup('o1', 'g1', { includeUnknownOutcome: false });
    expect(stubs.assertOrgNotPausedForSchedule).not.toHaveBeenCalled();
  });

  it('propagates a paused org and claims nothing', async () => {
    stubs.assertOrgNotPausedForSchedule.mockRejectedValue(new Error('paused'));
    await expect(svc.retryFailedByGroup('o1', 'g1', { includeUnknownOutcome: false })).rejects.toThrow('paused');
    expect(stubs.claimErrorForRetry).not.toHaveBeenCalled();
  });
});
