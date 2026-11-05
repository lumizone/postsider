import { api } from "./api";

export interface ApproverLinkView {
  post: {
    text: string;
    media: { path: string; type: "image" | "video" }[];
    publishDate: string | null;
  };
  channel: { name: string; providerIdentifier: string };
  requester: { name: string };
  stage: { position: number; total: number; name: string };
  approver: { name: string };
  selfApprovalBlocked: boolean;
  expiresAt: string;
  challenge: string;
}

export interface ApproverDecisionResult {
  status: string;
  final: boolean;
  stage?: unknown;
}

// The token only travels in the request path. `no-referrer` keeps it out of
// any Referer header, `no-store` out of caches.
const opts = { silent: true, anonymous: true, referrerPolicy: "no-referrer", cache: "no-store", credentials: "omit" } as const;

const base = (token: string) => `/public/approver-links/${encodeURIComponent(token)}`;

export const getApproverLink = (token: string) =>
  api.get<ApproverLinkView>(base(token), undefined, opts);

export const decideApproverLink = (
  token: string,
  body: { decision: "approve" | "reject"; note?: string; challenge: string },
) => api.post<ApproverDecisionResult>(`${base(token)}/decision`, body, opts);
