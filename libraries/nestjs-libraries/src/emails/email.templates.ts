/**
 * PostSider Email Templates
 * 
 * Apple-style clean design. All emails use the same base wrapper.
 * Logo loads from FRONTEND_URL/brand/postsider-logo.png on production.
 */

const FRONTEND_URL = () => process.env.FRONTEND_URL || 'http://localhost:4200';
const LOGO_URL = () => `${FRONTEND_URL()}/brand/postsider-logo.png`;

function baseWrapper(content: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background-color:#ffffff;border-radius:16px;box-shadow:0 2px 8px rgba(0,0,0,0.04);overflow:hidden;">
  <tr>
    <td align="center" style="padding:36px 40px 0 40px;">
      <img src="${LOGO_URL()}" alt="PostSider" width="48" height="48" style="width:48px;height:48px;border-radius:12px;display:block;">
      <p style="margin:10px 0 0 0;font-size:24px;font-weight:700;color:#1d1d1f;letter-spacing:0.5px;font-family:'Changa One',Impact,'Arial Black',sans-serif;">PostSider</p>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 40px 0 40px;">
      ${content}
    </td>
  </tr>
  <tr>
    <td style="padding:32px 40px 36px 40px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td style="border-top:1px solid #e8e8ed;padding-top:20px;">
            <p style="margin:0 0 4px 0;font-size:13px;color:#86868b;line-height:1.4;">Sent by <span style="color:#1d1d1f;font-weight:500;">PostSider</span></p>
            <p style="margin:0;font-size:12px;color:#86868b;line-height:1.4;"><a href="${FRONTEND_URL()}/settings/general" style="color:#86868b;text-decoration:underline;">Manage notifications</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;">
  <tr>
    <td style="padding:20px 40px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#86868b;">© ${new Date().getFullYear()} PostSider · <a href="https://postsider.com" style="color:#86868b;text-decoration:none;">postsider.com</a></p>
    </td>
  </tr>
</table>`;
}

function button(text: string, href: string): string {
  return `<a href="${href}" style="display:inline-block;margin:20px 0 4px 0;padding:12px 28px;background-color:#1d1d1f;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:-0.2px;">${text}</a>`;
}

// ─── Templates ────────────────────────────────────────────────────────────────

export function activateAccountEmail(activationUrl: string): string {
  return baseWrapper(`
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1d1d1f;letter-spacing:-0.3px;line-height:1.3;">Activate your account</h1>
    <div style="font-size:15px;line-height:1.6;color:#424245;">
      <p style="margin:0 0 8px 0;">Welcome to PostSider! Click the button below to activate your account and start scheduling posts.</p>
      ${button('Activate account', activationUrl)}
      <p style="margin:16px 0 0 0;font-size:13px;color:#86868b;">If you didn't create this account, you can safely ignore this email.</p>
    </div>
  `);
}

export function resetPasswordEmail(resetUrl: string): string {
  return baseWrapper(`
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1d1d1f;letter-spacing:-0.3px;line-height:1.3;">Reset your password</h1>
    <div style="font-size:15px;line-height:1.6;color:#424245;">
      <p style="margin:0 0 8px 0;">We received a request to reset your password. Click below to choose a new one.</p>
      ${button('Reset password', resetUrl)}
      <p style="margin:16px 0 0 0;font-size:13px;color:#86868b;">This link expires in 20 minutes. If you didn't request this, no action is needed.</p>
    </div>
  `);
}

export function teamInviteEmail(email: string, password: string): string {
  return baseWrapper(`
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1d1d1f;letter-spacing:-0.3px;line-height:1.3;">You've been invited</h1>
    <div style="font-size:15px;line-height:1.6;color:#424245;">
      <p style="margin:0 0 16px 0;">Someone invited you to join their team on PostSider. Here are your credentials:</p>
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 16px 0;">
        <tr><td style="padding:4px 0;font-size:14px;color:#86868b;width:100px;">Email</td><td style="padding:4px 0;font-size:14px;font-weight:600;color:#1d1d1f;">${email}</td></tr>
        <tr><td style="padding:4px 0;font-size:14px;color:#86868b;width:100px;">Password</td><td style="padding:4px 0;font-size:14px;font-weight:600;color:#1d1d1f;font-family:monospace;">${password}</td></tr>
      </table>
      <p style="margin:0 0 4px 0;font-size:13px;color:#86868b;">You'll be asked to set your own password after signing in.</p>
      ${button('Sign in to PostSider', FRONTEND_URL())}
    </div>
  `);
}

export function welcomeEmail(name?: string): string {
  return baseWrapper(`
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1d1d1f;letter-spacing:-0.3px;line-height:1.3;">Welcome to PostSider${name ? `, ${name}` : ''}!</h1>
    <div style="font-size:15px;line-height:1.6;color:#424245;">
      <p style="margin:0 0 12px 0;">Your account is active. Here's what you can do next:</p>
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 16px 0;">
        <tr><td style="padding:6px 0;font-size:14px;color:#424245;">📅 &nbsp;Connect your social channels</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;color:#424245;">✍️ &nbsp;Schedule your first post</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;color:#424245;">🤖 &nbsp;Set up AI agent access via MCP</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;color:#424245;">👥 &nbsp;Invite your team members</td></tr>
      </table>
      ${button('Go to dashboard', FRONTEND_URL() + '/calendar')}
    </div>
  `);
}

export function postPublishedEmail(platform: string, postContent?: string, publishedAt?: string): string {
  return baseWrapper(`
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1d1d1f;letter-spacing:-0.3px;line-height:1.3;">Your post was published</h1>
    <div style="font-size:15px;line-height:1.6;color:#424245;">
      <p style="margin:0 0 12px 0;">Your scheduled post was successfully published on <strong>${platform}</strong>.</p>
      ${postContent ? `<div style="margin:12px 0;padding:12px 16px;background:#f5f5f7;border-radius:8px;font-size:14px;color:#424245;line-height:1.5;">${postContent.slice(0, 200)}${postContent.length > 200 ? '…' : ''}</div>` : ''}
      <p style="margin:0;color:#86868b;font-size:13px;">${publishedAt || new Date().toLocaleString()}</p>
    </div>
  `);
}

export function postFailedEmail(platform: string, error: string, postContent?: string): string {
  return baseWrapper(`
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1d1d1f;letter-spacing:-0.3px;line-height:1.3;">Post failed to publish</h1>
    <div style="font-size:15px;line-height:1.6;color:#424245;">
      <p style="margin:0 0 12px 0;">Your post couldn't be published on <strong>${platform}</strong>.</p>
      <div style="margin:12px 0;padding:12px 16px;background:#fef2f2;border-radius:8px;border-left:3px solid #dc2626;font-size:13px;color:#7f1d1d;line-height:1.5;">
        ${error}
      </div>
      <p style="margin:12px 0 0 0;font-size:13px;color:#86868b;">Check your channel connection in Settings or try scheduling again.</p>
      ${button('View posts', FRONTEND_URL() + '/posts')}
    </div>
  `);
}

export function accountDeletedEmail(): string {
  return baseWrapper(`
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1d1d1f;letter-spacing:-0.3px;line-height:1.3;">Account deleted</h1>
    <div style="font-size:15px;line-height:1.6;color:#424245;">
      <p style="margin:0 0 12px 0;">Your PostSider account has been permanently deleted. All your data, channels, and scheduled posts have been removed.</p>
      <p style="margin:0 0 12px 0;">If this was a mistake or you change your mind, you can always create a new account at <a href="https://postsider.com" style="color:#1d1d1f;font-weight:500;">postsider.com</a>.</p>
      <p style="margin:0;font-size:13px;color:#86868b;">Thank you for using PostSider.</p>
    </div>
  `);
}

export function streakReminderEmail(streakDays: number): string {
  return baseWrapper(`
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1d1d1f;letter-spacing:-0.3px;line-height:1.3;">Keep your streak alive! 🔥</h1>
    <div style="font-size:15px;line-height:1.6;color:#424245;">
      <p style="margin:0 0 12px 0;">You've been posting consistently for <strong>${streakDays} days</strong>. Don't break the chain!</p>
      <p style="margin:0 0 4px 0;font-size:13px;color:#86868b;">Schedule a post today to keep your streak going.</p>
      ${button('Schedule a post', FRONTEND_URL() + '/calendar')}
    </div>
  `);
}



export interface WeeklyDigestData {
  name?: string;
  postsPublished: number;
  postsFailed: number;
  topPlatform?: string;
  channelsConnected: number;
  streakDays?: number;
  periodStart: string;
  periodEnd: string;
}

export function weeklyDigestEmail(data: WeeklyDigestData): string {
  const totalPosts = data.postsPublished + data.postsFailed;
  const successRate = totalPosts > 0 ? Math.round((data.postsPublished / totalPosts) * 100) : 0;

  return baseWrapper(`
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:600;color:#1d1d1f;letter-spacing:-0.3px;line-height:1.3;">Your weekly recap${data.name ? `, ${data.name}` : ''}</h1>
    <div style="font-size:15px;line-height:1.6;color:#424245;">
      <p style="margin:0 0 20px 0;font-size:13px;color:#86868b;">${data.periodStart} — ${data.periodEnd}</p>

      <!-- Stats grid -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 24px 0;">
        <tr>
          <td style="padding:16px;background:#f5f5f7;border-radius:10px;text-align:center;width:50%;">
            <p style="margin:0;font-size:28px;font-weight:700;color:#1d1d1f;">${data.postsPublished}</p>
            <p style="margin:4px 0 0 0;font-size:12px;color:#86868b;text-transform:uppercase;letter-spacing:0.5px;">Published</p>
          </td>
          <td style="width:12px;"></td>
          <td style="padding:16px;background:#f5f5f7;border-radius:10px;text-align:center;width:50%;">
            <p style="margin:0;font-size:28px;font-weight:700;color:${data.postsFailed > 0 ? '#dc2626' : '#1d1d1f'};">${data.postsFailed}</p>
            <p style="margin:4px 0 0 0;font-size:12px;color:#86868b;text-transform:uppercase;letter-spacing:0.5px;">Failed</p>
          </td>
        </tr>
      </table>

      <!-- Details -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px 0;">
        ${data.topPlatform ? `<tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#86868b;">Top platform</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:14px;font-weight:600;color:#1d1d1f;text-align:right;">${data.topPlatform}</td></tr>` : ''}
        <tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#86868b;">Success rate</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:14px;font-weight:600;color:#1d1d1f;text-align:right;">${successRate}%</td></tr>
        <tr><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#86868b;">Channels active</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:14px;font-weight:600;color:#1d1d1f;text-align:right;">${data.channelsConnected}</td></tr>
        ${data.streakDays ? `<tr><td style="padding:10px 0;font-size:14px;color:#86868b;">Posting streak</td><td style="padding:10px 0;font-size:14px;font-weight:600;color:#1d1d1f;text-align:right;">${data.streakDays} days 🔥</td></tr>` : ''}
      </table>

      ${data.postsPublished === 0 ? `<p style="margin:0 0 4px 0;font-size:14px;color:#424245;">No posts this week — schedule some to keep your audience engaged.</p>` : ''}
      ${button('View analytics', FRONTEND_URL() + '/analytics')}
    </div>
  `);
}
