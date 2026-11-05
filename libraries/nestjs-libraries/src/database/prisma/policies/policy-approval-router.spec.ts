jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { PolicyApprovalRouter } from './policy-approval-router';

describe('PolicyApprovalRouter', () => {
  const calls: string[] = [];
  const posts = {
    changePostStatus: jest.fn(async (..._a: any[]) => {
      calls.push('changePostStatus');
    }),
    setPostState: jest.fn(async (..._a: any[]) => {
      calls.push('setPostState');
    }),
  };
  const approvals = {
    requestApprovalFromApi: jest.fn(async (..._a: any[]) => {
      calls.push('request');
      return { id: 'ap1', created: true };
    }),
  };
  const repo = { getPostById: jest.fn() };
  const router = new PolicyApprovalRouter(posts as any, approvals as any, repo as any);

  beforeEach(() => {
    calls.length = 0;
    jest.clearAllMocks();
  });

  it('moves a QUEUE post to DRAFT first, then requests approval', async () => {
    repo.getPostById.mockResolvedValue({ id: 'p', state: 'QUEUE' });
    const out = await router.route('org', 'p', { terminateWorkflow: true });
    expect(posts.changePostStatus).toHaveBeenCalledWith('org', 'p', 'draft');
    expect(calls).toEqual(['changePostStatus', 'request']);
    expect(out).toEqual({ requested: true, approvalId: 'ap1' });
  });

  it('only requests for a DRAFT post', async () => {
    repo.getPostById.mockResolvedValue({ id: 'p', state: 'DRAFT' });
    await router.route('org', 'p', { terminateWorkflow: true });
    expect(calls).toEqual(['request']);
    expect(repo.getPostById).toHaveBeenCalledWith('p', 'org');
  });

  it('terminateWorkflow false uses setPostState and never changePostStatus', async () => {
    repo.getPostById.mockResolvedValue({ id: 'p', state: 'QUEUE' });
    await router.route('org', 'p', { terminateWorkflow: false });
    expect(posts.setPostState).toHaveBeenCalledWith('org', 'p', 'DRAFT');
    expect(posts.changePostStatus).not.toHaveBeenCalled();
  });

  it('onlyFromState: a row whose fresh state changed is left untouched and not routed', async () => {
    repo.getPostById.mockResolvedValue({ id: 'p', state: 'QUEUE' });
    const out = await router.route('org', 'p', { terminateWorkflow: false, onlyFromState: 'ERROR' });
    expect(out).toEqual({ requested: false, approvalId: null });
    expect(posts.setPostState).not.toHaveBeenCalled();
    expect(posts.changePostStatus).not.toHaveBeenCalled();
    expect(approvals.requestApprovalFromApi).not.toHaveBeenCalled();
  });

  it('onlyFromState: a row still in ERROR moves to DRAFT and is routed', async () => {
    repo.getPostById.mockResolvedValue({ id: 'p', state: 'ERROR' });
    const out = await router.route('org', 'p', { terminateWorkflow: false, onlyFromState: 'ERROR' });
    expect(calls).toEqual(['setPostState', 'request']);
    expect(out.requested).toBe(true);
  });

  it('moves an ERROR post to DRAFT first', async () => {
    repo.getPostById.mockResolvedValue({ id: 'p', state: 'ERROR' });
    await router.route('org', 'p', { terminateWorkflow: true });
    expect(calls).toEqual(['changePostStatus', 'request']);
  });

  it('is idempotent: an existing approval passes created false through', async () => {
    repo.getPostById.mockResolvedValue({ id: 'p', state: 'APPROVAL' });
    approvals.requestApprovalFromApi.mockResolvedValueOnce({ id: 'ap1', created: false });
    const out = await router.route('org', 'p', { terminateWorkflow: true });
    expect(approvals.requestApprovalFromApi).toHaveBeenCalledTimes(1);
    expect(posts.changePostStatus).not.toHaveBeenCalled();
    expect(out).toEqual({ requested: false, approvalId: 'ap1' });
  });

  it('propagates a request failure after the post was moved to DRAFT', async () => {
    repo.getPostById.mockResolvedValue({ id: 'p', state: 'QUEUE' });
    approvals.requestApprovalFromApi.mockRejectedValueOnce(new Error('boom'));
    await expect(router.route('org', 'p', { terminateWorkflow: true })).rejects.toThrow('boom');
    expect(calls).toEqual(['changePostStatus']);
  });

  it.each([true, false])('HELD post (terminateWorkflow %s): setPostState DRAFT, no changePostStatus, then request', async (t) => {
    repo.getPostById.mockResolvedValue({ id: 'p', state: 'HELD' });
    await router.route('org', 'p', { terminateWorkflow: t });
    expect(posts.setPostState).toHaveBeenCalledWith('org', 'p', 'DRAFT');
    expect(posts.changePostStatus).not.toHaveBeenCalled();
    expect(calls).toEqual(['setPostState', 'request']);
  });

  it('fails when the post does not exist', async () => {
    repo.getPostById.mockResolvedValue(null);
    await expect(router.route('org', 'p', { terminateWorkflow: true })).rejects.toThrow();
    expect(approvals.requestApprovalFromApi).not.toHaveBeenCalled();
  });

  describe('ruleIds', () => {
    it('forwards ruleIds to requestApprovalFromApi', async () => {
      repo.getPostById.mockResolvedValue({ id: 'p', state: 'DRAFT' });
      await router.route('org', 'p', { terminateWorkflow: true, ruleIds: ['r2', 'r1'] });
      expect(approvals.requestApprovalFromApi).toHaveBeenCalledWith('org', 'p', { ruleIds: ['r2', 'r1'] });
    });

    it('absent ruleIds passes an undefined ruleIds (same as before)', async () => {
      repo.getPostById.mockResolvedValue({ id: 'p', state: 'DRAFT' });
      await router.route('org', 'p', { terminateWorkflow: true });
      expect(approvals.requestApprovalFromApi).toHaveBeenCalledWith('org', 'p', { ruleIds: undefined });
    });
  });
});
