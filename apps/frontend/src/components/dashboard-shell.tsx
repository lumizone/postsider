"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useT, type MessageKey } from "@/lib/i18n";
import { LanguageSwitcher } from "./language-switcher";
import styles from "./dashboard-shell.module.css";

interface NavItem {
  href: string;
  labelKey: MessageKey;
  icon: ReactNode;
  /** Minimum role required. Default: everyone. */
  minRole?: "ADMIN" | "SUPERADMIN";
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
    href: "/approval",
    labelKey: "nav.approval",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d="M3.5 8.5l2.5 2.5 6-6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    href: "/settings",
    labelKey: "nav.settings",
    minRole: "ADMIN",
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
    minRole: "SUPERADMIN",
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

const ROLE_LEVEL: Record<string, number> = {
  USER: 0,
  ADMIN: 1,
  SUPERADMIN: 2,
};

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
  const myLevel = ROLE_LEVEL[user?.role ?? "USER"] ?? 0;
  const [collapsed, setCollapsed] = useState(false);
  // Mobile off-canvas drawer (opened from the hamburger in the topbar).
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Restore collapsed state from localStorage on mount.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setCollapsed(true);
    } catch {}
  }, []);

  // Close the drawer on navigation.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  // The open drawer always shows the full sidebar; on desktop the drawer is
  // never open, so this matches the stored collapsed state exactly.
  const isCollapsed = collapsed && !mobileNavOpen;

  return (
    <div
      className={
        styles.shell + (collapsed ? " " + styles.shellCollapsed : "")
      }
    >
      <header className={styles.topbar}>
        <button
          type="button"
          className={styles.menuButton}
          onClick={() => setMobileNavOpen(true)}
          aria-label={t("calendar.openMenu")}
          aria-expanded={mobileNavOpen}
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden width="18" height="18">
            <path
              d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <span className={styles.topbarBrand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={user?.orgLogo || "/brand/postsider-logo.png"}
            alt=""
            width={28}
            height={28}
            aria-hidden
            style={{
              width: 28,
              height: 28,
              borderRadius: "var(--radius-sm)",
              objectFit: "cover",
              flexShrink: 0,
              display: "block",
            }}
          />
          <span
            className="brand"
            style={{ fontSize: "19px", lineHeight: 1, display: "inline-block" }}
          >
            PostSider
          </span>
        </span>
      </header>

      {mobileNavOpen && (
        <div
          className={styles.backdrop}
          onClick={() => setMobileNavOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={
          styles.sidebar +
          (isCollapsed ? " " + styles.sidebarCollapsed : "") +
          (mobileNavOpen ? " " + styles.sidebarOpen : "")
        }
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: isCollapsed ? "center" : "space-between",
            gap: 8,
            padding: isCollapsed ? 0 : "0 6px",
          }}
        >
          {!isCollapsed ? (
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
                src={user?.orgLogo || "/brand/postsider-logo.png"}
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
              src={user?.orgLogo || "/brand/postsider-logo.png"}
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
            aria-label={
              isCollapsed ? t("calendar.expand") : t("calendar.collapse")
            }
            style={{
              width: 28,
              height: 28,
              padding: 0,
              borderRadius: 999,
              border: "none",
              background: "transparent",
              color: "var(--fg)",
              display: isCollapsed ? "none" : "inline-flex",
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
            <ChevronCollapse collapsed={isCollapsed} />
          </button>
        </div>

        {isCollapsed && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={t("calendar.expand")}
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
            <ChevronCollapse collapsed={isCollapsed} />
          </button>
        )}

        <nav>
          <ul style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            {NAV_ITEMS.filter((item) => {
              if (!item.minRole) return true;
              return myLevel >= (ROLE_LEVEL[item.minRole] ?? 0);
            }).map((item) => {
              const isActive =
                pathname === item.href || pathname?.startsWith(item.href + "/");
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    title={isCollapsed ? t(item.labelKey) : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: isCollapsed ? 0 : "12px",
                      justifyContent: isCollapsed ? "center" : "flex-start",
                      padding: isCollapsed ? "10px 0" : "10px 14px",
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
                    {!isCollapsed && <span>{t(item.labelKey)}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {!isCollapsed && (
          <div style={{ marginTop: "auto", padding: "0 6px", display: "flex", flexDirection: "column", gap: 10 }}>
            <OrgSwitcher />
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

/** Org switcher — shown in the sidebar footer when the user has 2+ orgs. */
function OrgSwitcher() {
  const { user, switchOrg, createOrg } = useAuth();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const orgs = user?.organizations || [];
  const currentOrgId = user?.orgId;

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  // Always reachable — even with a single org, "+ New organization" must
  // have somewhere to live. Was hidden entirely below 2 orgs, which meant
  // an agency starting with one client had no way to add a second.
  if (orgs.length === 0) return null;

  const submitCreate = async () => {
    const name = newOrgName.trim();
    if (!name || createBusy) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      await createOrg(name);
      // createOrg reloads the page on success (same as switchOrg) — no need
      // to reset local state, but guard anyway in case that ever changes.
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : t("orgSwitcher.createError"));
      setCreateBusy(false);
    }
  };

  const currentOrg = orgs.find((o) => o.id === currentOrgId);
  const initials = (currentOrg?.name || "?").slice(0, 2).toUpperCase();

  return (
    <div ref={ref} style={{ position: "relative", padding: "0 8px" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 10px",
          borderRadius: 10,
          border: "1px solid var(--line-soft)",
          background: "var(--bg)",
          color: "var(--fg)",
          cursor: "pointer",
          fontSize: 13,
          textAlign: "left",
        }}
      >
        <span
          style={{
            width: 28, height: 28, borderRadius: 8,
            background: "var(--fg)", color: "var(--bg)",
            display: "grid", placeItems: "center",
            fontSize: 11, fontWeight: 700, flexShrink: 0,
          }}
        >
          {initials}
        </span>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {currentOrg?.name || "?"}
        </span>
        <span style={{ fontSize: 10, opacity: 0.5, flexShrink: 0 }}>▼</span>
      </button>

      {open && (
        <ul
          role="listbox"
          style={{
            position: "absolute",
            bottom: "100%",
            left: 8,
            right: 8,
            margin: "0 0 4px 0",
            padding: 4,
            listStyle: "none",
            background: "var(--bg)",
            border: "1px solid var(--line-soft)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            zIndex: 50,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {orgs.map((org) => {
            const isCurrent = org.id === currentOrgId;
            return (
              <li key={org.id} role="option" aria-selected={isCurrent}>
                <button
                  type="button"
                  onClick={() => {
                    if (!isCurrent) switchOrg(org.id);
                    setOpen(false);
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 10px",
                    borderRadius: 8,
                    border: "none",
                    background: isCurrent ? "rgba(0,0,0,0.04)" : "transparent",
                    color: "var(--fg)",
                    cursor: isCurrent ? "default" : "pointer",
                    fontSize: 13,
                    textAlign: "left",
                    opacity: isCurrent ? 0.7 : 1,
                  }}
                >
                  <span
                    style={{
                      width: 24, height: 24, borderRadius: 6,
                      background: isCurrent ? "var(--fg)" : "rgba(0,0,0,0.1)",
                      color: isCurrent ? "var(--bg)" : "var(--fg)",
                      display: "grid", placeItems: "center",
                      fontSize: 10, fontWeight: 700, flexShrink: 0,
                    }}
                  >
                    {org.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {org.name}
                  </span>
                  {isCurrent && <span style={{ fontSize: 12 }}>✓</span>}
                  <span style={{ fontSize: 10, opacity: 0.5 }}>
                    {org.role === "SUPERADMIN" ? "Admin" : org.role === "ADMIN" ? "Admin" : "Member"}
                  </span>
                </button>
              </li>
            );
          })}

          <li style={{ borderTop: "1px solid var(--line-soft)", marginTop: 2, paddingTop: 4 }}>
            {creating ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 6px" }}>
                <input
                  autoFocus
                  type="text"
                  value={newOrgName}
                  onChange={(e) => setNewOrgName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void submitCreate(); }}
                  placeholder={t("orgSwitcher.namePlaceholder")}
                  style={{
                    padding: "6px 8px", borderRadius: 6,
                    border: "1px solid var(--line-soft)",
                    background: "var(--bg)", color: "var(--fg)", fontSize: 13,
                  }}
                />
                <span style={{ fontSize: 11, opacity: 0.6, lineHeight: 1.4 }}>
                  {t("orgSwitcher.newOrgHint")}
                </span>
                {createError && (
                  <span style={{ fontSize: 11, color: "#DC2626" }}>{createError}</span>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    disabled={createBusy || !newOrgName.trim()}
                    onClick={() => void submitCreate()}
                    style={{
                      flex: 1, padding: "6px 8px", borderRadius: 6, border: "none",
                      background: "var(--fg)", color: "var(--bg)", fontSize: 12,
                      fontWeight: 600, cursor: "pointer",
                      opacity: createBusy || !newOrgName.trim() ? 0.5 : 1,
                    }}
                  >
                    {createBusy ? t("orgSwitcher.creating") : t("orgSwitcher.create")}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCreating(false); setNewOrgName(""); setCreateError(null); }}
                    style={{
                      padding: "6px 8px", borderRadius: 6,
                      border: "1px solid var(--line-soft)", background: "var(--bg)",
                      color: "var(--fg)", fontSize: 12, cursor: "pointer",
                    }}
                  >
                    {t("common.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: "7px 10px", borderRadius: 8, border: "none",
                  background: "transparent", color: "var(--fg)", cursor: "pointer",
                  fontSize: 13, textAlign: "left",
                }}
              >
                <span style={{
                  width: 24, height: 24, borderRadius: 6,
                  border: "1px dashed var(--line-soft)",
                  display: "grid", placeItems: "center", fontSize: 13, flexShrink: 0,
                }}>
                  +
                </span>
                {t("orgSwitcher.newOrg")}
              </button>
            )}
          </li>
        </ul>
      )}
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
