'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { ClientSimple } from '@/lib/dashboard';

type ModalName = 'type' | 'move' | 'services' | 'revoke' | null;

const TYPE_OPTIONS = [
  { value: 'server',  label: 'Servidor' },
  { value: 'desktop', label: 'Sobremesa' },
  { value: 'laptop',  label: 'Portátil' },
  { value: 'nas',     label: 'NAS' },
  { value: 'ups',     label: 'SAI' },
];

// ─── Estilos base ────────────────────────────────────────────────────────────

const btnBase: React.CSSProperties = {
  padding: '8px 16px', borderRadius: '8px', fontSize: '14px', fontWeight: 500,
  cursor: 'pointer', border: '1px solid #1E293B', background: '#0F172A',
  color: '#E2E8F0', lineHeight: '1.4',
};

const btnPrimary: React.CSSProperties = {
  ...btnBase, background: '#1E3A5F', borderColor: '#4C8DFF', color: '#E2E8F0',
};

const btnDanger: React.CSSProperties = {
  ...btnBase, background: '#2D0F0F', borderColor: '#F87171', color: '#F87171',
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
  zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '16px',
};

const modalBox: React.CSSProperties = {
  background: '#0F172A', border: '1px solid #1E293B', borderRadius: '12px',
  padding: '24px', width: '100%', maxWidth: '480px',
  display: 'flex', flexDirection: 'column', gap: '16px',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '13px', color: '#94A3B8', marginBottom: '6px',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: '8px',
  border: '1px solid #1E293B', background: '#0A0F1E', color: '#E2E8F0',
  fontSize: '14px', boxSizing: 'border-box',
};

const errorStyle: React.CSSProperties = {
  fontSize: '13px', color: '#F87171', padding: '8px 12px',
  background: '#2D0F0F', borderRadius: '6px', border: '1px solid #F87171',
};

// ─── Componente principal ────────────────────────────────────────────────────

