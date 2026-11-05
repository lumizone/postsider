jest.mock('./approval.repository', () => ({ ApprovalRepository: jest.fn() }));
jest.mock('@postsider/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: jest.fn() }));
jest.mock('@postsider/nestjs-libraries/database/prisma/notifications/notification.service', () => ({
  NotificationService: jest.fn(),
}));
jest.mock('@postsider/nestjs-libraries/database/prisma/organizations/organization.repository', () => ({
  OrganizationRepository: jest.fn(),
}));

import { ApprovalService } from './approval.service';
import { hashGuestToken } from './guest-token';
import { runWithActor } from '@postsider/nestjs-libraries/actor/actor-context';
import { toStageView } from './approval.projection';

type Stage = {
  position: number;
  name: string;
  minRole: 'ADMIN' | 'SUPERADMIN';
  approverUserIds: string[];
  allowAutomation: boolean;
  allowGuest: boolean;
};
const stage = (position: number, over: Partial<Stage> = {}): Stage => ({
  position,
  name: `Stage ${position}`,
  minRole: 'ADMIN',
  approverUserIds: [],
  allowAutomation: false,
  allowGuest: false,
  ...over,
});

const MEMBERS: Record<string, { role: string; disabled: boolean }> = {
  creator: { role: 'ADMIN', disabled: false },
  a: { role: 'ADMIN', disabled: false },
  b: { role: 'ADMIN', disabled: false },
  super: { role: 'SUPERADMIN', disabled: false },
  plain: { role: 'USER', disabled: false },
  x: { role: 'ADMIN', disabled: false },
  y: { role: 'ADMIN', disabled: false },
};

/** A small stateful stand-in for the repository: the conditional write is real, so races are real. */
function makeWorld(opts: {
  flow?: { id: string; stages: Stage[]; rules?: { preventSelfApproval: boolean; requireDistinctApprovers: boolean } };
  createdBy?: { type: string; userId?: string; apiKeyId?: string };
  requestedBy?: { type: string; userId?: string; apiKeyId?: string };
  integrationId?: string;
} = {}) {
  const post: Record<string, any> = {
    id: 'p1',
    state: 'DRAFT',
    parentPostId: null,
    integrationId: opts.integrationId ?? 'ch1',
    createdByType: opts.createdBy?.type ?? 'USER',
    createdByUserId: opts.createdBy?.userId ?? 'creator',
    createdByApiKeyId: opts.createdBy?.apiKeyId ?? null,
    createdByOAuthClientId: null,
  };
  let approval: Record<string, any> | null = null;
  let stages: Array<Record<string, any>> = [];
  const log = { tokensDeleted: 0, openSnapshots: [] as any[] };
  const rules = opts.flow?.rules ?? { preventSelfApproval: true, requireDistinctApprovers: true };

  const view = () =>
    approval && {
      ...approval,
      requestedBy: { email: 'req@x.test', name: 'Req' },
      stages: stages.map((s) => ({ ...s })).sort((p, q) => p.position - q.position),
    };

  const repo: any = {
    getPost: jest.fn(async () => post),
    getById: jest.fn(async () => view()),
    getApprovalByPost: jest.fn(async () => view()),
    getPending: jest.fn(async () => (approval && approval.status === 'PENDING' ? [view()] : [])),
    getFlowRules: jest.fn(async () => rules),
    openRequest: jest.fn(async (_o: string, _p: string, requestedById: string, actor: any, snapshot?: any) => {
      log.openSnapshots.push(snapshot ?? null);
      const requester = {
        requestedById,
        requestedByType: opts.requestedBy?.type ?? actor.type,
        requestedByUserId: opts.requestedBy?.userId ?? actor.userId ?? null,
        requestedByApiKeyId: opts.requestedBy?.apiKeyId ?? actor.apiKeyId ?? null,
      };
      if (approval && approval.status === 'PENDING') return { approval: { ...approval }, created: false };
      const progress = {
        flowId: snapshot?.flowId ?? null,
        stageCount: snapshot ? snapshot.stages.length : 1,
        currentStage: 1,
      };
      if (approval) log.tokensDeleted += 1;
      approval = {
        id: 'ap1',
        postId: 'p1',
        organizationId: 'o1',
        status: 'PENDING',
        note: null,
        decidedByType: null,
        approverId: null,
        resolvedAt: null,
        requestedAt: new Date(),
        guestTokenExpiresAt: null,
        ...requester,
        ...progress,
      };
      stages = (snapshot?.stages ?? []).map((s: Stage) => ({
        ...s,
        status: 'PENDING',
        decidedByType: null,
        decidedByUserId: null,
        decidedByApiKeyId: null,
        decidedByOAuthClientId: null,
        decidedVia: null,
        decidedAt: null,
      }));
      return { approval: { ...approval }, created: true };
    }),
    decideStageTx: jest.fn(async (p: any) => {
      await Promise.resolve();
      const a = approval!;
      if (a.status !== 'PENDING' || a.currentStage !== p.position) return false;
      if (p.hasStageRow) {
        const row = stages.find((s) => s.position === p.position);
        if (!row || row.status !== 'PENDING') return false;
        row.status = p.decision;
        row.decidedByType = p.actor ? p.actor.type : null;
        row.decidedByUserId = p.actor?.type === 'USER' ? p.actor.userId : null;
        row.decidedByApiKeyId = p.actor?.type === 'API_KEY' ? p.actor.apiKeyId : null;
        row.decidedVia = p.via;
        row.decidedAt = new Date();
      }
      if (p.final) {
        a.status = p.decision;
        a.decidedByType = p.actor ? p.actor.type : null;
        a.approverId = p.actor?.type === 'USER' ? p.actor.userId : null;
        a.decidedByApiKeyId = p.actor?.type === 'API_KEY' ? p.actor.apiKeyId : null;
        a.decidedVia = p.via;
        a.note = p.note;
        a.resolvedAt = new Date();
      } else {
        a.currentStage = p.position + 1;
      }
      return true;
    }),
    revertFinal: jest.fn(async (_o: string, _a: string, position: number, hasRow: boolean) => {
      const a = approval!;
      if (a.status !== 'APPROVED') return 0;
      a.status = 'PENDING';
      a.decidedByType = null;
      a.approverId = null;
      a.resolvedAt = null;
      if (hasRow) {
        const row = stages.find((s) => s.position === position);
        if (row) {
          row.status = 'PENDING';
          row.decidedByType = null;
          row.decidedByUserId = null;
        }
      }
      return 1;
    }),
  };

  const posts: any = {
    setPostState: jest.fn(async (_o: string, _p: string, state: string) => {
      post.state = state;
    }),
    changePostStatus: jest.fn().mockResolvedValue(undefined),
    getPostIdentity: jest.fn().mockResolvedValue({
      actor: { createdBy: null, lastModifiedBy: null },
      provenance: {},
    }),
  };
  const notifications: any = {
    inAppNotification: jest.fn().mockResolvedValue(undefined),
    notifyApprovers: jest.fn().mockResolvedValue(undefined),
    sendEmail: jest.fn().mockResolvedValue(undefined),
  };
  const organizations: any = {
    getUserOrgLink: jest.fn(async (_o: string, userId: string) => MEMBERS[userId] ?? null),
    getAllUsersOrgs: jest.fn().mockResolvedValue({ users: [{ role: 'SUPERADMIN', user: { id: 'super' } }] }),
  };
  const deliver = jest.fn().mockResolvedValue(undefined);
  const audit = { logResourceEvent: jest.fn().mockResolvedValue(undefined) };
  const flowRow = opts.flow && {
    id: opts.flow.id,
    stages: opts.flow.stages,
  };
  const flows: any = {
    getById: jest.fn(async (_o: string, id: string) => (flowRow && id === flowRow.id ? flowRow : null)),
    resolveFlowForRules: jest.fn(async () => flowRow ?? null),
    snapshot: jest.fn((flow: any) => ({
      flowId: flow.id,
      stageCount: flow.stages.length,
      stages: flow.stages,
      rules,
    })),
  };
  const svc = new ApprovalService(repo, posts, notifications, organizations, { deliver } as any, audit as any, opts.flow ? flows : undefined);
  const request = () =>
    svc.requestApproval('o1', 'p1', 'creator', { type: 'USER', userId: 'creator' });
  return { svc, repo, posts, notifications, deliver, audit, flows, request, post, log, get approval() { return approval!; }, get stages() { return stages; } };
}

const twoStages = () => ({
  id: 'flow1',
  stages: [stage(1), stage(2)],
});
const user = (userId: string) => ({ actor: { type: 'USER', userId } as const, via: 'DASHBOARD' as const });

describe('implicit single stage (no flow)', () => {
  it('lets the creator approve their own post (solo owner)', async () => {
    const w = makeWorld();
    await w.request();
    const r = await w.svc.decide('o1', 'ap1', user('creator'), 'approve');
    expect(r).toEqual({
      approvalId: 'ap1',
      postId: 'p1',
      status: 'APPROVED',
      changed: true,
      stage: { position: 1, total: 1 },
      final: true,
    });
    expect(w.posts.changePostStatus).toHaveBeenCalledTimes(1);
    expect(w.posts.changePostStatus).toHaveBeenCalledWith('o1', 'p1', 'schedule', true);
    expect(w.repo.openRequest).toHaveBeenCalledWith('o1', 'p1', 'creator', { type: 'USER', userId: 'creator' });
  });

  it('a USER role member is refused with not_allowed_for_stage', async () => {
    const w = makeWorld();
    await w.request();
    await expect(w.svc.decide('o1', 'ap1', user('plain'), 'approve')).rejects.toMatchObject({
      response: { error: 'not_allowed_for_stage', reason: 'role' },
    });
    expect(w.repo.decideStageTx).not.toHaveBeenCalled();
  });

  it('a non member (foreign user) is refused', async () => {
    const w = makeWorld();
    await w.request();
    await expect(w.svc.decide('o1', 'ap1', user('stranger'), 'approve')).rejects.toMatchObject({
      response: { error: 'not_allowed_for_stage', reason: 'not_member' },
    });
  });

  it('automation equal to the creator key is refused even on the implicit stage', async () => {
    const w = makeWorld({ createdBy: { type: 'API_KEY', apiKeyId: 'k1' } });
    await w.request();
    await expect(
      w.svc.decide('o1', 'ap1', { actor: { type: 'API_KEY', apiKeyId: 'k1' }, via: 'API' }, 'approve')
    ).rejects.toMatchObject({ response: { error: 'self_approval_blocked' } });
    expect(w.repo.decideStageTx).not.toHaveBeenCalled();
  });

  it('another key may approve on the implicit stage and is attributed', async () => {
    const w = makeWorld({ createdBy: { type: 'API_KEY', apiKeyId: 'k1' } });
    await w.request();
    const r = await w.svc.decide('o1', 'ap1', { actor: { type: 'API_KEY', apiKeyId: 'k2' }, via: 'API' }, 'approve');
    expect(r.status).toBe('APPROVED');
    expect(w.repo.decideStageTx).toHaveBeenCalledWith(
      expect.objectContaining({ via: 'API', actor: { type: 'API_KEY', apiKeyId: 'k2' } })
    );
    expect(w.approval.decidedByApiKeyId).toBe('k2');
  });

  it('a key limited to DRAFT cannot approve (key_action_not_allowed)', async () => {
    const w = makeWorld({ createdBy: { type: 'API_KEY', apiKeyId: 'k1' } });
    await w.request();
    await expect(
      runWithActor(
        { type: 'API_KEY', apiKeyId: 'k2' },
        () => w.svc.decide('o1', 'ap1', { actor: { type: 'API_KEY', apiKeyId: 'k2' }, via: 'API' }, 'approve'),
        { keyPermissions: { allowedActions: ['DRAFT'], allowedIntegrationIds: [] } }
      )
    ).rejects.toMatchObject({ status: 403, response: { error: 'key_action_not_allowed' } });
    expect(w.repo.decideStageTx).not.toHaveBeenCalled();
  });

  it('a key limited to other channels cannot approve (key_channel_not_allowed)', async () => {
    const w = makeWorld({ createdBy: { type: 'API_KEY', apiKeyId: 'k1' } });
    await w.request();
    await expect(
      runWithActor(
        { type: 'API_KEY', apiKeyId: 'k2' },
        () => w.svc.decide('o1', 'ap1', { actor: { type: 'API_KEY', apiKeyId: 'k2' }, via: 'API' }, 'approve'),
        { keyPermissions: { allowedActions: [], allowedIntegrationIds: ['other'] } }
      )
    ).rejects.toMatchObject({ status: 403, response: { error: 'key_channel_not_allowed' } });
  });
});

describe('two stage flow', () => {
  it('request snapshots both stages and records them on the approval', async () => {
    const w = makeWorld({ flow: twoStages() });
    const out = await w.request();
    expect(out.created).toBe(true);
    expect(w.repo.openRequest.mock.calls[0][4]).toMatchObject({
      flowId: 'flow1',
      stages: [expect.objectContaining({ position: 1 }), expect.objectContaining({ position: 2 })],
    });
    expect(w.approval).toMatchObject({ flowId: 'flow1', stageCount: 2, currentStage: 1 });
    expect(w.stages.map((s) => s.status)).toEqual(['PENDING', 'PENDING']);
    expect(w.post.state).toBe('APPROVAL');
  });

  it('stage 1 approval keeps the approval PENDING, schedules nothing, emits no resolved webhook', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    w.deliver.mockClear();
    const r = await w.svc.decide('o1', 'ap1', user('a'), 'approve');
    expect(r).toMatchObject({ status: 'PENDING', changed: true, final: false, stage: { position: 1, total: 2 } });
    expect((await w.svc.getForPost('o1', 'p1'))!.status).toBe('PENDING');
    expect(w.post.state).toBe('APPROVAL');
    expect(w.posts.changePostStatus).not.toHaveBeenCalled();
    expect(w.deliver).not.toHaveBeenCalled();
    expect(w.audit.logResourceEvent).toHaveBeenCalledTimes(2); // requested + stage decision
    expect(w.audit.logResourceEvent.mock.calls[1][0]).toMatchObject({
      event: 'post.approval_resolved',
      actor: { type: 'USER', userId: 'a' },
      metadata: { approvalId: 'ap1', decision: 'APPROVED', via: 'DASHBOARD', stage: 1, stageCount: 2, final: false },
    });
  });

  it('opens the next stage for its approvers after stage 1', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    w.notifications.inAppNotification.mockClear();
    w.notifications.notifyApprovers.mockClear();
    await w.svc.decide('o1', 'ap1', user('a'), 'approve');
    expect(w.notifications.inAppNotification).toHaveBeenCalledTimes(1);
    expect(w.notifications.notifyApprovers.mock.calls[0][1]).toContain('stage 2 of 2');
    expect(JSON.stringify(w.notifications.notifyApprovers.mock.calls[0])).not.toContain('Stage 2');
  });

  it('stage 2 approval by a different admin finishes: APPROVED, scheduled once, webhook once', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    w.deliver.mockClear();
    await w.svc.decide('o1', 'ap1', user('a'), 'approve');
    const r = await w.svc.decide('o1', 'ap1', user('b'), 'approve');
    expect(r).toMatchObject({ status: 'APPROVED', final: true, stage: { position: 2, total: 2 } });
    expect((await w.svc.getForPost('o1', 'p1'))!.status).toBe('APPROVED');
    expect(w.posts.changePostStatus).toHaveBeenCalledTimes(1);
    expect(w.posts.changePostStatus).toHaveBeenCalledWith('o1', 'p1', 'schedule', true);
    expect(w.deliver).toHaveBeenCalledTimes(1);
    expect(w.deliver.mock.calls[0][1]).toBe('approval.resolved');
    expect(w.deliver.mock.calls[0][2].approval).toMatchObject({
      stage: { position: 2, total: 2, name: 'Stage 2' },
      decidedBy: { type: 'USER', userId: 'b' },
    });
    expect(w.audit.logResourceEvent.mock.calls[2][0].metadata).toMatchObject({ stage: 2, stageCount: 2, final: true });
  });

  it('rejection at stage 2 is final, returns the post to DRAFT, keeps the stage 1 approval', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    w.deliver.mockClear();
    await w.svc.decide('o1', 'ap1', user('a'), 'approve');
    const r = await w.svc.decide('o1', 'ap1', user('b'), 'reject', { note: 'nope' });
    expect(r).toMatchObject({ status: 'REJECTED', final: true, changed: true, stage: { position: 2, total: 2 } });
    expect(w.post.state).toBe('DRAFT');
    expect(w.posts.changePostStatus).not.toHaveBeenCalled();
    expect(w.stages.map((s) => s.status)).toEqual(['APPROVED', 'REJECTED']);
    expect(w.deliver).toHaveBeenCalledTimes(1);
    expect(w.deliver.mock.calls[0][2]).toMatchObject({ status: 'REJECTED', note: 'nope' });
    const inApp = w.notifications.inAppNotification.mock.calls.filter((c: any[]) => c[1] === 'Post rejected');
    expect(inApp).toHaveLength(1);
  });

  it('a rejection at stage 1 skips stage 2 and views it as NOT_REACHED', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    await w.svc.decide('o1', 'ap1', user('a'), 'reject');
    const got: any = await w.svc.getForPost('o1', 'p1');
    expect(got.status).toBe('REJECTED');
    expect(got.stages.map((s: any) => s.status)).toEqual(['REJECTED', 'NOT_REACHED']);
    expect(got.stage).toMatchObject({ position: 1, total: 2 });
  });

  it('a new request after a rejection recreates two fresh PENDING stages', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    await w.svc.decide('o1', 'ap1', user('a'), 'approve');
    await w.svc.decide('o1', 'ap1', user('b'), 'reject');
    expect(w.stages.map((s) => s.status)).toEqual(['APPROVED', 'REJECTED']);
    const again = await w.request();
    expect(again.created).toBe(true);
    expect(w.log.tokensDeleted).toBe(1);
    expect(w.stages.map((s) => s.status)).toEqual(['PENDING', 'PENDING']);
    expect(w.approval).toMatchObject({ status: 'PENDING', currentStage: 1, stageCount: 2 });
    expect(w.repo.openRequest.mock.calls[1][4].stages).toHaveLength(2);
  });

  it('a repeated request on a live approval changes nothing', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    await w.svc.decide('o1', 'ap1', user('a'), 'approve');
    w.notifications.inAppNotification.mockClear();
    const again = await w.request();
    expect(again.created).toBe(false);
    expect(w.approval.currentStage).toBe(2);
    expect(w.notifications.inAppNotification).not.toHaveBeenCalled();
  });

  it('is idempotent for the same decision afterwards and a 409 for the opposite', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    await w.svc.decide('o1', 'ap1', user('a'), 'approve');
    await w.svc.decide('o1', 'ap1', user('b'), 'approve');
    const again = await w.svc.decide('o1', 'ap1', user('b'), 'approve');
    expect(again).toMatchObject({ changed: false, status: 'APPROVED', final: true });
    expect(w.posts.changePostStatus).toHaveBeenCalledTimes(1);
    await expect(w.svc.decide('o1', 'ap1', user('b'), 'reject')).rejects.toMatchObject({
      status: 409,
      response: { error: 'approval_already_resolved', status: 'APPROVED' },
    });
  });

  it('dashboard approve keeps answering 400 for a resolved approval', async () => {
    const w = makeWorld();
    await w.request();
    await w.svc.approve('o1', 'ap1', 'a', 'ADMIN');
    await expect(w.svc.approve('o1', 'ap1', 'a', 'ADMIN')).rejects.toThrow('This approval has already been resolved');
    await expect(w.svc.reject('o1', 'ap1', 'a', 'ADMIN')).rejects.toThrow('This approval has already been resolved');
  });

  it('the dashboard wrapper still returns { approved: true, postId } at a non final stage', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    await expect(w.svc.approve('o1', 'ap1', 'a', 'ADMIN')).resolves.toEqual({ approved: true, postId: 'p1' });
    expect(w.approval.currentStage).toBe(2);
  });
});

