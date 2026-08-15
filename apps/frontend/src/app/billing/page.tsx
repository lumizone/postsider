'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader, Card } from '@/components/settings-ui';
import { useAuth } from '@/lib/auth-context';
import { useT, useI18n } from '@/lib/i18n';
import {
  PLANS,
  getPlan,
  subscribe,
  openBillingPortal,
  cancelSubscription,
  getCurrentBilling,
  checkCheckout,
  type CurrentSubscription,
  type BillingPeriod,
  type TierName,
  type PlanDescriptor,
} from '@/lib/billing-api';
import { ApiError } from '@/lib/api';
import styles from './billing.module.css';

const TIER_ORDER: Record<string, number> = {
  STANDARD: 1,
  TEAM: 2,
  PRO: 3,
  ULTIMATE: 4,
  SAMURAI: 5,
};

const FAQ_KEYS: { q: string; a: string }[] = [
  { q: 'billing.faq.trust_q', a: 'billing.faq.trust_a' },
  { q: 'billing.faq.channel_q', a: 'billing.faq.channel_a' },
  { q: 'billing.faq.team_q', a: 'billing.faq.team_a' },
  { q: 'billing.faq.cancel_q', a: 'billing.faq.cancel_a' },
  { q: 'billing.faq.upgrade_q', a: 'billing.faq.upgrade_a' },
];

