import { timer } from '@postsider/helpers/utils/timer';
import { Integration } from '@prisma/client';
import { ApplicationFailure } from '@temporalio/activity';
import { readOrFetch } from '@postsider/helpers/utils/read.or.fetch';
import sharp from 'sharp';

export type ValidityMedia = {
  path: string;
  thumbnail?: string;
  /** Media row id, when the caller knows it. */
  id?: string;
  /** Pixel dimensions, persisted on the Media row at upload time. */
  width?: number;
  height?: number;
  /** Video duration in seconds, probed at upload time. */
  durationSeconds?: number;
};

export class RefreshToken extends ApplicationFailure {
  constructor(identifier: string, json: string, body: BodyInit, message = '') {
    super(message, 'refresh_token', true, [
      {
        identifier,
        json,
        body,
      },
    ]);
  }
}

export class BadBody extends ApplicationFailure {
  constructor(identifier: string, json: string, body: BodyInit, message = '') {
    super(message, 'bad_body', true, [
      {
        identifier,
        json,
        body,
      },
    ]);
  }
}

export class NotEnoughScopes extends ApplicationFailure {
  constructor(
    message = 'Not enough scopes, when choosing a provider, please add all the scopes'
  ) {
    super(message, 'not_enough_scopes', true);
  }
}

/**
 * Guard for raw-fetch token-refresh implementations. A refresh response
 * without an access token is a failure, and it must be *thrown* so the
 * lifecycle can classify it: `invalid_grant`/`invalid_client` is a permanent
 * rejection (the user must reconnect), while anything else (5xx, rate limit,
 * malformed upstream body) is transient and gets retried. Returns the access
 * token when present.
 *
 * Providers that silently returned an object with `accessToken: undefined`
 * made every transient outage look like a revoked credential, forcing a
 * manual reconnect for a channel that was perfectly healthy.
 */
export function assertRefreshedAccessToken(
  provider: string,
  response: any,
  status?: number
): string {
  const token = response?.access_token;
  if (typeof token === 'string' && token.length > 0) {
    return token;
  }
  const errorCode = String(
    response?.error ?? response?.error_description ?? ''
  );
  const message = `${provider} token refresh failed${
    errorCode ? `: ${errorCode}` : status ? ` (HTTP ${status})` : ''
  }`;
  if (
    /invalid_grant|invalid_client|invalid_request|invalid_token|unauthorized|revoked/i.test(
      errorCode
    )
  ) {
    throw new RefreshToken(provider, JSON.stringify(response ?? {}), '', message);
  }
  throw new Error(message);
}

function safeStringify(obj: any) {
  const seen = new WeakSet();

  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  });
}

export abstract class SocialAbstract {
  abstract identifier: string;
  maxConcurrentJob = 1;

  public handleErrors(
    body: string,
    status: number
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    return undefined;
  }

  /**
   * Server-side replacement for the old client-side `checkValidity`.
   * Validates the media attached to a post (and its comments) against the
   * provider rules. Returns `true` when valid, or an error message string.
   *
   * `posts` mirrors the client shape: the outer array is the main post followed
   * by each comment, the inner array is the media items for that entry.
   *
   * Note: video-duration validations that used to run in the browser are not
   * re-implemented here (no ffmpeg dependency). Image-dimension checks use sharp.
   */
  async checkValidity(
    posts: Array<ValidityMedia[]>,
    settings: any,
    additionalSettings: any[]
  ): Promise<string | true> {
    return true;
  }

  /** Reads the pixel dimensions of an image via sharp (works for http or local paths). */
  protected async getImageDimensions(
    path: string
  ): Promise<{ width: number; height: number }> {
    // Stored media paths are relative (e.g. "uploads/x.png"); resolve them to a
    // fetchable URL the same way posts.service.updateMedia does.
    const url =
      path?.indexOf('http') === -1
        ? `${process.env.FRONTEND_URL}/${path}`
        : path;
    const { width = 0, height = 0 } = await sharp(
      await readOrFetch(url)
    ).metadata();
    return { width, height };
  }

  public async mention(
    token: string,
    d: { query: string },
    id: string,
    integration: Integration
  ): Promise<
    | { id: string; label: string; image: string; doNotCache?: boolean }[]
    | { none: true }
  > {
    return { none: true };
  }

  async runInConcurrent<T>(
    func: (...args: any[]) => Promise<T>,
    ignoreConcurrency?: boolean
  ) {
    let globalErr = {};
    let value: any;
    try {
      value = await func();
    } catch (err) {
      const handle = this.handleErrors(safeStringify(err), 200);
      value = { err: true, value: 'Unknown Error', ...(handle || {}) };
      globalErr = err as any;
    }

    if (value && value?.err && value?.value) {
      if (value.type === 'refresh-token') {
        throw new RefreshToken(
          '',
          safeStringify({}),
          {} as any,
          value.value || ''
        );
      }
      throw new BadBody('', safeStringify(globalErr), {} as any, value.value || '');
    }

    return value;
  }

  async fetch(
    url: string,
    options: RequestInit = {},
    identifier = '',
    totalRetries = 0,
    ignoreConcurrency = false
  ): Promise<Response> {
    const request = await fetch(url, options);

    if (request.status >= 200 && request.status < 300) {
      return request;
    }

    if (totalRetries > 2) {
      throw new BadBody(identifier, '{}', options.body || '{}');
    }

    let json = '{}';
    try {
      json = await request.text();
    } catch (err) {
      json = '{}';
    }

    const handleError = this.handleErrors(json || '{}', request.status);

    if (
      request.status === 429 ||
      (request.status === 500 && !handleError) ||
      json.includes('rate_limit_exceeded') ||
      json.includes('Rate limit')
    ) {
      await timer(5000);
      return this.fetch(
        url,
        options,
        identifier,
        totalRetries + 1,
        ignoreConcurrency
      );
    }

    if (handleError?.type === 'retry') {
      await timer(5000);
      return this.fetch(
        url,
        options,
        identifier,
        totalRetries + 1,
        ignoreConcurrency
      );
    }

    if (
      (request.status === 401 &&
        (handleError?.type === 'refresh-token' || !handleError)) ||
      handleError?.type === 'refresh-token'
    ) {
      throw new RefreshToken(
        identifier,
        json,
        options.body!,
        handleError?.value
      );
    }

    throw new BadBody(
      identifier,
      json,
      options.body!,
      handleError?.value || 'Unknown Error'
    );
  }

  checkScopes(required: string[], got: string | string[]) {
    if (Array.isArray(got)) {
      if (!required.every((scope) => got.includes(scope))) {
        throw new NotEnoughScopes();
      }

      return true;
    }

    const newGot = decodeURIComponent(got);

    const splitType = newGot.indexOf(',') > -1 ? ',' : ' ';
    const gotArray = newGot.split(splitType);
    if (!required.every((scope) => gotArray.includes(scope))) {
      throw new NotEnoughScopes();
    }

    return true;
  }
}