describe('eligibility inside a flow', () => {
  it('a stage listing member x refuses member y but accepts a SUPERADMIN', async () => {
    const w = makeWorld({ flow: { id: 'f', stages: [stage(1, { approverUserIds: ['x'] })] } });
    await w.request();
    await expect(w.svc.decide('o1', 'ap1', user('y'), 'approve')).rejects.toMatchObject({
      response: { error: 'not_allowed_for_stage', reason: 'not_listed' },
    });
    const r = await w.svc.decide('o1', 'ap1', user('super'), 'approve');
    expect(r.status).toBe('APPROVED');
  });

  it('a SUPERADMIN only stage refuses an ADMIN', async () => {
    const w = makeWorld({ flow: { id: 'f', stages: [stage(1, { minRole: 'SUPERADMIN' })] } });
    await w.request();
    await expect(w.svc.decide('o1', 'ap1', user('a'), 'approve')).rejects.toMatchObject({
      response: { error: 'not_allowed_for_stage', reason: 'role' },
    });
  });

  it('preventSelfApproval refuses the post creator with self_approval_blocked', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    await expect(w.svc.decide('o1', 'ap1', user('creator'), 'approve')).rejects.toMatchObject({
      status: 403,
      response: { error: 'self_approval_blocked' },
    });
    expect(w.repo.decideStageTx).not.toHaveBeenCalled();
  });

  it('preventSelfApproval also refuses the requester when that is not the creator', async () => {
    const w = makeWorld({ flow: twoStages(), createdBy: { type: 'USER', userId: 'x' }, requestedBy: { type: 'USER', userId: 'y' } });
    await w.request();
    await expect(w.svc.decide('o1', 'ap1', user('y'), 'approve')).rejects.toMatchObject({
      response: { error: 'self_approval_blocked' },
    });
  });

  it('a flow with preventSelfApproval false lets the creator decide', async () => {
    const w = makeWorld({
      flow: { id: 'f', stages: [stage(1)], rules: { preventSelfApproval: false, requireDistinctApprovers: true } },
    });
    await w.request();
    const r = await w.svc.decide('o1', 'ap1', user('creator'), 'approve');
    expect(r.status).toBe('APPROVED');
  });

  it('requireDistinctApprovers refuses the same member on stage 2', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    await w.svc.decide('o1', 'ap1', user('a'), 'approve');
    await expect(w.svc.decide('o1', 'ap1', user('a'), 'approve')).rejects.toMatchObject({
      response: { error: 'self_approval_blocked', reason: 'not_distinct' },
    });
    expect(w.approval.currentStage).toBe(2);
  });

  it('without requireDistinctApprovers the same member may decide both stages', async () => {
    const w = makeWorld({
      flow: { id: 'f', stages: [stage(1), stage(2)], rules: { preventSelfApproval: true, requireDistinctApprovers: false } },
    });
    await w.request();
    await w.svc.decide('o1', 'ap1', user('a'), 'approve');
    const r = await w.svc.decide('o1', 'ap1', user('a'), 'approve');
    expect(r.status).toBe('APPROVED');
  });

  it('automation on a stage that does not allow it is refused', async () => {
    const w = makeWorld({ flow: twoStages(), createdBy: { type: 'USER', userId: 'creator' } });
    await w.request();
    await expect(
      w.svc.decide('o1', 'ap1', { actor: { type: 'API_KEY', apiKeyId: 'k9' }, via: 'API' }, 'approve')
    ).rejects.toMatchObject({ response: { error: 'not_allowed_for_stage', reason: 'automation_not_allowed' } });
  });

  it('automation on a stage that allows it decides and is stored on the stage and approval', async () => {
    const w = makeWorld({ flow: { id: 'f', stages: [stage(1, { allowAutomation: true })] } });
    await w.request();
    const r = await w.svc.decide('o1', 'ap1', { actor: { type: 'API_KEY', apiKeyId: 'k9' }, via: 'API' }, 'approve');
    expect(r.status).toBe('APPROVED');
    expect(w.stages[0]).toMatchObject({ decidedByType: 'API_KEY', decidedByApiKeyId: 'k9', decidedVia: 'API' });
  });

  it('a disabled member and an unsupported actor are refused', async () => {
    const w = makeWorld();
    await w.request();
    MEMBERS.off = { role: 'ADMIN', disabled: true };
    try {
      await expect(w.svc.decide('o1', 'ap1', user('off'), 'approve')).rejects.toMatchObject({
        response: { reason: 'disabled' },
      });
    } finally {
      delete MEMBERS.off;
    }
    await expect(
      w.svc.decide('o1', 'ap1', { actor: { type: 'SYSTEM' }, via: 'API' }, 'approve')
    ).rejects.toMatchObject({ response: { reason: 'unsupported_actor' } });
    await expect(w.svc.decide('o1', 'ap1', { actor: null, via: 'API' }, 'approve')).rejects.toMatchObject({
      response: { reason: 'unsupported_actor' },
    });
  });

  it('a flow based approval whose stage rows are missing fails closed', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    w.stages.length = 0;
    await expect(w.svc.decide('o1', 'ap1', user('a'), 'approve')).rejects.toMatchObject({
      status: 409,
      response: { error: 'approval_stage_invalid' },
    });
    expect(w.repo.decideStageTx).not.toHaveBeenCalled();
  });
});

