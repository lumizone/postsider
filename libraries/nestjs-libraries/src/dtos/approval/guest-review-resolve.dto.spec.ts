import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GuestReviewResolveDto } from './guest-review-resolve.dto';

const check = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(GuestReviewResolveDto, body);
  const errors = await validate(dto);
  return { dto, props: errors.map((e) => e.property) };
};

describe('GuestReviewResolveDto', () => {
  const original = process.env.GUEST_REVIEW_REQUIRE_IDENTITY;
  afterEach(() => {
    if (original === undefined) delete process.env.GUEST_REVIEW_REQUIRE_IDENTITY;
    else process.env.GUEST_REVIEW_REQUIRE_IDENTITY = original;
  });

  it('requires guestName', async () => {
    const { props } = await check({ action: 'approve', guestEmail: 'a@b.co' });
    expect(props).toContain('guestName');
  });

  it('rejects a 121 char name', async () => {
    const { props } = await check({
      action: 'approve',
      guestName: 'x'.repeat(121),
      guestEmail: 'a@b.co',
    });
    expect(props).toContain('guestName');
  });

  it('rejects an invalid email', async () => {
    const { props } = await check({
      action: 'approve',
      guestName: 'Ann',
      guestEmail: 'not-an-email',
    });
    expect(props).toContain('guestEmail');
  });

  it('rejects a 255 char email', async () => {
    const email = `${'a'.repeat(243)}@example.com`;
    expect(email).toHaveLength(255);
    const { props } = await check({
      action: 'approve',
      guestName: 'Ann',
      guestEmail: email,
    });
    expect(props).toContain('guestEmail');
  });

  it('accepts a valid pair and trims / lowercases', async () => {
    const { dto, props } = await check({
      action: 'reject',
      note: 'no',
      guestName: '  Ann  ',
      guestEmail: '  A@B.co ',
    });
    expect(props).toEqual([]);
    expect(dto.guestName).toBe('Ann');
    expect(dto.guestEmail).toBe('a@b.co');
  });

  it('rejects an unknown action', async () => {
    const { props } = await check({
      action: 'maybe',
      guestName: 'Ann',
      guestEmail: 'a@b.co',
    });
    expect(props).toContain('action');
  });

  it('does not require identity when the rollout switch is false', async () => {
    process.env.GUEST_REVIEW_REQUIRE_IDENTITY = 'false';
    expect((await check({ action: 'approve' })).props).toEqual([]);
    expect(
      (await check({ action: 'approve', guestEmail: 'bad' })).props
    ).toContain('guestEmail');
  });
});
