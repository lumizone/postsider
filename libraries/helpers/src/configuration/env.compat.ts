/**
 * Backwards-compatible environment variable reader (Requirements 6, 22.3).
 *
 * During the PostSider rebrand, environment variable names may change. To let
 * existing production deployments upgrade without renaming their env in the
 * same release, `readEnv` performs a dual read:
 *
 *   1. Prefer the canonical (new) variable name.
 *   2. Fall back to the legacy name, emitting a one-time deprecation warning.
 *
 * The warning is emitted at most once per variable per process lifetime
 * (Requirement 22.3) and recorded as an observability breadcrumb so operators
 * can plan migration (Requirement 6.4).
 *
 * Correctness: when both canonical and legacy values are set, the canonical
 * value always wins (Correctness Property 10).
 */

/** Names that have already emitted a deprecation warning this process. */
const warnedLegacyVars = new Set<string>();

/**
 * Optional sink for deprecation events (e.g. Sentry breadcrumb). Defaults to a
 * console warning. Kept injectable so the backend can wire it to
 * `Observability_System` without this helper depending on Sentry directly.
 */
export type DeprecationSink = (event: {
  legacy: string;
  canonical: string;
  message: string;
}) => void;

let deprecationSink: DeprecationSink = ({ message }) => {
  // eslint-disable-next-line no-console
  console.warn(message);
};

/** Override the deprecation sink (call once during bootstrap). */
export function setEnvDeprecationSink(sink: DeprecationSink): void {
  deprecationSink = sink;
}

function emitDeprecationOnce(legacy: string, canonical: string): void {
  if (warnedLegacyVars.has(legacy)) {
    return;
  }
  warnedLegacyVars.add(legacy);
  deprecationSink({
    legacy,
    canonical,
    message:
      `[deprecation] Environment variable "${legacy}" is deprecated and will be ` +
      `removed in a future release. Use "${canonical}" instead.`,
  });
}

/**
 * Read an environment variable, preferring the canonical name and falling back
 * to an optional legacy name with a one-time deprecation warning.
 *
 * @param canonical The current (preferred) variable name.
 * @param legacy    The deprecated variable name to fall back to, if any.
 * @param env       The environment object to read from (defaults to process.env).
 *                  Injectable for testing.
 */
export function readEnv(
  canonical: string,
  legacy?: string,
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const canonicalValue = env[canonical];
  if (canonicalValue != null && canonicalValue !== '') {
    return canonicalValue;
  }

  if (legacy) {
    const legacyValue = env[legacy];
    if (legacyValue != null && legacyValue !== '') {
      emitDeprecationOnce(legacy, canonical);
      return legacyValue;
    }
  }

  return canonicalValue;
}

/** Test-only: reset the one-time warning state. */
export function __resetEnvCompatWarnings(): void {
  warnedLegacyVars.clear();
}