describe('races', () => {
  it('two concurrent decisions on the same stage: one winner, one changed:false, scheduled once', async () => {
    const w = makeWorld();
    await w.request();
    const [r1, r2] = await Promise.all([
      w.svc.decide('o1', 'ap1', user('a'), 'approve'),
      w.svc.decide('o1', 'ap1', user('b'), 'approve'),
    ]);
    expect([r1.changed, r2.changed].sort()).toEqual([false, true]);
    expect(w.posts.changePostStatus).toHaveBeenCalledTimes(1);
    expect(w.deliver.mock.calls.filter((c: any[]) => c[1] === 'approval.resolved')).toHaveLength(1);
    expect(w.audit.logResourceEvent.mock.calls.filter((c: any[]) => c[0].event === 'post.approval_resolved')).toHaveLength(1);
  });

  it('a concurrent approve and reject: the loser gets a 409, the post is not scheduled and rejected exactly once', async () => {
    const w = makeWorld();
    await w.request();
    const settled = await Promise.allSettled([
      w.svc.decide('o1', 'ap1', user('a'), 'approve'),
      w.svc.decide('o1', 'ap1', user('b'), 'reject'),
    ]);
    const rejected = settled.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.status).toBe(409);
    expect(w.deliver.mock.calls.filter((c: any[]) => c[1] === 'approval.resolved')).toHaveLength(1);
    // first caller won: approve scheduled, reject never ran
    expect(w.posts.changePostStatus).toHaveBeenCalledTimes(1);
  });

  it('two admins on stage 1 of 2 advance the approval exactly once', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    const [r1, r2] = await Promise.all([
      w.svc.decide('o1', 'ap1', user('a'), 'approve'),
      w.svc.decide('o1', 'ap1', user('b'), 'approve'),
    ]);
    expect([r1.changed, r2.changed].sort()).toEqual([false, true]);
    expect(w.approval.currentStage).toBe(2);
    expect(w.approval.status).toBe('PENDING');
    expect(w.stages.map((s) => s.status)).toEqual(['APPROVED', 'PENDING']);
  });

  it('a lost write with the same decision answers changed:false and with the opposite answers 409', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    // simulate: the winner approved stage 1 between our read and our write
    w.repo.decideStageTx.mockImplementationOnce(async () => {
      w.stages[0].status = 'APPROVED';
      w.approval.currentStage = 2;
      return false;
    });
    const same = await w.svc.decide('o1', 'ap1', user('a'), 'approve');
    expect(same).toMatchObject({ changed: false, status: 'PENDING', stage: { position: 2, total: 2 } });

    const w2 = makeWorld({ flow: twoStages() });
    await w2.request();
    w2.repo.decideStageTx.mockImplementationOnce(async () => {
      w2.stages[0].status = 'APPROVED';
      w2.approval.currentStage = 2;
      return false;
    });
    await expect(w2.svc.decide('o1', 'ap1', user('a'), 'reject')).rejects.toMatchObject({
      status: 409,
      response: { error: 'approval_already_resolved' },
    });
  });

  it('expectStage that no longer matches is treated as a lost race and writes nothing', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    await w.svc.decide('o1', 'ap1', user('a'), 'approve');
    w.repo.decideStageTx.mockClear();
    const r = await w.svc.decide('o1', 'ap1', user('b'), 'approve', { expectStage: 1 });
    expect(r).toMatchObject({ changed: false, status: 'PENDING', stage: { position: 2, total: 2 } });
    expect(w.repo.decideStageTx).not.toHaveBeenCalled();
    await expect(w.svc.decide('o1', 'ap1', user('b'), 'reject', { expectStage: 1 })).rejects.toMatchObject({ status: 409 });
  });
});

