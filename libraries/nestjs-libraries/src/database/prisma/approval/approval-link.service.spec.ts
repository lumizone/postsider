jest.mock('./approval.service', () => ({ ApprovalService: class ApprovalService {} }));
jest.mock(
  '@postsider/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class NotificationService {} })
);
jest.mock(
  '@postsider/nestjs-libraries/database/prisma/organizations/organization.repository',
  () => ({ OrganizationRepository: class OrganizationRepository {} })
);
const counters = new Map<string, number>();
jest.mock('@postsider/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    incr: jest.fn(async (key: string) => {
      const n = (counters.get(key) ?? 0) + 1;
      counters.set(key, n);
      return n;
    }),
    expire: jest.fn(async () => 1),
  },
}));

import {
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalLinkService } from './approval-link.service';
import {
  hashLinkToken,
  makeChallenge,
  newLinkToken,
} from './approval-link.crypto';

const SECRET = 'service-test-secret-long-enough';
const ORG = 'org-1';

type Token = {
  organizationId: string;
  approvalId: string;
  stagePosition: number;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
};

function setup(
  opts: {
    review?: Record<string, any>;
    link?: { role: string; disabled: boolean } | null;
    rules?: { preventSelfApproval: boolean; requireDistinctApprovers: boolean } | null;
  } = {}
) {
  const tokens = new Map<string, Token>();
  const review: Record<string, any> = {
    id: 'ap1',
    postId: 'p1',
    status: 'PENDING',
    flowId: null,
    currentStage: 1,
    requestedById: 'u-requester',
    requestedByType: 'USER',
    requestedByUserId: 'u-requester',
    requestedBy: { name: 'Req Name' },
    stages: [],
    post: {
      content: '<p>Hello <b>world</b></p>',
      image: JSON.stringify([
        { id: 'm1', path: 'https://cdn.example.com/a.png' },
        { id: 'm2', path: 'https://cdn.example.com/b.mp4' },
        { id: 'm3', path: 'javascript:alert(1)' },
      ]),
      publishDate: new Date('2026-12-01T10:00:00Z'),
      integrationId: 'int1',
      createdByType: 'USER',
      createdByUserId: 'u-creator',
      integration: { name: 'Acme Page', providerIdentifier: 'facebook' },
    },
    ...(opts.review ?? {}),
  };
  const repo = {
    replaceToken: jest.fn(async (p: any) => {
      for (const [h, t] of tokens) {
        if (
          t.approvalId === p.approvalId &&
          t.stagePosition === p.stagePosition &&
          t.userId === p.userId
        ) {
          tokens.delete(h);
        }
      }
      tokens.set(p.tokenHash, {
        organizationId: p.orgId,
        approvalId: p.approvalId,
        stagePosition: p.stagePosition,
        userId: p.userId,
        expiresAt: p.expiresAt,
        usedAt: null,
      });
    }),
    getLiveToken: jest.fn(async (hash: string, now: Date) => {
      const t = tokens.get(hash);
      return t && !t.usedAt && t.expiresAt > now ? { ...t } : null;
    }),
    consumeToken: jest.fn(async (hash: string, now: Date) => {
      const t = tokens.get(hash);
      if (!t || t.usedAt || t.expiresAt <= now) return false;
      t.usedAt = now;
      return true;
    }),
    restoreToken: jest.fn(async (hash: string) => {
      const t = tokens.get(hash);
      if (t) t.usedAt = null;
    }),
    deleteToken: jest.fn(async (hash: string) => {
      tokens.delete(hash);
    }),
    deleteForApproval: jest.fn(async (_o: string, a: string) => {
      for (const [h, t] of tokens) if (t.approvalId === a) tokens.delete(h);
    }),
    deleteOtherStages: jest.fn(async (_o: string, a: string, keep: number) => {
      for (const [h, t] of tokens) {
        if (t.approvalId === a && t.stagePosition !== keep) tokens.delete(h);
      }
    }),
    getFlowRules: jest.fn(async () =>
      opts.rules === undefined
        ? { preventSelfApproval: true, requireDistinctApprovers: true }
        : opts.rules
    ),
    getUserName: jest.fn(async () => 'Approver Name'),
    getReview: jest.fn(async () => review),
  };
  const sent: Array<{ to: string; subject: string; html: string }> = [];
  const notifications = {
    sendEmail: jest.fn(async (to: string, subject: string, html: string) => {
      sent.push({ to, subject, html });
    }),
  };
  const orgs = {
    getAllUsersOrgs: jest.fn(async () => ({
      users: [
        { role: 'SUPERADMIN', user: { id: 'u-owner', email: 'owner@x.co', sendSuccessEmails: true } },
        { role: 'ADMIN', user: { id: 'u-admin', email: 'admin@x.co', sendSuccessEmails: true } },
        { role: 'USER', user: { id: 'u-member', email: 'member@x.co', sendSuccessEmails: true } },
        { role: 'ADMIN', user: { id: 'u-creator', email: 'creator@x.co', sendSuccessEmails: true } },
      ],
    })),
    getUserOrgLink: jest.fn(async (_org: string, userId: string) =>
      opts.link !== undefined
        ? opts.link
        : userId === 'u-member'
          ? { role: 'USER', disabled: false }
          : { role: 'ADMIN', disabled: false }
    ),
  };
  const approvals = {
    decide: jest.fn(async () => ({
      approvalId: 'ap1',
      postId: 'p1',
      status: 'APPROVED',
      changed: true,
      stage: { position: 1, total: 1 },
      final: true,
    })),
  };
  const service = new ApprovalLinkService(
    repo as any,
    notifications as any,
    orgs as any,
    approvals as any
  );
  const mint = (
    userId = 'u-admin',
    extra: Partial<Token> = {}
  ): { token: string; hash: string } => {
    const token = newLinkToken();
    const hash = hashLinkToken(token);
    tokens.set(hash, {
      organizationId: ORG,
      approvalId: 'ap1',
      stagePosition: 1,
      userId,
      expiresAt: new Date(Date.now() + 3_600_000),
      usedAt: null,
      ...extra,
    });
    return { token, hash };
  };
  const goodChallenge = (hash: string) => makeChallenge(hash, Date.now() - 5_000, SECRET);
  return { service, repo, notifications, orgs, approvals, tokens, review, sent, mint, goodChallenge };
}

