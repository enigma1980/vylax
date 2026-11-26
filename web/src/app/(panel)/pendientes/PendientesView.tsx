'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PendingDeviceRow, ClientSimple } from '@/lib/dashboard';
import type { TokenRow } from '@/lib/sites-tokens';

// ─── Estilos base ─────────────────────────────────────────────────────────────

const btnBase: React.CSSProperties = {
  padding: '7px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
  cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--card)',
  color: 'var(--text)', font: 'inherit',
};
const btnPrimary: React.CSSProperties = {
  ...btnBase, background: '#1E3A5F', borderColor: '#4C8DFF', color: '#E2E8F0',
};
const btnDanger: React.CSSProperties = {
  ...btnBase, background: '#2D0F0F', borderColor: '#F87171', color: '#F87171',
};
const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
  zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
};
const modalBox: React.CSSProperties = {
  background: '#0F172A', border: '1px solid #1E293B', borderRadius: '12px',
  padding: '24px', width: '100%', maxWidth: '500px',
  display: 'flex', flexDirection: 'column', gap: '16px',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '13px', color: '#94A3B8', marginBottom: '6px',
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: '8px',
  border: '1px solid #1E293B', background: '#0A0F1E', color: '#E2E8F0',
  fontSize: '14px', boxSizing: 'border-box', font: 'inherit',
};
const errorStyle: React.CSSProperties = {
  fontSize: '13px', color: '#F87171', padding: '8px 12px',
  background: '#2D0F0F', borderRadius: '6px', border: '1px solid #F87171',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(isoStr: string | null): string {
  if (!isoStr) return 'Nunca';
  const ms   = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1)  return 'Ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `hace ${hrs} h`;
  return `hace ${Math.floor(hrs / 24)} días`;
}

