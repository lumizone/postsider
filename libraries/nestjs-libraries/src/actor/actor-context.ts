import { AsyncLocalStorage } from 'node:async_hooks';
import { PostActor, SYSTEM_ACTOR } from './post-actor';

type ActorStore = { actor: PostActor; impersonatedBy?: string };

const storage = new AsyncLocalStorage<ActorStore>();

export function runWithActor<T>(
  actor: PostActor,
  fn: () => T,
  opts?: { impersonatedBy?: string }
): T {
  return storage.run({ actor, impersonatedBy: opts?.impersonatedBy }, fn);
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
