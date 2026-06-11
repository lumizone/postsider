import { Injectable } from '@nestjs/common';
import { EmailInterface } from '@postsider/nestjs-libraries/emails/email.interface';
import { ResendProvider } from '@postsider/nestjs-libraries/emails/resend.provider';
import { EmptyProvider } from '@postsider/nestjs-libraries/emails/empty.provider';
import { NodeMailerProvider } from '@postsider/nestjs-libraries/emails/node.mailer.provider';
import { TemporalService } from 'nestjs-temporal-core';
import { timer } from '@postsider/helpers/utils/timer';

@Injectable()
export class EmailService {
  emailService: EmailInterface;
  constructor(private _temporalService: TemporalService) {
    this.emailService = this.selectProvider(process.env.EMAIL_PROVIDER!);
    console.log('Email service provider:', this.emailService.name);
    for (const key of this.emailService.validateEnvKeys) {
      if (!process.env[key]) {
        console.error(`Missing environment variable: ${key}`);
      }
    }
  }

  hasProvider() {
    return !(this.emailService instanceof EmptyProvider);
  }

  selectProvider(provider: string) {
    switch (provider) {
      case 'resend':
        return new ResendProvider();
      case 'nodemailer':
        return new NodeMailerProvider();
      default:
        return new EmptyProvider();
    }
  }

  async sendEmail(
    to: string,
    subject: string,
    html: string,
    addTo: 'top' | 'bottom',
    replyTo?: string
  ) {
    return this._temporalService.client
      .getRawClient()
      ?.workflow.signalWithStart('sendEmailWorkflow', {
        taskQueue: 'main',
        workflowId: 'send_email',
        signal: 'sendEmail',
        args: [{ queue: [] }],
        signalArgs: [{ to, subject, html, replyTo, addTo }],
        workflowIdConflictPolicy: 'USE_EXISTING',
      });
  }

  async sendEmailSync(
    to: string,
    subject: string,
    html: string,
    replyTo?: string
  ) {
    if (to.indexOf('@') === -1) {
      return;
    }

    if (!process.env.EMAIL_FROM_ADDRESS || !process.env.EMAIL_FROM_NAME) {
      console.log(
        'Email sender information not found in environment variables'
      );
      return;
    }

    const modifiedHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f7; font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="min-height: 100vh; background-color: #f5f5f7;">
    <tr>
      <td align="center" style="padding: 48px 24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border-radius: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); overflow: hidden;">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding: 36px 40px 0 40px;">
              <img src="${process.env.FRONTEND_URL || 'https://app.postsider.com'}/brand/postsider-logo.png" alt="PostSider" width="48" height="48" style="width: 48px; height: 48px; border-radius: 12px; display: block;">
              <p style="margin: 10px 0 0 0; font-size: 24px; font-weight: 700; color: #1d1d1f; letter-spacing: 0.5px; font-family: 'Changa One', Impact, 'Arial Black', sans-serif;">PostSider</p>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 24px 40px 0 40px;">
              <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 600; color: #1d1d1f; letter-spacing: -0.3px; line-height: 1.3;">${subject}</h1>
              <div style="font-size: 15px; line-height: 1.6; color: #424245;">
                ${html}
              </div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 32px 40px 36px 40px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="border-top: 1px solid #e8e8ed; padding-top: 20px;">
                    <p style="margin: 0 0 4px 0; font-size: 13px; color: #86868b; line-height: 1.4;">
                      Sent by <span style="color: #1d1d1f; font-weight: 500;">PostSider</span>
                    </p>
                    <p style="margin: 0; font-size: 12px; color: #86868b; line-height: 1.4;">
                      <a href="${process.env.FRONTEND_URL}/settings/general" style="color: #86868b; text-decoration: underline;">Manage notifications</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <!-- Sub-footer -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 520px;">
          <tr>
            <td style="padding: 20px 40px; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #86868b;">
                © ${new Date().getFullYear()} PostSider · <a href="https://postsider.com" style="color: #86868b; text-decoration: none;">postsider.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const sends = await this.emailService.sendEmail(
          to,
          subject,
          modifiedHtml,
          process.env.EMAIL_FROM_NAME,
          process.env.EMAIL_FROM_ADDRESS,
          replyTo
        );
        console.log(sends);
        return;
      } catch (err) {
        lastErr = err;
        console.log(`Email attempt ${attempt + 1}/3 failed:`, err);
        if (attempt < 2) {
          await timer(700);
        }
      }
    }
    console.log(`Email to ${to} failed after 3 attempts:`, lastErr);
  }
}
