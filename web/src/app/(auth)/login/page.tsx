'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
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

        <h1 className="auth-heading">Iniciar sesión</h1>
        <p className="auth-sub">Accede al panel de monitorización</p>

        <form onSubmit={submit}>
          <div className="form-field">
            <label htmlFor="email">Correo electrónico</label>
            <input
              id="email" type="email" className="inp"
              placeholder="usuario@empresa.com"
              value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="email" required
            />
          </div>
          <div className="form-field">
            <label htmlFor="password">Contraseña</label>
            <input
              id="password" type="password" className="inp"
              placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)}
              autoComplete="current-password" required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Verificando…' : 'Continuar'}
          </button>
        </form>

        {error && <p className="form-error">{error}</p>}
      </div>
    </main>
  );
}
