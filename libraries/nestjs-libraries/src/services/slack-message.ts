const MAX_VALUE_LENGTH = 200;
const MAX_BUTTON_URL_LENGTH = 2000;

export function isSlackWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'hooks.slack.com' &&
      // the default https port only (an explicit :443 parses to '')
      parsed.port === '' &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname.startsWith('/services/')
    );
  } catch {
    return false;
  }
}

function escapeSlack(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Cut first, then escape; control characters become spaces so a value stays
// on one line.
function safe(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const flat = String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, MAX_VALUE_LENGTH);
  return escapeSlack(flat);
}

function obj(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_BUTTON_URL_LENGTH) {
    return null;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function stageText(stage: unknown): string {
  const s = obj(stage);
  const position = Number(s.position);
  const total = Number(s.total);
  if (!Number.isInteger(position) || !Number.isInteger(total) || total < 1) {
    return '';
  }
  const name = safe(s.name);
  return ` (stage ${position} of ${total}${name ? `: ${name}` : ''})`;
}

/**
 * Slack incoming webhook body for a PostSider event. Reads only the stage,
 * status, note, error category and an https release URL; never post text,
 * ids or actor fields.
 */
export function buildSlackBody(
  envelope: { event: string; data: any },
  frontendUrl: string
): { text: string; blocks: unknown[] } {
  const data = obj(envelope?.data);
  const base = (frontendUrl || '').trim().replace(/\/+$/, '');
  let text: string;
  let button: { label: string; url: string | null } | null = null;

  switch (envelope?.event) {
    case 'approval.requested':
      text = `A post is waiting for approval${stageText(obj(data.approval).stage)}.`;
      button = { label: 'Review in PostSider', url: base ? `${base}/approval` : null };
      break;
    case 'approval.resolved': {
      const rejected = data.status === 'REJECTED';
      const note = safe(data.note);
      text = `A post was ${rejected ? 'rejected' : 'approved'}.${note ? ` Note: ${note}` : ''}`;
      button = { label: 'Open in PostSider', url: base ? `${base}/agents` : null };
      break;
    }
    case 'post.failed': {
      const category = safe(data.errorCategory);
      text = `A post failed to publish${category ? ` (${category})` : ''}.`;
      button = { label: 'Open in PostSider', url: base ? `${base}/agents` : null };
      break;
    }
    case 'post.published':
      text = 'A post was published.';
      button = {
        label: 'View post',
        url: httpsUrl(obj(data.post).releaseURL),
      };
      break;
    default:
      text = `PostSider event: ${safe(envelope?.event) || 'unknown'}.`;
  }

  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text } },
  ];
  if (button?.url) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: button.label },
          url: button.url,
        },
      ],
    });
  }
  return { text, blocks };
}
