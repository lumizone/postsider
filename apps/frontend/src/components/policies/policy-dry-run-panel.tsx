"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Card, settingsStyles as s } from "@/components/settings-ui";
import { ApiError } from "@/lib/api";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  evaluatePolicy,
  type EvaluateAsActor,
  type EvaluateBody,
  type EvaluateResult,
  type PolicyApiKeyChoice,
} from "@/lib/policies-api";
import type { PolicyChannelChoice } from "./policy-rule-form";
import styles from "./policies.module.css";

type AsKind = "me" | "apiKey" | "oauth" | "system";
type PostType = "draft" | "schedule" | "now";

interface Props {
  channels: PolicyChannelChoice[];
  apiKeys: PolicyApiKeyChoice[];
}

function asActor(kind: AsKind, apiKeyId: string): EvaluateAsActor | undefined {
  if (kind === "apiKey") return apiKeyId ? { type: "API_KEY", apiKeyId } : { type: "API_KEY" };
  if (kind === "oauth") return { type: "OAUTH_CLIENT" };
  if (kind === "system") return { type: "SYSTEM" };
  return undefined;
}

export function effectLabelKey(effect: "ALLOW" | "REQUIRE_APPROVAL" | "BLOCK"): MessageKey {
  if (effect === "BLOCK") return "policies.result.block";
  if (effect === "REQUIRE_APPROVAL") return "policies.result.requireApproval";
  return "policies.result.allow";
}

