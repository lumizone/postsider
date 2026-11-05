import { actorViewFromColumns } from '@postsider/nestjs-libraries/actor/post-actor';
import {
  htmlToPolicyText,
  POLICY_MAX_INPUT_CHARS,
} from '@postsider/nestjs-libraries/policies/policy-text';
import { approvalDecidedByView, toStageView } from './approval.projection';

// Pure projection of the public approvals API (GET /public/v1/approvals).
// Every field is picked explicitly: no guest token material, no requester id,
// no organization id and no approver lists can leave through this module.

export const PREVIEW_MAX = 500;

export type PublicApprovalItem = {
  id: string;
  postId: string;
  status: string;
  note: string | null;
  requestedAt: Date;
  resolvedAt: Date | null;
  requestedBy: ReturnType<typeof actorViewFromColumns>;
  decidedBy: ReturnType<typeof approvalDecidedByView>;
  stage: ReturnType<typeof toStageView>['stage'] | null;
  stages: ReturnType<typeof toStageView>['stages'];
  flow: { id: string; name: string } | null;
  channel: { id: string; name: string; providerIdentifier: string } | null;
};

export function toPublicApprovalItem(
  row: Record<string, any>,
  flow: { id: string; name: string } | null
): PublicApprovalItem {
  const view = toStageView(row);
  const integration = row.post?.integration;
  return {
    id: row.id,
    postId: row.postId,
    status: row.status,
    note: row.note ?? null,
    requestedAt: row.requestedAt,
    resolvedAt: row.resolvedAt ?? null,
    requestedBy: actorViewFromColumns(row, 'requestedBy'),
    decidedBy: row.status === 'PENDING' ? null : approvalDecidedByView(row),
    stage: view.stage,
    stages: view.stages,
    flow: flow ? { id: flow.id, name: flow.name } : null,
    channel: integration
      ? {
          id: integration.id,
          name: integration.name,
          providerIdentifier: integration.providerIdentifier,
        }
      : null,
  };
}

/** Plain text of the post body, cut to PREVIEW_MAX characters. */
export function previewOf(content: unknown): string {
  if (typeof content !== 'string' || !content) return '';
  let text: string;
  try {
    text = htmlToPolicyText(content.slice(0, POLICY_MAX_INPUT_CHARS));
  } catch {
    text = content.slice(0, PREVIEW_MAX).replace(/<[^>]*>/g, ' ');
  }
  return text.trim().slice(0, PREVIEW_MAX);
}

export type ApprovalCursor = { requestedAt: Date; id: string };

export function encodeCursor(c: ApprovalCursor): string {
  return Buffer.from(`${c.requestedAt.toISOString()}|${c.id}`, 'utf8').toString('base64url');
}

/** Null for anything that is not a cursor this module produced. */
export function decodeCursor(raw: string): ApprovalCursor | null {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(raw)) return null;
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const sep = text.indexOf('|');
  if (sep <= 0) return null;
  const at = text.slice(0, sep);
  const id = text.slice(sep + 1);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at)) return null;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) return null;
  const requestedAt = new Date(at);
  if (Number.isNaN(requestedAt.getTime())) return null;
  return { requestedAt, id };
}
