import { CreatePostDto } from '@postsider/nestjs-libraries/dtos/posts/create.post.dto';
import { GetPostsDto } from '@postsider/nestjs-libraries/dtos/posts/get.posts.dto';
import { createHmac, timingSafeEqual } from 'crypto';
import fetch, { FormData } from 'node-fetch';

export interface PostsiderClientOptions {
  /** Path prefix used by self-hosted deployments, for example `/api`. */
  apiBasePath?: string;
}

export class PostsiderApiError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    readonly method: string,
    readonly path: string,
    readonly details: unknown
  ) {
    super(message);
    this.name = 'PostsiderApiError';
  }
}

function toQueryString(obj: Record<string, any>): string {
  const params = new URLSearchParams();
  Object.entries(obj).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

export default class Postsider {
  private readonly _base: string;

  constructor(
    private _apiKey: string,
    path = 'http://localhost:3000',
    options: PostsiderClientOptions = {}
  ) {
    const basePath = options.apiBasePath ?? '';
    this._base = `${path.replace(/\/+$/, '')}/${basePath.replace(/^\/+|\/+$/g, '')}`.replace(
      /\/$/,
      ''
    );
  }

  private async request(
    path: string,
    options: { method: string; body?: any; headers?: Record<string, string> }
  ) {
    const url = `${this._base}${path}`;
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: {
          Authorization: this._apiKey,
          ...options.headers,
        },
      });
    } catch (error) {
      throw new PostsiderApiError(
        `PostSider API ${options.method} ${path} could not be reached`,
        undefined,
        options.method,
        path,
        error instanceof Error ? error.message : error
      );
    }
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const message =
        data && typeof data === 'object' && 'message' in data
          ? String((data as { message: unknown }).message)
          : data && typeof data === 'object' && 'msg' in data
          ? String((data as { msg: unknown }).msg)
          : typeof data === 'string'
          ? data
          : response.statusText || 'Request failed';
      throw new PostsiderApiError(
        `PostSider API ${options.method} ${path} failed (${response.status}): ${message}`,
        response.status,
        options.method,
        path,
        data
      );
    }

    return data;
  }

  async post(posts: CreatePostDto, idempotencyKey?: string) {
    return this.request('/public/v1/posts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(posts),
    });
  }

  async postList(filters: GetPostsDto) {
    return this.request(`/public/v1/posts?${toQueryString(filters)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async upload(file: Buffer, extension: string) {
    const formData = new FormData();
    const type =
      extension === 'png'
        ? 'image/png'
        : extension === 'jpg'
        ? 'image/jpeg'
        : extension === 'gif'
        ? 'image/gif'
        : extension === 'jpeg'
        ? 'image/jpeg'
        : 'image/jpeg';

    const blob = new Blob([file], { type });
    formData.append('file', blob, extension);

    return this.request('/public/v1/upload', {
      method: 'POST',
      // @ts-ignore
      body: formData,
      headers: {},
    });
  }

  async integrations() {
    return this.request('/public/v1/integrations', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Verify an inbound webhook HMAC signature (Requirement 19.3).
   * `signature` is the value of the `X-Postsider-Signature` header
   * (`sha256=<hex>`), `body` is the raw request body, and `secret` is the
   * endpoint secret. `timestamp` is required from `X-Postsider-Timestamp`;
   * it is included in the signed payload to reject replayed requests.
   */
  static verifyWebhookSignature(
    signature: string,
    body: string,
    secret: string,
    timestamp: string,
    toleranceSeconds = 300
  ): boolean {
    if (!signature) return false;
    const parsed = Number(timestamp);
    if (!Number.isFinite(parsed) || Math.abs(Date.now() / 1000 - parsed) > toleranceSeconds) return false;
    const expected =
      'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  deletePost(id: string) {
    return this.request(`/public/v1/posts/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
