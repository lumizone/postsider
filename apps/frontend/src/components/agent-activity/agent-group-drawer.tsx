"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import {
  getAgentGroup,
  type AgentGroup,
  type AgentGroupDetail,
  type ActorDisplay,
  type ApprovalDetail,
  type ClaimedProvenance,
  type DestinationDetail,
  type PolicyEffect,
} from "@/lib/agent-activity-api";
import { BUCKET_WEIGHT, bucketLabelKey } from "@/lib/agent-activity-model";
import { destinationToChannel } from "@/lib/agent-destination-channel";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import { platformFromIdentifier } from "@/lib/integrations";
import { parsePostMedia } from "@/lib/posts";
import { effectiveMaxLength, getProviderRequirement } from "@/lib/provider-requirements";
import { PlatformIcon } from "@/components/platform-icon";
import { PostPreviewPanel } from "@/components/post-preview/post-preview-panel";
import { ActorLabel } from "./actor-label";
import { AgentContentCompare } from "./agent-content-compare";
import { errorKey, safeHttpUrl } from "./agent-group-drawer-helpers";
import { AgentTimeline } from "./agent-timeline";
import s from "./agent-activity.module.css";

const WEIGHT_CLASS = {
  filled: s.wFilled,
  outline: s.wOutline,
  dotted: s.wDotted,
  struck: s.wStruck,
  plain: s.wPlain,
} as const;

const EFFECTS = new Set(["ALLOW", "REQUIRE_APPROVAL", "BLOCK"]);
const APPROVAL_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED"]);
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type LoadState =
  | { status: "loading" }
  | { status: "ready"; detail: AgentGroupDetail }
  | { status: "changed" }
  | { status: "error" };

