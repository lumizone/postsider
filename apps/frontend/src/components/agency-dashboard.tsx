"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth-context";
import { downloadCsv, rowsToCsv } from "@/lib/csv-export";
import {
  getAgencyOverview,
  getCustomerReport,
  downloadReportPdf,
  type AgencyOverview,
  type CustomerReport,
} from "@/lib/agency-api";
import styles from "./agency-dashboard.module.css";

const ranges = [7, 30, 90];

function number(value: number) {
  return new Intl.NumberFormat().format(value);
}

export function AgencyDashboard() {
  const t = useT();
  const { user } = useAuth();
  const agencyMode = !!user?.agencyMode;
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<AgencyOverview | null>(null);
  const [report, setReport] = useState<CustomerReport | null>(null);
  const [customerId, setCustomerId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agencyMode) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAgencyOverview(days)
      .then((data) => {
        if (cancelled) return;
        setOverview(data);
        // A payload without `clients` would otherwise throw here and replace
        // the whole page with a raw "Cannot read properties of undefined".
        const firstCustomer = data.clients?.find((client) => client.id)?.id ?? "";
        setCustomerId((current) => current || firstCustomer);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("agency.loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [agencyMode, days, t]);

  useEffect(() => {
    if (!customerId) {
      setReport(null);
      return;
    }
    let cancelled = false;
    setReportLoading(true);
    getCustomerReport(customerId, days)
      .then((data) => { if (!cancelled) setReport(data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : t("agency.reportError")); })
      .finally(() => { if (!cancelled) setReportLoading(false); });
    return () => { cancelled = true; };
  }, [customerId, days, t]);

  const summary = overview?.summary;
  const exportReport = () => {
    if (!report) return;
    downloadCsv(
      `${report.customer.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "customer"}-report.csv`,
      rowsToCsv(
        ["Metric", "Value"],
        Object.entries(report.summary).map(([key, value]) => [key, value]),
      ),
    );
  };

  const exportPdf = async () => {
    if (!report || pdfBusy) return;
    setPdfBusy(true);
    setError(null);
    try {
      const filename = `${report.customer.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "customer"}-report.pdf`;
      await downloadReportPdf(customerId, days, filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("agency.reportError"));
    } finally {
      setPdfBusy(false);
    }
  };

  const clientFlags = (client: AgencyOverview["clients"][number]) => {
    const flags: string[] = [];
    if (client.stuckPosts > 0) flags.push(t("agency.stuckFlag", { count: client.stuckPosts }));
    if (client.errors > 0) flags.push(t("agency.errorFlag", { count: client.errors }));
    if (client.tokenIssues > 0) flags.push(t("agency.tokenFlag", { count: client.tokenIssues }));
    return flags;
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t("agency.eyebrow")}</p>
          <h1>{t("agency.title")}</h1>
          <p className={styles.subtitle}>{t("agency.subtitle")}</p>
        </div>
        {agencyMode && (
          <div className={styles.controls}>
            <label htmlFor="agency-range">{t("agency.window")}</label>
            <select id="agency-range" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {ranges.map((range) => <option key={range} value={range}>{t("agency.days", { days: range })}</option>)}
            </select>
          </div>
        )}
      </header>

      {!agencyMode ? (
        <div className={styles.notice} role="status">
          {t("agency.disabledTitle")}{" "}
          <Link href="/settings/organization" style={{ color: "var(--fg)", fontWeight: 600 }}>
            {t("agency.disabledLink")}
          </Link>
          .
        </div>
      ) : error ? (
        <div className={styles.error} role="alert">{error}</div>
      ) : loading ? (
        <p className={styles.muted}>{t("common.loading")}</p>
      ) : overview && (
        <>
          <section className={styles.metrics} aria-label={t("agency.summary")}>
            {[
              [t("agency.clients"), summary?.clients],
              [t("agency.channels"), summary?.activeChannels, summary?.channels],
              [t("agency.queued"), summary?.queued],
              [t("agency.published"), summary?.published],
              [t("agency.approvals"), summary?.pendingApprovals],
              [t("agency.stuck"), summary?.stuckPosts],
              [t("agency.tokenIssues"), summary?.tokenIssues],
              [t("agency.errors"), summary?.recentErrors],
            ].map(([label, value, total]) => (
              <div className={styles.metric} key={String(label)}>
                <span>{label}</span>
                <strong>{number(Number(value ?? 0))}</strong>
                {total !== undefined && <small>{t("agency.activeOfTotal", { active: Number(value), total: Number(total) })}</small>}
              </div>
            ))}
          </section>

          <section className={styles.grid}>
            <div className={styles.card}>
              <div className={styles.cardHeader}><div><p className={styles.eyebrow}>{t("agency.clientsEyebrow")}</p><h2>{t("agency.clientRollup")}</h2></div></div>
              {overview.clients.length === 0 ? <p className={styles.muted}>{t("agency.noClients")}</p> : (
                <div className={styles.clientList}>
                  {overview.clients.map((client) => {
                    const flags = clientFlags(client);
                    return (
                      <button key={client.id ?? client.name} className={`${styles.client} ${client.id === customerId ? styles.selected : ""}`} onClick={() => client.id && setCustomerId(client.id)} disabled={!client.id}>
                        <span><strong>{client.name}</strong><small>{t("agency.channelCount", { count: client.channels })}</small></span>
                        <span className={styles.clientStatus}>
                          <span className={flags.length > 0 ? styles.warn : undefined}>
                            {flags.length > 0 ? flags.join(" · ") : `${client.activeChannels}/${client.channels}`}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div><p className={styles.eyebrow}>{t("agency.reportEyebrow")}</p><h2>{report?.customer.name ?? t("agency.selectClient")}</h2></div>
                <button className={styles.secondary} onClick={exportPdf} disabled={!report || reportLoading || pdfBusy}>{t("agency.downloadPdf")}</button>
                <button className={styles.secondary} onClick={exportReport} disabled={!report || reportLoading}>{t("agency.export")}</button>
              </div>
              {reportLoading ? <p className={styles.muted}>{t("common.loading")}</p> : report ? (
                <>
                  <div className={styles.reportStats}>
                    {[[t("agency.channels"), report.summary.channels], [t("agency.queued"), report.summary.queued], [t("agency.published"), report.summary.published], [t("agency.approvals"), report.summary.pendingApprovals]].map(([label, value]) => <div key={String(label)}><strong>{number(Number(value))}</strong><span>{label}</span></div>)}
                  </div>
                  <ul className={styles.channelList}>{report.channels.map((channel) => <li key={channel.id}><span>{channel.name}<small>{channel.providerIdentifier}</small></span><span className={channel.disabled ? styles.disabled : styles.active}>{channel.disabled ? t("agency.disabled") : t("agency.active")}</span></li>)}</ul>
                </>
              ) : <p className={styles.muted}>{t("agency.selectClientHint")}</p>}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