describe('stage guard for the dashboard and the public API (strictStage)', () => {
  it('a stale expectStage is a 409 stage_changed that names the current stage and writes nothing', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    await w.svc.decide('o1', 'ap1', user('a'), 'approve');
    w.repo.decideStageTx.mockClear();
    await expect(
      w.svc.decide('o1', 'ap1', user('b'), 'approve', { expectStage: 1, strictStage: true })
    ).rejects.toMatchObject({
      status: 409,
      response: { error: 'stage_changed', stage: { position: 2, total: 2 } },
    });
    await expect(
      w.svc.decide('o1', 'ap1', user('b'), 'reject', { expectStage: 1, strictStage: true })
    ).rejects.toMatchObject({ status: 409, response: { error: 'stage_changed' } });
    expect(w.repo.decideStageTx).not.toHaveBeenCalled();
  });

  it('a matching expectStage decides normally', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    const r = await w.svc.decide('o1', 'ap1', user('a'), 'approve', { expectStage: 1, strictStage: true });
    expect(r).toMatchObject({ changed: true, final: false, stage: { position: 1, total: 2 } });
  });

  it('dashboard approve and reject forward the stage the admin saw; a stale one is 409 stage_changed', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    await w.svc.decide('o1', 'ap1', user('a'), 'approve');
    await expect(w.svc.approve('o1', 'ap1', 'b', 'ADMIN', 1)).rejects.toMatchObject({
      status: 409,
      response: { error: 'stage_changed', stage: { position: 2, total: 2 } },
    });
    await expect(w.svc.reject('o1', 'ap1', 'b', 'ADMIN', undefined, 1)).rejects.toMatchObject({
      status: 409,
      response: { error: 'stage_changed' },
    });
  });
});

