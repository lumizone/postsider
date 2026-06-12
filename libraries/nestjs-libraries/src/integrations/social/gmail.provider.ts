import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { SocialAbstract } from '@postsider/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import nodemailer from 'nodemailer';
import { Rules } from '@postsider/nestjs-libraries/chat/rules.description.decorator';
import { GmailDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/gmail.dto';
import { Integration } from '@prisma/client';

interface GmailCredentials {
  email: string;
  password: string;
}

/**
 * Gmail integration via SMTP with an App Password.
 *
 * Instead of OAuth, the user connects by entering their Gmail address and a
 * 16-character App Password (Google Account → Security → 2-Step Verification →
 * App passwords). Emails are sent through Gmail's SMTP server with nodemailer.
 *
 * The credentials are stored (encrypted at rest) as a base64 JSON blob in the
 * integration token, the same convention other credential-based providers use.
 */
@Rules(
  'Gmail "posts" are emails sent over SMTP. Use the message body as the email body and provide subject + recipients via post settings.'
)
export class GmailProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 5;
  identifier = 'gmail';
  name = 'Gmail';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'html' as const;
  dto = GmailDto;

  maxLength() {
    return 1_000_000;
  }

  /** Gmail App Passwords are 16 letters, usually shown as 4 groups of 4. */
  private parseCredentials(blob: string): GmailCredentials {
    const { email, password } = JSON.parse(
      Buffer.from(blob, 'base64').toString()
    ) as GmailCredentials;
    return { email, password: (password || '').replace(/\s+/g, '') };
  }

  private buildTransport(creds: GmailCredentials) {
    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: creds.email, pass: creds.password },
    });
  }

  override handleErrors(body: string):
    | { type: 'refresh-token' | 'bad-body'; value: string }
    | undefined {
    if (
      body.includes('Invalid login') ||
      body.includes('Username and Password not accepted') ||
      body.includes('535')
    ) {
      return {
        type: 'refresh-token',
        value:
          'Gmail rejected the App Password — re-connect the channel with a fresh App Password.',
      };
    }
    if (body.includes('Daily user sending limit exceeded')) {
      return {
        type: 'bad-body',
        value: 'Gmail daily sending quota exceeded',
      };
    }
    return undefined;
  }

  // Credential-based providers do not refresh — the App Password is long-lived.
  async refreshToken(_refreshToken: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  // No OAuth — the connection is driven by the customFields credential form.
  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
  }

  async customFields() {
    return [
      {
        key: 'email',
        label: 'Gmail address',
        validation: `/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/`,
        type: 'text' as const,
      },
      {
        key: 'password',
        label: 'App Password (16 characters)',
        validation: `/^[a-z]{4}\\s?[a-z]{4}\\s?[a-z]{4}\\s?[a-z]{4}$/i`,
        type: 'password' as const,
      },
    ];
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    let creds: GmailCredentials;
    try {
      creds = this.parseCredentials(params.code);
    } catch {
      return 'Invalid credentials';
    }

    if (!creds.email || !creds.password) {
      return 'Missing Gmail address or App Password';
    }

    try {
      // Verifying opens an authenticated SMTP session — fails fast on a wrong
      // address or App Password before we ever store the credentials.
      await this.buildTransport(creds).verify();
    } catch (err) {
      console.log('Gmail SMTP authenticate error', err);
      return 'Gmail rejected the address or App Password. Make sure 2-Step Verification is on and the App Password is correct.';
    }

    return {
      refreshToken: '',
      expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
      accessToken: params.code,
      id: Buffer.from(creds.email).toString('base64'),
      name: creds.email,
      picture: '',
      username: creds.email,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<GmailDto>[],
    _integration: Integration
  ): Promise<PostResponse[]> {
    const creds = this.parseCredentials(accessToken);
    const settings = postDetails[0].settings;

    // m.path is a public storage URL; nodemailer fetches http(s) `path` itself.
    // Strip any query string / fragment so the attachment name isn't e.g.
    // "photo.jpg?token=abc" in the recipient's inbox.
    const attachments = (postDetails[0].media || []).map((m) => ({
      filename: m.path.split('/').pop()?.split(/[?#]/)[0] || 'attachment',
      path: m.path,
    }));

    const info = await this.buildTransport(creds).sendMail({
      from: creds.email,
      to: settings.to.join(', '),
      ...(settings.cc?.length ? { cc: settings.cc.join(', ') } : {}),
      ...(settings.bcc?.length ? { bcc: settings.bcc.join(', ') } : {}),
      subject: settings.subject,
      html: postDetails[0].message,
      ...(attachments.length ? { attachments } : {}),
    });

    return [
      {
        id: postDetails[0].id,
        status: 'completed',
        postId: String(info.messageId || makeId(12)),
        releaseURL: 'https://mail.google.com/mail/u/0/#sent',
      },
    ];
  }
}
