# Postsider NodeJS SDK

This is the NodeJS SDK for PostSider instances.

You can start by installing the package:

```bash
npm install @postsider/node
```

## Usage
```typescript
import Postsider from '@postsider/node';
const postsider = new Postsider('your api key', 'https://social.example.com', {
  apiBasePath: '/api',
});

const result = await postsider.post(posts, 'stable-request-key');
```

The available methods are:
- `post(posts: CreatePostDto, idempotencyKey?: string)` - Schedule a post; reuse the key safely when retrying
- `postList(filters: GetPostsDto)` - Get a list of posts
- `upload(file: Buffer, extension: string)` - Upload a file to Postsider
- `integrations()` - Get a list of connected channels
- `deletePost(id: string)` - Delete a post by ID

All non-2xx responses throw `PostsiderApiError` with `status`, `method`, `path`, and parsed response `details`.
`deletePost()` now returns the parsed response body (or `null` for an empty `204` response), rather than the raw `fetch` `Response`. This is a breaking change in SDK `2.0.0`; use `PostsiderApiError.status` and `PostsiderApiError.details` for failed deletes.

The local development default is `http://localhost:3000`. Production callers
should always set their instance URL explicitly.
