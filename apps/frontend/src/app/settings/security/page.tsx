'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  PageHeader,
  Card,
  StatusChip,
  settingsStyles as s,
} from '@/components/settings-ui';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/i18n';
import { disconnectAllChannels, deleteAccount } from '@/lib/danger-api';
import { api, ApiError, setAuthToken, setOrgId } from '@/lib/api';
import {
  downloadRecoveryCodes,
  printRecoveryCodes,
} from '@/lib/mfa-recovery-export';

export default function SecuritySettingsPage() {
  const t = useT();
  const { user } = useAuth();
  const canManage = user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';

  return (
    <>
      <PageHeader
        eyebrow={t('settings.eyebrow')}
        title={t('security.title')}
        subtitle={
          canManage ? t('security.subtitleFull') : t('security.subtitle')
        }
      />
      <PasswordCard />
      <MfaCard />
      {user?.admin && <SuperAdminMfaPolicy />}
      {canManage && <DangerZone />}
    </>
  );
}

function PasswordCard() {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setMsg(null);
    setErr(null);
    if (next !== confirm) {
      setErr(t('security.noMatch'));
      return;
    }
    if (next.length < 3) {
      setErr(t('security.minLength'));
      return;
    }
    setSaving(true);
    try {
      const { changePassword } = await import('@/lib/password-api');
      await changePassword(current, next);
      setMsg(t('security.passwordChanged'));
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (e: any) {
      setErr(e?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={t('security.passwordTitle')}
      subtitle={t('security.passwordSubtitle')}
    >
      <div className={s.fieldGrid}>
        <div className={s.field}>
          <label className={s.label} htmlFor="pwd-current">
            {t('security.currentPassword')}
          </label>
          <input
            id="pwd-current"
            type="password"
            className={s.input}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="pwd-new">
            {t('security.newPassword')}
          </label>
          <input
            id="pwd-new"
            type="password"
            className={s.input}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={3}
          />
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="pwd-confirm">
            {t('security.confirmPassword')}
          </label>
          <input
            id="pwd-confirm"
            type="password"
            className={s.input}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={3}
          />
        </div>
      </div>
      {err && (
        <div
          role="alert"
          style={{ marginTop: 8, fontSize: 13, color: 'var(--danger)' }}
        >
          {err}
        </div>
      )}
      {msg && (
        <div
          role="status"
          style={{ marginTop: 8, fontSize: 13, color: 'var(--success)' }}
        >
          {msg}
        </div>
      )}
      <div className={s.cardActions}>
        <button
          type="button"
          className={s.btnPrimary}
          onClick={onSubmit}
          disabled={saving}
        >
          {saving ? t('security.changing') : t('security.changePassword')}
        </button>
      </div>
    </Card>
  );
}

type DangerAction = 'channels' | 'account' | null;

function DangerZone() {
  const t = useT();
  const router = useRouter();
  const [action, setAction] = useState<DangerAction>(null);

  return (
    <>
      <section
        style={{
          borderRadius: 'var(--radius-lg)',
          border:
            '1px solid color-mix(in srgb, var(--danger) 45%, transparent)',
          background: 'var(--danger-soft)',
          padding: '22px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--danger-bright)',
          }}
        >
          {t('security.dangerZone')}
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
          {t('security.dangerSubtitle')}
        </div>

        <DangerRow
          title={t('security.disconnectTitle')}
          description={t('security.disconnectDesc')}
          buttonLabel={t('security.disconnectBtn')}
          onClick={() => setAction('channels')}
        />
        <div
          style={{
            height: 1,
            background: 'color-mix(in srgb, var(--danger) 24%, transparent)',
            margin: '4px 0',
          }}
        />
        <DangerRow
          title={t('security.deleteTitle')}
          description={t('security.deleteDesc')}
          buttonLabel={t('security.deleteBtn')}
          onClick={() => setAction('account')}
        />
      </section>

      {action === 'channels' && (
        <DangerModal
          title={t('security.disconnectConfirmTitle')}
          body={t('security.disconnectConfirmBody')}
          confirmWord="DISCONNECT"
          confirmLabel={t('security.disconnectBtn')}
          onClose={() => setAction(null)}
          onConfirm={async () => {
            await disconnectAllChannels();
            setAction(null);
            window.location.reload();
          }}
        />
      )}

      {action === 'account' && (
        <DangerModal
          title={t('security.deleteConfirmTitle')}
          body={t('security.deleteConfirmBody')}
          confirmWord="DELETE"
          confirmLabel={t('security.deleteBtn')}
          onClose={() => setAction(null)}
          onConfirm={async () => {
            await deleteAccount();
            setAuthToken(null);
            setOrgId(null);
            router.replace('/login');
          }}
        />
      )}
    </>
  );
}

function DangerRow({
  title,
  description,
  buttonLabel,
  onClick,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  onClick: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '10px 0',
        flexWrap: 'wrap',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          minWidth: 0,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {description}
        </span>
      </div>
      <button
        type="button"
        onClick={onClick}
        style={{
          height: 36,
          padding: '0 16px',
          borderRadius: 'var(--radius-pill)',
          border:
            '1px solid color-mix(in srgb, var(--danger) 55%, transparent)',
          background: 'var(--bg)',
          color: 'var(--danger-bright)',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          transition: 'background 140ms var(--ease), color 140ms var(--ease)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--danger-bright)';
          e.currentTarget.style.color = 'var(--on-fg)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--bg)';
          e.currentTarget.style.color = 'var(--danger-bright)';
        }}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

function DangerModal({
  title,
  body,
  confirmWord,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmWord: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const t = useT();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = typed.trim().toUpperCase() === confirmWord;

  // Close on Escape (unless a destructive call is in flight).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const run = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
    } catch (e: any) {
      setErr(e?.message || 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--scrim)',
        backdropFilter: 'blur(4px)',
        padding: 16,
      }}
      onClick={() => !busy && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'var(--bg)',
          borderRadius: 16,
          padding: '26px 24px 22px',
          boxShadow:
            '0 24px 64px rgb(var(--shadow) / calc(0.18 * var(--shadow-boost)))',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              margin: 0,
              color: 'var(--danger-bright)',
            }}
          >
            {title}
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: 'var(--muted)',
              lineHeight: 1.5,
            }}
          >
            {body}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>
            {t('security.typeToConfirm', { word: confirmWord })}
          </label>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--line-soft)',
              fontSize: 14,
              background: 'var(--bg)',
              color: 'var(--fg)',
            }}
          />
        </div>

        {err && (
          <div role="alert" style={{ fontSize: 13, color: 'var(--danger)' }}>
            {err}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              padding: '10px 18px',
              borderRadius: 10,
              border: '1px solid var(--line-soft)',
              background: 'var(--bg)',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={run}
            disabled={!ready || busy}
            style={{
              padding: '10px 18px',
              borderRadius: 10,
              border: 'none',
              background: ready
                ? 'var(--danger-bright)'
                : 'rgb(var(--tint) / 0.1)',
              color: ready ? 'var(--on-fg)' : 'rgb(var(--tint) / 0.38)',
              fontSize: 14,
              fontWeight: 600,
              cursor: ready && !busy ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? t('common.working') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function MfaCard() {
  const t = useT();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<'begin' | 'confirm' | 'disable' | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const loadStatus = async () => {
    try {
      const status = await api.get<MfaStatus>('/user/mfa/status', undefined, {
        silent: true,
      });
      setEnabled(status.enabled);
    } catch (err) {
      setError(errorMessage(err, t('security.mfaStatusError')));
      setEnabled(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const begin = async () => {
    setBusy('begin');
    setError(null);
    setRecoveryCodes(null);
    try {
      setEnrollment(
        await api.post<Enrollment>('/user/mfa/begin', {}, { silent: true })
      );
      setCode('');
    } catch (err) {
      setError(errorMessage(err, t('security.mfaStartError')));
    } finally {
      setBusy(null);
    }
  };

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('confirm');
    setError(null);
    try {
      const result = await api.post<{ recoveryCodes: string[] }>(
        '/user/mfa/confirm',
        { code },
        { silent: true }
      );
      setRecoveryCodes(result.recoveryCodes);
      setEnrollment(null);
      setCode('');
      setEnabled(true);
    } catch (err) {
      setError(errorMessage(err, t('security.mfaConfirmError')));
    } finally {
      setBusy(null);
    }
  };

  const disable = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy('disable');
    setError(null);
    try {
      await api.post(
        '/user/mfa/disable',
        { code: disableCode },
        { silent: true }
      );
      setDisableCode('');
      setRecoveryCodes(null);
      setEnabled(false);
    } catch (err) {
      setError(errorMessage(err, t('security.mfaDisableError')));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title={t('security.mfaTitle')} subtitle={t('security.mfaSubtitle')}>
      {error && (
        <div
          role="alert"
          style={{ marginBottom: 12, fontSize: 13, color: 'var(--danger)' }}
        >
          {error}
        </div>
      )}
      {enabled === null ? (
        <div className={s.hint}>{t('common.loading')}</div>
      ) : enabled ? (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div>
              <strong>{t('security.mfaEnabled')}</strong>
              <div className={s.hint}>{t('security.mfaEnabledHint')}</div>
            </div>
            <StatusChip variant="filled">{t('security.mfaEnabled')}</StatusChip>
          </div>
          {recoveryCodes && (
            <RecoveryCodes codes={recoveryCodes} onError={setError} />
          )}
          <form onSubmit={disable} className={s.fieldGrid}>
            <div className={s.field}>
              <label className={s.label} htmlFor="mfa-disable-code">
                {t('security.mfaDisableCode')}
              </label>
              <input
                id="mfa-disable-code"
                className={s.input}
                value={disableCode}
                onChange={(event) => setDisableCode(event.target.value)}
                autoComplete="one-time-code"
                required
              />
            </div>
            <div className={s.cardActions}>
              <button
                type="submit"
                className={s.btnPrimary}
                disabled={busy === 'disable'}
              >
                {busy === 'disable'
                  ? t('security.mfaDisabling')
                  : t('security.mfaDisable')}
              </button>
            </div>
          </form>
        </>
      ) : enrollment ? (
        <>
          <p className={s.hint} style={{ marginTop: 0 }}>
            {t('security.mfaScanHint')}
          </p>
          <div
            style={{
              display: 'flex',
              gap: 20,
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              marginBottom: 16,
            }}
          >
            {/* The server returns an otpauth QR data URL; the secret never persists in the browser. */}
            <img
              src={enrollment.qrCodeDataUrl}
              alt={t('security.mfaQrAlt')}
              width={180}
              height={180}
              style={{ borderRadius: 8, background: 'white', padding: 8 }}
            />
            <div style={{ flex: 1, minWidth: 220 }}>
              <span className={s.label}>{t('security.mfaManualKey')}</span>
              <code
                style={{
                  display: 'block',
                  marginTop: 6,
                  overflowWrap: 'anywhere',
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'rgb(var(--tint) / 0.06)',
                }}
              >
                {enrollment.manualKey}
              </code>
            </div>
          </div>
          <form onSubmit={confirm} className={s.fieldGrid}>
            <div className={s.field}>
              <label className={s.label} htmlFor="mfa-confirm-code">
                {t('security.mfaConfirmCode')}
              </label>
              <input
                id="mfa-confirm-code"
                className={s.input}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="one-time-code"
                inputMode="numeric"
                required
                autoFocus
              />
            </div>
            <div className={s.cardActions}>
              <button
                type="submit"
                className={s.btnPrimary}
                disabled={busy === 'confirm'}
              >
                {busy === 'confirm'
                  ? t('common.working')
                  : t('security.mfaConfirm')}
              </button>
            </div>
          </form>
        </>
      ) : (
        <div className={s.row}>
          <div className={s.rowMain}>
            <span className={s.rowTitle}>{t('security.mfaDisabled')}</span>
            <span className={s.rowSub}>{t('security.mfaDisabledHint')}</span>
          </div>
          <button
            type="button"
            className={s.btnPrimary}
            onClick={begin}
            disabled={busy === 'begin'}
          >
            {busy === 'begin' ? t('common.working') : t('security.mfaStart')}
          </button>
        </div>
      )}
    </Card>
  );
}

type MfaStatus = { enabled: boolean };
type Enrollment = { qrCodeDataUrl: string; manualKey: string };
function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}
function RecoveryCodes({
  codes,
  onError,
}: {
  codes: string[];
  onError: (message: string) => void;
}) {
  const t = useT();
  const exportCodes = (action: () => void) => {
    try {
      action();
    } catch {
      onError(t('security.mfaRecoveryExportError'));
    }
  };

  return (
    <div
      role="status"
      style={{
        margin: '0 0 16px',
        padding: 14,
        borderRadius: 8,
        background: 'rgb(var(--tint) / 0.06)',
      }}
    >
      <strong>{t('security.mfaRecoveryTitle')}</strong>
      <p className={s.hint}>{t('security.mfaRecoveryHint')}</p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 6,
        }}
      >
        {codes.map((recoveryCode) => (
          <code
            key={recoveryCode}
            style={{
              padding: '6px 8px',
              borderRadius: 5,
              background: 'var(--bg)',
            }}
          >
            {recoveryCode}
          </code>
        ))}
      </div>
      <div className={s.cardActions} style={{ marginTop: 14 }}>
        <button
          type="button"
          className={s.btnSecondary}
          onClick={() => exportCodes(() => printRecoveryCodes(codes))}
        >
          {t('security.mfaRecoveryPrint')}
        </button>
        <button
          type="button"
          className={s.btnSecondary}
          onClick={() => exportCodes(() => downloadRecoveryCodes(codes))}
        >
          {t('security.mfaRecoveryDownload')}
        </button>
      </div>
    </div>
  );
}

function SuperAdminMfaPolicy() {
  const t = useT();
  const [enforced, setEnforced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ enforceForAll: boolean }>('/user/mfa/policy', undefined, {
        silent: true,
      })
      .then((policy) => setEnforced(!!policy.enforceForAll))
      .catch(() => setError(t('security.mfaPolicyLoadError')))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const policy = await api.put<{ enforceForAll: boolean }>(
        '/user/mfa/policy',
        { enforceForAll: !enforced }
      );
      setEnforced(policy.enforceForAll);
    } catch (err) {
      setError(errorMessage(err, t('security.mfaPolicySaveError')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={t('security.mfaPolicyTitle')}
      subtitle={t('security.mfaPolicySubtitle')}
    >
      {error && (
        <div
          role="alert"
          style={{ marginBottom: 12, fontSize: 13, color: 'var(--danger)' }}
        >
          {error}
        </div>
      )}
      <div className={s.row}>
        <div className={s.rowMain}>
          <div className={s.rowTitle}>
            {enforced ? t('security.mfaPolicyOn') : t('security.mfaPolicyOff')}
          </div>
          <div className={s.rowSub}>
            {enforced
              ? t('security.mfaPolicyOnHint')
              : t('security.mfaPolicyOffHint')}
          </div>
        </div>
        <div className={s.cardActions}>
          <button
            type="button"
            className={s.btnPrimary}
            onClick={save}
            disabled={loading || saving}
          >
            {saving
              ? t('security.mfaPolicySaving')
              : enforced
              ? t('security.mfaPolicyMakeOptional')
              : t('security.mfaPolicyRequire')}
          </button>
        </div>
      </div>
    </Card>
  );
}
