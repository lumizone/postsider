jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PublicController } from './public.controller';
import { ApprovalService } from '@postsider/nestjs-libraries/database/prisma/approval/approval.service';
import { AuthRateLimitGuard } from '@postsider/nestjs-libraries/services/auth-rate-limit.guard';

describe('POST /public/approval-review/:token/resolve', () => {
  let app: INestApplication;
  let base: string;
  const approvals = { resolveGuestReview: jest.fn() };
  const original = process.env.GUEST_REVIEW_REQUIRE_IDENTITY;

  beforeAll(async () => {
    const tokens = new Map<any, any>([[ApprovalService, approvals]]);
    const moduleRef = await Test.createTestingModule({ controllers: [PublicController] })
      .useMocker((token) => tokens.get(token) ?? {})
      .overrideGuard(AuthRateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/public`;
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    jest.resetAllMocks();
    delete process.env.GUEST_REVIEW_REQUIRE_IDENTITY;
    approvals.resolveGuestReview.mockResolvedValue({ approved: true });
  });
  afterAll(() => {
    if (original === undefined) delete process.env.GUEST_REVIEW_REQUIRE_IDENTITY;
    else process.env.GUEST_REVIEW_REQUIRE_IDENTITY = original;
  });

  const post = (body: unknown) =>
    fetch(`${base}/approval-review/tok/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('400 without a guest name and does not resolve', async () => {
    const res = await post({ action: 'approve', guestEmail: 'a@b.co' });
    expect(res.status).toBe(400);
    expect(approvals.resolveGuestReview).not.toHaveBeenCalled();
  });

  it('passes the normalised guest identity down', async () => {
    const res = await post({ action: 'approve', guestName: ' Ann ', guestEmail: 'A@b.co' });
    expect(res.status).toBe(201);
    expect(approvals.resolveGuestReview).toHaveBeenCalledWith(
      'tok',
      'approve',
      undefined,
      { name: 'Ann', email: 'a@b.co' }
    );
  });

  it('accepts a missing identity only while the rollout switch is false', async () => {
    process.env.GUEST_REVIEW_REQUIRE_IDENTITY = 'false';
    const res = await post({ action: 'approve' });
    expect(res.status).toBe(201);
    expect(approvals.resolveGuestReview).toHaveBeenCalledWith('tok', 'approve', undefined, null);
  });
});
