'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { AuthAside } from '../../AuthAside';

export function VerifyForm({ method, email }: { method: 'totp' | 'email' | null; email: string }) {
  const [digits,         setDigits]         = useState<string[]>(Array(6).fill(''));
  const [remember,       setRemember]       = useState(false);
  const [error,          setError]          = useState('');
  const [loading,        setLoading]        = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>(Array(6).fill(null));
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const router    = useRouter();

  const isEmail = method === 'email' || method === null;
  const code    = digits.join('');

  function startCooldown(secs = 60) {
    setResendCooldown(secs);
    timerRef.current = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) { clearInterval(timerRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
  }

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  function onDigitChange(i: number, val: string) {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = digit;
    setDigits(next);
    if (digit && i < 5) inputRefs.current[i + 1]?.focus();
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      inputRefs.current[i - 1]?.focus();
    }
  }

  function onPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = [...digits];
    for (let j = 0; j < pasted.length; j++) next[j] = pasted[j];
    setDigits(next);
    const nextFocus = Math.min(pasted.length, 5);
    inputRefs.current[nextFocus]?.focus();
  }

  async function resend() {
    setError('');
    const res  = await fetch('/api/auth/2fa/email/send', { method: 'POST' });
    const data = await res.json() as { error?: string };
    if (!res.ok) { setError(data.error ?? 'Error al enviar el código.'); return; }
    startCooldown(60);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, rememberDevice: remember }),
      });
      const data = await res.json() as { next?: string; error?: string };
      if (!res.ok) { setError(data.error ?? 'Código incorrecto.'); return; }
      router.push(data.next ?? '/');
    } catch { setError('Error de red.'); }
    finally { setLoading(false); }
  }

  return (
    <div className="auth-split">
      <main className="auth-left">
        <div className="auth-card">
          <button
            type="button"
            className="btn-back"
            onClick={() => router.push('/login')}
            aria-label="Volver al inicio de sesión"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M15 6l-6 6 6 6"/>
            </svg>
          </button>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center' }}>
            <div className="auth-icon-wrap">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>
              </svg>
            </div>
            <h1 className="auth-heading">Verificación en dos pasos</h1>
            <p className="auth-sub" style={{ margin: 0 }}>
              {isEmail
                ? `Introduce el código enviado a ${email}`
                : 'Escribe el código de 6 cifras de tu app de autenticación'}
            </p>
          </div>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
              <legend style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
                Código de verificación
              </legend>
              <div className="otp-grid" onPaste={onPaste}>
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={el => { inputRefs.current[i] = el; }}
                    aria-label={`Cifra ${i + 1}`}
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    onChange={e => onDigitChange(i, e.target.value)}
                    onKeyDown={e => onKeyDown(i, e)}
                    className={`otp-digit${d ? ' filled' : ''}`}
                    autoFocus={i === 0}
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  />
                ))}
              </div>
            </fieldset>

            <label className="check-row">
              <input
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
              />
              <span>Recordar este dispositivo 30 días</span>
            </label>

            <button type="submit" className="btn btn-indigo" disabled={loading || code.length < 6}>
              {loading ? 'Verificando…' : 'Verificar'}
            </button>
          </form>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '18px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px', textAlign: 'center' }}>
            {isEmail ? (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ width: '100%' }}
                onClick={resend}
                disabled={resendCooldown > 0 || loading}
              >
                {resendCooldown > 0 ? `Reenviar en ${resendCooldown}s` : 'Enviarme un código por correo'}
              </button>
            ) : (
              <a href="#" style={{ color: 'var(--accent-lt)', textDecoration: 'none' }}>
                Enviarme un código por correo
              </a>
            )}
            <a href="#" style={{ color: 'var(--text-sec)', textDecoration: 'none', fontSize: '13px' }}>
              Usar un código de recuperación
            </a>
          </div>

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
