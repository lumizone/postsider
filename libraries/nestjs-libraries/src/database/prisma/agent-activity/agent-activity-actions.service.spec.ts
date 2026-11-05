jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { AgentActivityActionsService } from './agent-activity-actions.service';
import { PolicyBlockedException } from '../../../policies/policy-errors';

const make = () => {
  const resolved = new Set<string>();
  const approval = {
    approve: jest.fn(async (_o: string, id: string) => {
      if (id === 'boom') throw new Error('db exploded '.repeat(40));
      if (id === 'weird') throw 'not an error';
      if (id === 'gone') throw new NotFoundException('Approval not found');
      if (resolved.has(id)) throw new BadRequestException('This approval has already been resolved');
      resolved.add(id);
      return { approved: true, postId: `post-${id}` };
    }),
    reject: jest.fn(async (_o: string, id: string) => {
      if (resolved.has(id)) throw new BadRequestException('This approval has already been resolved');
      resolved.add(id);
      return { rejected: true, postId: `post-${id}` };
    }),
  };
  const approvalRepo = {
    getById: jest.fn(async (_o: string, id: string) =>
      id === 'foreign' ? null : { id, postId: `post-${id}`, status: 'PENDING' }
    ),
  };
  const order: string[] = [];
  const gate = {
    gateRetry: jest.fn(async () => {
      order.push('gate');
      return {
        policy: { effect: 'REQUIRE_APPROVAL', matched: [{ ruleId: 'r', name: 'R', effect: 'REQUIRE_APPROVAL' }], channels: [] },
        approvalPostIds: new Set(['p-appr']),
        evaluatedPostIds: new Set(['p-appr', 'p-ok']),
      };
    }),
    routeRetry: jest.fn(async () => true),
  };
  const posts = {
    retryFailedByGroup: jest.fn(async (_o: string, group: string) => {
      order.push('retry');
      return { group, results: [{ postId: 'p-ok', integrationId: 'i', previousState: 'ERROR', action: 'requeued' }] };
    }),
  };
  const svc = new AgentActivityActionsService(approval as any, approvalRepo as any, posts as any, gate as any);
  return { svc, approval, approvalRepo, gate, posts, order };
};

describe('bulkResolve', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('a USER role gets 403 and nothing is touched', async () => {
    const { svc, approval, approvalRepo } = make();
    await expect(
      svc.bulkResolve('org-1', 'u1', 'USER', { action: 'approve', approvalIds: ['a'] } as any)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(approval.approve).not.toHaveBeenCalled();
    expect(approval.reject).not.toHaveBeenCalled();
    expect(approvalRepo.getById).not.toHaveBeenCalled();
  });

  it('a mixed batch never aborts and reports each outcome', async () => {
    const { svc, approval, approvalRepo } = make();
    const out = await svc.bulkResolve('org-1', 'u1', 'ADMIN', {
      action: 'approve',
      approvalIds: ['ok', 'second', 'foreign', 'boom', 'gone', 'weird'],
    } as any);
    expect(out.results.map((r) => r.status)).toEqual(['done', 'done', 'skipped', 'failed', 'skipped', 'failed']);
    expect(out.results[2]).toEqual({ approvalId: 'foreign', postId: null, status: 'skipped', reason: 'not_found' });
    expect(out.results[3].reason).toBe('error');
    expect(out.results[3].message!.length).toBeLessThanOrEqual(200);
    expect(out.results[4]).toMatchObject({ status: 'skipped', reason: 'not_found' });
    expect(out.results[5]).toMatchObject({ status: 'failed', reason: 'error', message: 'Unexpected error' });
    expect(out.summary).toEqual({ done: 2, skipped: 2, failed: 2 });
    expect(approvalRepo.getById).toHaveBeenCalledTimes(6);
    for (const call of approvalRepo.getById.mock.calls) expect(call[0]).toBe('org-1');
    expect(approval.approve).toHaveBeenCalledTimes(5);
  });

  it('maps an already resolved approval to skipped/already_resolved', async () => {
    const { svc } = make();
    const first = await svc.bulkResolve('org-1', 'u1', 'ADMIN', { action: 'approve', approvalIds: ['a', 'b'] } as any);
    expect(first.summary).toEqual({ done: 2, skipped: 0, failed: 0 });
    const second = await svc.bulkResolve('org-1', 'u1', 'ADMIN', { action: 'approve', approvalIds: ['a', 'b'] } as any);
    expect(second.results.every((r) => r.status === 'skipped' && r.reason === 'already_resolved')).toBe(true);
    expect(second.results[0].postId).toBe('post-a');
    expect(second.summary).toEqual({ done: 0, skipped: 2, failed: 0 });
  });

  it('mixed batch of ok, already resolved, foreign and boom attempts all four', async () => {
    const { svc, approval } = make();
    await svc.bulkResolve('org-1', 'u1', 'ADMIN', { action: 'approve', approvalIds: ['pre'] } as any);
    const out = await svc.bulkResolve('org-1', 'u1', 'ADMIN', {
      action: 'approve',
      approvalIds: ['ok', 'pre', 'foreign', 'boom'],
    } as any);
    expect(out.results.map((r) => [r.status, r.reason])).toEqual([
      ['done', undefined],
      ['skipped', 'already_resolved'],
      ['skipped', 'not_found'],
      ['failed', 'error'],
    ]);
    expect(out.summary).toEqual({ done: 1, skipped: 2, failed: 1 });
    expect(approval.approve).toHaveBeenCalledTimes(4);
  });

  it('an empty or blank reject note is stored as null/undefined, not an empty string', async () => {
    const { svc, approval } = make();
    await svc.bulkResolve('org-1', 'u1', 'ADMIN', { action: 'reject', approvalIds: ['a', 'b'], note: '   ' } as any);
    await svc.bulkResolve('org-1', 'u1', 'ADMIN', { action: 'reject', approvalIds: ['c'], note: '' } as any);
    for (const call of approval.reject.mock.calls) expect(call[4]).toBeUndefined();
  });

  it('reject passes the note, approve does not', async () => {
    const { svc, approval } = make();
    await svc.bulkResolve('org-1', 'u1', 'SUPERADMIN', { action: 'reject', approvalIds: ['a'], note: 'no thanks' } as any);
    expect(approval.reject).toHaveBeenCalledWith('org-1', 'a', 'u1', 'SUPERADMIN', 'no thanks');
    await svc.bulkResolve('org-1', 'u1', 'ADMIN', { action: 'approve', approvalIds: ['b'], note: 'ignored' } as any);
    expect(approval.approve).toHaveBeenCalledWith('org-1', 'b', 'u1', 'ADMIN');
  });
});

