"use client";

import { useCallback, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { approvePost, rejectPost } from "@/lib/approval-api";
import { bulkResolveApprovals, retryAgentGroup } from "@/lib/agent-activity-api";
import type { RowBucketName } from "@/lib/agent-activity-api";
import {
  groupActionVisibility,
  retryFlag,
  summarizeBulk,
  summarizeRetry,
} from "@/lib/agent-activity-actions";
import { selectedApprovalIds, type SelectableGroup } from "@/lib/agent-activity-model";
import { useT } from "@/lib/i18n";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RetryUnknownDialog } from "./retry-unknown-dialog";
import s from "./agent-activity.module.css";

type Translate = ReturnType<typeof useT>;

export interface ActionMessageState {
  kind: "ok" | "error";
  text: string;
}

export interface AgentActionsApi {
  approve: (approvalId: string) => Promise<boolean>;
  reject: (approvalId: string, note?: string) => Promise<boolean>;
  bulk: (action: "approve" | "reject", approvalIds: string[], note?: string) => Promise<boolean>;
  retry: (group: string, includeUnknown: boolean) => Promise<boolean>;
  busy: boolean;
  message: ActionMessageState | null;
  clearMessage: () => void;
}

function errorText(t: Translate, e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return t("agentActivity.action.forbidden");
    if (e.status === 404) return t("agentActivity.drawer.changed");
    // 422 policy_blocked: the server message already names the rules.
    if (e.status === 422 && e.message) return e.message;
  }
  return t("agentActivity.action.failed");
}

const STALE_STATUSES = new Set([400, 404, 409]);

/**
 * One request in flight at a time for the whole page. The result message and
 * the busy flag live here (not in a row or the drawer), so a list refetch that
 * unmounts a row never loses the outcome of an action it started.
 */
