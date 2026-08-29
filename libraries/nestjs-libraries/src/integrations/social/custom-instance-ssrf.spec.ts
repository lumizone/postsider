import 'reflect-metadata';
import { Integration } from '@prisma/client';
import { AuthService } from '@postsider/helpers/auth/auth.service';
import { ssrfSafeDispatcher } from '@postsider/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { GhostProvider } from './ghost.provider';
import { LemmyProvider } from './lemmy.provider';
import { ListmonkProvider } from './listmonk.provider';
import { MastodonProvider } from './mastodon.provider';
import { MastodonCustomProvider } from './mastodon.custom.provider';

const customUrl = 'https://tenant.example.test';
const integration = { customInstanceDetails: 'encrypted' } as Integration;

function response(body: unknown) {
  return {
    status: 200,
    ok: true,
    json: jest.fn().mockResolvedValue(body),
    blob: jest.fn().mockResolvedValue({} as Blob),
  } as unknown as Response;
}

describe('custom-instance provider SSRF protection', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function expectRequestsToUseDispatcher() {
    expect(fetchMock).toHaveBeenCalled();
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toContain(customUrl);
      expect(options).toEqual(
        expect.objectContaining({ dispatcher: ssrfSafeDispatcher })
      );
    }
  }

  it('protects every Listmonk request while retaining campaign methods and bodies', async () => {
    jest.spyOn(AuthService, 'decryptSecret').mockReturnValue(
      JSON.stringify({
        url: customUrl,
        username: 'user',
        password: 'password',
      })
    );
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/lists'))
        return response({ data: { results: [] } });
      if (url.endsWith('/api/templates')) return response({ data: [] });
      if (url.endsWith('/api/campaigns')) {
        return response({ data: { uuid: 'campaign-uuid', id: 7 } });
      }
      return response({});
    });
    const provider = new ListmonkProvider();

    await provider.list('', {}, '', integration);
    await provider.templates('', {}, '', integration);
    await provider.post(
      '',
      '',
      [
        {
          id: 'post-1',
          message: 'Newsletter body',
          settings: { subject: 'Newsletter', list: '2' },
        } as any,
      ],
      integration
    );

    expectRequestsToUseDispatcher();
    const campaignCall = fetchMock.mock.calls.find(([url]) =>
      url.endsWith('/api/campaigns')
    );
    expect(campaignCall?.[1]).toEqual(
      expect.objectContaining({ method: 'POST' })
    );
    expect(JSON.parse(campaignCall?.[1].body)).toEqual(
      expect.objectContaining({ subject: 'Newsletter', lists: [2] })
    );
    const statusCall = fetchMock.mock.calls.find(([url]) =>
      url.endsWith('/api/campaigns/7/status')
    );
    expect(statusCall?.[1]).toEqual(expect.objectContaining({ method: 'PUT' }));
    expect(JSON.parse(statusCall?.[1].body)).toEqual({ status: 'running' });
  });

  it('protects every Lemmy login, publish, comment, and community request', async () => {
    jest.spyOn(AuthService, 'decryptSecret').mockReturnValue(
      JSON.stringify({
        service: customUrl,
        identifier: 'user',
        password: 'password',
      })
    );
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/user/login')) return response({ jwt: 'jwt' });
      if (url.includes('/user?')) {
        return response({
          person_view: { person: { id: 1, display_name: 'User', avatar: '' } },
        });
      }
      if (url.includes('/post'))
        return response({ post_view: { post: { id: 2 } } });
      if (url.includes('/comment')) {
        return response({ comment_view: { comment: { id: 3 } } });
      }
      return response({ communities: [] });
    });
    const provider = new LemmyProvider();
    const post = [
      {
        id: 'post-1',
        message: 'Post body',
        settings: { subreddit: [{ value: { id: '1', title: 'Title' } }] },
      } as any,
    ];

    await provider.authenticate({
      code: Buffer.from(
        JSON.stringify({
          service: customUrl,
          identifier: 'user',
          password: 'password',
        })
      ).toString('base64'),
      codeVerifier: '',
    });
    await provider.post('', '', post, integration);
    await provider.comment('', '2', undefined, '', post, integration);
    await provider.subreddits('', { word: 'topic' }, '', integration);

    expectRequestsToUseDispatcher();
    const postCall = fetchMock.mock.calls.find(([url]) =>
      url.endsWith('/api/v3/post')
    );
    expect(postCall?.[1]).toEqual(expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(postCall?.[1].body)).toEqual(
      expect.objectContaining({
        community_id: 1,
        name: 'Title',
        body: 'Post body',
      })
    );
    const commentCall = fetchMock.mock.calls.find(([url]) =>
      url.endsWith('/api/v3/comment')
    );
    expect(commentCall?.[1]).toEqual(
      expect.objectContaining({ method: 'POST' })
    );
    expect(JSON.parse(commentCall?.[1].body)).toEqual({
      post_id: 2,
      content: 'Post body',
    });
  });

  it('protects Ghost authentication and publication requests', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/ghost/api/admin/site/'))
        return response({ site: { title: 'Site' } });
      return response({
        posts: [{ id: 'post-1', url: `${customUrl}/post-1` }],
      });
    });
    const provider = new GhostProvider();
    const credentials = {
      url: customUrl,
      apiKey:
        '0123456789abcdef01234567:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    };
    const accessToken = Buffer.from(JSON.stringify(credentials)).toString(
      'base64'
    );

    await provider.authenticate({ code: accessToken, codeVerifier: '' });
    await provider.post(
      '',
      accessToken,
      [
        {
          id: 'post-1',
          message: '<p>Post</p>',
          settings: { title: 'Title' },
        } as any,
      ],
      integration
    );

    expectRequestsToUseDispatcher();
    const postCall = fetchMock.mock.calls.find(([url]) =>
      url.includes('/posts/')
    );
    expect(postCall?.[1]).toEqual(expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(postCall?.[1].body).posts[0]).toEqual(
      expect.objectContaining({
        title: 'Title',
        html: '<p>Post</p>',
        status: 'published',
      })
    );
  });

  it('protects dormant Mastodon custom registration, authentication, and publishing', async () => {
    jest
      .spyOn(AuthService, 'decryptSecret')
      .mockReturnValue(JSON.stringify({ instanceUrl: customUrl }));
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/oauth/token'))
        return response({ access_token: 'token' });
      if (url.endsWith('/verify_credentials')) {
        return response({
          id: 'user-1',
          display_name: 'User',
          username: 'user',
        });
      }
      if (url.endsWith('/api/v1/apps')) {
        return response({ client_id: 'client', client_secret: 'secret' });
      }
      return response({ id: 'status-1', url: `${customUrl}/@user/status-1` });
    });
    const provider = new MastodonCustomProvider();

    await provider.externalUrl(customUrl);
    await provider.authenticate(
      { code: 'code', codeVerifier: '' },
      { client_id: 'client', client_secret: 'secret', instanceUrl: customUrl }
    );
    await provider.post(
      '',
      'token',
      [{ id: 'post-1', message: 'Post body', media: [] } as any],
      integration
    );
    await provider.comment(
      '',
      'status-1',
      undefined,
      'token',
      [{ id: 'comment-1', message: 'Comment body', media: [] } as any],
      integration
    );

    expectRequestsToUseDispatcher();
    const statusCalls = fetchMock.mock.calls.filter(([url]) =>
      url.endsWith('/api/v1/statuses')
    );
    expect(statusCalls).toHaveLength(2);
    expect(statusCalls[0][1]).toEqual(
      expect.objectContaining({ method: 'POST' })
    );
    expect(statusCalls[1][1]).toEqual(
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('protects the Mastodon custom media-source fetch used to upload post media', async () => {
    jest
      .spyOn(AuthService, 'decryptSecret')
      .mockReturnValue(JSON.stringify({ instanceUrl: customUrl }));
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/oauth/token'))
        return response({ access_token: 'token' });
      if (url.endsWith('/verify_credentials')) {
        return response({
          id: 'user-1',
          display_name: 'User',
          username: 'user',
        });
      }
      if (url.endsWith('/api/v1/media')) return response({ id: 'media-1' });
      if (url.endsWith('/api/v1/statuses')) {
        return response({
          id: 'status-1',
          url: `${customUrl}/@user/status-1`,
        });
      }
      return response({});
    });
    const provider = new MastodonCustomProvider();

    await provider.authenticate(
      { code: 'code', codeVerifier: '' },
      { client_id: 'client', client_secret: 'secret', instanceUrl: customUrl }
    );
    await provider.post(
      '',
      'token',
      [
        {
          id: 'post-1',
          message: 'Post body',
          media: [{ path: `${customUrl}/media/img.png` }],
        } as any,
      ],
      integration
    );

    expectRequestsToUseDispatcher();
    const mediaFetchCall = fetchMock.mock.calls.find(([url]) =>
      url.includes('/media/img.png')
    );
    expect(mediaFetchCall).toBeDefined();
    expect(mediaFetchCall?.[1]).toEqual(
      expect.objectContaining({ dispatcher: ssrfSafeDispatcher })
    );
  });

  it('routes the base Mastodon media-source fetch through the SSRF dispatcher', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/v1/media')) return response({ id: 'media-1' });
      if (url.endsWith('/api/v1/statuses')) {
        return response({
          id: 'status-1',
          url: 'https://mastodon.social/@user/status-1',
        });
      }
      return response({});
    });
    const provider = new MastodonProvider();

    await provider.post(
      '',
      'token',
      [
        {
          id: 'post-1',
          message: 'Post body',
          media: [{ path: 'https://example.test/img.png' }],
        } as any,
      ],
      undefined
    );

    const mediaFetchCall = fetchMock.mock.calls.find(([url]) =>
      url.includes('/img.png')
    );
    expect(mediaFetchCall).toBeDefined();
    expect(mediaFetchCall?.[1]).toEqual(
      expect.objectContaining({ dispatcher: ssrfSafeDispatcher })
    );
  });
});