interface Props {
  group: AgentGroup;
  onClose: () => void;
  onChanged: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={s.kv}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function effectLabel(t: (k: MessageKey) => string, effect: string): string {
  return EFFECTS.has(effect) ? t(`agentActivity.effect.${effect}` as MessageKey) : effect;
}

export function AgentGroupDrawer({ group, onClose, onChanged }: Props) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus the close button on open and give focus back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!dialogRef.current?.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getAgentGroup(group.group)
      .then((detail) => {
        if (cancelled) return;
        setState({ status: "ready", detail });
        setActiveId((prev) =>
          prev && detail.destinations.some((d) => d.postId === prev)
            ? prev
            : (detail.destinations[0]?.postId ?? null),
        );
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState(e instanceof ApiError && e.status === 404 ? { status: "changed" } : { status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [group.group, reloadKey]);

  const detail = state.status === "ready" ? state.detail : null;
  const when = new Date(detail?.updatedAt ?? group.updatedAt);
  const weight = BUCKET_WEIGHT[group.bucket];

  return (
    <div className={s.overlay} onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("agentActivity.drawer.title")}
        className={s.drawer}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.drawerHead}>
          <div className={s.drawerHeadMain}>
            <span className={s.badge + " " + WEIGHT_CLASS[weight]}>
              {t(bucketLabelKey(group.bucket) as MessageKey)}
            </span>
            {Number.isNaN(when.getTime()) ? null : (
              <time dateTime={when.toISOString()} className={s.muted}>
                {when.toLocaleString(locale)}
              </time>
            )}
          </div>
          <button ref={closeRef} type="button" className={s.ghost} onClick={onClose}>
            {t("agentActivity.drawer.close")}
          </button>
        </div>

        <div className={s.drawerBody}>
          {state.status === "loading" ? (
            <div aria-busy="true" role="status">
              <span className={s.srOnly}>{t("agentActivity.drawer.loading")}</span>
              {[0, 1, 2].map((i) => (
                <div key={i} className={s.skeleton} aria-hidden />
              ))}
            </div>
          ) : null}

          {state.status === "changed" ? (
            <div role="alert" className={s.changedBox}>
              <p>{t("agentActivity.drawer.changed")}</p>
              <button
                type="button"
                className={s.ghost}
                onClick={() => {
                  onChanged();
                  onClose();
                }}
              >
                {t("agentActivity.drawer.refresh")}
              </button>
            </div>
          ) : null}

          {state.status === "error" ? (
            <div role="alert" className={s.errorBanner}>
              <span>{t("agentActivity.drawer.loadError")}</span>
              <button type="button" className={s.ghost} onClick={() => setReloadKey((k) => k + 1)}>
                {t("agentActivity.drawer.retry")}
              </button>
            </div>
          ) : null}

          {detail ? (
            <DrawerSections detail={detail} activeId={activeId} onActive={setActiveId} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DrawerSections({
  detail,
  activeId,
  onActive,
}: {
  detail: AgentGroupDetail;
  activeId: string | null;
  onActive: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const first = detail.destinations[0] ?? null;
  const approvals = detail.destinations.filter((d) => d.approval);
  const { recorded, current } = detail.policy;
  const fmt = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(locale);
  };

  return (
    <>
      <section className={s.section} aria-labelledby="ag-dest">
        <h3 id="ag-dest" className={s.sectionTitle}>
          {t("agentActivity.drawer.destinations")}
        </h3>
        <ul className={s.destList}>
          {detail.destinations.map((d) => (
            <DestinationBlock key={d.postId} d={d} fmt={fmt} />
          ))}
        </ul>
      </section>

      <section className={s.section} aria-labelledby="ag-who">
        <h3 id="ag-who" className={s.sectionTitle}>
          {t("agentActivity.drawer.who")}
        </h3>
        <p className={s.subTitle}>{t("agentActivity.drawer.verified")}</p>
        <dl className={s.kvList}>
          <Row label={t("agentActivity.drawer.createdBy")}>
            <ActorLabel actor={first?.createdBy ?? null} />
          </Row>
          <Row label={t("agentActivity.drawer.lastModifiedBy")}>
            <ActorLabel actor={first?.lastModifiedBy ?? null} />
          </Row>
        </dl>
        <ClaimedBlock claimed={first?.claimed ?? null} />
      </section>

      {approvals.length > 0 ? (
        <section className={s.section} aria-labelledby="ag-appr">
          <h3 id="ag-appr" className={s.sectionTitle}>
            {t("agentActivity.drawer.approval")}
          </h3>
          {approvals.map((d) => (
            <ApprovalBlock
              key={d.postId}
              approval={d.approval as ApprovalDetail}
              label={approvals.length > 1 ? d.integration.name : null}
              fmt={fmt}
            />
          ))}
        </section>
      ) : null}

      <section className={s.section} aria-labelledby="ag-pol">
        <h3 id="ag-pol" className={s.sectionTitle}>
          {t("agentActivity.drawer.policy")}
        </h3>
        <dl className={s.kvList}>
          <Row label={t("agentActivity.drawer.policyRecorded")}>
            {recorded ? (
              <>
                <div>
                  {effectLabel(t, recorded.effect)} ({t(`agentActivity.phase.${recorded.phase}` as MessageKey)})
                </div>
                {recorded.ruleNames.length > 0 ? (
                  <ul className={s.plainList}>
                    {recorded.ruleNames.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <span className={s.muted}>{t("agentActivity.drawer.notRecorded")}</span>
            )}
          </Row>
          <Row label={t("agentActivity.drawer.policyCurrent")}>
            {current ? (
              <>
                <div>{effectLabel(t, current.effect as PolicyEffect)}</div>
                {current.matched.length > 0 ? (
                  <ul className={s.plainList}>
                    {current.matched.map((m) => (
                      <li key={m.ruleId}>{m.name}</li>
                    ))}
                  </ul>
                ) : (
                  <span className={s.muted}>{t("agentActivity.drawer.policyNone")}</span>
                )}
              </>
            ) : (
              <span className={s.muted}>{t("agentActivity.drawer.notRecorded")}</span>
            )}
          </Row>
        </dl>
      </section>

      <section className={s.section} aria-labelledby="ag-content">
        <h3 id="ag-content" className={s.sectionTitle}>
          {t("agentActivity.drawer.content")}
        </h3>
        <ContentBlock destinations={detail.destinations} activeId={activeId} onActive={onActive} />
      </section>

      <section className={s.section} aria-labelledby="ag-time">
        <h3 id="ag-time" className={s.sectionTitle}>
          {t("agentActivity.drawer.timeline")}
        </h3>
        <AgentTimeline items={detail.timeline} />
      </section>
    </>
  );
}

function DestinationBlock({ d, fmt }: { d: DestinationDetail; fmt: (iso: string | null) => string }) {
  const { t } = useI18n();
  const platform = platformFromIdentifier(d.integration.providerIdentifier);
  const failed = d.state === "ERROR" || d.errorCategory !== null || d.errorMessage !== null;
  const release = safeHttpUrl(d.releaseURL);
  const lastAttempt = fmt(d.lastPublishAttemptAt);
  const publishAt = fmt(d.publishDate);
  return (
    <li className={s.destItem}>
      <div className={s.destTop}>
        <span className={s.destName}>
          {platform ? <PlatformIcon platform={platform} size={16} /> : null}
          <strong>{d.integration.name}</strong>
        </span>
        <span className={s.badge + " " + WEIGHT_CLASS[BUCKET_WEIGHT[d.bucket]]}>
          {t(bucketLabelKey(d.bucket) as MessageKey)}
        </span>
      </div>
      {failed ? (
        <div className={s.destError}>
          <div>{t(errorKey(d.errorCategory) as MessageKey)}</div>
          {d.errorMessage ? (
            <div className={s.errorText}>
              {t("agentActivity.drawer.errorLabel")}: {d.errorMessage}
            </div>
          ) : null}
          {d.errorRetryable !== null ? (
            <div className={s.muted}>
              {d.errorRetryable
                ? t("agentActivity.drawer.canRetry")
                : t("agentActivity.drawer.cannotRetry")}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={s.destMeta}>
        {d.publishAttempts > 0 ? (
          <span>{t("agentActivity.drawer.attempts", { count: d.publishAttempts })}</span>
        ) : null}
        {lastAttempt ? <span>{t("agentActivity.drawer.lastAttempt", { when: lastAttempt })}</span> : null}
        {publishAt ? <span>{t("agentActivity.drawer.scheduledFor", { when: publishAt })}</span> : null}
        {release ? (
          <a href={release} target="_blank" rel="noopener noreferrer">
            {t("agentActivity.action.viewOnPlatform")}
          </a>
        ) : null}
      </div>
    </li>
  );
}

function ClaimedBlock({ claimed }: { claimed: ClaimedProvenance | null }) {
  const { t } = useI18n();
  const rows: Array<[string, string | null]> = claimed
    ? [
        [t("agentActivity.drawer.claimedAgent"), claimed.agentName],
        [t("agentActivity.drawer.claimedWorkflow"), claimed.workflowId],
        [t("agentActivity.drawer.claimedRun"), claimed.runId],
        [t("agentActivity.drawer.claimedRef"), claimed.externalRef],
        [t("agentActivity.drawer.claimedSource"), claimed.source],
      ]
    : [];
  const present = rows.filter(([, v]) => v !== null && v.trim() !== "");
  return (
    <>
      <p className={s.subTitle}>{t("agentActivity.drawer.claimed")}</p>
      {present.length === 0 ? (
        <p className={s.muted}>{t("agentActivity.drawer.notRecorded")}</p>
      ) : (
        <dl className={s.kvList}>
          {present.map(([label, value]) => (
            <Row key={label} label={label}>
              {value}
            </Row>
          ))}
        </dl>
      )}
    </>
  );
}

function ApprovalBlock({
  approval,
  label,
  fmt,
}: {
  approval: ApprovalDetail;
  label: string | null;
  fmt: (iso: string | null) => string;
}) {
  const { t } = useI18n();
  const status = APPROVAL_STATUSES.has(approval.status)
    ? t(`agentActivity.approvalStatus.${approval.status}` as MessageKey)
    : approval.status;
  const decider = approval.decidedBy;
  return (
    <div className={s.approvalBlock}>
      {label ? <p className={s.subTitle}>{label}</p> : null}
      <dl className={s.kvList}>
        <Row label={t("agentActivity.drawer.approvalStatus")}>
          {status}
          {fmt(approval.resolvedAt ?? approval.requestedAt) ? (
            <span className={s.muted}> ({fmt(approval.resolvedAt ?? approval.requestedAt)})</span>
          ) : null}
        </Row>
        <Row label={t("agentActivity.drawer.requestedBy")}>
          <ActorLabel actor={approval.requestedBy} />
        </Row>
        {decider ? (
          <Row label={t("agentActivity.drawer.decidedBy")}>
            {decider.type === "GUEST" ? (
              <span>
                {decider.name ? decider.name + " " : ""}({t("agentActivity.actor.guest")})
              </span>
            ) : (
              <ActorLabel actor={decider as ActorDisplay} />
            )}
          </Row>
        ) : null}
        {approval.note ? <Row label={t("agentActivity.drawer.note")}>{approval.note}</Row> : null}
      </dl>
    </div>
  );
}

function ContentBlock({
  destinations,
  activeId,
  onActive,
}: {
  destinations: DestinationDetail[];
  activeId: string | null;
  onActive: (id: string) => void;
}) {
  const { t } = useI18n();
  const active = destinations.find((d) => d.postId === activeId) ?? destinations[0];
  const channel = useMemo(
    () => (active ? destinationToChannel(
      {
        integrationId: active.integration.id,
        integrationName: active.integration.name,
        providerIdentifier: active.integration.providerIdentifier,
        picture: active.integration.picture,
      },
      platformFromIdentifier,
    ) : null),
    [active],
  );
  const media = useMemo(() => parsePostMedia(active?.image), [active]);

  if (!active || !channel) return null;

  return (
    <div className={s.contentBlock}>
      {destinations.length > 1 ? (
        <div className={s.tabStrip} role="tablist">
          {destinations.map((d) => {
            const on = d.postId === active.postId;
            return (
              <button
                key={d.postId}
                type="button"
                role="tab"
                aria-selected={on}
                className={s.segment + (on ? " " + s.segmentOn : "")}
                onClick={() => onActive(d.postId)}
              >
                {d.integration.name}
              </button>
            );
          })}
        </div>
      ) : null}

      <PostPreviewPanel
        key={active.postId}
        channels={[channel]}
        activeTarget={channel.id}
        bodyFor={() => active.contentText}
        media={media.map((m, i) => ({ id: m.id ?? String(i), kind: m.kind, url: m.url }))}
        threadParts={active.thread}
        maxLenFor={(c) => effectiveMaxLength(getProviderRequirement(c.identifier), {})}
        identifierFor={(c) => c.identifier}
      />

      {active.firstComment ? (
        <div className={s.firstComment}>
          <p className={s.subTitle}>{t("agentActivity.drawer.firstComment")}</p>
          <p className={s.compareText}>{active.firstComment}</p>
        </div>
      ) : null}

      <AgentContentCompare
        items={destinations.map((d) => ({
          id: d.postId,
          name: d.integration.name,
          text: d.contentText,
        }))}
      />
    </div>
  );
}
