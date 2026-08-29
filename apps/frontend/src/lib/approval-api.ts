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
}

export const requestApproval = (postId: string) =>
  api.post("/approval/request", { postId });

export const getPendingApprovals = () =>
  api.get<PendingApproval[]>("/approval/pending");

export const approvePost = (id: string) => api.put(`/approval/${id}/approve`);

export const rejectPost = (id: string, note?: string) =>
  api.put(`/approval/${id}/reject`, { note });

export const getApprovalByPost = (postId: string) =>
  api.get<{ status: string; note?: string | null; requestedAt?: string }>(
    `/approval/post/${postId}`,
  );

export const createGuestLink = (id: string) =>
  api.post<{ token: string; expiresAt: string }>(`/approval/${id}/guest-link`);

export const revokeGuestLink = (id: string) =>
  api.del(`/approval/${id}/guest-link`);