describe('schedule failure on the final stage', () => {
  it('reverts the approval and the last stage row, propagates the error, sends no success signals', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    await w.svc.decide('o1', 'ap1', user('a'), 'approve');
    w.deliver.mockClear();
    const boom = new Error('workflow start failed');
    w.posts.changePostStatus.mockRejectedValue(boom);
    await expect(w.svc.decide('o1', 'ap1', user('b'), 'approve')).rejects.toBe(boom);
    expect(w.repo.revertFinal).toHaveBeenCalledWith('o1', 'ap1', 2, true, undefined);
    expect(w.approval.status).toBe('PENDING');
    expect(w.stages.map((s) => s.status)).toEqual(['APPROVED', 'PENDING']);
    expect(w.deliver).not.toHaveBeenCalled();
    expect(w.notifications.inAppNotification.mock.calls.some((c: any[]) => c[1] === 'Post approved')).toBe(false);
    // the retry decides stage 2 again and schedules
    w.posts.changePostStatus.mockResolvedValue(undefined);
    const again = await w.svc.decide('o1', 'ap1', user('b'), 'approve');
    expect(again.status).toBe('APPROVED');
  });
});

describe('guests', () => {
  it('createGuestLink refuses a stage without allowGuest', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    w.repo.setGuestToken = jest.fn().mockResolvedValue(1);
    await expect(w.svc.createGuestLink('o1', 'ap1', 'ADMIN')).rejects.toMatchObject({
      status: 400,
      response: { error: 'guest_not_allowed_for_stage' },
    });
    expect(w.repo.setGuestToken).not.toHaveBeenCalled();
  });

  it('createGuestLink works on a stage with allowGuest and on the implicit stage', async () => {
    const flowed = makeWorld({ flow: { id: 'f', stages: [stage(1, { allowGuest: true })] } });
    await flowed.request();
    flowed.repo.setGuestToken = jest.fn().mockResolvedValue(1);
    await expect(flowed.svc.createGuestLink('o1', 'ap1', 'ADMIN')).resolves.toMatchObject({ token: expect.any(String) });
    const implicit = makeWorld();
    await implicit.request();
    implicit.repo.setGuestToken = jest.fn().mockResolvedValue(1);
    await expect(implicit.svc.createGuestLink('o1', 'ap1', 'ADMIN')).resolves.toMatchObject({ token: expect.any(String) });
  });

  it('the guest resolve path refuses a stage that does not allow guests, even with a live token', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    w.repo.getByGuestToken = jest.fn().mockResolvedValue({
      id: 'ap1',
      organizationId: 'o1',
      guestTokenExpiresAt: new Date(Date.now() + 1000),
      post: { id: 'p1' },
    });
    await expect(w.svc.resolveGuestReview('tok', 'approve')).rejects.toMatchObject({
      response: { error: 'not_allowed_for_stage', reason: 'guest_not_allowed' },
    });
    expect(w.repo.decideStageTx).not.toHaveBeenCalled();
  });

  it('a guest decision records via GUEST, actor null, and consumes the token in the transaction', async () => {
    const w = makeWorld({ flow: { id: 'f', stages: [stage(1, { allowGuest: true })] } });
    await w.request();
    w.repo.getByGuestToken = jest.fn().mockResolvedValue({
      id: 'ap1',
      organizationId: 'o1',
      guestTokenExpiresAt: new Date(Date.now() + 1000),
      post: { id: 'p1' },
    });
    w.audit.logResourceEvent.mockClear();
    await expect(
      w.svc.resolveGuestReview('tok', 'approve', undefined, { name: 'Ann', email: 'a@x.test' })
    ).resolves.toEqual({ approved: true });
    expect(w.repo.decideStageTx).toHaveBeenCalledWith(
      expect.objectContaining({ via: 'GUEST', actor: null, guestToken: 'tok', guest: { name: 'Ann', email: 'a@x.test' } })
    );
    const e = w.audit.logResourceEvent.mock.calls[0][0];
    expect(e.actor).toBeNull();
    expect(e.metadata).toMatchObject({ via: 'GUEST', by: 'guest', final: true });
    expect(w.stages[0]).toMatchObject({ decidedVia: 'GUEST', decidedByType: null });
  });

  it('a failed guest approval restores the link through the hash', async () => {
    const exp = new Date(Date.now() + 5000);
    const w = makeWorld();
    await w.request();
    w.approval.guestTokenExpiresAt = exp;
    w.repo.getByGuestToken = jest.fn().mockResolvedValue({ id: 'ap1', organizationId: 'o1', guestTokenExpiresAt: exp, post: { id: 'p1' } });
    w.posts.changePostStatus.mockRejectedValue(new Error('x'));
    await expect(w.svc.resolveGuestReview('tok', 'approve')).rejects.toThrow('x');
    expect(w.repo.revertFinal).toHaveBeenCalledWith('o1', 'ap1', 1, false, { tokenHash: hashGuestToken('tok'), expiresAt: exp });
  });

  it('a guest losing the race to an in-app decision gets the link-used error', async () => {
    const w = makeWorld();
    await w.request();
    w.repo.getByGuestToken = jest.fn().mockResolvedValue({ id: 'ap1', organizationId: 'o1', guestTokenExpiresAt: new Date(), post: { id: 'p1' } });
    await w.svc.decide('o1', 'ap1', user('a'), 'approve');
    await expect(w.svc.resolveGuestReview('tok', 'reject')).rejects.toThrow('This review link has already been used.');
  });
});

