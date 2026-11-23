'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { AuthAside } from '../../AuthAside';

type Step = 'choice' | 'totp-setup' | 'totp-code' | 'recovery';

interface SetupData { qrDataUrl: string; base32: string }
interface VerifyData { recoveryCodes: string[]; next: string }

export function SetupForm({ isAdmin }: { isAdmin: boolean }) {
  const [step,     setStep]     = useState<Step>(isAdmin ? 'totp-setup' : 'choice');
  const [setup,    setSetup]    = useState<SetupData | null>(null);
  const [recovery, setRecovery] = useState<string[]>([]);
  const [code,     setCode]     = useState('');
  const [method,   setMethod]   = useState<'totp' | 'email'>('totp');
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

  async function continueChoice() {
    if (method === 'totp') await startTotp();
    else await chooseEmail();
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

  // ── Elección de método ──────────────────────────────────────────────────────
  if (step === 'choice') {
    return (
      <div className="auth-split">
        <main className="auth-left">
          <div className="auth-card auth-card-wide">
            <div className="auth-heading-wrap">
              <h1 className="auth-heading">Configura la verificación en dos pasos</h1>
              <p className="auth-sub" style={{ margin: 0 }}>Elige cómo quieres proteger tu cuenta</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <label className="method-option">
                <input
                  type="radio" name="method" value="totp"
                  checked={method === 'totp'}
                  onChange={() => setMethod('totp')}
                />
                <div>
                  <div className="method-option-label">Aplicación de autenticación (recomendado)</div>
                  <div className="method-option-desc">Google Authenticator, Authy, 1Password…</div>
                </div>
              </label>
              <label className="method-option">
                <input
                  type="radio" name="method" value="email"
                  checked={method === 'email'}
                  onChange={() => setMethod('email')}
                />
                <div>
                  <div className="method-option-label">Código por correo electrónico</div>
                  <div className="method-option-desc">Recibirás un código de 6 dígitos</div>
                </div>
              </label>
            </div>

            <button className="btn btn-indigo" onClick={continueChoice} disabled={loading}>
              {loading ? 'Cargando…' : 'Continuar'}
            </button>

            {error && <p className="form-error">{error}</p>}
          </div>
          <div className="auth-footer">
            <a href="#">Condiciones del servicio</a>
            <a href="#">Privacidad</a>
          </div>
        </main>
        <AuthAside />
      </div>
    );
  }

  // ── Setup TOTP: generando QR ────────────────────────────────────────────────
  if (step === 'totp-setup' || (step === 'totp-code' && !setup)) {
    return (
      <div className="auth-split">
        <main className="auth-left">
          <div className="auth-card auth-card-wide">
            <div className="auth-heading-wrap">
              <h1 className="auth-heading">Configura TOTP</h1>
              <p className="auth-sub" style={{ margin: 0 }}>Generando código QR…</p>
            </div>
            <button className="btn btn-indigo" onClick={startTotp} disabled={loading}>
              {loading ? 'Cargando…' : 'Generar QR'}
            </button>
            {error && <p className="form-error">{error}</p>}
          </div>
          <div className="auth-footer">
            <a href="#">Condiciones del servicio</a>
            <a href="#">Privacidad</a>
          </div>
        </main>
        <AuthAside />
      </div>
    );
  }

  // ── Código de verificación TOTP ─────────────────────────────────────────────
  if (step === 'totp-code' && setup) {
    return (
      <div className="auth-split">
        <main className="auth-left">
          <div className="auth-card auth-card-wide">
            <div className="auth-heading-wrap">
              <h1 className="auth-heading">Escanea el código QR</h1>
              <p className="auth-sub" style={{ margin: 0 }}>
                Abre tu app de autenticación y escanea la imagen
              </p>
            </div>

            <div style={{ textAlign: 'center' }}>
              <Image
                src={setup.qrDataUrl}
                alt="Código QR para TOTP"
                width={180} height={180}
                className="totp-qr"
              />
              <p style={{ fontSize: '12px', color: 'var(--text-sec)', margin: '12px 0 6px' }}>
                O introduce la clave manual:
              </p>
              <div className="totp-secret">{setup.base32}</div>
            </div>

            <hr className="divider" />

            <form onSubmit={verifyTotp} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'var(--text-sec)' }}>
                Código de verificación
                <input
                  type="text" inputMode="numeric" pattern="\d{6}"
                  className="inp"
                  placeholder="000000" maxLength={6}
                  value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  autoComplete="one-time-code" autoFocus required
                  style={{ textAlign: 'center', letterSpacing: '0.5em', fontSize: '1.3rem', fontWeight: 600 }}
                />
              </label>
              <button type="submit" className="btn btn-indigo" disabled={loading || code.length < 6}>
                {loading ? 'Verificando…' : 'Activar verificación en dos pasos'}
              </button>
            </form>

            {error && <p className="form-error">{error}</p>}
          </div>
          <div className="auth-footer">
            <a href="#">Condiciones del servicio</a>
            <a href="#">Privacidad</a>
          </div>
        </main>
        <AuthAside />
      </div>
    );
  }

  // ── Códigos de recuperación ─────────────────────────────────────────────────
  return (
    <div className="auth-split">
      <main className="auth-left">
        <div className="auth-card auth-card-wide">
          <div className="auth-heading-wrap">
            <h1 className="auth-heading">Guarda tus códigos de recuperación</h1>
          </div>

          <div className="recovery-warn">
            Estos códigos se muestran <strong>una sola vez</strong>. Guárdalos en un lugar seguro.
            Cada código solo puede usarse una vez si pierdes el acceso a tu app.
          </div>

          <div className="recovery-grid">
            {recovery.map((c, i) => (
              <div key={i} className="recovery-code">{c}</div>
            ))}
          </div>

          <button className="btn btn-ghost" style={{ width: '100%' }} onClick={copyAll}>
            {copied ? '✓ Copiado' : 'Copiar todos'}
          </button>
          <button className="btn btn-indigo" onClick={() => router.push(nextUrl)}>
            He guardado mis códigos → Continuar
          </button>
        </div>
        <div className="auth-footer">
          <a href="#">Condiciones del servicio</a>
          <a href="#">Privacidad</a>
        </div>
      </main>
      <AuthAside />
    </div>
  );
}
