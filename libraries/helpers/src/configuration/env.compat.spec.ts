import fc from 'fast-check';
import {
  readEnv,
  setEnvDeprecationSink,
  __resetEnvCompatWarnings,
} from '@postsider/helpers/configuration/env.compat';

describe('EnvCompat.readEnv', () => {
  beforeEach(() => {
    __resetEnvCompatWarnings();
    setEnvDeprecationSink(() => {});
  });

  it('Property 10: canonical value always wins when both are set', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.string({ minLength: 1 }),
        (canonicalValue, legacyValue) => {
          __resetEnvCompatWarnings();
          const env = {
            MY_CANONICAL: canonicalValue,
            MY_LEGACY: legacyValue,
          } as NodeJS.ProcessEnv;
          const result = readEnv('MY_CANONICAL', 'MY_LEGACY', env);
          expect(result).toBe(canonicalValue);
        }
      )
    );
  });

  it('falls back to legacy only when canonical is unset/empty', () => {
    expect(readEnv('C', 'L', { L: 'legacy' } as NodeJS.ProcessEnv)).toBe('legacy');
    expect(readEnv('C', 'L', { C: '', L: 'legacy' } as NodeJS.ProcessEnv)).toBe(
      'legacy'
    );
    expect(readEnv('C', 'L', {} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it('emits a deprecation warning at most once per legacy variable', () => {
    let calls = 0;
    setEnvDeprecationSink(() => {
      calls++;
    });
    const env = { OLD: 'x' } as NodeJS.ProcessEnv;
    readEnv('NEW', 'OLD', env);
    readEnv('NEW', 'OLD', env);
    readEnv('NEW', 'OLD', env);
    expect(calls).toBe(1);
  });

  it('does not warn when only the canonical name is used', () => {
    let calls = 0;
    setEnvDeprecationSink(() => {
      calls++;
    });
    readEnv('NEW', 'OLD', { NEW: 'value' } as NodeJS.ProcessEnv);
    expect(calls).toBe(0);
  });
});
