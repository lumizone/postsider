// Pure model for Settings > Approval flows. No React, no network. Imports are
// relative and type only so the root jest run can load it.
import type { MessageKey } from "./i18n";
import type { ApprovalFlow, ApprovalFlowBody, FlowMinRole } from "./approval-flows-api";

/** Mirrors the server limits (approval-flow.dto.ts). The server stays the authority. */
export const FLOW_LIMITS = {
  nameMax: 120,
  stageNameMax: 80,
  stagesMin: 1,
  stagesMax: 5,
  approversMax: 20,
} as const;

export const FLOW_MIN_ROLE_LIST: readonly FlowMinRole[] = ["ADMIN", "SUPERADMIN"];

export type StageDraft = {
  name: string;
  minRole: FlowMinRole;
  approverUserIds: string[];
  allowAutomation: boolean;
  allowGuest: boolean;
};

export type FlowDraft = {
  name: string;
  isDefault: boolean;
  preventSelfApproval: boolean;
  requireDistinctApprovers: boolean;
  stages: StageDraft[];
};

export type FlowValidationError = { field: string; key: MessageKey };

export const FLOW_VALIDATION_KEYS = [
  "approvalFlows.validation.nameRequired",
  "approvalFlows.validation.nameTooLong",
  "approvalFlows.validation.stagesMin",
  "approvalFlows.validation.stagesMax",
  "approvalFlows.validation.stageNameRequired",
  "approvalFlows.validation.stageNameTooLong",
  "approvalFlows.validation.minRoleInvalid",
  "approvalFlows.validation.approversTooMany",
  "approvalFlows.validation.approversDuplicate",
] as const satisfies readonly MessageKey[];

export function emptyStage(): StageDraft {
  return { name: "", minRole: "ADMIN", approverUserIds: [], allowAutomation: false, allowGuest: false };
}

export function emptyFlow(): FlowDraft {
  return {
    name: "",
    isDefault: false,
    preventSelfApproval: true,
    requireDistinctApprovers: true,
    stages: [emptyStage()],
  };
}

/** The edit form starts from the raw stored name; stages are ordered by position. */
export function flowToDraft(flow: ApprovalFlow): FlowDraft {
  return {
    name: flow.name,
    isDefault: flow.isDefault,
    preventSelfApproval: flow.preventSelfApproval,
    requireDistinctApprovers: flow.requireDistinctApprovers,
    stages: [...flow.stages]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        name: s.name,
        minRole: s.minRole,
        approverUserIds: [...s.approverUserIds],
        allowAutomation: s.allowAutomation,
        allowGuest: s.allowGuest,
      })),
  };
}

/** One entry per invalid field (the first problem of that field). Empty when valid. */
export function validateFlow(draft: FlowDraft): FlowValidationError[] {
  const errors: FlowValidationError[] = [];
  const name = draft.name.trim();
  if (!name) errors.push({ field: "name", key: "approvalFlows.validation.nameRequired" });
  else if (name.length > FLOW_LIMITS.nameMax) errors.push({ field: "name", key: "approvalFlows.validation.nameTooLong" });

  if (draft.stages.length < FLOW_LIMITS.stagesMin) {
    errors.push({ field: "stages", key: "approvalFlows.validation.stagesMin" });
  } else if (draft.stages.length > FLOW_LIMITS.stagesMax) {
    errors.push({ field: "stages", key: "approvalFlows.validation.stagesMax" });
  }

  draft.stages.forEach((s, i) => {
    const stageName = s.name.trim();
    if (!stageName) errors.push({ field: `stages.${i}.name`, key: "approvalFlows.validation.stageNameRequired" });
    else if (stageName.length > FLOW_LIMITS.stageNameMax) {
      errors.push({ field: `stages.${i}.name`, key: "approvalFlows.validation.stageNameTooLong" });
    }
    if (!FLOW_MIN_ROLE_LIST.includes(s.minRole)) {
      errors.push({ field: `stages.${i}.minRole`, key: "approvalFlows.validation.minRoleInvalid" });
    }
    const ids = s.approverUserIds ?? [];
    if (ids.length > FLOW_LIMITS.approversMax) {
      errors.push({ field: `stages.${i}.approverUserIds`, key: "approvalFlows.validation.approversTooMany" });
    } else if (new Set(ids).size !== ids.length) {
      errors.push({ field: `stages.${i}.approverUserIds`, key: "approvalFlows.validation.approversDuplicate" });
    }
  });
  return errors;
}

/** Moves one stage. Out of range or non integer indexes give an unchanged copy. */
export function moveStage<T>(stages: readonly T[], from: number, to: number): T[] {
  const copy = [...stages];
  const ok = (n: number) => Number.isInteger(n) && n >= 0 && n < copy.length;
  if (!ok(from) || !ok(to) || from === to) return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/** Exactly the fields the server reads; no ids, positions or timestamps. */
export function toRequestBody(draft: FlowDraft): ApprovalFlowBody {
  return {
    name: draft.name.trim(),
    isDefault: draft.isDefault,
    preventSelfApproval: draft.preventSelfApproval,
    requireDistinctApprovers: draft.requireDistinctApprovers,
    stages: draft.stages.map((s) => ({
      name: s.name.trim(),
      minRole: s.minRole,
      approverUserIds: [...s.approverUserIds],
      allowAutomation: s.allowAutomation,
      allowGuest: s.allowGuest,
    })),
  };
}