function Check() {
  return (
    <svg
      className={styles.featureIcon}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
    >
      <path
        d="M3.5 8.5l3 3 6-7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function BillingPage() {
  // useSearchParams (used inside BillingInner for the post-checkout ?check=
  // param) must sit under a Suspense boundary in Next 15.
  return (
    <Suspense fallback={null}>
      <BillingInner />
    </Suspense>
  );
}

function BillingInner() {
  const t = useT();
  const { locale } = useI18n();
  const { user, refresh: refreshUser } = useAuth();
  const searchParams = useSearchParams();

  // Billing is owner-only — mirrors the backend's assertOwner() in
  // billing.controller.ts and the sidebar nav's minRole: "SUPERADMIN".
  const canManage = user?.role === 'SUPERADMIN';

  const [period, setPeriod] = useState<BillingPeriod>('MONTHLY');
  const [current, setCurrent] = useState<CurrentSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyTier, setBusyTier] = useState<TierName | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);

  const [showCancel, setShowCancel] = useState(false);
  const [cancelFeedback, setCancelFeedback] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  // Status returned after coming back from a checkout.
  const checkoutId = searchParams.get('check');
  const [provisioning, setProvisioning] = useState(false);
  const [provisioningTimedOut, setProvisioningTimedOut] = useState(false);

  // Esc closes the cancel modal (mirrors the overlay click behavior).
  useEffect(() => {
    if (!showCancel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !cancelBusy) setShowCancel(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showCancel, cancelBusy]);

  // Display copy for a plan card comes from the i18n catalog; the descriptor
  // only carries the structural limits.
  const planLabel = (name: string) => {
    const key = `billing.plans.${name}.label`;
    const label = t(key as Parameters<typeof t>[0]);
    // t() echoes the key back when a tier is missing from the catalog
    // (e.g. added server-side first) — fall back to the raw tier name.
    return label === key ? name : label;
  };
  const planTagline = (name: string) => {
    const key = `billing.plans.${name}.tagline`;
    const tagline = t(key as Parameters<typeof t>[0]);
    return tagline === key ? '' : tagline;
  };
  const planFeatures = (plan: PlanDescriptor): string[] =>
    [
      t('billing.features.channels', { count: plan.channels }),
      plan.postsPerMonth === 'unlimited'
        ? t('billing.features.unlimitedPosts')
        : t('billing.features.posts', { count: plan.postsPerMonth }),
      ...(plan.teamMembers ? [t('billing.features.teamMembers')] : []),
      t('billing.features.multiPlatform'),
      t('billing.features.calendar'),
      t('billing.features.analytics'),
      // AI usage is billed as simple per-action credits rather than provider
      // input/output tokens, so plans stay understandable to customers.
      plan.name === 'STANDARD'
        ? t('billing.features.aiUses', { count: 50 })
        : plan.name === 'TEAM'
        ? t('billing.features.aiUses', { count: 150 })
        : plan.name === 'PRO'
        ? t('billing.features.aiUses', { count: 500 })
        : plan.name === 'ULTIMATE'
        ? t('billing.features.aiUses', { count: 1000 })
        : null,
      t('billing.features.approvals'),
    ].filter((feature): feature is string => !!feature);

  const loadBilling = useCallback(async () => {
    try {
      const res = await getCurrentBilling();
      setCurrent(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setCurrent(null);
      } else {
        setError(err instanceof Error ? err.message : 'Could not load billing');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  // After returning from checkout, poll until the subscription is provisioned.
  useEffect(() => {
    if (!checkoutId) return;
    let cancelled = false;
    let attempts = 0;
    setProvisioning(true);
    setProvisioningTimedOut(false);

    const poll = async () => {
      attempts += 1;
      try {
        const status = await checkCheckout(checkoutId);
        if (status === 2) {
          if (cancelled) return;
          setProvisioning(false);
          await Promise.all([loadBilling(), refreshUser()]);
          return;
        }
      } catch {
        // ignore and keep polling
      }
      if (!cancelled && attempts < 15) {
        setTimeout(poll, 2000);
      } else if (!cancelled) {
        setProvisioning(false);
        setProvisioningTimedOut(true);
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [checkoutId, loadBilling, refreshUser]);

  const currentTier = current?.subscriptionTier || null;
  const currentPlan = getPlan(currentTier);
  const isTrial = current?.identifier === 'trial';
  const hasPaidPlan = !!current && !isTrial;
  const currentLevel =
    hasPaidPlan && currentTier ? TIER_ORDER[currentTier] ?? 0 : 0;
  // SAMURAI is an internal owner plan: full access, no payment, no Polar
  // subscription to manage or cancel.
  const isInternalPlan = currentTier === 'SAMURAI';
  const trialDaysLeft = user?.onTrial ? user.trialDaysLeft ?? 0 : 0;
  const trialStatus =
    trialDaysLeft <= 0
      ? t('trial.endsToday')
      : trialDaysLeft === 1
      ? t('trial.oneDayLeft')
      : t('trial.daysLeft', { days: trialDaysLeft });

  const onSelectPlan = async (tier: TierName) => {
    if (busyTier) return;
    setBusyTier(tier);
    setError(null);
    try {
      const res = await subscribe(tier, period);
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      if (res.portal) {
        window.location.href = res.portal;
        return;
      }
      // In-place change (no redirect) — refresh state.
      await Promise.all([loadBilling(), refreshUser()]);
      setBusyTier(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout');
      setBusyTier(null);
    }
  };

  const onOpenPortal = async () => {
    if (portalBusy) return;
    setPortalBusy(true);
    setError(null);
    try {
      const url = await openBillingPortal();
      if (url) {
        window.location.href = url;
        return;
      }
      setError(t('billing.portalUnavailable'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open portal');
    } finally {
      setPortalBusy(false);
    }
  };

  const onConfirmCancel = async () => {
    setCancelBusy(true);
    setError(null);
    try {
      await cancelSubscription(cancelFeedback.trim());
      setShowCancel(false);
      setCancelFeedback('');
      await Promise.all([loadBilling(), refreshUser()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel');
    } finally {
      setCancelBusy(false);
    }
  };

  if (!canManage) {
    return (
      <PageHeader
        eyebrow={t('billing.eyebrow')}
        title={t('billing.title')}
        subtitle={t('billing.noPermission')}
      />
    );
  }

  return (
    <div className={styles.wrap}>
      <PageHeader
        eyebrow={t('billing.eyebrow')}
        title={t('billing.title')}
        subtitle={t('billing.subtitle')}
      />
      {error && (
        <div role="alert" className={`${styles.banner} ${styles.bannerError}`}>
          {error}
        </div>
      )}

      {provisioning && (
        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          {t('billing.finalizing')}
        </div>
      )}
      {provisioningTimedOut && (
        <div role="alert" className={`${styles.banner} ${styles.bannerWarn}`}>
          {t('billing.stillFinalizing')}{' '}
          <button type="button" onClick={() => window.location.reload()}>
            {t('calendar.retry')}
          </button>
        </div>
      )}

      {current?.cancelAt && !isTrial && (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          {t('billing.cancelAt', {
            date: new Date(current.cancelAt).toLocaleDateString(locale, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
          })}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <Card title="">
          <div
            style={{
              padding: '20px 0',
              textAlign: 'center',
              color: 'var(--muted)',
              fontSize: 13,
            }}
          >
            {t('common.loading')}
          </div>
        </Card>
      ) : (
        <>
          {/* Current plan header — only when subscribed */}
          {current && (
            <Card title="">
              <div className={styles.current}>
                <div className={styles.currentMain}>
                  <span className={styles.currentBadge} aria-hidden>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M12 2.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16l-5.2 2.6 1-5.8L3.5 8.7l5.9-.9L12 2.5Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <div className={styles.currentText}>
                    <span className={styles.currentTier}>
                      {isTrial
                        ? t('onboarding.trialBadge', { days: trialDaysLeft })
                        : t('billing.currentPlanOn', {
                            plan: planLabel(current.subscriptionTier),
                          })}
                    </span>
                    <span className={styles.currentMeta}>
                      {isTrial
                        ? trialStatus
                        : isInternalPlan
                        ? t('billing.internalPlan')
                        : `${
                            current.period === 'YEARLY'
                              ? t('billing.billedYearly', {
                                  price: String(currentPlan?.yearlyPrice ?? ''),
                                })
                              : t('billing.billedMonthly')
                          }${
                            current.isLifetime
                              ? ' · ' + t('billing.lifetime')
                              : ''
                          }`}
                    </span>
                  </div>
                </div>
                {!isInternalPlan && !isTrial && (
                  <div className={styles.currentActions}>
                    <button
                      type="button"
                      onClick={onOpenPortal}
                      disabled={portalBusy}
                      className={styles.planBtn + ' ' + styles.planBtnSecondary}
                      style={{ padding: '0 16px' }}
                    >
                      {portalBusy ? t('billing.opening') : t('billing.manage')}
                    </button>
                    {!current.cancelAt && (
                      <button
                        type="button"
                        onClick={() => setShowCancel(true)}
                        className={
                          styles.planBtn + ' ' + styles.planBtnSecondary
                        }
                        style={{ padding: '0 16px' }}
                      >
                        {t('billing.cancelPlan')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Plan picker — hidden for the internal SAMURAI plan */}
          {!isInternalPlan && (
            <Card
              title={
                hasPaidPlan
                  ? t('billing.availablePlans')
                  : t('billing.choosePlan')
              }
              subtitle={
                hasPaidPlan
                  ? t('billing.switchHint')
                  : t('billing.pickPlanHint')
              }
              actions={
                <div className={styles.periodRow}>
                  <PeriodToggle period={period} onChange={setPeriod} />
                </div>
              }
            >
              <div className={styles.plans}>
                {PLANS.map((plan) => {
                  const isCurrent =
                    !isTrial &&
                    current?.subscriptionTier === plan.name &&
                    current?.period === period;
                  const planLevel = TIER_ORDER[plan.name] ?? 0;
                  const isUpgrade = planLevel > currentLevel;
                  // Monthly: show the monthly price. Yearly: show the per-month
                  // equivalent as the main price, total yearly below.
                  const displayPrice =
                    period === 'MONTHLY'
                      ? plan.monthlyPrice
                      : Math.round(plan.yearlyPrice / 12);

                  return (
                    <div
                      key={plan.name}
                      className={
                        styles.plan +
                        (isCurrent ? ' ' + styles.planCurrent : '') +
                        (plan.popular ? ' ' + styles.planPopular : '')
                      }
                    >
                      {plan.popular && (
                        <span className={styles.popularBadge}>
                          {t('billing.popular')}
                        </span>
                      )}
                      <div className={styles.planHead}>
                        <span className={styles.planName}>
                          {planLabel(plan.name)}
                        </span>
                        <span className={styles.planTagline}>
                          {planTagline(plan.name)}
                        </span>
                      </div>

                      <div>
                        <div className={styles.priceRow}>
                          <span className={styles.price}>${displayPrice}</span>
                          <span className={styles.priceUnit}>
                            {t('billing.perMonth')}
                          </span>
                        </div>
                        <div className={styles.yearNote}>
                          {period === 'YEARLY'
                            ? t('billing.billedYearly', {
                                price: String(plan.yearlyPrice),
                              })
                            : ''}
                        </div>
                      </div>

                      <div className={styles.priceDivider} />

                      <ul className={styles.featureList}>
                        {planFeatures(plan).map((f) => (
                          <li key={f} className={styles.feature}>
                            <Check />
                            {f}
                          </li>
                        ))}
                      </ul>

                      <button
                        type="button"
                        disabled={isCurrent || busyTier !== null}
                        onClick={() => onSelectPlan(plan.name)}
                        className={
                          styles.planBtn +
                          (isCurrent
                            ? ' ' + styles.planBtnCurrent
                            : !isUpgrade
                            ? ' ' + styles.planBtnSecondary
                            : '')
                        }
                      >
                        {isCurrent
                          ? t('billing.currentPlan')
                          : busyTier === plan.name
                          ? t('billing.starting')
                          : hasPaidPlan
                          ? isUpgrade
                            ? t('common.upgrade')
                            : t('billing.switch')
                          : t('billing.choosePlan')}
                      </button>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* FAQ — each item is its own card */}
          {FAQ_KEYS.map((item, i) => {
            const open = openFaq === i;
            return (
              <div key={i} className={styles.faqCard}>
                <button
                  type="button"
                  className={styles.faqQuestion}
                  onClick={() => setOpenFaq(open ? null : i)}
                  aria-expanded={open}
                >
                  {t(item.q as any)}
                  <svg
                    className={
                      styles.faqIcon + (open ? ' ' + styles.faqIconOpen : '')
                    }
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="M4 6l4 4 4-4"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <div
                  className={
                    styles.faqAnswer + (open ? ' ' + styles.faqAnswerOpen : '')
                  }
                >
                  {t(item.a as any)}
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Cancel modal */}
      {showCancel && (
        <div
          className={styles.modalOverlay}
          onClick={() => !cancelBusy && setShowCancel(false)}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-label={t('billing.cancelTitle')}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className={styles.modalTitle}>{t('billing.cancelTitle')}</h2>
            <p className={styles.modalText}>{t('billing.cancelBody')}</p>
            <textarea
              className={styles.textarea}
              value={cancelFeedback}
              onChange={(e) => setCancelFeedback(e.target.value)}
              placeholder={t('billing.cancelPlaceholder')}
            />
            <div className={styles.modalActions}>
              <button
                type="button"
                onClick={() => setShowCancel(false)}
                disabled={cancelBusy}
                className={styles.planBtn + ' ' + styles.planBtnSecondary}
                style={{ padding: '0 18px' }}
              >
                {t('billing.keepPlan')}
              </button>
              <button
                type="button"
                onClick={onConfirmCancel}
                disabled={cancelBusy}
                className={styles.planBtn}
                style={{
                  padding: '0 18px',
                  background: '#dc2626',
                  borderColor: '#dc2626',
                  color: '#fff',
                }}
              >
                {cancelBusy
                  ? t('billing.cancelling')
                  : t('billing.cancelSubscription')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PeriodToggle({
  period,
  onChange,
}: {
  period: BillingPeriod;
  onChange: (p: BillingPeriod) => void;
}) {
  const t = useT();
  return (
    <div className={styles.periodToggle}>
      {(['MONTHLY', 'YEARLY'] as BillingPeriod[]).map((p) => {
        const active = period === p;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={
              styles.periodBtn + (active ? ' ' + styles.periodBtnActive : '')
            }
          >
            {p === 'MONTHLY' ? t('billing.monthly') : t('billing.yearly')}
            {p === 'YEARLY' && (
              <span className={styles.saveBadge}>
                {t('billing.twoMonFree')}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
