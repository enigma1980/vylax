'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export function VerifyForm({ method, email }: { method: 'totp' | 'email' | null; email: string }) {
  const [code,           setCode]           = useState('');
  const [remember,       setRemember]       = useState(false);
  const [error,          setError]          = useState('');
  const [loading,        setLoading]        = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isEmail = method === 'email' || method === null;

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

  const methodLabel = isEmail
    ? `Introduce el código enviado a ${email}`
    : 'Introduce el código de tu app de autenticación';

  const placeholder = method === 'totp' ? '000000 o código de recuperación' : '000000';

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-mark">
            <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path d="M9 2L2 6v5c0 3.1 2.9 6 7 7 4.1-1 7-3.9 7-7V6L9 2Z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M6 9l2.5 2.5L12 7" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="auth-logo-text">Vylax</span>
        </div>

        <h1 className="auth-heading">Verificación en dos pasos</h1>
        <p className="auth-sub">{methodLabel}</p>

        <form onSubmit={submit}>
          <div className="form-field">
            <label htmlFor="code">
              {isEmail ? 'Código de 6 dígitos' : 'Código TOTP o de recuperación'}
            </label>
            <input
              id="code" type="text" inputMode="numeric"
              className={`inp${method === 'totp' ? '' : ' inp-otp'}`}
              placeholder={placeholder} maxLength={method === 'totp' ? 20 : 6}
              value={code} onChange={e => setCode(e.target.value.trim())}
              autoComplete="one-time-code" autoFocus required
            />
          </div>

          <div className="check-row">
            <input
              id="remember" type="checkbox"
              checked={remember} onChange={e => setRemember(e.target.checked)}
            />
            <label htmlFor="remember">Recordar este dispositivo durante 30 días</label>
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Verificando…' : 'Verificar'}
          </button>
        </form>

        {isEmail && (
          <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              className="btn btn-ghost"
              onClick={resend}
              disabled={resendCooldown > 0 || loading}
              style={{ flex: '0 0 auto' }}
            >
              Reenviar código
            </button>
            {resendCooldown > 0 && (
              <span className="form-info">({resendCooldown}s)</span>
            )}
          </div>
        )}

        {error && <p className="form-error" style={{ marginTop: '0.75rem' }}>{error}</p>}
      </div>
    </main>
  );
}
