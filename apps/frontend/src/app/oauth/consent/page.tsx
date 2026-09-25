"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import s from "./mcp-consent.module.css";

/**
 * MCP consent screen.
 *
 * The MCP authorization flow (`GET /oauth/authorize` on the backend) records a
 * pending request and redirects the browser here with `?request=<id>`. The
 * page shows what the AI client asked for, lets an organization admin pick the
 * organization, and posts the decision to `/oauth/mcp-consent`. The backend
 * answers with the exact redirect back to the client (`code` + `state`, or
 * `error=access_denied`), which we follow.
 */

interface ConsentOrg {
  id: string;
  name: string;
  role: string;
}

interface ConsentRequest {
  id: string;
  clientName: string;
  scopes: string[];
  redirectUri: string;
  organizations: ConsentOrg[];
}

type Phase =
  | "loading"
  | "ready"
  | "submitting"
  | "signin"
  | "expired"
  | "invalid";

function scopeLabel(t: ReturnType<typeof useT>, scope: string): string {
  if (scope === "posts:read") return t("mcpConsent.scopeRead");
  if (scope === "posts:write") return t("mcpConsent.scopeWrite");
  return scope;
}

function ConsentCard() {
  const t = useT();
  const search = useSearchParams();
  const requestId = search.get("request");

  const [phase, setPhase] = useState<Phase>("loading");
  const [request, setRequest] = useState<ConsentRequest | null>(null);
  const [orgId, setOrgId] = useState<string>("");

  useEffect(() => {
    if (!requestId) {
      setPhase("invalid");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<ConsentRequest>(
          `/oauth/mcp-request/${encodeURIComponent(requestId)}`,
          undefined,
          { silent: true },
        );
        if (cancelled) return;
        if (!res || !res.id) {
          setPhase("invalid");
          return;
        }
        setRequest(res);
        setOrgId(res.organizations?.[0]?.id ?? "");
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setPhase("signin");
        } else if (err instanceof ApiError && err.status === 404) {
          setPhase("expired");
        } else {
          setPhase("invalid");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const decide = useCallback(
    async (action: "approve" | "deny") => {
      if (!requestId) return;
      setPhase("submitting");
      try {
        const res = await api.post<{ redirect: string }>(
          "/oauth/mcp-consent",
          {
            request_id: requestId,
            organization_id: action === "approve" ? orgId : undefined,
            action,
          },
          { silent: true },
        );
        if (res?.redirect) {
          window.location.href = res.redirect;
          return;
        }
        setPhase("invalid");
      } catch (err) {
        // Expired/consumed between load and submit, or a forged request.
        setPhase(
          err instanceof ApiError && err.status === 404 ? "expired" : "invalid",
        );
      }
    },
    [requestId, orgId],
  );

  return (
    <div className={s.wrap}>
      <div className={s.card}>
        {(phase === "loading" || phase === "submitting") && (
          <p className={s.muted} role="status">
            {phase === "loading" ? t("mcpConsent.loading") : null}
          </p>
        )}

        {phase === "signin" && (
          <>
            <h1 className={s.title}>{t("mcpConsent.title")}</h1>
            <p className={s.muted}>{t("mcpConsent.signInNeeded")}</p>
            <a className={s.primary} href="/login">
              {t("mcpConsent.signIn")}
            </a>
          </>
        )}

        {phase === "expired" && (
          <>
            <h1 className={s.title}>{t("mcpConsent.title")}</h1>
            <p className={s.muted}>{t("mcpConsent.expired")}</p>
          </>
        )}

        {phase === "invalid" && (
          <>
            <h1 className={s.title}>{t("mcpConsent.title")}</h1>
            <p className={s.muted}>{t("mcpConsent.invalid")}</p>
          </>
        )}

        {phase === "ready" && request && (
          <>
            <h1 className={s.title}>{t("mcpConsent.title")}</h1>
            <p className={s.muted}>{t("mcpConsent.subtitle")}</p>

            <div className={s.clientRow}>
              <span className={s.clientBadge}>
                {request.clientName.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <div className={s.clientName}>{request.clientName}</div>
                <div className={s.clientHost}>
                  {t("mcpConsent.requestedBy")} · {safeHost(request.redirectUri)}
                </div>
              </div>
            </div>

            <h2 className={s.sectionTitle}>{t("mcpConsent.permissions")}</h2>
            <ul className={s.scopes}>
              {request.scopes.map((scope) => (
                <li key={scope}>{scopeLabel(t, scope)}</li>
              ))}
            </ul>

            {request.organizations.length === 0 ? (
              <p className={s.notice}>{t("mcpConsent.adminOnly")}</p>
            ) : (
              <>
                <h2 className={s.sectionTitle}>{t("mcpConsent.organization")}</h2>
                {request.organizations.length === 1 ? (
                  <p className={s.orgStatic}>{request.organizations[0].name}</p>
                ) : (
                  <div className={s.orgList}>
                    {request.organizations.map((org) => (
                      <label key={org.id} className={s.orgOption}>
                        <input
                          type="radio"
                          name="organization"
                          value={org.id}
                          checked={orgId === org.id}
                          onChange={() => setOrgId(org.id)}
                        />
                        <span>{org.name}</span>
                      </label>
                    ))}
                  </div>
                )}
                <p className={s.muted}>{t("mcpConsent.organizationHint")}</p>
              </>
            )}

            <div className={s.actions}>
              <button
                type="button"
                className={s.primary}
                disabled={!orgId || request.organizations.length === 0}
                onClick={() => void decide("approve")}
              >
                {t("mcpConsent.approve")}
              </button>
              <button
                type="button"
                className={s.secondary}
                onClick={() => void decide("deny")}
              >
                {t("mcpConsent.deny")}
              </button>
            </div>

            <p className={s.footer}>{t("mcpConsent.footer")}</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Host of the redirect URI, for a small "where the code goes" hint. */
function safeHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return "unknown";
  }
}

export default function McpConsentPage() {
  // useSearchParams needs a Suspense boundary when the route is prerendered.
  return (
    <Suspense
      fallback={
        <div className={s.wrap}>
          <div className={s.card} />
        </div>
      }
    >
      <ConsentCard />
    </Suspense>
  );
}
