// Pure module: no imports, so it is safe inside the Temporal workflow sandbox.

export const PUBLISH_ERROR_CATEGORIES = [
  'AUTH_EXPIRED',
  'PERMISSION_MISSING',
  'RATE_LIMITED',
  'INVALID_CONTENT',
  'PROVIDER_UNAVAILABLE',
  'UNKNOWN_OUTCOME',
  'POLICY_BLOCKED',
  'UNKNOWN',
] as const;

export type PublishErrorCategoryName = (typeof PUBLISH_ERROR_CATEGORIES)[number];
export type AutoRetryPolicy = 'refresh' | 'delay' | 'none';
export type BadBodyKind =
  | 'rate_limited'
  | 'provider_unavailable'
  | 'pre_connection'
  | 'unknown_outcome';

export interface PublishFailure {
  category: PublishErrorCategoryName;
  retryable: boolean;
  autoRetry: AutoRetryPolicy;
  message: string;
}

export const PRE_CONNECTION_CODES = [
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
] as const;
export const AUTO_RETRY_DELAYS = ['2 minutes', '10 minutes'] as const;
export const MAX_AUTH_REFRESHES = 2;
export const UNKNOWN_OUTCOME_MESSAGE =
  'The platform did not confirm whether this post was published. Check the channel before retrying to avoid a duplicate.';

const MAX_MESSAGE_LENGTH = 500;
const MAX_CHAIN_DEPTH = 8;

/** Thrown when nothing was sent to the provider. */
export class PrePublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrePublishError';
  }
}

export function sanitizeFailureMessage(
  value: unknown,
  fallback: string
): string {
  const text =
    typeof value === 'string'
      ? value.replace(/[–—]/g, '-').trim().slice(0, MAX_MESSAGE_LENGTH)
      : '';
  return text || fallback;
}

function causeChain(err: unknown): any[] {
  const chain: any[] = [];
  let node: any = err;
  while (
    chain.length < MAX_CHAIN_DEPTH &&
    node !== null &&
    typeof node === 'object'
  ) {
    chain.push(node);
    node = node.cause;
  }
  return chain;
}

function badBodyKind(node: any): unknown {
  return node?.details?.[0]?.kind;
}

function hasPreConnectionCode(node: any): boolean {
  return (PRE_CONNECTION_CODES as readonly unknown[]).includes(node?.code);
}

export function isPreConnectionError(err: unknown): boolean {
  return causeChain(err).some(
    (node) =>
      (node.type === 'bad_body' && badBodyKind(node) === 'pre_connection') ||
      hasPreConnectionCode(node)
  );
}

const unknownOutcome = (): PublishFailure => ({
  category: 'UNKNOWN_OUTCOME',
  retryable: false,
  autoRetry: 'none',
  message: UNKNOWN_OUTCOME_MESSAGE,
});

function classifyBadBody(node: any): PublishFailure {
  const result = (
    category: PublishErrorCategoryName,
    retryable: boolean,
    autoRetry: AutoRetryPolicy,
    fallback: string
  ): PublishFailure => ({
    category,
    retryable,
    autoRetry,
    message: sanitizeFailureMessage(node.message, fallback),
  });
  switch (badBodyKind(node)) {
    case 'rate_limited':
      return result(
        'RATE_LIMITED',
        true,
        'delay',
        'The platform rate limit was reached.'
      );
    case 'provider_unavailable':
      return result(
        'PROVIDER_UNAVAILABLE',
        false,
        'none',
        'The platform reported an error.'
      );
    case 'pre_connection':
      return result(
        'PROVIDER_UNAVAILABLE',
        true,
        'delay',
        'Could not reach the platform.'
      );
    case 'unknown_outcome':
      return unknownOutcome();
    default:
      return result(
        'INVALID_CONTENT',
        false,
        'none',
        'The platform rejected the post.'
      );
  }
}

function classifyTypedFailure(node: any): PublishFailure | undefined {
  switch (node.type) {
    case 'refresh_token':
      return {
        category: 'AUTH_EXPIRED',
        retryable: false,
        autoRetry: 'refresh',
        message: sanitizeFailureMessage(
          node.message,
          'The channel authorization expired. Reconnect the channel.'
        ),
      };
    case 'not_enough_scopes':
      return {
        category: 'PERMISSION_MISSING',
        retryable: false,
        autoRetry: 'none',
        message: sanitizeFailureMessage(
          node.message,
          'The channel is missing required permissions. Reconnect it and grant all scopes.'
        ),
      };
    case 'bad_body':
      return classifyBadBody(node);
    default:
      return undefined;
  }
}

export function classifyPublishError(err: unknown): PublishFailure {
  const chain = causeChain(err);

  for (const node of chain) {
    if (typeof node.type === 'string') {
      const typed = classifyTypedFailure(node);
      if (typed) return typed;
    }
  }

  const pre = chain.find((node) => node.name === 'PrePublishError');
  if (pre) {
    return {
      category: 'UNKNOWN',
      retryable: false,
      autoRetry: 'none',
      message: sanitizeFailureMessage(pre.message, 'The post was not sent.'),
    };
  }

  if (chain.some(hasPreConnectionCode)) {
    return {
      category: 'PROVIDER_UNAVAILABLE',
      retryable: true,
      autoRetry: 'delay',
      message: 'Could not reach the platform.',
    };
  }

  return unknownOutcome();
}
