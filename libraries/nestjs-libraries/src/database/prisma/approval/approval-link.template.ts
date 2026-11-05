// Pure email template of the approver links. Every interpolated value is
// HTML-escaped, the preview is cut, and the two links must live on the
// configured FRONTEND_URL origin. No media, no <img>.

export type ApproverEmailInput = {
  channelName: string;
  stageName: string;
  stageLabel: string;
  requesterName: string;
  preview: string;
  approveUrl: string;
  rejectUrl: string;
};

export const PREVIEW_CHARS = 200;

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const HEADER_UNSAFE = new RegExp(
  '[' + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) +
    String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + ']+',
  'g'
);

function headerSafe(value: string, max: number): string {
  return value.replace(HEADER_UNSAFE, ' ').trim().slice(0, max);
}

function frontendOrigin(): string {
  const raw = process.env.FRONTEND_URL;
  if (!raw) throw new Error('FRONTEND_URL is not configured');
  return new URL(raw).origin;
}

function assertOnFrontend(url: string, origin: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Approver link is not a valid URL');
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username ||
    parsed.password ||
    parsed.origin !== origin
  ) {
    throw new Error('Approver link is not on the frontend origin');
  }
}

function cutPreview(text: string): string {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  // Array.from keeps surrogate pairs whole.
  const chars = Array.from(flat);
  return chars.length > PREVIEW_CHARS
    ? chars.slice(0, PREVIEW_CHARS).join('')
    : flat;
}

const BUTTON =
  'display:inline-block;padding:12px 22px;border-radius:10px;font-size:15px;font-weight:600;text-decoration:none;';

export function renderApproverEmail(input: ApproverEmailInput): {
  subject: string;
  html: string;
} {
  const origin = frontendOrigin();
  assertOnFrontend(input.approveUrl, origin);
  assertOnFrontend(input.rejectUrl, origin);

  const e = escapeHtml;
  const preview = cutPreview(input.preview);
  const subject = headerSafe(
    `Post awaiting your approval (${input.stageLabel})`,
    120
  );
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d1d1f;max-width:520px;">
  <h2 style="margin:0 0 12px;font-size:20px;">A post is waiting for your approval</h2>
  <p style="margin:0 0 4px;font-size:14px;color:#6e6e73;">${e(input.stageLabel)}: ${e(input.stageName)}</p>
  <p style="margin:0 0 16px;font-size:14px;color:#6e6e73;">Channel: ${e(input.channelName)} &middot; Requested by: ${e(input.requesterName)}</p>
  <blockquote style="margin:0 0 20px;padding:12px 14px;border-left:3px solid #d2d2d7;font-size:15px;white-space:pre-wrap;">${e(preview)}</blockquote>
  <p style="margin:0 0 20px;">
    <a href="${e(input.approveUrl)}" style="${BUTTON}background:#1d1d1f;color:#ffffff;">Review and approve</a>
    &nbsp;
    <a href="${e(input.rejectUrl)}" style="${BUTTON}background:#ffffff;color:#1d1d1f;border:1px solid #1d1d1f;">Review and reject</a>
  </p>
  <p style="margin:0;font-size:12px;color:#6e6e73;">This link is personal to you and works once. Nothing is decided until you confirm on the review page. If you did not expect this email, ignore it.</p>
</div>`;
  return { subject, html };
}
