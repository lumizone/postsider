"use client";

import { api } from "@/lib/api";

// Types mirror the dashboard /approval-flows JSON
// (apps/backend/src/api/routes/approval-flows.controller.ts). Admin only: the
// server answers 403 for everyone else.

export type FlowMinRole = "ADMIN" | "SUPERADMIN";

export interface ApprovalFlowStage {
  position: number;
  name: string;
  minRole: FlowMinRole;
  approverUserIds: string[];
  allowAutomation: boolean;
  allowGuest: boolean;
}

export interface ApprovalFlow {
  id: string;
  name: string;
  isDefault: boolean;
  preventSelfApproval: boolean;
  requireDistinctApprovers: boolean;
  createdAt: string;
  updatedAt: string;
  stages: ApprovalFlowStage[];
}

export interface ApprovalFlowStageBody {
  name: string;
  minRole: FlowMinRole;
  approverUserIds?: string[];
  allowAutomation?: boolean;
  allowGuest?: boolean;
}

export interface ApprovalFlowBody {
  name: string;
  isDefault: boolean;
  preventSelfApproval: boolean;
  requireDistinctApprovers: boolean;
  stages: ApprovalFlowStageBody[];
}

export async function listApprovalFlows(): Promise<ApprovalFlow[]> {
  const res = await api.get<{ flows: ApprovalFlow[] }>("/approval-flows");
  return Array.isArray(res?.flows) ? res.flows : [];
}

export function createApprovalFlow(body: ApprovalFlowBody): Promise<ApprovalFlow> {
  return api.post<ApprovalFlow>("/approval-flows", body);
}

export function updateApprovalFlow(id: string, body: ApprovalFlowBody): Promise<ApprovalFlow> {
  return api.put<ApprovalFlow>(`/approval-flows/${encodeURIComponent(id)}`, body);
}

export async function archiveApprovalFlow(id: string): Promise<void> {
  await api.del(`/approval-flows/${encodeURIComponent(id)}`);
}
