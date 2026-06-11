"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useT, type MessageKey } from "@/lib/i18n";
import { LanguageSwitcher } from "./language-switcher";

interface NavItem {
  href: string;
  labelKey: MessageKey;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/calendar",
    labelKey: "nav.calendar",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect
          x="2.75"
          y="3.75"
          width="10.5"
          height="9.5"
          rx="1.75"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M2.75 6.5h10.5"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M5 2.5v2M11 2.5v2"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    href: "/analytics",
    labelKey: "nav.analytics",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M3 12V8M7 12V4M11 12V9"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M2.5 13.25h11"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    href: "/media",
    labelKey: "nav.media",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect
          x="2.5"
          y="3.5"
          width="11"
          height="9"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <circle cx="6" cy="6.5" r="1" fill="currentColor" />
        <path
          d="M3 11.5 6.5 8.5l3 3 1.7-1.5 1.8 1.7"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/posts",
    labelKey: "nav.posts",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect
          x="2.5"
          y="2.5"
          width="11"
          height="11"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M5 6h6M5 8.5h6M5 11h4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    href: "/settings",
    labelKey: "nav.settings",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M19.43 12.98a7.7 7.7 0 0 0 .07-.98 7.7 7.7 0 0 0-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.32 7.32 0 0 0-1.69-.98l-.38-2.65A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.49.42l-.38 2.65a7.5 7.5 0 0 0-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65A7.83 7.83 0 0 0 4.5 12c0 .33.03.66.07.98L2.46 14.63a.5.5 0 0 0-.12.64l2 3.46c.14.24.42.34.66.25l2.49-1c.51.39 1.07.71 1.69.98l.38 2.65c.04.24.25.42.49.42h4c.24 0 .45-.18.49-.42l.38-2.65a7.5 7.5 0 0 0 1.69-.98l2.49 1c.24.09.52-.01.66-.25l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/billing",
    labelKey: "nav.billing",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect
          x="2"
          y="3.5"
          width="12"
          height="9"
          rx="1.75"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M2 6.5h12"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M4.5 10h3"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

const STORAGE_KEY = "postsider:sidebar-collapsed";

function ChevronCollapse({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="14" height="14">
      <path
        d={collapsed ? "M6 3.5 10.5 8 6 12.5" : "M10 3.5 5.5 8 10 12.5"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);

  // Restore collapsed state from localStorage on mount.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setCollapsed(true);
    } catch {}
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `${collapsed ? "76px" : "260px"} 1fr`,
        minHeight: "100vh",
        padding: "16px",
        gap: "16px",
        transition: "grid-template-columns 220ms var(--ease)",
      }}
    >
      <aside
        style={{
          borderRadius: "var(--radius-xl)",
          border: "1px solid var(--line-soft)",
          padding: collapsed ? "20px 12px" : "24px 18px",
          display: "flex",
          flexDirection: "column",
          gap: "24px",
          position: "sticky",
          top: "16px",
          alignSelf: "start",
          height: "calc(100vh - 32px)",
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.02) 0%, rgba(0,0,0,0) 60%)",
          transition:
            "padding 220ms var(--ease)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "space-between",
            gap: 8,
            padding: collapsed ? 0 : "0 6px",
          }}
        >
          {!collapsed ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                minWidth: 0,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/postsider-logo.png"
                alt=""
                width={32}
                height={32}
                aria-hidden
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  objectFit: "cover",
                  flexShrink: 0,
                  display: "block",
                }}
              />
              <span
                className="brand"
                style={{
                  fontSize: "22px",
                  lineHeight: 1,
                  display: "inline-block",
                }}
              >
                PostSider
              </span>
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/brand/postsider-logo.png"
              alt=""
              width={32}
              height={32}
              aria-hidden
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                objectFit: "cover",
                display: "block",
              }}
            />
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            style={{
              width: 28,
              height: 28,
              padding: 0,
              borderRadius: 999,
              border: "none",
              background: "transparent",
              color: "var(--fg)",
              display: collapsed ? "none" : "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              transition:
                "background 140ms var(--ease), transform 120ms var(--ease)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0, 0, 0, 0.06)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <ChevronCollapse collapsed={collapsed} />
          </button>
        </div>

        {collapsed && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Expand sidebar"
            style={{
              width: 28,
              height: 28,
              padding: 0,
              borderRadius: 999,
              border: "none",
              background: "transparent",
              color: "var(--fg)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              alignSelf: "center",
              marginTop: -8,
              transition:
                "background 140ms var(--ease), transform 120ms var(--ease)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(0, 0, 0, 0.06)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <ChevronCollapse collapsed={collapsed} />
          </button>
        )}

        <nav>
          <ul style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {NAV_ITEMS.map((item) => {
              const isActive =
                pathname === item.href || pathname?.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    title={collapsed ? t(item.labelKey) : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: collapsed ? 0 : "12px",
                      justifyContent: collapsed ? "center" : "flex-start",
                      padding: collapsed ? "10px 0" : "10px 14px",
                      borderRadius: "var(--radius-md)",
                      background: isActive ? "var(--fg)" : "transparent",
                      color: isActive ? "var(--bg)" : "var(--fg)",
                      transition:
                        "background 160ms var(--ease), color 160ms var(--ease), padding 220ms var(--ease)",
                      fontWeight: isActive ? 600 : 500,
                    }}
                  >
                    <span
                      aria-hidden
                      style={{
                        width: 18,
                        height: 18,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {item.icon}
                    </span>
                    {!collapsed && <span>{t(item.labelKey)}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {!collapsed && (
          <div style={{ marginTop: "auto", padding: "0 6px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ padding: "0 8px" }}>
              <LanguageSwitcher />
            </div>
            {user && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  padding: "10px 8px",
                  borderTop: "1px solid var(--line-soft)",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>
                  {user.name || user.email.split("@")[0]}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {user.email}
                </span>
                <button
                  type="button"
                  onClick={() => logout()}
                  style={{
                    marginTop: 6,
                    alignSelf: "flex-start",
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    color: "var(--muted)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {t("nav.signOut")}
                </button>
              </div>
            )}
          </div>
        )}
      </aside>

      <main
        style={{
          borderRadius: "var(--radius-xl)",
          border: "1px solid var(--line-soft)",
          padding: "32px",
          minHeight: "calc(100vh - 32px)",
        }}
      >
        {user?.onTrial &&
          user.trialDaysLeft !== null &&
          !pathname?.startsWith("/billing") && (
            <TrialBanner daysLeft={user.trialDaysLeft} />
          )}
        {children}
      </main>
    </div>
  );
}

function TrialBanner({ daysLeft }: { daysLeft: number }) {
  const t = useT();
  const urgent = daysLeft <= 2;
  const label =
    daysLeft <= 0
      ? t("trial.endsToday")
      : daysLeft === 1
        ? t("trial.oneDayLeft")
        : t("trial.daysLeft", { days: daysLeft });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderRadius: "var(--radius-md)",
        marginBottom: 24,
        background: urgent ? "rgba(217, 119, 6, 0.1)" : "rgba(0,0,0,0.04)",
        border: urgent
          ? "1px solid rgba(217, 119, 6, 0.25)"
          : "1px solid var(--line-soft)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          display: "grid",
          placeItems: "center",
          background: urgent ? "#d97706" : "var(--fg)",
          color: "#fff",
          flexShrink: 0,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M8 5v3l2 1.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: urgent ? "#b45309" : "var(--fg)" }}>
          {label}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          {t("trial.cta")}
        </div>
      </div>
      <Link
        href="/billing"
        style={{
          height: 34,
          padding: "0 16px",
          borderRadius: 999,
          background: "var(--fg)",
          color: "var(--bg)",
          fontSize: 13,
          fontWeight: 600,
          display: "inline-flex",
          alignItems: "center",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {t("trial.chooseAPlan")}
      </Link>
    </div>
  );
}
