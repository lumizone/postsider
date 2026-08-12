import { CreatePostDto } from '@postsider/nestjs-libraries/dtos/posts/create.post.dto';
import { GetPostsDto } from '@postsider/nestjs-libraries/dtos/posts/get.posts.dto';
import { createHmac, timingSafeEqual } from 'crypto';
import fetch, { FormData } from 'node-fetch';

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
  constructor(
    private _apiKey: string,
    private _path = 'https://api.postsider.com'
  ) {}

  async post(posts: CreatePostDto) {
    return (
      await fetch(`${this._path}/public/v1/posts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this._apiKey,
        },
        body: JSON.stringify(posts),
      })
    ).json();
  }

  async postList(filters: GetPostsDto) {
    return (
      await fetch(`${this._path}/public/v1/posts?${toQueryString(filters)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this._apiKey,
        },
      })
    ).json();
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

    return (
      await fetch(`${this._path}/public/v1/upload`, {
        method: 'POST',
        // @ts-ignore
        body: formData,
        headers: {
          Authorization: this._apiKey,
        },
      })
    ).json();
  }

  async integrations() {
    return (
      await fetch(`${this._path}/public/v1/integrations`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: this._apiKey,
        },
      })
    ).json();
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
    return fetch(`${this._path}/public/v1/posts/${id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this._apiKey,
      },
    });
  }
}