const WRITES = [
  'replaceToken',
  'consumeToken',
  'restoreToken',
  'deleteToken',
  'deleteForApproval',
  'deleteOtherStages',
] as const;

describe('ApprovalLinkService', () => {
  const env = { ...process.env };
  beforeEach(() => {
    counters.clear();
    process.env.JWT_SECRET = SECRET;
    process.env.FRONTEND_URL = 'https://app.example.com';
    delete process.env.APPROVAL_LINK_TTL_HOURS;
  });
  afterAll(() => {
    process.env = env;
  });

  describe('sendStageEmails', () => {
    it('mints one token per eligible human and sends one email each', async () => {
      const s = setup();
      const ok = await s.service.sendStageEmails(ORG, { id: 'ap1' }, { position: 1, total: 1, name: 'Approval' });
      expect(ok).toBe(true);
      // SUPERADMIN + ADMIN; the USER member is not eligible; the post creator is allowed on the implicit stage
      expect(s.sent.map((m) => m.to).sort()).toEqual(['admin@x.co', 'creator@x.co', 'owner@x.co']);
      expect(s.tokens.size).toBe(3);
      for (const m of s.sent) {
        const url = /href="(https:\/\/app\.example\.com\/approve\/([A-Za-z0-9_-]{43})\?intent=approve)"/.exec(m.html)!;
        expect(url).toBeTruthy();
        // only the hash is stored
        expect(s.tokens.has(hashLinkToken(url[2]))).toBe(true);
        expect(s.tokens.has(url[2])).toBe(false);
        expect(m.html).toContain('intent=reject');
      }
    });

    it('sets the expiry from APPROVAL_LINK_TTL_HOURS (default 48 h)', async () => {
      const s = setup();
      const t0 = Date.now();
      await s.service.sendStageEmails(ORG, { id: 'ap1' }, { position: 1, total: 1, name: 'Approval' });
      const exp = [...s.tokens.values()][0].expiresAt.getTime();
      expect(exp - t0).toBeGreaterThan(47.9 * 3_600_000);
      expect(exp - t0).toBeLessThan(48.1 * 3_600_000);
      const s2 = setup();
      process.env.APPROVAL_LINK_TTL_HOURS = '2';
      await s2.service.sendStageEmails(ORG, { id: 'ap1' }, { position: 1, total: 1, name: 'Approval' });
      const exp2 = [...s2.tokens.values()][0].expiresAt.getTime();
      expect(exp2 - Date.now()).toBeLessThan(2.1 * 3_600_000);
    });

    it('skips members who could not use the link (own post under a no self approval flow)', async () => {
      const s = setup({
        review: {
          flowId: 'f1',
          stages: [
            { position: 1, name: 'Legal', minRole: 'ADMIN', approverUserIds: [], allowAutomation: false, allowGuest: false, status: 'PENDING' },
          ],
        },
      });
      await s.service.sendStageEmails(ORG, { id: 'ap1' }, { position: 1, total: 1, name: 'Legal' });
      expect(s.sent.map((m) => m.to).sort()).toEqual(['admin@x.co', 'owner@x.co']);
    });

    it('replaces an earlier live token of the same (approval, stage, user) and purges other stages', async () => {
      const s = setup();
      const stage = { position: 1, total: 1, name: 'Approval' };
      await s.service.sendStageEmails(ORG, { id: 'ap1' }, stage);
      await s.service.sendStageEmails(ORG, { id: 'ap1' }, stage);
      expect(s.tokens.size).toBe(3);
      expect(s.repo.deleteOtherStages).toHaveBeenCalledWith(ORG, 'ap1', 1);
    });

    it('does not throw when the email send fails, and leaves no live token behind', async () => {
      const s = setup();
      s.notifications.sendEmail.mockRejectedValue(new Error('smtp down'));
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      await expect(
        s.service.sendStageEmails(ORG, { id: 'ap1' }, { position: 1, total: 1, name: 'Approval' })
      ).resolves.toBe(true);
      expect(s.tokens.size).toBe(0);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('reports false (plain email fallback) when links cannot be produced', async () => {
      const s = setup();
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      delete process.env.JWT_SECRET;
      await expect(
        s.service.sendStageEmails(ORG, { id: 'ap1' }, { position: 1, total: 1, name: 'Approval' })
      ).resolves.toBe(false);
      process.env.JWT_SECRET = SECRET;
      s.repo.getReview.mockRejectedValue(new Error('db down'));
      await expect(
        s.service.sendStageEmails(ORG, { id: 'ap1' }, { position: 1, total: 1, name: 'Approval' })
      ).resolves.toBe(false);
      expect(s.sent).toHaveLength(0);
      warn.mockRestore();
    });

    it('escapes post content, channel and requester in the email', async () => {
      const s = setup({
        review: {
          requestedBy: { name: '<script>x</script>' },
          post: {
            content: '<p>&lt;img src=x onerror=alert(1)&gt; "quote"</p>',
            image: '[]',
            publishDate: null,
            integrationId: 'i',
            createdByType: 'USER',
            createdByUserId: 'u-creator',
            integration: { name: '<b>Page</b>', providerIdentifier: 'x' },
          },
        },
      });
      await s.service.sendStageEmails(ORG, { id: 'ap1' }, { position: 1, total: 1, name: 'Approval' });
      const html = s.sent[0].html;
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<b>Page');
      expect(html).not.toContain('<img');
    });
  });

  describe('view (GET)', () => {
    it('returns the review data and writes nothing', async () => {
      const s = setup();
      const { token, hash } = s.mint();
      const data = await s.service.view(token);
      expect(data.post.text).toBe('Hello world');
      expect(data.post.media).toEqual([
        { path: 'https://cdn.example.com/a.png', type: 'image' },
        { path: 'https://cdn.example.com/b.mp4', type: 'video' },
      ]);
      expect(data.channel).toEqual({ name: 'Acme Page', providerIdentifier: 'facebook' });
      expect(data.requester).toEqual({ name: 'Req Name' });
      expect(data.approver).toEqual({ name: 'Approver Name' });
      expect(data.stage).toEqual({ position: 1, total: 1, name: 'Approval' });
      expect(data.selfApprovalBlocked).toBe(false);
      expect(data.challenge).toMatch(/^\d+\.[0-9a-f]{64}$/);
      expect(data.challenge.endsWith(makeChallenge(hash, Number(data.challenge.split('.')[0]), SECRET).split('.')[1])).toBe(true);
      for (const w of WRITES) expect((s.repo as any)[w]).not.toHaveBeenCalled();
      expect(s.approvals.decide).not.toHaveBeenCalled();
      expect(s.tokens.get(hash)!.usedAt).toBeNull();
    });

    it('never returns ids, token material or the organization', async () => {
      const s = setup();
      const { token, hash } = s.mint();
      const json = JSON.stringify(await s.service.view(token));
      expect(json).not.toContain(token);
      expect(json).not.toContain(hash);
      expect(json).not.toContain('u-admin');
      expect(json).not.toContain(ORG);
      expect(json).not.toContain('ap1');
    });

    it('flags selfApprovalBlocked for the creator under a no self approval flow', async () => {
      const s = setup({
        review: {
          flowId: 'f1',
          stages: [
            { position: 1, name: 'Legal', minRole: 'ADMIN', approverUserIds: [], allowAutomation: false, allowGuest: false, status: 'PENDING' },
          ],
        },
      });
      const { token } = s.mint('u-creator');
      const data = await s.service.view(token);
      expect(data.selfApprovalBlocked).toBe(true);
      expect(data.stage.name).toBe('Legal');
    });

    it('403 link_not_allowed when the member was demoted or disabled', async () => {
      for (const link of [{ role: 'USER', disabled: false }, { role: 'ADMIN', disabled: true }, null]) {
        const s = setup({ link });
        const { token } = s.mint();
        await expect(s.service.view(token)).rejects.toMatchObject({
          status: 403,
          response: { error: 'link_not_allowed' },
        });
      }
    });

    it('409 when the approval is already decided or moved to another stage', async () => {
      const s = setup({ review: { status: 'APPROVED' } });
      const { token } = s.mint();
      await expect(s.service.view(token)).rejects.toMatchObject({
        status: 409,
        response: { error: 'approval_already_resolved', status: 'APPROVED' },
      });
      const s2 = setup({ review: { currentStage: 2 } });
      const t2 = s2.mint();
      await expect(s2.service.view(t2.token)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('identical 404 for every invalid token state', () => {
    it('unknown, malformed, expired, used and revoked tokens give the same body', async () => {
      const s = setup();
      const expired = s.mint('u-admin', { expiresAt: new Date(Date.now() - 1000) });
      const used = s.mint('u-admin', { usedAt: new Date() });
      const revoked = s.mint();
      s.tokens.delete(revoked.hash);
      const bodies: unknown[] = [];
      for (const t of [newLinkToken(), 'short', '', expired.token, used.token, revoked.token]) {
        for (const call of [
          () => s.service.view(t),
          () => s.service.decide(t, { decision: 'approve', challenge: s.goodChallenge(hashLinkToken(t)) }),
        ]) {
          try {
            await call();
            throw new Error('should have failed');
          } catch (e: any) {
            expect(e).toBeInstanceOf(NotFoundException);
            expect(e.getStatus()).toBe(404);
            bodies.push(e.getResponse());
          }
        }
      }
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
      expect(bodies[0]).toEqual({ error: 'link_invalid' });
      expect(s.approvals.decide).not.toHaveBeenCalled();
    });
  });

  describe('decide (POST)', () => {
    it('consumes the token, decides as the member the email went to, via EMAIL_LINK', async () => {
      const s = setup();
      const { token, hash } = s.mint('u-admin');
      const out = await s.service.decide(token, {
        decision: 'approve',
        note: 'ok',
        challenge: s.goodChallenge(hash),
      });
      expect(out).toEqual({ status: 'APPROVED', final: true, stage: { position: 1, total: 1 } });
      expect(s.approvals.decide).toHaveBeenCalledTimes(1);
      expect(s.approvals.decide).toHaveBeenCalledWith(
        ORG,
        'ap1',
        { actor: { type: 'USER', userId: 'u-admin' }, userId: 'u-admin', role: 'ADMIN', via: 'EMAIL_LINK' },
        'approve',
        { note: 'ok', expectStage: 1 }
      );
      expect(s.repo.consumeToken).toHaveBeenCalledTimes(1);
      expect(s.repo.deleteForApproval).toHaveBeenCalledWith(ORG, 'ap1');
      // second use of the same link is dead
      await expect(
        s.service.decide(token, { decision: 'approve', challenge: s.goodChallenge(hash) })
      ).rejects.toMatchObject({ response: { error: 'link_invalid' } });
    });

    it('organization comes from the token row, not from the request', async () => {
      const s = setup();
      const { token, hash } = s.mint('u-admin');
      await s.service.decide(token, {
        decision: 'reject',
        challenge: s.goodChallenge(hash),
        organizationId: 'other-org',
        approvalId: 'other',
      });
      expect(s.approvals.decide.mock.calls[0].slice(0, 2)).toEqual([ORG, 'ap1']);
    });

    it('rejects a missing, early, expired, foreign or tampered challenge and counts each', async () => {
      const s = setup();
      const { token, hash } = s.mint();
      const other = hashLinkToken(newLinkToken());
      const bad = [
        undefined,
        '',
        makeChallenge(hash, Date.now() - 500, SECRET),
        makeChallenge(hash, Date.now() - 16 * 60_000, SECRET),
        makeChallenge(other, Date.now() - 5_000, SECRET),
      ];
      for (const challenge of bad) {
        await expect(
          s.service.decide(token, { decision: 'approve', challenge })
        ).rejects.toBeInstanceOf(Error);
      }
      expect(s.approvals.decide).not.toHaveBeenCalled();
      expect(s.repo.consumeToken).not.toHaveBeenCalled();
      // the fifth failure revoked the token
      expect(s.tokens.has(hash)).toBe(false);
      expect(counters.get(`approver-link:fail:${hash.slice(0, 12)}`)).toBe(5);
    });

    it('a bad challenge answers like an unknown link; a bad body is a 400', async () => {
      const s = setup();
      const { token, hash } = s.mint();
      await expect(
        s.service.decide(token, { decision: 'approve', challenge: makeChallenge(hash, Date.now(), SECRET) })
      ).rejects.toMatchObject({ status: 404, response: { error: 'link_invalid' } });
      await expect(
        s.service.decide(token, { decision: 'maybe', challenge: s.goodChallenge(hash) })
      ).rejects.toMatchObject({ status: 400 });
      await expect(s.service.decide(token, null)).rejects.toMatchObject({ status: 400 });
    });

    it('four failures do not revoke, the fifth does', async () => {
      const s = setup();
      const { token, hash } = s.mint();
      for (let i = 0; i < 4; i++) {
        await s.service.decide(token, { decision: 'approve' }).catch(() => undefined);
      }
      expect(s.tokens.has(hash)).toBe(true);
      await s.service.decide(token, { decision: 'approve' }).catch(() => undefined);
      expect(s.tokens.has(hash)).toBe(false);
      await expect(
        s.service.decide(token, { decision: 'approve', challenge: s.goodChallenge(hash) })
      ).rejects.toMatchObject({ response: { error: 'link_invalid' } });
    });

    it('403 link_not_allowed for a member who became USER or was disabled; the token is not consumed', async () => {
      for (const link of [{ role: 'USER', disabled: false }, { role: 'ADMIN', disabled: true }, null]) {
        const s = setup({ link });
        const { token, hash } = s.mint();
        await expect(
          s.service.decide(token, { decision: 'approve', challenge: s.goodChallenge(hash) })
        ).rejects.toMatchObject({ status: 403, response: { error: 'link_not_allowed' } });
        expect(s.repo.consumeToken).not.toHaveBeenCalled();
        expect(s.approvals.decide).not.toHaveBeenCalled();
        expect(s.tokens.get(hash)!.usedAt).toBeNull();
      }
    });

    it('self_approval_blocked for the creator under preventSelfApproval; token not consumed', async () => {
      const s = setup({
        review: {
          flowId: 'f1',
          stages: [
            { position: 1, name: 'Legal', minRole: 'ADMIN', approverUserIds: [], allowAutomation: false, allowGuest: false, status: 'PENDING' },
          ],
        },
      });
      const { token, hash } = s.mint('u-creator');
      await expect(
        s.service.decide(token, { decision: 'approve', challenge: s.goodChallenge(hash) })
      ).rejects.toMatchObject({ status: 403, response: { error: 'self_approval_blocked' } });
      expect(s.repo.consumeToken).not.toHaveBeenCalled();
      expect(s.tokens.get(hash)!.usedAt).toBeNull();
    });

    it('allows the creator on the implicit stage (solo owner keeps today)', async () => {
      const s = setup();
      const { token, hash } = s.mint('u-creator');
      await expect(
        s.service.decide(token, { decision: 'approve', challenge: s.goodChallenge(hash) })
      ).resolves.toMatchObject({ final: true });
    });

    it('restores the token when the engine refuses (a refused decision must not burn the link)', async () => {
      const s = setup();
      s.approvals.decide.mockRejectedValue(
        new ForbiddenException({ error: 'self_approval_blocked', reason: 'not_distinct' })
      );
      const { token, hash } = s.mint();
      await expect(
        s.service.decide(token, { decision: 'approve', challenge: s.goodChallenge(hash) })
      ).rejects.toMatchObject({ status: 403, response: { error: 'self_approval_blocked' } });
      expect(s.tokens.get(hash)!.usedAt).toBeNull();
      s.approvals.decide.mockRejectedValue(
        new ForbiddenException({ error: 'not_allowed_for_stage', reason: 'not_listed' })
      );
      await expect(
        s.service.decide(token, { decision: 'approve', challenge: s.goodChallenge(hash) })
      ).rejects.toMatchObject({ status: 403, response: { error: 'link_not_allowed' } });
      expect(s.tokens.get(hash)!.usedAt).toBeNull();
    });

    it('restores the token on an unexpected failure but keeps it spent after a conflict', async () => {
      const s = setup();
      s.approvals.decide.mockRejectedValueOnce(new Error('schedule failed'));
      const a = s.mint();
      await expect(
        s.service.decide(a.token, { decision: 'approve', challenge: s.goodChallenge(a.hash) })
      ).rejects.toThrow('schedule failed');
      expect(s.tokens.get(a.hash)!.usedAt).toBeNull();
      s.approvals.decide.mockRejectedValueOnce(
        new ConflictException({ error: 'approval_already_resolved', status: 'REJECTED' })
      );
      const b = s.mint();
      await expect(
        s.service.decide(b.token, { decision: 'approve', challenge: s.goodChallenge(b.hash) })
      ).rejects.toMatchObject({ status: 409 });
      expect(s.tokens.get(b.hash)!.usedAt).not.toBeNull();
    });

    it('409 when the engine reports the approval was already decided (changed false)', async () => {
      const s = setup();
      s.approvals.decide.mockResolvedValue({
        approvalId: 'ap1', postId: 'p1', status: 'APPROVED', changed: false,
        stage: { position: 1, total: 1 }, final: true,
      });
      const { token, hash } = s.mint();
      await expect(
        s.service.decide(token, { decision: 'approve', challenge: s.goodChallenge(hash) })
      ).rejects.toMatchObject({ status: 409, response: { error: 'approval_already_resolved', status: 'APPROVED' } });
    });

    it('two parallel POSTs make one decision (only the first consume wins)', async () => {
      const s = setup();
      const { token, hash } = s.mint();
      const body = { decision: 'approve', challenge: s.goodChallenge(hash) };
      const results = await Promise.allSettled([
        s.service.decide(token, body),
        s.service.decide(token, body),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason.getResponse()).toEqual({ error: 'link_invalid' });
      expect(s.approvals.decide).toHaveBeenCalledTimes(1);
    });

    it('a non final approval keeps the other tokens for the next stage purge', async () => {
      const s = setup();
      s.approvals.decide.mockResolvedValue({
        approvalId: 'ap1', postId: 'p1', status: 'PENDING', changed: true,
        stage: { position: 1, total: 2 }, final: false,
      });
      const { token, hash } = s.mint();
      const out = await s.service.decide(token, { decision: 'approve', challenge: s.goodChallenge(hash) });
      expect(out).toEqual({ status: 'PENDING', final: false, stage: { position: 1, total: 2 } });
      expect(s.repo.deleteForApproval).not.toHaveBeenCalled();
    });
  });

  describe('secrecy', () => {
    it('tokens and challenges never reach console or Logger output, nor engine metadata', async () => {
      const s = setup();
      const spies = [
        jest.spyOn(console, 'log'),
        jest.spyOn(console, 'warn'),
        jest.spyOn(console, 'error'),
        jest.spyOn(console, 'info'),
        jest.spyOn(console, 'debug'),
        jest.spyOn(Logger.prototype, 'log'),
        jest.spyOn(Logger.prototype, 'warn'),
        jest.spyOn(Logger.prototype, 'error'),
        jest.spyOn(Logger.prototype, 'debug'),
        jest.spyOn(Logger.prototype, 'verbose'),
      ].map((spy) => spy.mockImplementation(() => undefined as any));
      s.notifications.sendEmail.mockRejectedValueOnce(new Error('boom'));
      await s.service.sendStageEmails(ORG, { id: 'ap1' }, { position: 1, total: 1, name: 'Approval' });
      const m = s.sent[0];
      const token = /approve\/([A-Za-z0-9_-]{43})/.exec(m.html)![1];
      const hash = hashLinkToken(token);
      const challenge = s.goodChallenge(hash);
      await s.service.decide(token, { decision: 'approve', challenge });
      await s.service.decide(token, { decision: 'approve', challenge }).catch(() => undefined);
      await s.service.decide(token, { decision: 'approve' }).catch(() => undefined);
      const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
      expect(logged).not.toContain(token);
      expect(logged).not.toContain(challenge);
      expect(logged).not.toContain(challenge.split('.')[1]);
      expect(JSON.stringify(s.approvals.decide.mock.calls)).not.toContain(token);
      expect(JSON.stringify(s.approvals.decide.mock.calls)).not.toContain(challenge);
      jest.restoreAllMocks();
    });
  });
});
