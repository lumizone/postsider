# Postsider NodeJS SDK

This is the NodeJS SDK for [Postsider](https://postsider.com).

You can start by installing the package:

```bash
npm install @postsider/node
```

## Usage
```typescript
import Postsider from '@postsider/node';
const postsider = new Postsider('your api key', 'your self-hosted instance (optional)');
```

The available methods are:
- `post(posts: CreatePostDto)` - Schedule a post to Postsider
- `postList(filters: GetPostsDto)` - Get a list of posts
- `upload(file: Buffer, extension: string)` - Upload a file to Postsider
- `integrations()` - Get a list of connected channels
- `deletePost(id: string)` - Delete a post by ID

Alternatively you can use the SDK with curl, check the [Postsider API documentation](https://docs.postsider.com/public-api) for more information.