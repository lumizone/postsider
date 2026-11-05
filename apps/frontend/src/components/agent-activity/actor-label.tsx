"use client";

import type { ActorDisplay } from "@/lib/agent-activity-api";
import { useT } from "@/lib/i18n";

type Translate = ReturnType<typeof useT>;

/** Plain-text display name for a verified actor. Never HTML. */
export function actorName(t: Translate, actor: ActorDisplay | null): string {
  if (!actor) return t("agentActivity.actor.unknown");
  if (actor.type === "SYSTEM") return t("agentActivity.actor.SYSTEM");
  if (actor.state === "legacy") return t("agentActivity.actor.legacy");
  const name = (actor.name ?? "").trim();
  if (actor.state === "revoked") {
    return name
      ? t("agentActivity.actor.revoked", { name })
      : t("agentActivity.actor.revokedNoName");
  }
  if (actor.state === "unknown" || !name) return t("agentActivity.actor.unknown");
  return name;
}

/** Short type label ("API key", "OAuth client", "User"); empty when redundant. */
export function actorTypeLabel(t: Translate, actor: ActorDisplay | null): string {
  if (!actor) return "";
  if (actor.type === "SYSTEM" || actor.state === "legacy") return "";
  return t(`agentActivity.actor.${actor.type}`);
}

/** "name", a type label and, for OAuth clients, who authorized the client. */
export function ActorLabel({ actor, className }: { actor: ActorDisplay | null; className?: string }) {
  const t = useT();
  const typeLabel = actorTypeLabel(t, actor);
  const authorizedBy = actor?.authorizedBy?.trim();
  return (
    <span className={className}>
      <span>{actorName(t, actor)}</span>
      {typeLabel ? <span> ({typeLabel})</span> : null}
      {authorizedBy ? (
        <span> {t("agentActivity.actor.authorizedBy", { name: authorizedBy })}</span>
      ) : null}
    </span>
  );
}