describe('retryFailed', () => {
  it('a USER role gets 403 before the gate and nothing is touched (independent of the route guard)', async () => {
    const { svc, gate, posts } = make();
    for (const flag of [false, true]) {
      await expect(svc.retryFailed('org-1', 'USER', 'g1', { includeUnknownOutcome: flag })).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(gate.gateRetry).not.toHaveBeenCalled();
    expect(gate.routeRetry).not.toHaveBeenCalled();
    expect(posts.retryFailedByGroup).not.toHaveBeenCalled();
  });

  it('gates before retrying, forwards includeUnknownOutcome verbatim and adds policy', async () => {
    const { svc, gate, posts, order } = make();
    const out = await svc.retryFailed('org-1', 'ADMIN', 'g1', { includeUnknownOutcome: false });
    expect(order).toEqual(['gate', 'retry']);
    expect(gate.gateRetry).toHaveBeenCalledWith('org-1', 'g1', { includeUnknownOutcome: false });
    const opts = posts.retryFailedByGroup.mock.calls[0][2] as any;
    expect(opts.includeUnknownOutcome).toBe(false);
    expect(opts.approvalPostIds.has('p-appr')).toBe(true);
    expect(opts.evaluatedPostIds.has('p-ok')).toBe(true);
    expect(out.group).toBe('g1');
    expect(out.policy).toEqual({ effect: 'REQUIRE_APPROVAL', matched: [{ ruleId: 'r', name: 'R', effect: 'REQUIRE_APPROVAL' }] });
  });

  it('forwards includeUnknownOutcome true to both the gate and the retry', async () => {
    const { svc, gate, posts } = make();
    await svc.retryFailed('org-1', 'SUPERADMIN', 'g1', { includeUnknownOutcome: true });
    expect(gate.gateRetry).toHaveBeenCalledWith('org-1', 'g1', { includeUnknownOutcome: true });
    expect((posts.retryFailedByGroup.mock.calls[0][2] as any).includeUnknownOutcome).toBe(true);
  });

  it('a BLOCK from the gate propagates and nothing is retried', async () => {
    const { svc, gate, posts } = make();
    gate.gateRetry.mockRejectedValueOnce(
      new PolicyBlockedException({ matched: [], channels: [] } as any)
    );
    await expect(svc.retryFailed('org-1', 'ADMIN', 'g1', { includeUnknownOutcome: false })).rejects.toMatchObject({ status: 422 });
    expect(posts.retryFailedByGroup).not.toHaveBeenCalled();
  });

  it('routeToApproval only routes ids in the gate set', async () => {
    const { svc, gate, posts } = make();
    await svc.retryFailed('org-1', 'ADMIN', 'g1', { includeUnknownOutcome: false });
    const opts = posts.retryFailedByGroup.mock.calls[0][2] as any;
    expect(await opts.routeToApproval('p-ok')).toBe(false);
    expect(gate.routeRetry).not.toHaveBeenCalled();
    expect(await opts.routeToApproval('p-appr')).toBe(true);
    expect(gate.routeRetry).toHaveBeenCalledWith('org-1', 'p-appr');
  });
});
