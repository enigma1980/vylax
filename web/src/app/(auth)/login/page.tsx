'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthAside } from '../AuthAside';

export default function LoginPage() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json() as { next?: string; error?: string };
      if (!res.ok) { setError(data.error ?? 'Error de autenticación.'); return; }
      router.push(data.next ?? '/');
    } catch {
      setError('Error de red. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-split">
      <main className="auth-left">
        <div className="auth-card">
          <div className="auth-logo">
            <svg width="48" height="48" viewBox="0 0 28 28" aria-hidden="true">
              <rect x="1" y="1" width="26" height="26" rx="8" fill="none" stroke="#818CF8" strokeWidth="2"/>
              <path d="M8 9l6 11 6-11" fill="none" stroke="#E2E8F0" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="auth-logo-name">Vylax</span>
          </div>

          <div className="auth-heading-wrap">
            <h1 className="auth-heading">Inicia sesión</h1>
            <p className="auth-sub">Accede al panel de tu organización</p>
          </div>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: 'var(--text-sec)' }}>
              Correo electrónico
              <input
                type="email" className="inp"
                placeholder="usuario@empresa.com"
                value={email} onChange={e => setEmail(e.target.value)}
                autoComplete="username" required
              />
            </label>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <label htmlFor="pw" style={{ color: 'var(--text-sec)' }}>Contraseña</label>
                <a href="#" style={{ color: 'var(--accent-lt)', textDecoration: 'none', fontSize: '13px' }}>¿Has olvidado la contraseña?</a>
              </div>
              <div style={{ position: 'relative' }}>
                <input
                  id="pw" type={showPw ? 'text' : 'password'} className="inp"
                  placeholder="••••••••"
                  value={password} onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password" required
                  style={{ paddingRight: '48px' }}
                />
                <button
                  type="button"
                  aria-label={showPw ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  onClick={() => setShowPw(v => !v)}
                  style={{
                    position: 'absolute', right: '4px', top: '4px',
                    width: '40px', height: '40px', border: 0, background: 'none',
                    color: 'var(--text-sec)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  {showPw
                    ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M17 17 7 7M2 12s4-7 10-7a9.5 9.5 0 0 1 5 1.5M22 12s-2 3.5-5 5.5M12 15a3 3 0 0 1-2.8-4"/></svg>
                    : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-indigo" disabled={loading}>
              {loading ? 'Verificando…' : 'Iniciar sesión'}
            </button>
          </form>

          {error && <p className="form-error">{error}</p>}

          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-sec)', textAlign: 'center' }}>
            Protegido con verificación en dos pasos
          </p>
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
