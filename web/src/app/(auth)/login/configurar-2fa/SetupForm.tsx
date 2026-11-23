'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

type Step = 'choice' | 'totp-setup' | 'totp-code' | 'recovery';

interface SetupData { qrDataUrl: string; base32: string }
interface VerifyData { recoveryCodes: string[]; next: string }

export function SetupForm({ isAdmin }: { isAdmin: boolean }) {
  const [step,     setStep]     = useState<Step>(isAdmin ? 'totp-setup' : 'choice');
  const [setup,    setSetup]    = useState<SetupData | null>(null);
  const [recovery, setRecovery] = useState<string[]>([]);
  const [code,     setCode]     = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [copied,   setCopied]   = useState(false);
  const [nextUrl,  setNextUrl]  = useState('/');
  const router = useRouter();

  async function startTotp() {
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/auth/2fa/totp/setup', { method: 'POST' });
      const data = await res.json() as SetupData & { error?: string };
      if (!res.ok) { setError(data.error ?? 'Error al generar el QR.'); return; }
      setSetup(data);
      setStep('totp-code');
    } catch { setError('Error de red.'); }
    finally { setLoading(false); }
  }

  async function chooseEmail() {
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/auth/2fa/email/send', { method: 'POST' });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setError(data.error ?? 'Error al enviar el correo.'); return; }
      router.push('/login/verificacion');
    } catch { setError('Error de red.'); }
    finally { setLoading(false); }
  }

  async function verifyTotp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/auth/2fa/totp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json() as VerifyData & { error?: string };
      if (!res.ok) { setError(data.error ?? 'Código incorrecto.'); return; }
      setRecovery(data.recoveryCodes ?? []);
      setNextUrl(data.next ?? '/');
      setStep('recovery');
    } catch { setError('Error de red.'); }
    finally { setLoading(false); }
  }

  async function copyAll() {
    await navigator.clipboard.writeText(recovery.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── Elección de método ──────────────────────────────────────
  if (step === 'choice') {
    return (
      <main className="auth-wrap">
        <div className="auth-card">
          <Logo />
          <h1 className="auth-heading">Configura la verificación en dos pasos</h1>
          <p className="auth-sub">Elige cómo quieres proteger tu cuenta</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <button className="org-item" onClick={startTotp} disabled={loading}>
              <div>
                <div style={{ fontWeight: 500 }}>Aplicación de autenticación (recomendado)</div>
                <div className="org-role">Google Authenticator, Authy, 1Password…</div>
              </div>
              <Arrow />
            </button>
            <button className="org-item" onClick={chooseEmail} disabled={loading}>
              <div>
                <div style={{ fontWeight: 500 }}>Código por correo electrónico</div>
                <div className="org-role">Recibirás un código de 6 dígitos</div>
              </div>
              <Arrow />
            </button>
          </div>

          {error && <p className="form-error">{error}</p>}
        </div>
      </main>
    );
  }

  // ── Setup TOTP: QR + clave manual ──────────────────────────
  if (step === 'totp-setup' || (step === 'totp-code' && !setup)) {
    return (
      <main className="auth-wrap">
        <div className="auth-card">
          <Logo />
          <h1 className="auth-heading">Configura TOTP</h1>
          <p className="auth-sub">Generando QR…</p>
          <button className="btn btn-primary" onClick={startTotp} disabled={loading}>
            {loading ? 'Cargando…' : 'Generar QR'}
          </button>
          {error && <p className="form-error">{error}</p>}
        </div>
      </main>
    );
  }

  // ── Código de verificación TOTP ─────────────────────────────
  if (step === 'totp-code' && setup) {
    return (
      <main className="auth-wrap">
        <div className="auth-card">
          <Logo />
          <h1 className="auth-heading">Escanea el código QR</h1>
          <p className="auth-sub">Abre tu app de autenticación y escanea la imagen</p>

          <Image
            src={setup.qrDataUrl}
            alt="Código QR para TOTP"
            width={180} height={180}
            className="totp-qr"
          />

          <p style={{ fontSize: '0.8rem', color: 'var(--text-sec)', marginTop: '0.75rem', marginBottom: '0.4rem' }}>
            O introduce la clave manual:
          </p>
          <div className="totp-secret">{setup.base32}</div>

          <hr className="divider" />

          <form onSubmit={verifyTotp}>
            <div className="form-field">
              <label htmlFor="totp-code">Código de verificación</label>
              <input
                id="totp-code" type="text" inputMode="numeric" pattern="\d{6}"
                className="inp inp-otp" placeholder="000000" maxLength={6}
                value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                autoComplete="one-time-code" autoFocus required
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading || code.length < 6}>
              {loading ? 'Verificando…' : 'Activar verificación en dos pasos'}
            </button>
          </form>

          {error && <p className="form-error">{error}</p>}
        </div>
      </main>
    );
  }

  // ── Códigos de recuperación ─────────────────────────────────
  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <Logo />
        <h1 className="auth-heading">Guarda tus códigos de recuperación</h1>

        <div className="recovery-warn">
          Estos códigos se muestran <strong>una sola vez</strong>. Guárdalos en un lugar seguro.
          Cada código solo puede usarse una vez si pierdes el acceso a tu app.
        </div>

        <div className="recovery-grid">
          {recovery.map((c, i) => (
            <div key={i} className="recovery-code">{c}</div>
          ))}
        </div>

        <button className="btn btn-ghost" style={{ width: '100%', marginBottom: '0.75rem' }} onClick={copyAll}>
          {copied ? '✓ Copiado' : 'Copiar todos'}
        </button>
        <button
          className="btn btn-primary"
          onClick={() => router.push(nextUrl)}
        >
          He guardado mis códigos → Continuar
        </button>
      </div>
    </main>
  );
}

function Logo() {
  return (
    <div className="auth-logo">
      <div className="auth-logo-mark">
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="M9 2L2 6v5c0 3.1 2.9 6 7 7 4.1-1 7-3.9 7-7V6L9 2Z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M6 9l2.5 2.5L12 7" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <span className="auth-logo-text">Vylax</span>
    </div>
  );
}

function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 4l4 4-4 4" stroke="var(--text-sec)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