function fmtDate(isoStr: string): string {
  return new Date(isoStr).toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface Props {
  pendingDevices:   PendingDeviceRow[];
  orgToken:         TokenRow | null;
  clientsWithSites: ClientSimple[];
  isAdmin:          boolean;
}

export function PendientesView({ pendingDevices, orgToken, clientsWithSites, isAdmin }: Props) {
  const router = useRouter();

  // Token
  const [token,              setToken]          = useState<TokenRow | null>(orgToken);
  const [fullToken,          setFullToken]       = useState<string | null>(null);
  const [tokenLoading,       setTokenLoading]    = useState(false);
  const [tokenError,         setTokenError]      = useState('');
  const [tokenCopied,        setTokenCopied]     = useState(false);
  const [showRegenConfirm,   setShowRegenConfirm] = useState(false);

  // Modal de asignación
  const [assignDeviceId, setAssignDeviceId] = useState<string | null>(null);
  const [assignHostname, setAssignHostname] = useState('');

  // ── Acciones token ──────────────────────────────────────────────────────────

  async function handleCreateToken() {
    setTokenLoading(true); setTokenError('');
    try {
      const res = await fetch('/api/pendientes/token', { method: 'POST' });
      if (!res.ok) { const b = await res.json() as { error?: string }; setTokenError(b.error ?? 'Error'); return; }
      const data = await res.json() as { fullToken: string; token: TokenRow };
      setToken(data.token);
      setFullToken(data.fullToken);
    } catch { setTokenError('Error de red'); }
    finally { setTokenLoading(false); }
  }

  async function handleRotateToken() {
    if (!token) return;
    setTokenLoading(true); setTokenError('');
    try {
      const res = await fetch(`/api/pendientes/token/${token.id}/rotate`, { method: 'POST' });
      if (!res.ok) { const b = await res.json() as { error?: string }; setTokenError(b.error ?? 'Error'); return; }
      const data = await res.json() as { fullToken: string; token: TokenRow };
      setToken(data.token);
      setFullToken(data.fullToken);
    } catch { setTokenError('Error de red'); }
    finally { setTokenLoading(false); }
  }

  async function handleRevokeToken() {
    if (!token) return;
    setTokenLoading(true); setTokenError('');
    try {
      const res = await fetch(`/api/pendientes/token/${token.id}/revoke`, { method: 'POST' });
      if (!res.ok) { const b = await res.json() as { error?: string }; setTokenError(b.error ?? 'Error'); return; }
      setToken(null);
      setFullToken(null);
    } catch { setTokenError('Error de red'); }
    finally { setTokenLoading(false); }
  }

  function copyInstallCmd() {
    if (!fullToken) return;
    const cmd = `msiexec /i vylax-agent.msi TOKEN=${fullToken} /qn`;
    navigator.clipboard.writeText(cmd).then(() => {
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 3000);
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 600 }}>Pendientes de asignar</h1>
        <span style={{ fontSize: '13px', color: 'var(--text-sec)' }}>
          {pendingDevices.length} equipo{pendingDevices.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Token de org (solo admin) */}
      {isAdmin && (
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Token general de alta</h2>
            <span style={{ fontSize: '12px', color: 'var(--text-sec)', background: '#1E293B', padding: '2px 8px', borderRadius: '4px' }}>
              Bandeja de entrada
            </span>
          </div>
          <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--text-sec)' }}>
            Los agentes instalados con este token llegan aquí pendientes de asignación.
          </p>

          {!token ? (
            <button style={btnPrimary} onClick={handleCreateToken} disabled={tokenLoading}>
              {tokenLoading ? 'Creando…' : 'Crear token general'}
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <code style={{ background: '#0A0F1E', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 10px', fontSize: '13px', fontFamily: 'monospace' }}>
                  {token.tokenPrefix}…
                </code>

                {fullToken ? (
                  <button style={tokenCopied ? { ...btnPrimary, opacity: 0.8 } : btnPrimary} onClick={copyInstallCmd}>
                    {tokenCopied ? '✓ Copiado' : 'Copiar comando de instalación'}
                  </button>
                ) : (
                  <span style={{ fontSize: '12px', color: 'var(--text-sec)', fontStyle: 'italic' }}>
                    Token ya creado — regenera para obtener uno nuevo
                  </span>
                )}

                <button style={btnBase} onClick={() => { setTokenError(''); setShowRegenConfirm(true); }} disabled={tokenLoading}>
                  Regenerar
                </button>
                <button style={btnDanger} onClick={handleRevokeToken} disabled={tokenLoading}>
                  {tokenLoading ? '…' : 'Revocar'}
                </button>
              </div>

              {fullToken && (
                <div style={{ background: '#0A0F1E', border: '1px solid var(--border)', borderRadius: '6px', padding: '10px 12px' }}>
                  <p style={{ margin: '0 0 4px', fontSize: '12px', color: '#94A3B8' }}>Comando de instalación (cópialo ahora — no se guardará):</p>
                  <code style={{ fontSize: '12px', fontFamily: 'monospace', wordBreak: 'break-all', color: '#E2E8F0' }}>
                    msiexec /i vylax-agent.msi TOKEN={fullToken} /qn
                  </code>
                </div>
              )}

              {tokenError && <p style={errorStyle}>{tokenError}</p>}
            </div>
          )}
          {!token && tokenError && <p style={{ ...errorStyle, marginTop: '8px' }}>{tokenError}</p>}
        </div>
      )}

      {/* Tabla de pendientes */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '700px' }}>
          <thead>
            <tr style={{ color: 'var(--text-sec)', fontSize: '12px', textAlign: 'left' }}>
              {['Equipo', 'Fecha de alta', 'IP pública', 'Sistema', 'Último contacto', ...(isAdmin ? [''] : [])].map(h => (
                <th key={h} style={{ padding: '12px', fontWeight: 500, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pendingDevices.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 6 : 5} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-sec)' }}>
                  No hay equipos pendientes de asignar
                </td>
              </tr>
            ) : pendingDevices.map(d => (
              <tr key={d.id} style={{ borderBottom: '1px solid #232529' }}>
                <td style={{ padding: '12px', fontWeight: 500 }}>{d.hostname}</td>
                <td style={{ padding: '12px', color: 'var(--text-sec)' }}>{fmtDate(d.createdAt)}</td>
                <td style={{ padding: '12px', color: 'var(--text-sec)', fontFamily: 'monospace', fontSize: '12px' }}>
                  {d.publicIp ?? '—'}
                </td>
                <td style={{ padding: '12px', color: 'var(--text-sec)' }}>
                  {d.osName
                    ? d.osName.replace(/Windows Server\s?/i, 'WS ').replace(/Windows\s?/i, 'Win ')
                    : '—'}
                </td>
                <td style={{ padding: '12px', color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>
                  {timeAgo(d.lastSeenAt)}
                </td>
                {isAdmin && (
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    <button
                      style={btnPrimary}
                      onClick={() => { setAssignDeviceId(d.id); setAssignHostname(d.hostname); }}
                    >
                      Asignar
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal confirmar regenerar token */}
      {showRegenConfirm && (
        <div style={overlayStyle} onClick={() => setShowRegenConfirm(false)}>
          <div style={modalBox} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>Regenerar token general</h2>
            <p style={{ margin: 0, fontSize: '13px', color: '#94A3B8', lineHeight: '1.6' }}>
              Se creará un token nuevo y el actual dejará de funcionar para instalar equipos nuevos.
              Los equipos ya instalados no se ven afectados.
            </p>
            {tokenError && <p style={errorStyle}>{tokenError}</p>}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button style={btnBase} onClick={() => setShowRegenConfirm(false)} disabled={tokenLoading}>
                Cancelar
              </button>
              <button style={btnPrimary} disabled={tokenLoading}
                onClick={async () => {
                  await handleRotateToken();
                  setShowRegenConfirm(false);
                }}>
                {tokenLoading ? 'Regenerando…' : 'Regenerar token'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de asignación */}
      {assignDeviceId && (
        <AssignModal
          deviceId={assignDeviceId}
          hostname={assignHostname}
          clientsWithSites={clientsWithSites}
          onClose={() => setAssignDeviceId(null)}
          onDone={() => { setAssignDeviceId(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

// ─── Modal: Asignar equipo ────────────────────────────────────────────────────

function AssignModal({
  deviceId, hostname, clientsWithSites, onClose, onDone,
}: {
  deviceId:         string;
  hostname:         string;
  clientsWithSites: ClientSimple[];
  onClose:          () => void;
  onDone:           () => void;
}) {
  const [mode,          setMode]          = useState<'existing' | 'new'>('existing');
  const [clientId,      setClientId]      = useState(clientsWithSites[0]?.id ?? '');
  const [siteId,        setSiteId]        = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [newSiteName,   setNewSiteName]   = useState('');
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');

  const currentClient = clientsWithSites.find(c => c.id === clientId);

  function onClientChange(id: string) { setClientId(id); setSiteId(''); }

  async function submit() {
    if (mode === 'existing' && !clientId) { setError('Selecciona un cliente'); return; }
    if (mode === 'new' && !newClientName.trim()) { setError('El nombre del cliente es obligatorio'); return; }

    setLoading(true); setError('');
    const body = mode === 'existing'
      ? { clientId, siteId: siteId || null }
      : { newClientName: newClientName.trim(), newSiteName: newSiteName.trim() || null };

    try {
      const res = await fetch(`/api/pendientes/${deviceId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const b = await res.json() as { error?: string }; setError(b.error ?? 'Error'); }
      else onDone();
    } catch { setError('Error de red'); }
    finally { setLoading(false); }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Asignar equipo</h2>
        <p style={{ margin: 0, fontSize: '13px', color: '#94A3B8' }}>
          Equipo: <strong style={{ color: '#E2E8F0' }}>{hostname}</strong>
        </p>

        {/* Selector de modo */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['existing', 'new'] as const).map(m => (
            <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' }}>
              <input type="radio" value={m} checked={mode === m} onChange={() => { setMode(m); setError(''); }} />
              {m === 'existing' ? 'Cliente existente' : 'Crear cliente nuevo'}
            </label>
          ))}
        </div>

        {mode === 'existing' ? (
          <>
            <div>
              <label style={labelStyle}>Cliente</label>
              <select value={clientId} onChange={e => onClientChange(e.target.value)} style={inputStyle}>
                {clientsWithSites.length === 0
                  ? <option value="">Sin clientes disponibles</option>
                  : clientsWithSites.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Sede (opcional)</label>
              <select value={siteId} onChange={e => setSiteId(e.target.value)} style={inputStyle} disabled={!currentClient}>
                <option value="">Sin sede</option>
                {currentClient?.sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </>
        ) : (
          <>
            <div>
              <label style={labelStyle}>Nombre del cliente</label>
              <input type="text" value={newClientName} onChange={e => setNewClientName(e.target.value)}
                placeholder="p. ej. Clínica Pérez" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Nombre de la sede (opcional)</label>
              <input type="text" value={newSiteName} onChange={e => setNewSiteName(e.target.value)}
                placeholder="p. ej. Sede central" style={inputStyle} />
            </div>
          </>
        )}

        {error && <p style={errorStyle}>{error}</p>}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button style={btnBase} onClick={onClose} disabled={loading}>Cancelar</button>
          <button style={btnPrimary} onClick={submit} disabled={loading}>
            {loading ? 'Asignando…' : 'Asignar'}
          </button>
        </div>
      </div>
    </div>
  );
}