export function useAgentActions({ onDone }: { onDone: () => void }): AgentActionsApi {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionMessageState | null>(null);

  const run = useCallback(async function <T>(
    call: () => Promise<T>,
    ok: (result: T) => ActionMessageState,
  ): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await call();
      setMessage(ok(result));
      onDoneRef.current();
      return true;
    } catch (e) {
      setMessage({ kind: "error", text: errorText(tRef.current, e) });
      // The data behind the click is probably stale: show the truth.
      if (e instanceof ApiError && STALE_STATUSES.has(e.status)) onDoneRef.current();
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const approve = useCallback(
    (approvalId: string) =>
      run(
        () => approvePost(approvalId),
        () => ({ kind: "ok", text: tRef.current("agentActivity.action.approved") }),
      ),
    [run],
  );

  const reject = useCallback(
    (approvalId: string, note?: string) =>
      run(
        () => rejectPost(approvalId, note),
        () => ({ kind: "ok", text: tRef.current("agentActivity.action.rejected") }),
      ),
    [run],
  );

  const bulk = useCallback(
    (action: "approve" | "reject", approvalIds: string[], note?: string) =>
      run(
        () =>
          bulkResolveApprovals({
            action,
            approvalIds,
            ...(action === "reject" && note ? { note } : {}),
          }),
        (res) => {
          const sum = summarizeBulk(res.summary);
          return {
            kind: sum.hasFailures ? "error" : "ok",
            text: tRef.current("agentActivity.bulk.result", {
              done: sum.done,
              skipped: sum.skipped,
              failed: sum.failed,
            }),
          };
        },
      ),
    [run],
  );

  const retry = useCallback(
    (group: string, includeUnknown: boolean) =>
      run(
        // The flag is passed through verbatim; callers build it with retryFlag().
        () => retryAgentGroup(group, includeUnknown === true),
        (res) => {
          const sum = summarizeRetry(res.results);
          return {
            kind: "ok",
            text: tRef.current("agentActivity.action.retryResult", {
              requeued: sum.requeued,
              skipped: sum.skipped,
              approval: sum.approval,
            }),
          };
        },
      ),
    [run],
  );

  const clearMessage = useCallback(() => setMessage(null), []);

  return { approve, reject, bulk, retry, busy, message, clearMessage };
}

/** Polite live region. The container is always rendered so announcements are reliable. */
export function ActionMessage({ message }: { message: ActionMessageState | null }) {
  return (
    <div aria-live="polite" role="status" className={s.actionMessageWrap}>
      {message ? (
        <p className={s.actionMessage + (message.kind === "error" ? " " + s.actionMessageError : "")}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

interface AgentActionsProps {
  actions: AgentActionsApi;
  role: string | undefined;
  group: string;
  canRetry: boolean;
  buckets: RowBucketName[];
  pendingIds: string[];
  className?: string;
}

/** Approve, Reject (inline reason), Retry failed and Retry anyway for one group. */
export function AgentActions({ actions, role, group, canRetry, buckets, pendingIds, className }: AgentActionsProps) {
  const t = useT();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [unknownOpen, setUnknownOpen] = useState(false);
  const vis = groupActionVisibility({ role, canRetry, buckets, pendingCount: pendingIds.length });

  if (!vis.approve && !vis.reject && !vis.retry && !vis.retryAnyway) return null;

  const suffix = pendingIds.length > 1 ? ` (${pendingIds.length})` : "";

  const doApprove = () => {
    if (actions.busy) return;
    void (pendingIds.length === 1 ? actions.approve(pendingIds[0]) : actions.bulk("approve", pendingIds));
  };

  const doReject = async () => {
    if (actions.busy) return;
    const note = reason.trim() || undefined;
    const ok = await (pendingIds.length === 1
      ? actions.reject(pendingIds[0], note)
      : actions.bulk("reject", pendingIds, note));
    if (ok) {
      setRejecting(false);
      setReason("");
    }
  };

  return (
    <div role="group" aria-label={t("agentActivity.action.groupLabel")} className={s.actions + (className ? " " + className : "")}>
      <div className={s.actionButtons}>
        {vis.approve ? (
          <button type="button" className={s.primary} disabled={actions.busy} onClick={doApprove}>
            {t("agentActivity.action.approve") + suffix}
          </button>
        ) : null}
        {vis.reject && !rejecting ? (
          <button type="button" className={s.ghost} disabled={actions.busy} onClick={() => setRejecting(true)}>
            {t("agentActivity.action.reject") + suffix}
          </button>
        ) : null}
        {vis.retry ? (
          <button
            type="button"
            className={s.ghost}
            disabled={actions.busy}
            onClick={() => void actions.retry(group, retryFlag("plain", false))}
          >
            {t("agentActivity.action.retry")}
          </button>
        ) : null}
        {vis.retryAnyway ? (
          <button type="button" className={s.ghost} disabled={actions.busy} onClick={() => setUnknownOpen(true)}>
            {t("agentActivity.action.retryUnknown")}
          </button>
        ) : null}
      </div>

      {vis.reject && rejecting ? (
        <div className={s.rejectBox}>
          <input
            type="text"
            className={s.reasonInput}
            value={reason}
            maxLength={500}
            disabled={actions.busy}
            placeholder={t("agentActivity.action.reasonPlaceholder")}
            aria-label={t("agentActivity.action.reasonLabel")}
            onChange={(e) => setReason(e.target.value)}
          />
          <button type="button" className={s.primary} disabled={actions.busy} onClick={() => void doReject()}>
            {t("agentActivity.action.reject") + suffix}
          </button>
          <button
            type="button"
            className={s.ghost}
            disabled={actions.busy}
            onClick={() => {
              setRejecting(false);
              setReason("");
            }}
          >
            {t("common.cancel")}
          </button>
        </div>
      ) : null}

      {unknownOpen ? (
        <RetryUnknownDialog
          busy={actions.busy}
          onCancel={() => setUnknownOpen(false)}
          onConfirm={async (confirmed) => {
            await actions.retry(group, retryFlag("anyway", confirmed));
            setUnknownOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

interface BulkBarProps {
  actions: AgentActionsApi;
  groups: SelectableGroup[];
  selection: Set<string>;
  onCleared: () => void;
}

/** Sticky bar for the selected groups: approve or reject only, never retry. */
export function AgentBulkBar({ actions, groups, selection, onCleared }: BulkBarProps) {
  const t = useT();
  const [reason, setReason] = useState("");
  // Ids are frozen when the dialog opens so a background refetch cannot change what is confirmed.
  const [dialog, setDialog] = useState<{ action: "approve" | "reject"; ids: string[] } | null>(null);

  if (selection.size === 0) return null;
  const ids = selectedApprovalIds(groups, selection);

  const open = (action: "approve" | "reject") => {
    if (actions.busy || ids.length === 0) return;
    setDialog({ action, ids });
  };

  return (
    <div role="group" aria-label={t("agentActivity.action.barLabel")} className={s.bulkBar}>
      <span className={s.bulkCount}>{t("agentActivity.list.selected", { count: selection.size })}</span>
      <input
        type="text"
        className={s.reasonInput}
        value={reason}
        maxLength={500}
        disabled={actions.busy}
        placeholder={t("agentActivity.action.reasonPlaceholder")}
        aria-label={t("agentActivity.action.reasonLabel")}
        onChange={(e) => setReason(e.target.value)}
      />
      <button type="button" className={s.primary} disabled={actions.busy || ids.length === 0} onClick={() => open("approve")}>
        {t("agentActivity.action.approveSelected")}
      </button>
      <button type="button" className={s.ghost} disabled={actions.busy || ids.length === 0} onClick={() => open("reject")}>
        {t("agentActivity.action.rejectSelected")}
      </button>
      {dialog ? (
        <ConfirmDialog
          danger={dialog.action === "reject"}
          busy={actions.busy}
          title={t(
            dialog.action === "approve" ? "agentActivity.bulk.confirmApprove" : "agentActivity.bulk.confirmReject",
            { count: dialog.ids.length },
          )}
          body={dialog.action === "reject" && reason.trim() ? reason.trim() : ""}
          confirmLabel={t(
            dialog.action === "approve" ? "agentActivity.action.approveSelected" : "agentActivity.action.rejectSelected",
          )}
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            const ok = await actions.bulk(dialog.action, dialog.ids, reason.trim() || undefined);
            setDialog(null);
            if (ok) {
              setReason("");
              onCleared();
            }
          }}
        />
      ) : null}
    </div>
  );
}
