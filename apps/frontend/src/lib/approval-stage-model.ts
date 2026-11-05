// Pure helpers for the stage aware approval queue. No React, no network. The
// server stays authoritative: these only decide whether to offer the buttons
// and which words to show.
import type { MessageKey } from "./i18n";

export type StageInfo = {
  position?: number;
  total?: number;
  name?: string;
  /** Only known when a flow definition is at hand; the dashboard stage view omits it. */
  minRole?: string;
  approverUserIds?: string[];
};

export type MemberInfo = { userId?: string | null; role?: string | null } | null | undefined;

export type ApprovalInfo = {
  creatorUserId?: string | null;
  requesterUserId?: string | null;
  earlierDeciderUserIds?: string[];
  /** Flow flags are applied only when the caller knows them (undefined = server decides). */
  preventSelfApproval?: boolean;
  requireDistinctApprovers?: boolean;
};

export const STAGE_REASON_KEYS = [
  "approval.stageReasonRole",
  "approval.stageReasonSuperadmin",
  "approval.stageReasonNotListed",
  "approval.stageReasonSelf",
  "approval.stageReasonDistinct",
] as const satisfies readonly MessageKey[];

export const STAGE_SHAPE_KEYS = [
  "approval.stageStatusApproved",
  "approval.stageStatusPending",
  "approval.stageStatusRejected",
  "approval.stageStatusNotReached",
] as const satisfies readonly MessageKey[];

type Reason = (typeof STAGE_REASON_KEYS)[number];

export function canDecideStageClient(
  stage: StageInfo | null | undefined,
  member: MemberInfo,
  approval: ApprovalInfo | null | undefined
): { allowed: boolean; reasonKey?: Reason } {
  const deny = (reasonKey: Reason) => ({ allowed: false, reasonKey });
  const role = member?.role;
  if (role !== "ADMIN" && role !== "SUPERADMIN") return deny("approval.stageReasonRole");

  const minRole = stage?.minRole === "SUPERADMIN" ? "SUPERADMIN" : "ADMIN";
  if (minRole === "SUPERADMIN" && role !== "SUPERADMIN") return deny("approval.stageReasonSuperadmin");

  const listed = stage?.approverUserIds ?? [];
  if (role !== "SUPERADMIN" && listed.length > 0 && !(member?.userId && listed.includes(member.userId))) {
    return deny("approval.stageReasonNotListed");
  }

  const me = member?.userId;
  if (
    me &&
    approval?.preventSelfApproval === true &&
    (approval.creatorUserId === me || approval.requesterUserId === me)
  ) {
    return deny("approval.stageReasonSelf");
  }
  if (me && approval?.requireDistinctApprovers === true && (approval.earlierDeciderUserIds ?? []).includes(me)) {
    return deny("approval.stageReasonDistinct");
  }
  return { allowed: true };
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** "Stage 2 of 3: Owner"; empty for the single implicit stage. The name is plain text. */
export function stageProgressLabel(stage: StageInfo | null | undefined, t: Translate): string {
  if (!stage || typeof stage.position !== "number" || typeof stage.total !== "number") return "";
  if (stage.total <= 1) return "";
  return t("approval.stageOf", { position: stage.position, total: stage.total, name: stage.name ?? "" });
}

export type StageStatus = "PENDING" | "APPROVED" | "REJECTED" | "NOT_REACHED";
export type StageRowLike = { position: number; name: string; status: string };

/** Pending stages that follow a rejected one were never reached. Pure; returns copies. */
export function stagesAfterRejection<T extends StageRowLike>(stages: readonly T[] | null | undefined): T[] {
  const list = [...(stages ?? [])].sort((a, b) => a.position - b.position);
  const rejectedAt = list.find((s) => s.status === "REJECTED")?.position;
  if (rejectedAt === undefined) return list;
  return list.map((s) =>
    s.position > rejectedAt && (s.status === "PENDING" || s.status === "NOT_REACHED")
      ? { ...s, status: "NOT_REACHED" }
      : s
  );
}

export type StageShape = "filled" | "half" | "outlined" | "cross" | "dashed";
export type StageSegment = { position: number; name: string; status: StageStatus; shape: StageShape; labelKey: MessageKey };

const LABEL: Record<StageStatus, MessageKey> = {
  APPROVED: "approval.stageStatusApproved",
  PENDING: "approval.stageStatusPending",
  REJECTED: "approval.stageStatusRejected",
  NOT_REACHED: "approval.stageStatusNotReached",
};

/** Segments for the small progress bar: shapes and labels, never colour alone. */
export function stageSegments(stages: readonly StageRowLike[] | null | undefined, currentPosition: number): StageSegment[] {
  const list = stagesAfterRejection(stages);
  if (list.length <= 1) return [];
  return list.map((s) => {
    const status: StageStatus =
      s.status === "APPROVED" || s.status === "REJECTED" || s.status === "NOT_REACHED" ? s.status : "PENDING";
    const shape: StageShape =
      status === "APPROVED"
        ? "filled"
        : status === "REJECTED"
          ? "cross"
          : status === "NOT_REACHED"
            ? "dashed"
            : s.position === currentPosition
              ? "half"
              : "outlined";
    return { position: s.position, name: s.name, status, shape, labelKey: LABEL[status] };
  });
}
