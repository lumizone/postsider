import { buildCreatePostBody, type CreatePostArgs } from '../post-body.js';

describe('buildCreatePostBody', () => {
  const base: CreatePostArgs = {
    type: 'schedule',
    date: '2026-07-01T10:00:00Z',
    shortLink: false,
    posts: [{ channelId: 'chan-1', content: 'hello world' }],
  };

  it('passes through top-level fields (type, date, shortLink)', () => {
    const body = buildCreatePostBody({ ...base, type: 'now', shortLink: true });
    expect(body.type).toBe('now');
    expect(body.date).toBe('2026-07-01T10:00:00Z');
    expect(body.shortLink).toBe(true);
  });

  it('defaults tags to [] when omitted', () => {
    const body = buildCreatePostBody(base);
    expect(body.tags).toEqual([]);
  });

  it('passes tags through when provided', () => {
    const tags = [{ value: 'launch', label: 'Launch' }];
    const body = buildCreatePostBody({ ...base, tags });
    expect(body.tags).toEqual(tags);
  });

  it('wires channelId into integration.id', () => {
    const body = buildCreatePostBody(base);
    expect(body.posts[0].integration).toEqual({ id: 'chan-1' });
  });

  it('wraps content into value[0].content', () => {
    const body = buildCreatePostBody(base);
    expect(body.posts[0].value).toEqual([
      { content: 'hello world', image: [] },
    ]);
  });

  it('defaults image to [] and settings to {} when omitted', () => {
    const body = buildCreatePostBody(base);
    expect(body.posts[0].value[0].image).toEqual([]);
    expect(body.posts[0].settings).toEqual({});
  });

  it('passes images through into value[0].image', () => {
    const images = [{ path: 'https://cdn/x.png', id: 'm1' }];
    const body = buildCreatePostBody({
      ...base,
      posts: [{ channelId: 'chan-1', content: 'c', images }],
    });
    expect(body.posts[0].value[0].image).toEqual(images);
  });

  it('passes settings through when provided', () => {
    const settings = { __type: 'instagram', collaborators: ['x'] };
    const body = buildCreatePostBody({
      ...base,
      posts: [{ channelId: 'chan-1', content: 'c', settings }],
    });
    expect(body.posts[0].settings).toEqual(settings);
  });

  it('omits firstComment when not provided', () => {
    const body = buildCreatePostBody(base);
    expect('firstComment' in body.posts[0]).toBe(false);
  });

  it('includes firstComment only when provided', () => {
    const body = buildCreatePostBody({
      ...base,
      posts: [{ channelId: 'chan-1', content: 'c', firstComment: 'first!' }],
    });
    expect(body.posts[0].firstComment).toBe('first!');
  });

  it('treats an empty-string firstComment as absent (falsy)', () => {
    const body = buildCreatePostBody({
      ...base,
      posts: [{ channelId: 'chan-1', content: 'c', firstComment: '' }],
    });
    expect('firstComment' in body.posts[0]).toBe(false);
  });

  it('maps multiple posts to multiple entries, preserving order and ids', () => {
    const body = buildCreatePostBody({
      ...base,
      posts: [
        { channelId: 'a', content: 'first' },
        {
          channelId: 'b',
          content: 'second',
          firstComment: 'fc',
          images: [{ path: 'p' }],
        },
      ],
    });
    expect(body.posts).toHaveLength(2);
    expect(body.posts[0].integration.id).toBe('a');
    expect(body.posts[0].value[0].content).toBe('first');
    expect(body.posts[1].integration.id).toBe('b');
    expect(body.posts[1].value[0].content).toBe('second');
    expect(body.posts[1].firstComment).toBe('fc');
    expect(body.posts[1].value[0].image).toEqual([{ path: 'p' }]);
  });
});
