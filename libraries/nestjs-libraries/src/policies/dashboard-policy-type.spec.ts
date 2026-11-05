import { dashboardPolicyType } from './dashboard-policy-type';

describe('dashboardPolicyType', () => {
  it.each([
    ['draft', 'draft'],
    ['now', 'now'],
    ['schedule', 'schedule'],
    ['update', 'schedule'],
    ['whatever', 'schedule'],
    [undefined, 'schedule'],
    [42, 'schedule'],
    [null, 'schedule'],
  ])('maps %p to %p', (input, expected) => {
    expect(dashboardPolicyType(input)).toBe(expected);
  });
});
