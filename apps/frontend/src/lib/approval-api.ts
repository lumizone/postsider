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
    integration?: { name: string; providerIdentifier: string };
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
