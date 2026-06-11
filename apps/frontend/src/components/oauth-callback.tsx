"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  connectIntegration,
  saveProviderPage,
  type ConnectPage,
} from "@/lib/integrations";
import { ApiError } from "@/lib/api";

interface Props {
  provider: string;
}

/**
 * OAuth callback landing.
 *
 * The provider redirects the browser back to /integrations/social/:provider
 * with `?code=…&state=…`. We POST that to the backend to swap the auth code
 * for an Integration row and then send the user back to /calendar.
 *
 * Two-step providers (e.g. LinkedIn Page) return a list of `pages` the user
 * administers. In that case we show a picker and finalize via saveProviderPage.
 *
 * We use an instance ref to make sure the exchange runs exactly once even
 * under React strict-mode double effects.
 */
export function OauthCallback({ provider }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const [status, setStatus] = useState<"working" | "ok" | "error" | "pick-page">(
    "working",
  );
  const [message, setMessage] = useState<string>(
    "Finishing the connection with your account…",
  );
  const [pages, setPages] = useState<ConnectPage[]>([]);
  const [integrationId, setIntegrationId] = useState<string>("");
  const [savingPage, setSavingPage] = useState(false);
  const sentRef = useRef(false);

  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;

    // OAuth 2.0 / custom flows return ?code=&state=. OAuth 1.0a providers
    // (e.g. X/Twitter) return ?oauth_token=&oauth_verifier= instead — map
    // them so the backend authenticate() gets code=verifier, state=token.
    const code = search.get("code") ?? search.get("oauth_verifier");
    const state = search.get("state") ?? search.get("oauth_token");
    const refresh = search.get("refresh") || undefined;

    if (!code || !state) {
      setStatus("error");
      setMessage(
        "The provider did not return a valid authorization code. Try again.",
      );
      return;
    }

    (async () => {
      try {
        const res = await connectIntegration(provider, { code, state, refresh });
        if (res?.error) {
          setStatus("error");
          setMessage(res.error);
          return;
        }

        // Two-step provider (e.g. LinkedIn Page): user must pick a page.
        if (res.inBetweenSteps && res.pages && res.pages.length > 0) {
          setIntegrationId(res.id);
          setPages(res.pages);
          setStatus("pick-page");
          setMessage("Choose which page to connect.");
          return;
        }

        // Two-step provider but no pages found — user administers no pages.
        if (res.inBetweenSteps && (!res.pages || res.pages.length === 0)) {
          setStatus("error");
          setMessage(
            "No pages found. Make sure you're an admin of at least one LinkedIn Page.",
          );
          return;
        }

        setStatus("ok");
        setMessage("Channel connected — taking you back…");
        setTimeout(() => router.replace("/calendar"), 600);
      } catch (err) {
        const msg =
          err instanceof ApiError
            ? err.message
            : "Could not finish the connection. Try again.";
        setStatus("error");
        setMessage(msg);
      }
    })();
  }, [provider, router, search]);

  const handlePickPage = async (page: ConnectPage) => {
    if (savingPage) return;
    setSavingPage(true);
    setMessage(`Connecting ${page.name}…`);
    const state = search.get("state") || undefined;
    try {
      const res = await saveProviderPage(integrationId, {
        page: page.page || page.id,
        state,
      });
      if (res?.success) {
        setStatus("ok");
        setMessage("Page connected — taking you back…");
        setTimeout(() => router.replace("/calendar"), 600);
      } else {
        setStatus("error");
        setMessage("Could not connect the selected page. Try again.");
      }
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : "Could not connect the selected page. Try again.";
      setStatus("error");
      setMessage(msg);
    } finally {
      setSavingPage(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 32,
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          padding: 28,
          border: "1px solid var(--line-soft)",
          borderRadius: "var(--radius-xl)",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>
          {provider.toUpperCase()}
        </div>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>
          {status === "working" && "Connecting"}
          {status === "ok" && "Connected"}
          {status === "error" && "Connection failed"}
          {status === "pick-page" && "Choose a page"}
        </h1>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 14 }}>
          {message}
        </p>

        {status === "pick-page" && (
          <div
            style={{
              marginTop: 18,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {pages.map((page) => (
              <button
                key={page.id}
                type="button"
                disabled={savingPage}
                onClick={() => handlePickPage(page)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--line-soft)",
                  background: "var(--bg)",
                  cursor: savingPage ? "default" : "pointer",
                  textAlign: "left",
                  opacity: savingPage ? 0.6 : 1,
                }}
              >
                {page.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={page.picture}
                    alt=""
                    width={32}
                    height={32}
                    style={{ borderRadius: 6, objectFit: "cover" }}
                  />
                ) : (
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 6,
                      background: "var(--line-soft)",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 13,
                    }}
                  >
                    {page.name?.[0]?.toUpperCase() ?? "?"}
                  </span>
                )}
                <span style={{ fontSize: 14 }}>{page.name}</span>
              </button>
            ))}
          </div>
        )}

        {status === "error" && (
          <button
            type="button"
            onClick={() => router.replace("/calendar")}
            style={{
              marginTop: 18,
              padding: "9px 16px",
              borderRadius: "var(--radius-md)",
              background: "var(--fg)",
              color: "var(--bg)",
              border: "none",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Back to dashboard
          </button>
        )}
      </div>
    </div>
  );
}
