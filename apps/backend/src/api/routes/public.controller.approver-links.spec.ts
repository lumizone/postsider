jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { NotFoundException } from '@nestjs/common';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PublicController } from './public.controller';
import { ApprovalService } from '@postsider/nestjs-libraries/database/prisma/approval/approval.service';
import { ApprovalLinkService } from '@postsider/nestjs-libraries/database/prisma/approval/approval-link.service';
import { AuthRateLimitGuard } from '@postsider/nestjs-libraries/services/auth-rate-limit.guard';

describe('approver link routes', () => {
  let app: INestApplication;
  let base: string;
  const links = { view: jest.fn(), decide: jest.fn() };

  beforeAll(async () => {
    const tokens = new Map<any, any>([
      [ApprovalService, {}],
      [ApprovalLinkService, links],
    ]);
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
    links.view.mockResolvedValue({ stage: { position: 1 }, challenge: '1.abc' });
    links.decide.mockResolvedValue({ status: 'APPROVED', final: true });
  });

  it('GET answers no-store and no-referrer and passes only the token', async () => {
    const res = await fetch(`${base}/approver-links/tok123`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(links.view).toHaveBeenCalledWith('tok123');
    expect(links.decide).not.toHaveBeenCalled();
  });

  it('keeps the privacy headers on an error answer and the identical 404 body', async () => {
    links.view.mockRejectedValue(new NotFoundException({ error: 'link_invalid' }));
    const res = await fetch(`${base}/approver-links/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await res.json()).toEqual({ error: 'link_invalid' });
  });

  it('POST with JSON reaches the service with the raw body and the token', async () => {
    const body = { decision: 'approve', challenge: 'c.h', note: 'ok' };
    const res = await fetch(`${base}/approver-links/tok123/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(links.decide).toHaveBeenCalledWith('tok123', body);
    expect(await res.json()).toEqual({ status: 'APPROVED', final: true });
  });

  it('a form encoded POST (what a cross-site HTML form sends) never reaches the service', async () => {
    for (const type of ['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'text/plain']) {
      const res = await fetch(`${base}/approver-links/tok123/decision`, {
        method: 'POST',
        headers: { 'Content-Type': type },
        body: 'decision=approve&challenge=1.abc',
      });
      expect(res.status).toBe(400);
    }
    expect(links.decide).not.toHaveBeenCalled();
  });

  it('a POST with no content type is refused too', async () => {
    const res = await fetch(`${base}/approver-links/tok123/decision`, { method: 'POST' });
    expect(res.status).toBe(400);
    expect(links.decide).not.toHaveBeenCalled();
  });

  it('both routes sit behind the rate limit guard', () => {
    for (const name of ['getApproverLink', 'decideApproverLink'] as const) {
      const guards: unknown[] = Reflect.getMetadata('__guards__', PublicController.prototype[name]) ?? [];
      expect(guards).toContain(AuthRateLimitGuard);
    }
  });
});
