import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per provider-call context. `SocialAbstract.fetch` marks it when a request
 * that is not GET/HEAD returned 2xx, i.e. the platform may already have
 * accepted a write (for example a publish). If the same provider call later
 * fails, the outcome is unknown and must never be auto-retried.
 *
 * Residual: providers that talk to the platform through an SDK or axios
 * instead of `this.fetch` are not observed by this flag.
 */
export interface PublishSideEffectState {
  sideEffectObserved: boolean;
}

const storage = new AsyncLocalStorage<PublishSideEffectState>();

export function runWithPublishSideEffectTracking<T>(
  fn: () => Promise<T>
): { state: PublishSideEffectState; result: Promise<T> } {
  const state: PublishSideEffectState = { sideEffectObserved: false };
  return { state, result: storage.run(state, fn) };
}

export function markPublishSideEffect(method?: string): void {
  const m = (method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD') return;
  const state = storage.getStore();
  if (state) state.sideEffectObserved = true;
}
