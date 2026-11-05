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

export const approvePost = (id: string) => api.put(`/approval/${id}/approve`);

export const rejectPost = (id: string, note?: string) =>
  api.put(`/approval/${id}/reject`, { note });

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
