import { CheckProvider, LlmProvider } from './post-checker.types';

export function pickProvider(providers: LlmProvider[], name: CheckProvider): LlmProvider {
  const found = providers.find((p) => p.name === name);
  if (!found) throw new Error(`Unsupported post-checker provider: ${name}`);
  return found;
}
