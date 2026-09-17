import { isImpersonationEnabled } from './impersonation.flag';

describe('isImpersonationEnabled', () => {
  const original = process.env.ALLOW_SUPERADMIN_IMPERSONATION;

  afterEach(() => {
    if (original === undefined) delete process.env.ALLOW_SUPERADMIN_IMPERSONATION;
    else process.env.ALLOW_SUPERADMIN_IMPERSONATION = original;
  });

  it.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['0', false],
    ['TRUE', false],
    ['True', false],
    ['yes', false],
    ['true', true],
  ])('returns %s -> %s', (value, expected) => {
    if (value === undefined) delete process.env.ALLOW_SUPERADMIN_IMPERSONATION;
    else process.env.ALLOW_SUPERADMIN_IMPERSONATION = value;

    expect(isImpersonationEnabled()).toBe(expected);
  });
});
