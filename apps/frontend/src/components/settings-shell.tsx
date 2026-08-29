"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import styles from "./settings-shell.module.css";

interface NavEntry {
  href: string;
  labelKey: string;
  /** Minimum role required to see this link. Default: everyone. */
  minRole?: "ADMIN" | "SUPERADMIN";
  /** If true, this item is hidden in SaaS mode (managed infrastructure). */
  selfHostedOnly?: boolean;
  /**
   * If true, this item is only shown when the platform AI key is absent
   * (i.e. self-host BYO-key mode). Hidden when isPlatformAi is true.
   */
  byoAiOnly?: boolean;
}

const NAV_ITEMS: NavEntry[] = [
  { href: "/settings/general", labelKey: "settings.general" },
  { href: "/settings/ai-usage", labelKey: "settings.aiUsage" },
  { href: "/settings/organization", labelKey: "settings.organization", minRole: "ADMIN" },
  { href: "/settings/users", labelKey: "settings.users", minRole: "ADMIN" },
  { href: "/settings/security", labelKey: "settings.security" },
  { href: "/settings/storage", labelKey: "settings.storage", minRole: "ADMIN" },
  { href: "/settings/api", labelKey: "settings.api", minRole: "ADMIN" },
  { href: "/settings/webhooks", labelKey: "settings.webhooks", minRole: "ADMIN" },
{ href: "/settings/evergreen", labelKey: "settings.evergreen", minRole: "ADMIN" },
  { href: "/settings/queue-plan", labelKey: "settings.queuePlan", minRole: "ADMIN" },
  { href: "/settings/hashtag-groups", labelKey: "settings.hashtagGroups", minRole: "ADMIN" },
  { href: "/settings/caption-templates", labelKey: "settings.captionTemplates", minRole: "ADMIN" },
  { href: "/settings/utm-builder", labelKey: "settings.utmBuilder", minRole: "ADMIN" },
];

const ROLE_LEVEL: Record<string, number> = {
  USER: 0,
  ADMIN: 1,
  SUPERADMIN: 2,
};

export function SettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const t = useT();
  const myLevel = ROLE_LEVEL[user?.role ?? "USER"] ?? 0;

  const visibleItems = NAV_ITEMS.filter((item) => {
    // Hide self-hosted-only pages in SaaS mode.
    // SaaS mode = NEXT_PUBLIC_SELF_HOSTED !== 'true' (matches settings.controller.ts
    // backend check — was `!process.env.X`, which treats ANY set string, including
    // the literal "false", as truthy self-hosted mode).
    const isSaaS = process.env.NEXT_PUBLIC_SELF_HOSTED !== "true";
    if (isSaaS && item.selfHostedOnly) return false;
    // Hide BYO-AI pages when the platform AI key is present.
    if (item.byoAiOnly && user?.isPlatformAi) return false;
    if (!item.minRole) return true;
    return myLevel >= (ROLE_LEVEL[item.minRole] ?? 0);
  });

  return (
    <div className={styles.shell}>
      <aside className={styles.subnav}>
        <span className={styles.subnavTitle}>{t("settings.title")}</span>
        <nav className={styles.subnavList}>
          {visibleItems.map((item) => {
            const active =
              pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  styles.subnavLink +
                  (active ? " " + styles.subnavLinkActive : "")
                }
              >
                {t(item.labelKey as any)}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className={styles.content}>
        {children}
      </main>
    </div>
  );
}