describe('flow resolution on request', () => {
  const flowA = { id: 'flowA', stages: [stage(1), stage(2), stage(3)] };

  it('an explicit flowId wins over ruleIds', async () => {
    const w = makeWorld({ flow: flowA });
    await w.svc.requestApproval('o1', 'p1', 'creator', { type: 'USER', userId: 'creator' }, { flowId: 'flowA', ruleIds: ['r1'] });
    expect(w.flows.getById).toHaveBeenCalledWith('o1', 'flowA');
    expect(w.flows.resolveFlowForRules).not.toHaveBeenCalled();
    expect(w.approval.stageCount).toBe(3);
  });

  it('ruleIds go to resolveFlowForRules in the given order', async () => {
    const w = makeWorld({ flow: flowA });
    await w.svc.requestApproval('o1', 'p1', 'creator', { type: 'USER', userId: 'creator' }, { ruleIds: ['r2', 'r1'] });
    expect(w.flows.resolveFlowForRules).toHaveBeenCalledWith('o1', ['r2', 'r1']);
    expect(w.approval.flowId).toBe('flowA');
  });

  it('an unknown or archived explicit flow falls back to rules and the default', async () => {
    const w = makeWorld({ flow: flowA });
    await w.svc.requestApproval('o1', 'p1', 'creator', { type: 'USER', userId: 'creator' }, { flowId: 'archived' });
    expect(w.flows.getById).toHaveBeenCalledWith('o1', 'archived');
    expect(w.flows.resolveFlowForRules).toHaveBeenCalledWith('o1', []);
    expect(w.approval.flowId).toBe('flowA');
  });

  it('no flow at all gives the implicit stage and no stage rows', async () => {
    const w = makeWorld();
    await w.request();
    expect(w.approval).toMatchObject({ flowId: null, stageCount: 1, currentStage: 1 });
    expect(w.stages).toHaveLength(0);
    const pending = await w.svc.getPending('o1');
    expect(pending[0]).toMatchObject({ stage: { position: 1, total: 1, name: 'Approval' } });
  });

  it('requestApprovalFromApi forwards the options', async () => {
    const w = makeWorld({ flow: flowA });
    await w.svc.requestApprovalFromApi('o1', 'p1', { ruleIds: ['r1'] });
    expect(w.flows.resolveFlowForRules).toHaveBeenCalledWith('o1', ['r1']);
  });
});

