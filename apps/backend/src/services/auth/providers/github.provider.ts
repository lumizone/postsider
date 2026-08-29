import {
  AuthProvider,
  AuthProviderAbstract,
} from '@postsider/backend/services/auth/providers.interface';

@AuthProvider({ provider: 'GITHUB' })
export class GithubProvider extends AuthProviderAbstract {
  generateLink(): string {
    return `https://github.com/login/oauth/authorize?client_id=${
      process.env.GITHUB_CLIENT_ID
    }&scope=user:email&redirect_uri=${encodeURIComponent(
      `${process.env.FRONTEND_URL}/settings`
    )}`;
  }

  async getToken(code: string, _redirectUri?: string): Promise<string> {
    const { access_token } = await (
      await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: `${process.env.FRONTEND_URL}/settings`,
        }),
      })
    ).json();

    return access_token;
  }

  async getUser(access_token: string): Promise<{ email: string; id: string }> {
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${access_token}`,
      },
    });
    const data = await userResponse.json();
    if (!userResponse.ok || data?.id == null) {
      throw new Error('Invalid GitHub token');
    }

    const emailsResponse = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `token ${access_token}`,
      },
    });
    const emails = await emailsResponse.json();
    if (!emailsResponse.ok || !Array.isArray(emails)) {
      throw new Error('Could not load GitHub emails');
    }

    // The first entry is not guaranteed to be primary/verified — prefer one that
    // is, so we never bind an unverified secondary address to the account.
    const primaryEmail =
      emails.find((e: any) => e.primary && e.verified)?.email ||
      emails.find((e: any) => e.verified)?.email ||
      emails[0]?.email;

    return {
      email: primaryEmail,
      id: String(data.id),
    };
  }
}
