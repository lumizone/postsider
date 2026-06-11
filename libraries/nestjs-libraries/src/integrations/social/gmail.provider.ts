import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library/build/src/auth/oauth2client';
import { SocialAbstract } from '@postsider/nestjs-libraries/integrations/social.abstract';
import * as process from 'node:process';
import dayjs from 'dayjs';
import { Rules } from '@postsider/nestjs-libraries/chat/rules.description.decorator';
import { GmailDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/gmail.dto';
import { Integration } from '@prisma/client';

const clientAndGmail = () => {
  const client = new google.auth.OAuth2({
    clientId: process.env.GOOGLE_GMAIL_CLIENT_ID || process.env.YOUTUBE_CLIENT_ID,
    clientSecret:
      process.env.GOOGLE_GMAIL_CLIENT_SECRET || process.env.YOUTUBE_CLIENT_SECRET,
    redirectUri: `${process.env.FRONTEND_URL}/integrations/social/gmail`,
  });

  const oauth2 = (newClient: OAuth2Client) =>
    google.oauth2({
      version: 'v2',
      auth: newClient,
    });

  const gmail = (newClient: OAuth2Client) =>
    google.gmail({ version: 'v1', auth: newClient });

  return { client, oauth2, gmail };
};

@Rules(
  'Gmail "posts" are emails. Use the message body as the email body and provide subject + recipients via post settings.'
)
export class GmailProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 5;
  identifier = 'gmail';
  name = 'Gmail';
  isBetweenSteps = false;
  scopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/gmail.send',
  ];
  editor = 'html' as const;
  dto = GmailDto;

  maxLength() {
    return 1_000_000;
  }

  override handleErrors(body: string):
    | { type: 'refresh-token' | 'bad-body'; value: string }
    | undefined {
    if (body.includes('invalid_grant') || body.includes('UNAUTHENTICATED')) {
      return {
        type: 'refresh-token',
        value: 'Please re-authenticate your Gmail account',
      };
    }
    if (body.includes('Daily user sending quota exceeded')) {
      return {
        type: 'bad-body',
        value: 'Gmail daily sending quota exceeded',
      };
    }
    return undefined;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    const { client, oauth2 } = clientAndGmail();
    client.setCredentials({ refresh_token });
    const { credentials } = await client.refreshAccessToken();
    const user = oauth2(client);

    const expiryDate = new Date(credentials.expiry_date!);
    const expiresIn =
      Math.floor(expiryDate.getTime() / 1000) -
      Math.floor(Date.now() / 1000);

    const { data } = await user.userinfo.get();

    return {
      accessToken: credentials.access_token!,
      expiresIn,
      refreshToken: credentials.refresh_token || refresh_token,
      id: data.id!,
      name: data.name!,
      picture: data?.picture || '',
      username: data.email || '',
    };
  }

  async generateAuthUrl() {
    const state = makeId(7);
    const { client } = clientAndGmail();
    return {
      url: client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        state,
        redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/gmail`,
        scope: this.scopes.slice(0),
      }),
      codeVerifier: makeId(11),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const { client, oauth2 } = clientAndGmail();
    const { tokens } = await client.getToken(params.code);
    client.setCredentials(tokens);
    const { scopes } = await client.getTokenInfo(tokens.access_token!);
    this.checkScopes(this.scopes, scopes);

    const user = oauth2(client);
    const { data } = await user.userinfo.get();

    const expiryDate = new Date(tokens.expiry_date!);
    const expiresIn =
      Math.floor(expiryDate.getTime() / 1000) -
      Math.floor(Date.now() / 1000);

    return {
      accessToken: tokens.access_token!,
      expiresIn,
      refreshToken: tokens.refresh_token!,
      id: data.id!,
      name: data.name || data.email || '',
      picture: data?.picture || '',
      username: data.email || '',
    };
  }

  /** Build a base64url encoded RFC 5322 message ready for the Gmail API. */
  private buildRawMessage(
    fromEmail: string,
    settings: GmailDto,
    htmlBody: string
  ): string {
    const lines = [
      `From: ${fromEmail}`,
      `To: ${settings.to.join(', ')}`,
      ...(settings.cc?.length ? [`Cc: ${settings.cc.join(', ')}`] : []),
      ...(settings.bcc?.length ? [`Bcc: ${settings.bcc.join(', ')}`] : []),
      `Subject: ${settings.subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      htmlBody,
    ];

    return Buffer.from(lines.join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<GmailDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const { client, gmail, oauth2 } = clientAndGmail();
    client.setCredentials({ access_token: accessToken });

    const { data: profile } = await oauth2(client).userinfo.get();
    const fromEmail = profile.email!;

    const settings = postDetails[0].settings;
    const raw = this.buildRawMessage(
      fromEmail,
      settings,
      postDetails[0].message
    );

    const { data } = await gmail(client).users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    return [
      {
        id: postDetails[0].id,
        status: 'completed',
        postId: String(data.id || makeId(12)),
        releaseURL: `https://mail.google.com/mail/u/0/#sent/${data.id || ''}`,
      },
    ];
  }
}
