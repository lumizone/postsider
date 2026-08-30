import { FacebookProvider } from './facebook.provider';

describe('FacebookProvider — authorization scopes', () => {
  const provider = new FacebookProvider();

  beforeAll(() => {
    process.env.FACEBOOK_APP_ID = 'test-app-id';
    process.env.FRONTEND_URL = 'https://app.example.com';
  });

  it('does NOT request the non-existent pages_video_upload scope (Meta rejects the whole OAuth URL with "Invalid Scope")', () => {
    expect(provider.scopes).not.toContain('pages_video_upload');
    return provider.generateAuthUrl().then(({ url }) => {
      expect(url).not.toContain('pages_video_upload');
    });
  });

  it('asks for every required scope', async () => {
    const { url } = await provider.generateAuthUrl();
    for (const scope of provider.scopes) {
      expect(url).toContain(scope);
    }
  });

  it('uses only currently valid page-insight metrics', () => {
    expect((FacebookProvider as any).PAGE_INSIGHT_METRICS).toEqual([
      'page_post_engagements',
      'page_daily_follows',
      'page_video_views',
      'page_views_total',
      'page_total_actions',
    ]);
  });
});
