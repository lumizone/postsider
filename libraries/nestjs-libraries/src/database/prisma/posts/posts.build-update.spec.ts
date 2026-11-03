jest.mock('isomorphic-dompurify', () => ({
  sanitize: (value: string) => value,
}));

import { PostsService } from './posts.service';

/**
 * buildPostUpdate powers PUT /public/v1/posts/:id (and the MCP edit tool). A
 * partial edit must never wipe what the caller did not send.
 */
describe('PostsService.buildPostUpdate', () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    group: 'g1',
    state: 'DRAFT',
    parentPostId: null,
    integrationId: 'int-1',
    integration: { id: 'int-1', deletedAt: null },
    content: 'old text',
    delay: 0,
    firstComment: 'old comment',
    publishDate: new Date('2030-01-01T10:00:00.000Z'),
    settings: JSON.stringify({ __type: 'x', who_can_reply_post: 'everyone' }),
    image: JSON.stringify([{ id: 'm1', path: 'image/a.png' }]),
    tags: [{ tag: { name: 'launch' } }],
    ...over,
  });

  const build = (thread: any[]) => {
    const service = Object.create(PostsService.prototype) as PostsService;
    (service as any).getPostsRecursively = jest.fn().mockResolvedValue(thread);
    return service;
  };

  it('keeps everything that was not sent', async () => {
    const { dto, state } = await build([stored()]).buildPostUpdate('org', 'p1', {
      content: 'new text',
    });
    const post = dto.posts[0] as any;

    expect(state).toBe('DRAFT');
    // Drafts keep lenient draft validation; anything else is an in-place update.
    expect(dto.type).toBe('draft');
    expect(post.group).toBe('g1');
    expect(post.integration.id).toBe('int-1');
    expect(post.firstComment).toBe('old comment');
    expect(post.settings).toEqual({ __type: 'x', who_can_reply_post: 'everyone' });
    expect(post.value[0]).toMatchObject({
      id: 'p1',
      content: 'new text',
      image: [{ id: 'm1', path: 'image/a.png' }],
    });
    expect(dto.date).toBe('2030-01-01T10:00:00.000Z');
    expect(dto.tags).toEqual([{ value: 'launch', label: 'launch' }]);
  });

  it('uses a real update for a scheduled post', async () => {
    const { dto } = await build([stored({ state: 'QUEUE' })]).buildPostUpdate('org', 'p1', {
      content: 'x',
    });
    expect(dto.type).toBe('update');
  });

  it('replaces media wholesale and can clear it', async () => {
    const svc = build([stored()]);
    const replaced = await svc.buildPostUpdate('org', 'p1', {
      images: [{ id: 'm2', path: 'image/b.png' }],
    });
    expect((replaced.dto.posts[0] as any).value[0].image).toEqual([
      { id: 'm2', path: 'image/b.png' },
    ]);

    const cleared = await svc.buildPostUpdate('org', 'p1', { images: [] });
    expect((cleared.dto.posts[0] as any).value[0].image).toEqual([]);
  });

  it('clears the first comment on null but keeps it on undefined', async () => {
    const svc = build([stored()]);
    const cleared = await svc.buildPostUpdate('org', 'p1', { firstComment: null });
    expect((cleared.dto.posts[0] as any).firstComment).toBeUndefined();
  });

  it('only edits the first part of a thread', async () => {
    const thread = [
      stored(),
      stored({ id: 'p2', parentPostId: 'p1', content: 'reply', image: '[]' }),
    ];
    const { dto } = await build(thread).buildPostUpdate('org', 'p1', {
      content: 'new first',
    });
    const values = (dto.posts[0] as any).value;
    expect(values.map((v: any) => [v.id, v.content])).toEqual([
      ['p1', 'new first'],
      ['p2', 'reply'],
    ]);
  });

  it.each(['PUBLISHED', 'APPROVAL'])('rejects a %s post', async (state) => {
    await expect(
      build([stored({ state })]).buildPostUpdate('org', 'p1', { content: 'x' })
    ).rejects.toThrow(/Cannot change a post/);
  });

  it('rejects a later thread part, a removed channel and an unknown post', async () => {
    await expect(
      build([stored({ parentPostId: 'p0' })]).buildPostUpdate('org', 'p1', {
        content: 'x',
      })
    ).rejects.toThrow(/first post/);
    await expect(
      build([
        stored({ integration: { id: 'int-1', deletedAt: new Date() } }),
      ]).buildPostUpdate('org', 'p1', { content: 'x' })
    ).rejects.toThrow(/removed/);
    await expect(
      build([]).buildPostUpdate('org', 'nope', { content: 'x' })
    ).rejects.toThrow(/not found/);
  });

  it('refuses to move a queued post into the past', async () => {
    await expect(
      build([stored({ state: 'QUEUE' })]).buildPostUpdate('org', 'p1', {
        date: '2020-01-01T00:00:00Z',
      })
    ).rejects.toThrow(/past/);
  });
});
