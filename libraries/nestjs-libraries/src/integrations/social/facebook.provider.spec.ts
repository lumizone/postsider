import { FacebookProvider } from './facebook.provider';

describe('FacebookProvider — video upload scope', () => {
  const provider = new FacebookProvider();

  beforeAll(() => {
    process.env.FACEBOOK_APP_ID = 'test-app-id';
    process.env.FRONTEND_URL = 'https://app.example.com';
  });

  it('does not REQUIRE pages_video_upload (that would block every Standard Access user from connecting)', () => {
    expect(provider.scopes).not.toContain('pages_video_upload');
  });

  it('asks Facebook for pages_video_upload in the authorization URL', async () => {
    const { url } = await provider.generateAuthUrl();
    expect(url).toContain('pages_video_upload');
  });

  it('still asks for every required scope', async () => {
    const { url } = await provider.generateAuthUrl();
    for (const scope of provider.scopes) {
      expect(url).toContain(scope);
    }
  });
});
