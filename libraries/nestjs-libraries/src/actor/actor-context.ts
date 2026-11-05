import { AsyncLocalStorage } from 'node:async_hooks';
import { PostActor, SYSTEM_ACTOR } from './post-actor';
import type { KeyPermissions } from '../policies/key-permissions';

type ActorStore = {
  actor: PostActor;
  impersonatedBy?: string;
  keyPermissions?: KeyPermissions;
};

const storage = new AsyncLocalStorage<ActorStore>();

export function runWithActor<T>(
  actor: PostActor,
  fn: () => T,
  opts?: { impersonatedBy?: string; keyPermissions?: KeyPermissions }
): T {
  return storage.run(
    {
      actor,
      impersonatedBy: opts?.impersonatedBy,
      keyPermissions: opts?.keyPermissions,
    },
    fn
  );
}

export function runAsSystem<T>(fn: () => T): T {
  return runWithActor(SYSTEM_ACTOR, fn);
}

export function currentActor(): PostActor {
  return storage.getStore()?.actor ?? SYSTEM_ACTOR;
}

export function currentImpersonator(): string | undefined {
  return storage.getStore()?.impersonatedBy;
}

/** Limits of the API key behind this request; null for no context or no limits. */
export function currentKeyPermissions(): KeyPermissions | null {
  return storage.getStore()?.keyPermissions ?? null;
}
