'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Org { id: string; name: string; role: string }

export function OrgSelect({ orgs }: { orgs: Org[] }) {
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const router = useRouter();

  async function select(orgId: string) {
    setLoading(orgId); setError('');
    try {
      const res  = await fetch('/api/auth/org/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setError(data.error ?? 'Error al seleccionar la organización.'); return; }
      router.push('/');
    } catch { setError('Error de red.'); }
    finally { setLoading(null); }
  }

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/guaitiq-logo-blanco.png" alt="Guaitiq" height={36} style={{ display: 'block' }} />
        </div>

        <h1 className="auth-heading">Selecciona una organización</h1>
        <p className="auth-sub">Tu cuenta pertenece a varias organizaciones</p>

        <div className="org-list">
          {orgs.map(org => (
            <button
              key={org.id}
              className="org-item"
              onClick={() => select(org.id)}
              disabled={loading !== null}
            >
              <div>
                <div style={{ fontWeight: 500 }}>{org.name}</div>
                <div className="org-role">{org.role === 'admin' ? 'Administrador' : 'Técnico'}</div>
              </div>
              {loading === org.id
                ? <span style={{ fontSize: '0.8rem', color: 'var(--text-sec)' }}>…</span>
                : <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M6 4l4 4-4 4" stroke="var(--text-sec)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
              }
            </button>
          ))}
        </div>

        {error && <p className="form-error">{error}</p>}
      </div>
    </main>
  );
}
