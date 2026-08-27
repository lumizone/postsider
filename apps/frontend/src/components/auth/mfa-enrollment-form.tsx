'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthShell } from './auth-shell';
import styles from './auth.module.css';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/i18n';
import {
  downloadRecoveryCodes,
  printRecoveryCodes,
} from '@/lib/mfa-recovery-export';

type Enrollment = { qrCodeDataUrl: string; manualKey: string };

export function MfaEnrollmentForm() {
  const t = useT();
  const router = useRouter();
  const { refresh } = useAuth();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    api
      .post<Enrollment>('/auth/mfa/enroll/begin', {}, { anonymous: true, silent: true })
      .then(setEnrollment)
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t('security.mfaStartError'));
      })
      .finally(() => setLoading(false));
  }, [t]);

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (confirming) return;
    setConfirming(true);
    setError(null);
    try {
      const result = await api.post<{ recoveryCodes: string[] }>(
        '/auth/mfa/enroll/confirm',
        { code },
        { anonymous: true, silent: true }
      );
      setRecoveryCodes(result.recoveryCodes);
      setEnrollment(null);
      setCode('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('security.mfaConfirmError'));
    } finally {
      setConfirming(false);
    }
  };

  const continueToCalendar = async () => {
    await refresh();
    router.replace('/calendar');
  };

  const exportCodes = (action: () => void) => {
    try {
      action();
    } catch {
      setError(t('security.mfaRecoveryExportError'));
    }
  };

  return (
    <AuthShell
      title={t('security.mfaTitle')}
      subtitle={t('security.mfaSubtitle')}
      footer={<Link href="/login">{t('auth.backToSignIn')}</Link>}
    >
      {error && <div className={styles.error} role="alert">{error}</div>}
      {loading ? (
        <p className={styles.notice}>{t('common.loading')}</p>
      ) : recoveryCodes ? (
        <div className={styles.form}>
          <div className={styles.codeBlock}>
            <strong>{t('security.mfaRecoveryTitle')}</strong>
            <p className={styles.notice}>{t('security.mfaRecoveryHint')}</p>
            <div className={styles.codeGrid}>
              {recoveryCodes.map((recoveryCode) => (
                <code key={recoveryCode} className={styles.code}>
                  {recoveryCode}
                </code>
              ))}
            </div>
            <div className={styles.btnRow}>
              <button
                type="button"
                className={styles.submitSecondary}
                onClick={() => exportCodes(() => printRecoveryCodes(recoveryCodes))}
              >
                {t('security.mfaRecoveryPrint')}
              </button>
              <button
                type="button"
                className={styles.submitSecondary}
                onClick={() => exportCodes(() => downloadRecoveryCodes(recoveryCodes))}
              >
                {t('security.mfaRecoveryDownload')}
              </button>
            </div>
          </div>
          <button type="button" className={styles.submit} onClick={continueToCalendar}>
            {t('auth.mfaContinue')}
          </button>
        </div>
      ) : enrollment ? (
        <>
          <p className={styles.notice}>{t('security.mfaScanHint')}</p>
          <img
            src={enrollment.qrCodeDataUrl}
            alt={t('security.mfaQrAlt')}
            width={180}
            height={180}
            style={{ display: 'block', margin: '16px auto 20px', borderRadius: 8, background: '#ffffff', padding: 8 }}
          />
          <div className={styles.field}>
            <span className={styles.label}>{t('security.mfaManualKey')}</span>
            <code className={styles.code}>{enrollment.manualKey}</code>
          </div>
          <form className={styles.form} onSubmit={confirm}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="mfa-enroll-code">
                {t('security.mfaConfirmCode')}
              </label>
              <input
                id="mfa-enroll-code"
                className={styles.input}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="one-time-code"
                inputMode="numeric"
                required
                autoFocus
              />
            </div>
            <button type="submit" className={styles.submit} disabled={confirming}>
              {confirming ? t('common.working') : t('security.mfaConfirm')}
            </button>
          </form>
        </>
      ) : null}
    </AuthShell>
  );
}
