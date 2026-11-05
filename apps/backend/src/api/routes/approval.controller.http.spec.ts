jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { ApprovalController } from './approval.controller';
import { ApprovalService } from '@postsider/nestjs-libraries/database/prisma/approval/approval.service';

const future = new Date(Date.now() + 3600_000);

// A raw DB-shaped row, as the repository returns it.
const rawRow = () => ({
  id: 'a1',
  postId: 'p1',
  organizationId: 'org-1',
  status: 'PENDING',
  note: null,
  requestedAt: new Date('2026-11-01T00:00:00Z'),
  resolvedAt: null,
  guestToken: 'PLAINTEXT-SECRET',
  guestTokenHash: 'HASH-SECRET',
  guestTokenExpiresAt: future,
  requestedById: 'u-requester',
  approverId: 'u-approver',
  guestEmail: 'guest@example.com',
  requestedBy: { name: 'Ann', email: 'ann@example.com' },
  post: { id: 'p1', content: 'hi', group: 'g' },
});

describe('ApprovalController response projection', () => {
  let app: INestApplication;
  let base: string;
  let role = 'USER';
  const approvals = {
    getPending: jest.fn(),
    getForPost: jest.fn(),
    requestApproval: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
  };

  beforeAll(async () => {
    const tokens = new Map<any, any>([[ApprovalService, approvals]]);
    const moduleRef = await Test.createTestingModule({ controllers: [ApprovalController] })
      .useMocker((token) => tokens.get(token) ?? {})
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.use((req: any, _res: any, next: any) => {
      req.org = { id: 'org-1', users: [{ role }] };
      req.user = { id: 'u-me' };
      next();
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/approval`;
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    jest.resetAllMocks();
    approvals.getPending.mockResolvedValue([rawRow()]);
    approvals.getForPost.mockResolvedValue(rawRow());
    approvals.requestApproval.mockResolvedValue({ ...rawRow(), created: true });
  });

  const forbidden = [
    'guestToken',
    'guestTokenHash',
    'guestTokenExpiresAt',
    'requestedById',
    'approverId',
    'guestEmail',
    'PLAINTEXT-SECRET',
    'HASH-SECRET',
    'u-requester',
    'u-approver',
    'guest@example.com',
  ];
  const expectClean = (text: string) => {
    for (const needle of forbidden) expect(text).not.toContain(needle);
  };

  it.each(['USER', 'ADMIN', 'SUPERADMIN'])('GET /pending leaks nothing as %s', async (r) => {
    role = r;
    const res = await fetch(`${base}/pending`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expectClean(text);
    const body = JSON.parse(text);
    expect(body[0].id).toBe('a1');
    expect(body[0].requestedBy).toEqual({ name: 'Ann', email: 'ann@example.com' });
    expect(body[0].hasGuestLink).toBe(r !== 'USER');
  });

  it('GET /pending: a member never learns that a link exists, admins do', async () => {
    role = 'USER';
    const user = await (await fetch(`${base}/pending`)).json();
    expect(user[0].hasGuestLink).toBe(false);
    expect(user[0]).not.toHaveProperty('guestLinkExpiresAt');
    role = 'ADMIN';
    const admin = await (await fetch(`${base}/pending`)).json();
    expect(admin[0].hasGuestLink).toBe(true);
    expect(typeof admin[0].guestLinkExpiresAt).toBe('string');
  });

  it.each(['USER', 'ADMIN'])('GET /post/x leaks nothing as %s', async (r) => {
    role = r;
    const res = await fetch(`${base}/post/x`);
    expect(res.status).toBe(200);
    expectClean(await res.text());
  });

  it('GET /post/x with no approval answers an empty body', async () => {
    approvals.getForPost.mockResolvedValue(null);
    const res = await fetch(`${base}/post/x`);
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBe(0);
  });

  it.each(['USER', 'ADMIN'])('POST /request leaks nothing as %s', async (r) => {
    role = r;
    const res = await fetch(`${base}/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: 'p1' }),
    });
    expect(res.status).toBe(201);
    const text = await res.text();
    expectClean(text);
    expect(JSON.parse(text).created).toBe(true);
  });

  describe('stage guard', () => {
    const put = (path: string, body?: unknown) =>
      fetch(`${base}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    it('approve forwards the stage the admin saw', async () => {
      role = 'ADMIN';
      approvals.approve.mockResolvedValue({ approved: true, postId: 'p1' });
      const res = await put('/a1/approve', { expectStage: 2 });
      expect(res.status).toBe(200);
      expect(approvals.approve).toHaveBeenCalledWith('org-1', 'a1', 'u-me', 'ADMIN', 2);
    });

    it('approve without a body keeps working (expectStage optional)', async () => {
      role = 'ADMIN';
      approvals.approve.mockResolvedValue({ approved: true, postId: 'p1' });
      const res = await put('/a1/approve');
      expect(res.status).toBe(200);
      expect(approvals.approve).toHaveBeenCalledWith('org-1', 'a1', 'u-me', 'ADMIN', undefined);
    });

    it('reject forwards note and stage', async () => {
      role = 'ADMIN';
      approvals.reject.mockResolvedValue({ rejected: true, postId: 'p1' });
      const res = await put('/a1/reject', { note: 'no', expectStage: 1 });
      expect(res.status).toBe(200);
      expect(approvals.reject).toHaveBeenCalledWith('org-1', 'a1', 'u-me', 'ADMIN', 'no', 1);
    });

    it.each([0, -1, 1.5, 'x'])('expectStage %p is a 400 and nothing is decided', async (bad) => {
      role = 'ADMIN';
      const res = await put('/a1/approve', { expectStage: bad });
      expect(res.status).toBe(400);
      expect(approvals.approve).not.toHaveBeenCalled();
    });
  });
});
