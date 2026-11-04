import { SYSTEM_ACTOR, PostActor } from './post-actor';
import {
  currentActor,
  currentImpersonator,
  runAsSystem,
  runWithActor,
} from './actor-context';

const user: PostActor = { type: 'USER', userId: 'u1' };
const key: PostActor = { type: 'API_KEY', apiKeyId: 'k1' };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('actor-context', () => {
  it('is SYSTEM outside a run', () => {
    expect(currentActor()).toEqual(SYSTEM_ACTOR);
  });

  it('survives awaits', async () => {
    const got = await runWithActor(user, async () => {
      await Promise.resolve();
      await wait(1);
      return currentActor();
    });
    expect(got).toEqual(user);
  });

  it('nested run overrides and restores', () => {
    runWithActor(user, () => {
      runWithActor(key, () => expect(currentActor()).toEqual(key));
      expect(currentActor()).toEqual(user);
    });
  });

  it('runAsSystem yields SYSTEM inside a user run', () => {
    runWithActor(user, () => {
      expect(runAsSystem(() => currentActor())).toEqual(SYSTEM_ACTOR);
      expect(currentActor()).toEqual(user);
    });
  });

  it('concurrent runs are isolated', async () => {
    const run = (a: PostActor, ms: number) =>
      runWithActor(a, async () => {
        await wait(ms);
        return currentActor();
      });
    const [a, b] = await Promise.all([run(user, 5), run(key, 1)]);
    expect(a).toEqual(user);
    expect(b).toEqual(key);
  });

  it('impersonator scoping', () => {
    expect(currentImpersonator()).toBeUndefined();
    runWithActor(
      user,
      () => {
        expect(currentImpersonator()).toBe('admin1');
        runWithActor(key, () => expect(currentImpersonator()).toBeUndefined());
        expect(currentImpersonator()).toBe('admin1');
      },
      { impersonatedBy: 'admin1' }
    );
    expect(currentImpersonator()).toBeUndefined();
  });
});