describe('read surfaces', () => {
  it('getForPost and getPending expose stage progress without raw rows', async () => {
    const w = makeWorld({ flow: twoStages() });
    await w.request();
    await w.svc.decide('o1', 'ap1', user('a'), 'approve');
    const got: any = await w.svc.getForPost('o1', 'p1');
    expect(got.stage).toEqual({ position: 2, total: 2, name: 'Stage 2' });
    expect(got.stages).toEqual([
      expect.objectContaining({ position: 1, status: 'APPROVED', decidedBy: { type: 'USER', userId: 'a' } }),
      expect.objectContaining({ position: 2, status: 'PENDING', decidedBy: null }),
    ]);
    expect(JSON.stringify(got.stages)).not.toContain('approverUserIds');
    const pending: any = await w.svc.getPending('o1');
    expect(pending[0].stages).toHaveLength(2);
    expect(pending[0].stages[0]).not.toHaveProperty('approverUserIds');
    expect(w.svc.getStageView(await w.repo.getById())).toEqual({ stage: got.stage, stages: got.stages });
  });

  it('toStageView shows API_KEY and GUEST deciders', () => {
    const view = toStageView({
      status: 'APPROVED',
      currentStage: 2,
      stages: [
        { position: 1, name: 'A', status: 'APPROVED', decidedByType: 'API_KEY', decidedByApiKeyId: 'k1', decidedAt: null },
        { position: 2, name: 'B', status: 'APPROVED', decidedByType: null, decidedVia: 'GUEST', decidedAt: null },
      ],
    });
    expect(view.stages[0].decidedBy).toEqual({ type: 'API_KEY', apiKeyId: 'k1' });
    expect(view.stages[1].decidedBy).toEqual({ type: 'GUEST', guestName: null, guestEmail: null });
  });
});
