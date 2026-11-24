'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientOverview } from '@/lib/dashboard';

interface Props {
  clients: ClientOverview[];
  role?: string;
}

const SEM_COLOR: Record<string, string> = {
  ok:   'var(--green)',
  warn: 'var(--amber)',
  crit: 'var(--red)',
};
const SEM_BG: Record<string, string> = {
  ok:   'rgba(52,211,153,0.12)',
  warn: 'rgba(251,191,36,0.12)',
  crit: 'rgba(248,113,113,0.12)',
};
const SEM_LABEL: Record<string, string> = {
  ok:   'Correcto',
  warn: 'Aviso',
  crit: 'Crítico',
};

export function ClientGrid({ clients, role }: Props) {
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Clientes</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setView('grid')}
            style={{
              border: '1px solid var(--border)',
              background: view === 'grid' ? 'var(--active-nav)' : 'var(--card)',
              color: view === 'grid' ? 'var(--text)' : 'var(--text-sec)',
              borderRadius: '8px', padding: '8px 12px',
              font: 'inherit', fontSize: '13px', cursor: 'pointer',
            }}
          >
            Cuadrícula
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            style={{
              border: '1px solid var(--border)',
              background: view === 'list' ? 'var(--active-nav)' : 'var(--card)',
              color: view === 'list' ? 'var(--text)' : 'var(--text-sec)',
              borderRadius: '8px', padding: '8px 12px',
              font: 'inherit', fontSize: '13px', cursor: 'pointer',
            }}
          >
            Lista
          </button>
          {role === 'admin' && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              style={{
                border: '0', background: 'var(--accent)', color: '#0B1220',
                borderRadius: '8px', padding: '8px 14px',
                font: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              }}
            >
              + Nuevo cliente
            </button>
          )}
        </div>
      </div>

      {view === 'grid' ? (
        <div className="client-grid">
          {clients.map(c => (
            <ClientCard key={c.id} c={c} />
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {clients.map(c => (
            <ClientRow key={c.id} c={c} />
          ))}
        </div>
      )}

      {modalOpen && (
        <NewClientModal onClose={() => setModalOpen(false)} />
      )}
    </section>
  );
}

function ClientCard({ c }: { c: ClientOverview }) {
  const pct = c.total > 0 ? Math.round((c.online / c.total) * 100) : 0;
  return (
    <a
      href={`/clientes/${c.id}`}
      style={{
        textDecoration: 'none', color: 'inherit',
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: '12px', padding: '16px',
        display: 'flex', flexDirection: 'column', gap: '12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '15px', fontWeight: 600 }}>{c.name}</span>
        <span style={{
          fontSize: '12px', fontWeight: 600,
          padding: '3px 9px', borderRadius: '999px',
          color: SEM_COLOR[c.semaphore],
          background: SEM_BG[c.semaphore],
        }}>
          {SEM_LABEL[c.semaphore]}
        </span>
      </div>
      <span style={{ fontSize: '12px', color: 'var(--text-sec)' }}>
        {c.sites} sede{c.sites !== 1 ? 's' : ''}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
          <span style={{ color: 'var(--text-sec)' }}>En línea</span>
          <span>{c.online} / {c.total}</span>
        </div>
        <div style={{ height: '6px', background: 'var(--border)', borderRadius: '999px', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: '999px',
            background: SEM_COLOR[c.semaphore],
            width: `${pct}%`,
          }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '14px', fontSize: '12px', color: 'var(--text-sec)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <SrvIcon />{c.servers}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <PcIcon />{c.pcs}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <LaptopIcon />{c.laptops}
        </span>
      </div>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '10px', fontSize: '13px', color: '#C9CCD1' }}>
        {c.reason}
      </div>
    </a>
  );
}

function ClientRow({ c }: { c: ClientOverview }) {
  return (
    <a
      href={`/clientes/${c.id}`}
      style={{
        textDecoration: 'none', color: 'inherit',
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: '8px', padding: '12px 16px',
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px',
      }}
    >
      <span style={{
        width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
        background: SEM_COLOR[c.semaphore],
      }} />
      <span style={{ fontSize: '14px', fontWeight: 600, flex: '1 1 140px' }}>{c.name}</span>
      <span style={{ fontSize: '12px', color: 'var(--text-sec)' }}>
        {c.sites} sede{c.sites !== 1 ? 's' : ''}
      </span>
      <span style={{ fontSize: '13px' }}>{c.online}/{c.total} en línea</span>
      <span style={{ fontSize: '12px', color: 'var(--text-sec)', flex: '1 1 180px' }}>{c.reason}</span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Modal + Nuevo cliente
// ---------------------------------------------------------------------------

interface CreatedClient {
  clientId:  string;
  fullToken: string;
}

function NewClientModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [clientName, setClientName] = useState('');
  const [siteName,   setSiteName]   = useState('');
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [created,    setCreated]    = useState<CreatedClient | null>(null);
  const [copied,     setCopied]     = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/clientes', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ clientName, siteName }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? 'Error desconocido');
        return;
      }
      const data = await res.json() as CreatedClient;
      setCreated(data);
    } catch {
      setError('Error de red. Comprueba la conexión.');
    } finally {
      setLoading(false);
    }
  }

  function copyToken() {
    if (!created) return;
    navigator.clipboard.writeText(created.fullToken).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function goToClient() {
    if (!created) return;
    onClose();
    router.push(`/clientes/${created.clientId}`);
    router.refresh();
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !created) onClose(); }}
    >
      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        padding: '28px',
        width: '100%', maxWidth: '440px',
        display: 'flex', flexDirection: 'column', gap: '20px',
      }}>
        {!created ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Nuevo cliente</h2>
              <button
                type="button"
                onClick={onClose}
                style={{ background: 'none', border: 'none', color: 'var(--text-sec)', cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              <div className="form-field">
                <label htmlFor="modal-client-name">Nombre del cliente</label>
                <input
                  id="modal-client-name"
                  className="inp"
                  type="text"
                  value={clientName}
                  onChange={e => setClientName(e.target.value)}
                  placeholder="Empresa del cliente"
                  required
                  autoFocus
                />
              </div>
              <div className="form-field">
                <label htmlFor="modal-site-name">Nombre de la primera sede</label>
                <input
                  id="modal-site-name"
                  className="inp"
                  type="text"
                  value={siteName}
                  onChange={e => setSiteName(e.target.value)}
                  placeholder="Oficina principal"
                  required
                />
              </div>
              {error && <div className="form-error">{error}</div>}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
                style={{ marginTop: '4px' }}
              >
                {loading ? 'Creando…' : 'Crear cliente'}
              </button>
            </form>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px' }}>✅</span>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Cliente creado</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-sec)' }}>
                Token de alta generado. <strong style={{ color: 'var(--amber)' }}>Guárdalo ahora: no se volverá a mostrar.</strong>
              </p>
              <div style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: '8px', padding: '12px',
                fontFamily: 'monospace', fontSize: '13px',
                wordBreak: 'break-all', color: 'var(--accent)',
                userSelect: 'all',
              }}>
                {created.fullToken}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={copyToken}
            >
              {copied ? '¡Copiado!' : 'Copiar comando de instalación'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={goToClient}
              style={{ width: '100%', textAlign: 'center' }}
            >
              Ir al cliente →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function SrvIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="3" width="16" height="7" rx="1.5"/>
      <rect x="4" y="14" width="16" height="7" rx="1.5"/>
    </svg>
  );
}
function PcIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2"/>
      <path d="M8 20h8"/>
    </svg>
  );
}
function LaptopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="5" y="5" width="14" height="10" rx="1.5"/>
      <path d="M3 19h18"/>
    </svg>
  );
}
