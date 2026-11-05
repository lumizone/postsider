"use client";

import { api } from "@/lib/api";

export interface PendingApproval {
  id: string;
  postId: string;
  note: string | null;
  status: string;
  requestedAt: string;
  post?: {
    id: string;
    content: string;
    group: string;
    state?: string;
    image?: string;             // JSON-stringified media array
    settings?: string;          // JSON-stringified provider settings
    publishDate?: string;
    integration?: {
      id?: string;
      name: string;
      providerIdentifier: string;
      picture?: string | null;
    };
  };
  requestedBy?: { name: string | null; email: string };
  // Never contains token material. Admins only: whether an unexpired guest
  // link exists and when it expires (members always get false / absent).
  hasGuestLink?: boolean;
  guestLinkExpiresAt?: string | null;
  // Where the approval is now (always present from the server; the implicit
  // single stage is "Approval", 1 of 1) and the progress of every stage.
  stage?: ApprovalStageSummary | null;
  stages?: ApprovalStageRow[];
}

export interface ApprovalStageSummary {
  position: number;
  total: number;
  name: string;
}

export interface ApprovalStageRow {
  position: number;
  name: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "NOT_REACHED";
  /** Who decided it; a USER entry carries userId, never an email or token. */
  decidedBy?: { type?: string; userId?: string } | null;
  decidedAt?: string | null;
}

export const requestApproval = (postId: string) =>
  api.post("/approval/request", { postId });

export const getPendingApprovals = () =>
  api.get<PendingApproval[]>("/approval/pending");

// `expectStage` is the stage position the admin was looking at; the server
// answers 409 stage_changed instead of deciding a later stage by accident.
export const approvePost = (id: string, expectStage?: number) =>
  api.put(`/approval/${id}/approve`, expectStage === undefined ? undefined : { expectStage });

export const rejectPost = (id: string, note?: string, expectStage?: number) =>
  api.put(`/approval/${id}/reject`, {
    note,
    ...(expectStage === undefined ? {} : { expectStage }),
  });

export const getApprovalByPost = (postId: string) =>
  api.get<{
    status: string;
    note?: string | null;
    requestedAt?: string;
    hasGuestLink?: boolean;
    guestLinkExpiresAt?: string | null;
    stage?: ApprovalStageSummary | null;
    stages?: ApprovalStageRow[];
  }>(
    `/approval/post/${postId}`,
  );

// Admin only. The plaintext token is in this response and nowhere else: the
// dashboard lists only hasGuestLink / guestLinkExpiresAt.
export const createGuestLink = (id: string) =>
  api.post<{ token: string; expiresAt: string }>(`/approval/${id}/guest-link`);

export const revokeGuestLink = (id: string) =>
  api.del(`/approval/${id}/guest-link`);