export function DeviceActions({
  deviceId,
  currentType,
  currentServices,
  clientsWithSites,
}: {
  deviceId:        string;
  currentType:     string | null;
  currentServices: string[];
  clientsWithSites: ClientSimple[];
}) {
  const router  = useRouter();
  const [modal, setModal] = useState<ModalName>(null);
  const closeModal = () => setModal(null);

  return (
    <>
      {/* Barra de botones */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
        <button style={btnBase} onClick={() => setModal('type')}>Cambiar tipo</button>
        <button style={btnBase} onClick={() => setModal('move')}>Mover equipo</button>
        <button style={btnBase} onClick={() => setModal('services')}>Servicios críticos</button>
        <button style={btnDanger} onClick={() => setModal('revoke')}>Revocar credencial</button>
      </div>

      {/* Modales */}
      {modal === 'type'     && <TypeModal     deviceId={deviceId} currentType={currentType}         onClose={closeModal} onDone={() => { closeModal(); router.refresh(); }} />}
      {modal === 'move'     && <MoveModal     deviceId={deviceId} clientsWithSites={clientsWithSites} onClose={closeModal} onDone={() => { closeModal(); router.refresh(); }} />}
      {modal === 'services' && <ServicesModal deviceId={deviceId} currentServices={currentServices}  onClose={closeModal} onDone={() => { closeModal(); router.refresh(); }} />}
      {modal === 'revoke'   && <RevokeModal   deviceId={deviceId}                                    onClose={closeModal} onDone={() => { closeModal(); router.refresh(); }} />}
    </>
  );
}

// ─── Modal: Cambiar tipo ─────────────────────────────────────────────────────

function TypeModal({ deviceId, currentType, onClose, onDone }: {
  deviceId: string; currentType: string | null;
  onClose: () => void; onDone: () => void;
}) {
  const [type, setType]       = useState(currentType ?? 'desktop');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  async function submit() {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/equipos/${deviceId}/type`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      if (!res.ok) { const b = await res.json() as { error?: string }; setError(b.error ?? 'Error'); }
      else onDone();
    } catch { setError('Error de red'); }
    finally { setLoading(false); }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Cambiar tipo de equipo</h2>
        <div>
          <label style={labelStyle}>Tipo</label>
          <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
            {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {error && <p style={errorStyle}>{error}</p>}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button style={btnBase} onClick={onClose} disabled={loading}>Cancelar</button>
          <button style={btnPrimary} onClick={submit} disabled={loading}>
            {loading ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Mover equipo ─────────────────────────────────────────────────────

function MoveModal({ deviceId, clientsWithSites, onClose, onDone }: {
  deviceId: string; clientsWithSites: ClientSimple[];
  onClose: () => void; onDone: () => void;
}) {
  const [clientId, setClientId] = useState(clientsWithSites[0]?.id ?? '');
  const [siteId, setSiteId]     = useState<string>('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const currentClient = clientsWithSites.find(c => c.id === clientId);

  function onClientChange(id: string) {
    setClientId(id);
    setSiteId('');
  }

  async function submit() {
    if (!clientId) { setError('Selecciona un cliente'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/equipos/${deviceId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, siteId: siteId || null }),
      });
      if (!res.ok) { const b = await res.json() as { error?: string }; setError(b.error ?? 'Error'); }
      else onDone();
    } catch { setError('Error de red'); }
    finally { setLoading(false); }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Mover equipo</h2>
        <p style={{ margin: 0, fontSize: '13px', color: '#94A3B8' }}>
          El historial, métricas y eventos del agente se conservan.
        </p>
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
        {error && <p style={errorStyle}>{error}</p>}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button style={btnBase} onClick={onClose} disabled={loading}>Cancelar</button>
          <button style={btnPrimary} onClick={submit} disabled={loading || !clientId}>
            {loading ? 'Moviendo…' : 'Mover'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Servicios críticos ───────────────────────────────────────────────

function ServicesModal({ deviceId, currentServices, onClose, onDone }: {
  deviceId: string; currentServices: string[];
  onClose: () => void; onDone: () => void;
}) {
  const [text, setText]       = useState(currentServices.join('\n'));
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  async function submit() {
    const services = text.split('\n').map(s => s.trim()).filter(Boolean);
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/equipos/${deviceId}/services`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services }),
      });
      if (!res.ok) { const b = await res.json() as { error?: string }; setError(b.error ?? 'Error'); }
      else onDone();
    } catch { setError('Error de red'); }
    finally { setLoading(false); }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Servicios críticos</h2>
        <div>
          <label style={labelStyle}>Un servicio por línea</label>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={6}
            placeholder={'MSSQLSERVER\nVeeamBackupSvc\nW3SVC'}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: 'monospace' }}
          />
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#94A3B8' }}>
            Usa el nombre interno del servicio de Windows (p. ej. MSSQLSERVER, VeeamBackupSvc).
            Al guardar, el agente recibirá la lista actualizada en su próxima llamada a /v1/config.
          </p>
        </div>
        {error && <p style={errorStyle}>{error}</p>}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button style={btnBase} onClick={onClose} disabled={loading}>Cancelar</button>
          <button style={btnPrimary} onClick={submit} disabled={loading}>
            {loading ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal: Revocar credencial ───────────────────────────────────────────────

function RevokeModal({ deviceId, onClose, onDone }: {
  deviceId: string; onClose: () => void; onDone: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  async function submit() {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/equipos/${deviceId}/revoke-credential`, { method: 'POST' });
      if (!res.ok) { const b = await res.json() as { error?: string }; setError(b.error ?? 'Error'); }
      else onDone();
    } catch { setError('Error de red'); }
    finally { setLoading(false); }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalBox} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>Revocar credencial del agente</h2>
        <p style={{ margin: 0, fontSize: '14px', color: '#94A3B8', lineHeight: '1.6' }}>
          El agente recibirá <strong style={{ color: '#F87171' }}>401</strong> en su próximo envío
          y dejará de reportar datos. Para recuperarlo, reinstalarlo con un token de alta válido
          (el hardware y el historial se conservan).
        </p>
        {error && <p style={errorStyle}>{error}</p>}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button style={btnBase} onClick={onClose} disabled={loading}>Cancelar</button>
          <button style={btnDanger} onClick={submit} disabled={loading}>
            {loading ? 'Revocando…' : 'Revocar'}
          </button>
        </div>
      </div>
    </div>
  );
}
