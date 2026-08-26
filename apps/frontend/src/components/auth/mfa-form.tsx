'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AuthShell } from './auth-shell';
import styles from './auth.module.css';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useT } from '@/lib/i18n';

/**
 * Second step of sign-in for accounts with TOTP enabled. The first step already
 * issued a short-lived MFA challenge cookie, so this form only carries the code.
 */
export function MfaForm() {
  const t = useT();
  const router = useRouter();
  const { refresh } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await api.post(
        '/auth/mfa/verify',
        { code },
        { anonymous: true, silent: true }
      );
      await refresh();
      router.replace('/calendar');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.mfaError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.mfaTitle')}
      subtitle={t('auth.mfaSubtitle')}
      footer={<Link href="/login">{t('auth.backToSignIn')}</Link>}
    >
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="code">
            {t('auth.mfaCode')}
          </label>
          <input
            id="code"
            className={styles.input}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoFocus
            autoComplete="one-time-code"
            placeholder={t('auth.mfaCodePlaceholder')}
          />
        </div>
        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
        <button type="submit" className={styles.submit} disabled={loading}>
          {loading ? t('auth.mfaVerifying') : t('auth.mfaContinue')}
        </button>
      </form>
    </AuthShell>
  );
}
