# Postsider NodeJS SDK

This is the NodeJS SDK for [Postsider](https://postsider.com).

You can start by installing the package:

```bash
npm install @postsider/node
```

## Usage
```typescript
import Postsider from '@postsider/node';
const postsider = new Postsider('your api key');

// Self-hosted instances served below /api:
const selfHosted = new Postsider('your api key', 'https://your-instance.com', {
  apiBasePath: '/api',
});

const result = await postsider.post(posts, 'stable-request-key');
```

The available methods are:
- `post(posts: CreatePostDto, idempotencyKey?: string)` - Create a draft, schedule or publish according to the explicit `posts.type`; reuse the key safely when retrying
- `getPost(id: string)` - Read a saved post back by ID
- `updatePostStatus(id: string, status: 'draft' | 'schedule')` - Explicitly move a draft to the scheduled queue or back; it never accepts `now`
- `postList(filters: GetPostsDto)` - Get a list of posts
- `upload(file: Buffer, extension: string)` - Upload a file to Postsider
- `integrations()` - Get a list of connected channels
- `deletePost(id: string)` - Delete a post by ID

All non-2xx responses throw `PostsiderApiError` with `status`, `method`, `path`, and parsed response `details`.
`deletePost()` now returns the parsed response body (or `null` for an empty `204` response), rather than the raw `fetch` `Response`. This is a breaking change in SDK `2.0.0`; use `PostsiderApiError.status` and `PostsiderApiError.details` for failed deletes.

Alternatively you can use the SDK with curl, check the [Postsider API documentation](https://docs.postsider.com/public-api) for more information.

## Safe draft-first workflow

The SDK sends the requested operation; it does **not** silently enforce a human
approval gate. A key with `posts:write` can also request `type: "now"`, so your
application must only schedule or publish when the user authorized the content,
channels and timing. Prefer named keys limited to `channels:read`, `posts:read`
and `posts:write`; add scopes only as needed.

1. Resolve a real channel ID using `integrations()`.
2. Call `post({ type: 'draft', ... })`, using a stable idempotency key.
3. Call `getPost(id)` and inspect the stored text, channel and state.
4. After approval and setting a future date, call
   `updatePostStatus(id, 'schedule')` and then `getPost(id)` again.
5. A queued post can be returned to a draft with
   `updatePostStatus(id, 'draft')` (before publication).

The DTO requires `date`, `shortLink`, `tags` and a `posts` array; per-channel
settings and validation rules still apply. See
[API & MCP trust checklist](../../docs/API-MCP-TRUST.md) for request bodies,
scopes, error codes and live-client verification.
