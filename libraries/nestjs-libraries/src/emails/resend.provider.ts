import { Resend } from 'resend';
import { EmailInterface } from '@postsider/nestjs-libraries/emails/email.interface';

const resend = new Resend(process.env.RESEND_API_KEY || 're_132');

export class ResendProvider implements EmailInterface {
  name = 'resend';
  validateEnvKeys = ['RESEND_API_KEY'];
  async sendEmail(
    to: string,
    subject: string,
    html: string,
    emailFromName: string,
    emailFromAddress: string,
    replyTo?: string
  ) {
    const sends = await resend.emails.send({
      from: `${emailFromName} <${emailFromAddress}>`,
      to,
      subject,
      html,
      ...(replyTo && { reply_to: replyTo }),
    });

    // The Resend SDK does NOT throw on API errors — it resolves with
    // `{ data: null, error: {...} }` (unverified sending domain, bad key, rate
    // limit, invalid recipient). Returning that as-is made every such failure
    // look like a successful send to EmailService, which then skipped its
    // retries and returned without throwing, so the "email vanished without a
    // trace" problem the retry loop was built to solve came straight back —
    // silently dropping password resets, invites and publish-failure notices.
    // Swallowing thrown errors into `{ sent: false }` did the same. Throw on
    // both, so EmailService's retry/alert path actually runs (nodemailer, the
    // other provider, already propagates).
    if (sends?.error) {
      const { message, name, statusCode } = sends.error as {
        message?: string;
        name?: string;
        statusCode?: number;
      };
      throw new Error(
        `Resend rejected the email (${name ?? 'error'}${
          statusCode ? ` ${statusCode}` : ''
        }): ${message ?? 'unknown error'}`
      );
    }

    return sends;
  }
}
