jest.mock('isomorphic-dompurify', () => ({
  sanitize: (value: string) => value,
}));

// Billing gating is unrelated to the TikTok gate under test.
jest.mock('@postsider/nestjs-libraries/services/billing.flag', () => ({
  isBillingEnabled: () => false,
}));

import { PostActivity } from './post.activity';

/**
 * The publish activity is the last place every publish route converges — the
 * composer, the public API, approvals, duplicates, evergreen and queue rows
 * armed by older workflow versions all call `postSocial`. The TikTok Direct
 * Post gate therefore lives here, and these tests pin that it runs before the
 * provider is asked to post.
 */
describe('PostActivity TikTok publish gate', () => {
  const post = {
    id: 'post-1',
    content: 'caption',
    settings: JSON.stringify({
      privacy_level: 'SELF_ONLY',
      content_posting_method: 'DIRECT_POST',
    }),
    image: '[]',
  };

  const integration = {
    id: 'int-1',
    internalId: 'internal-1',
    organizationId: 'org-1',
    providerIdentifier: 'tiktok',
    token: 'token',
  };

  const build = () => {
    const provider = { post: jest.fn().mockResolvedValue([]) };
    const postService = {
      updateTags: jest.fn().mockResolvedValue([post]),
      updateMedia: jest.fn().mockResolvedValue([]),
      validatePostAtPublish: jest.fn().mockResolvedValue(undefined),
    };
    const activity = new PostActivity(
      postService as any,
      {} as any,
      { getSocialIntegration: jest.fn().mockReturnValue(provider) } as any,
      {} as any,
      {} as any,
      {} as any,
      {
        client: {
          getRawClient: jest.fn().mockReturnValue({
            workflow: { start: jest.fn().mockResolvedValue(undefined) },
          }),
        },
      } as any,
      {} as any,
      {
        withCredentials: jest.fn(
          (_org: string, _provider: string, fn: () => Promise<unknown>) => fn()
        ),
      } as any
    );
    return { activity, provider, postService };
  };

  it('validates the post before asking TikTok to publish it', async () => {
    const { activity, provider, postService } = build();

    await activity.postSocial(integration as any, [post] as any);

    expect(postService.validatePostAtPublish).toHaveBeenCalledWith(
      'org-1',
      'post-1'
    );
    expect(provider.post).toHaveBeenCalled();
    // The gate must run first: validation happens before the provider call.
    expect(
      postService.validatePostAtPublish.mock.invocationCallOrder[0]
    ).toBeLessThan(provider.post.mock.invocationCallOrder[0]);
  });

  it('does not publish when the gate rejects the post', async () => {
    const { activity, provider, postService } = build();
    postService.validatePostAtPublish.mockRejectedValue(
      new Error('Choose who can see this post on TikTok')
    );

    await expect(
      activity.postSocial(integration as any, [post] as any)
    ).rejects.toThrow('Choose who can see this post on TikTok');

    expect(provider.post).not.toHaveBeenCalled();
  });

  it('skips the TikTok gate for other providers', async () => {
    const { activity, provider, postService } = build();

    await activity.postSocial(
      { ...integration, providerIdentifier: 'x-post' } as any,
      [post] as any
    );

    expect(postService.validatePostAtPublish).not.toHaveBeenCalled();
    expect(provider.post).toHaveBeenCalled();
  });
});
