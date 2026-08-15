import { TRIAL_X_POSTS_LIMIT } from './trial.x.limit';

describe('trial X publishing limit', () => {
  it('keeps the internal anti-abuse cap at twenty posts', () => {
    expect(TRIAL_X_POSTS_LIMIT).toBe(20);
  });
});