export function PolicyDryRunPanel({ channels, apiKeys }: Props) {
  const t = useT();
  const uid = useId();
  const [integrationId, setIntegrationId] = useState("");
  const [type, setType] = useState<PostType>("draft");
  const [date, setDate] = useState("");
  const [text, setText] = useState("");
  const [image, setImage] = useState(false);
  const [video, setVideo] = useState(false);
  const [as, setAs] = useState<AsKind>("me");
  const [apiKeyId, setApiKeyId] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EvaluateResult | null>(null);
  const seq = useRef(0);

  // Default to the first channel once the list arrives.
  const effectiveChannel = integrationId || channels[0]?.id || "";

  useEffect(() => () => void (seq.current += 1), []);

  const channelName = (id: string) => channels.find((c) => c.id === id)?.name ?? id;

  const run = async () => {
    if (running || !effectiveChannel) return;
    setError(null);
    let iso: string | undefined;
    if (type === "schedule") {
      const parsed = date ? new Date(date) : null;
      if (!parsed || Number.isNaN(parsed.getTime())) {
        setError(t("policies.test.dateRequired"));
        return;
      }
      iso = parsed.toISOString();
    }
    const images = [
      ...(image ? [{ path: "sample.png" }] : []),
      ...(video ? [{ path: "sample.mp4" }] : []),
    ];
    const actor = asActor(as, apiKeyId);
    const body: EvaluateBody = {
      type,
      ...(iso ? { date: iso } : {}),
      posts: [
        {
          integration: { id: effectiveChannel },
          value: [{ content: text, ...(images.length ? { image: images } : {}) }],
        },
      ],
      ...(actor ? { asActor: actor } : {}),
    };
    const mine = ++seq.current;
    setRunning(true);
    try {
      const res = await evaluatePolicy(body);
      if (mine !== seq.current) return;
      setResult(res);
    } catch (err) {
      if (mine !== seq.current) return;
      setResult(null);
      setError(
        err instanceof ApiError && err.status === 403
          ? t("policies.forbidden")
          : err instanceof Error && err.message
            ? err.message
            : t("policies.test.error")
      );
    } finally {
      if (mine === seq.current) setRunning(false);
    }
  };

  const keyMessage = (code?: string): string => {
    if (code === "key_action_not_allowed") return t("policies.test.keyCode.key_action_not_allowed");
    if (code === "key_channel_not_allowed") return t("policies.test.keyCode.key_channel_not_allowed");
    return t("policies.test.keyBlocked");
  };

  const chipClass = (effect: string) =>
    styles.chip +
    (effect === "BLOCK" ? " " + styles.chipFilled : effect === "ALLOW" ? " " + styles.chipDashed : "");

  return (
    <Card title={t("policies.test.title")} subtitle={t("policies.test.subtitle")}>
      {channels.length === 0 ? (
        <div className={s.hint}>{t("policies.test.noChannels")}</div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className={styles.testGrid}>
            <div className={s.field}>
              <label className={s.label} htmlFor={`${uid}-channel`}>
                {t("policies.test.channel")}
              </label>
              <select
                id={`${uid}-channel`}
                className={s.select}
                value={effectiveChannel}
                onChange={(e) => setIntegrationId(e.target.value)}
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={s.field}>
              <label className={s.label} htmlFor={`${uid}-type`}>
                {t("policies.test.type")}
              </label>
              <select
                id={`${uid}-type`}
                className={s.select}
                value={type}
                onChange={(e) => setType(e.target.value as PostType)}
              >
                <option value="draft">{t("policies.test.typeDraft")}</option>
                <option value="schedule">{t("policies.test.typeSchedule")}</option>
                <option value="now">{t("policies.test.typeNow")}</option>
              </select>
            </div>

            {type === "schedule" && (
              <div className={`${s.field} ${styles.span2}`}>
                <label className={s.label} htmlFor={`${uid}-date`}>
                  {t("policies.test.date")}
                </label>
                <input
                  id={`${uid}-date`}
                  type="datetime-local"
                  className={s.input}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            )}

            <div className={`${s.field} ${styles.span2}`}>
              <label className={s.label} htmlFor={`${uid}-text`}>
                {t("policies.test.text")}
              </label>
              <textarea
                id={`${uid}-text`}
                className={s.textarea}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
              />
            </div>

            <div className={`${styles.checks} ${styles.span2}`}>
              <label className={styles.check}>
                <input type="checkbox" checked={image} onChange={(e) => setImage(e.target.checked)} />
                {t("policies.test.image")}
              </label>
              <label className={styles.check}>
                <input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} />
                {t("policies.test.video")}
              </label>
            </div>

            <div className={s.field}>
              <label className={s.label} htmlFor={`${uid}-as`}>
                {t("policies.test.asLabel")}
              </label>
              <select
                id={`${uid}-as`}
                className={s.select}
                value={as}
                onChange={(e) => setAs(e.target.value as AsKind)}
              >
                <option value="me">{t("policies.test.as.me")}</option>
                <option value="apiKey">{t("policies.test.as.apiKey")}</option>
                <option value="oauth">{t("policies.test.as.oauth")}</option>
                <option value="system">{t("policies.test.as.system")}</option>
              </select>
            </div>

            {as === "apiKey" && (
              <div className={s.field}>
                <label className={s.label} htmlFor={`${uid}-key`}>
                  {t("policies.test.apiKey")}
                </label>
                <select
                  id={`${uid}-key`}
                  className={s.select}
                  value={apiKeyId}
                  onChange={(e) => setApiKeyId(e.target.value)}
                >
                  <option value="">{t("policies.test.anyKey")}</option>
                  {apiKeys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {error && (
            <div role="alert" className={styles.banner} style={{ marginTop: 14, marginBottom: 0 }}>
              {error}
            </div>
          )}

          <div className={styles.footer} style={{ marginTop: 14 }}>
            <button type="submit" className={s.btnPrimary} disabled={running || !effectiveChannel}>
              {running ? t("policies.test.running") : t("policies.test.run")}
            </button>
          </div>
        </form>
      )}

      {result && (
        <div className={styles.result} role="status" aria-live="polite">
          <div className={styles.resultHead}>
            <span>{t("policies.test.resultTitle")}</span>
            <span className={chipClass(result.effect)}>{t(effectLabelKey(result.effect))}</span>
          </div>

          <div>
            <div className={styles.sectionLabel}>{t("policies.test.matched")}</div>
            {result.matched.length === 0 ? (
              <div className={styles.small}>{t("policies.test.noMatched")}</div>
            ) : (
              <ul className={styles.matchList}>
                {result.matched.map((m) => (
                  <li key={m.ruleId} className={styles.matchItem}>
                    <span>{m.name}</span>
                    <span className={chipClass(m.effect)}>{t(`policies.effect.${m.effect}` as MessageKey)}</span>
                    <span className={styles.small}>{t(`policies.condition.${m.condition}` as MessageKey)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {result.channels.length > 0 && (
            <div>
              <div className={styles.sectionLabel}>{t("policies.test.perChannel")}</div>
              <ul className={styles.matchList}>
                {result.channels.map((c) => (
                  <li key={c.integrationId} className={styles.matchItem}>
                    <span>{channelName(c.integrationId)}</span>
                    <span className={chipClass(c.effect)}>{t(effectLabelKey(c.effect))}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.key && result.key.allowed === false && (
            <div className={styles.fieldError} role="alert">
              {keyMessage(result.key.code)}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
