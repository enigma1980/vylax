'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { securityChecks, performanceChecks } from '@/lib/device-checks';
import { applyFilters, computeCounts, hasIssues, type FilterType } from '@/lib/device-filters';
import { useBreadcrumb } from '@/lib/breadcrumb';
import type { ClientDetail, DeviceRow } from '@/lib/dashboard';
import type { SiteRow, TokenRow } from '@/lib/sites-tokens';

interface Props {
  client:  ClientDetail;
  devices: DeviceRow[];
  sites:   SiteRow[];
  tokens:  TokenRow[];
  role:    string;
}

type TabType = 'equipos' | 'sedes' | 'tokens' | 'ajustes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function fmtGb(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  return (bytes / 1_073_741_824).toFixed(1) + ' GB';
}

function fmtPct(v: number | null | undefined): string {
  return v == null ? '—' : Math.round(v) + ' %';
}

function getLanIp(d: DeviceRow): string {
  for (const a of d.network?.adapters ?? []) {
    if (a.ipv4?.length) return a.ipv4[0];
  }
  return '—';
}

function getLinkSpeedLabel(d: DeviceRow): string {
  const speed = d.network?.adapters?.[0]?.link_speed_mbps;
  if (!speed) return '';
  return speed >= 1000 ? ` · ${speed / 1000} Gbps` : ` · ${speed} Mbps`;
}

function fullestDisk(vols: DeviceRow['volumes']): { mount: string; usedPct: number } | null {
  if (!vols?.length) return null;
  let best = { mount: '', usedPct: -1 };
  for (const v of vols) {
    if (!v.total_bytes) continue;
    const pct = Math.round(((v.total_bytes - v.free_bytes) / v.total_bytes) * 100);
    if (pct > best.usedPct) best = { mount: v.mount, usedPct: pct };
  }
  return best.usedPct >= 0 ? best : null;
}

function diskColor(pct: number): string {
  if (pct >= 95) return 'var(--red)';
  if (pct >= 85) return 'var(--amber)';
  return 'var(--text)';
}

const STATUS_DOT: Record<string, string> = {
  online:       'var(--green)',
  no_report:    'var(--amber)',
  disconnected: 'var(--text-sec)',
  suspended:    'var(--accent)',
};

const STATUS_LABEL: Record<string, string> = {
  online:       'En línea',
  no_report:    'Sin reportar',
  disconnected: 'Sin conexión',
  suspended:    'Suspendido',
};

const STATUS_BADGE_BG: Record<string, string> = {
  online:       'rgba(61,214,140,0.12)',
  no_report:    'rgba(245,185,66,0.12)',
  disconnected: 'rgba(148,163,171,0.12)',
  suspended:    'rgba(76,141,255,0.12)',
};

const TYPE_LABEL: Record<string, string> = {
  server: 'Servidor',
  pc:     'Sobremesa',
  laptop: 'Portátil',
  nas:    'NAS',
  ups:    'SAI',
};

const EVENT_LABEL: Record<string, string> = {
  device_enrolled:   'Alta del equipo',
  device_reenrolled: 'Re-alta del equipo',
  system_boot:       'Arranque',
  system_shutdown:   'Apagado',
  system_sleep:      'Suspensión',
  system_resume:     'Reanudación',
  suspend:           'Suspensión',
  resume:            'Reanudación',
  shutdown:          'Apagado',
  boot:              'Arranque',
  service_stopped:   'Servicio detenido',
  service_started:   'Servicio iniciado',
};

const RING_COLOR: Record<string, string> = {
  ok:   'var(--green)',
  warn: 'var(--amber)',
  crit: 'var(--red)',
};

const CIRC = 302;

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function ClientDetailView({ client, devices, sites, tokens, role }: Props) {
  const router             = useRouter();
  const { setCrumbs }      = useBreadcrumb();
  const [tab,        setTab]        = useState<TabType>('equipos');
  const [siteFilter, setSiteFilter] = useState('');
  const [filter,     setFilter]     = useState<FilterType>('all');
  const [selId,      setSelId]      = useState<string | null>(null);

  // Migas de pan dinámicas en la barra superior
  useEffect(() => {
    setCrumbs([
      { label: 'Clientes', href: '/clientes' },
      { label: client.name },
    ]);
    return () => setCrumbs([]);
  }, [client.name, setCrumbs]);

  const filtered    = applyFilters(devices, siteFilter, filter);
  const counts      = computeCounts(devices, siteFilter);
  const selectedDev = selId ? (devices.find(d => d.id === selId) ?? null) : null;

  const chips: { key: FilterType; label: string }[] = [
    { key: 'all',        label: `Todos ${counts.all}` },
    { key: 'con_avisos', label: `Con avisos ${counts.con_avisos}` },
    { key: 'server',     label: `Servidores ${counts.server}` },
    { key: 'pc',         label: `PCs ${counts.pc}` },
    { key: 'laptop',     label: `Portátiles ${counts.laptop}` },
  ];

  const tabs: { key: TabType; label: string }[] = [
    { key: 'equipos', label: 'Equipos' },
    { key: 'sedes',   label: 'Sedes' },
    { key: 'tokens',  label: 'Tokens de alta' },
    ...(role === 'admin' ? [{ key: 'ajustes' as TabType, label: 'Ajustes' }] : []),
  ];

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'flex-start' }}>

      {/* ── Sección principal ─────────────────────────────────── */}
      <section style={{ flex: '999 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* Cabecera del cliente */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <Link href="/clientes"
              style={{ color: 'var(--text-sec)', fontSize: '22px', lineHeight: '1.3', textDecoration: 'none', flexShrink: 0 }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-sec)')}
              aria-label="Volver a Clientes">
              ←
            </Link>
            <div>
              <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 600 }}>{client.name}</h1>
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-sec)' }}>
                {client.sites.length > 0
                  ? client.sites.map(s => s.name).join(' · ')
                  : 'Sin sedes'}
                {client.deviceCount > 0 && ` · ${client.deviceCount} equipo${client.deviceCount !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
          {role === 'admin' && <AddDeviceButton clientId={client.id} />}
        </div>

        {/* Pestañas */}
        <div role="tablist" aria-label="Secciones del cliente"
          style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--border)' }}>
          {tabs.map(t => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              style={{
                background: 'none', border: 'none',
                borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
                color: tab === t.key ? 'var(--text)' : 'var(--text-sec)',
                padding: '10px 14px', font: 'inherit', fontSize: '14px',
                fontWeight: tab === t.key ? 600 : 400, cursor: 'pointer',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Pestaña Equipos */}
        {tab === 'equipos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* Filtros */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              {client.sites.length > 1 && (
                <select value={siteFilter}
                  onChange={e => { setSiteFilter(e.target.value); setSelId(null); }}
                  style={{
                    background: 'var(--card)', border: '1px solid var(--border)',
                    borderRadius: '8px', color: 'var(--text)',
                    padding: '6px 10px', font: 'inherit', fontSize: '13px',
                    cursor: 'pointer', outline: 'none',
                  }}>
                  <option value="">Todas las sedes</option>
                  {client.sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              {chips.map(c => (
                <button key={c.key} type="button"
                  onClick={() => { setFilter(c.key); setSelId(null); }}
                  style={{
                    border: `1px solid ${filter === c.key ? 'var(--accent)' : 'var(--border)'}`,
                    background: filter === c.key ? 'var(--active-nav)' : 'var(--card)',
                    color: filter === c.key ? 'var(--text)' : 'var(--text-sec)',
                    borderRadius: '999px', padding: '6px 12px',
                    font: 'inherit', fontSize: '13px', cursor: 'pointer',
                  }}>
                  {c.label}
                </button>
              ))}
            </div>

            {/* Tabla */}
            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '760px' }}>
                <thead>
                  <tr style={{ color: 'var(--text-sec)', fontSize: '12px', textAlign: 'left' }}>
                    {['Equipo', 'Tipo', 'IP', 'Sistema', 'CPU', 'RAM', 'Disco más lleno', 'Último contacto'].map(h => (
                      <th key={h} style={{ padding: '12px', fontWeight: 500, borderBottom: '1px solid var(--border)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={8} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-sec)' }}>
                      No hay equipos con estos filtros
                    </td></tr>
                  ) : filtered.map(d => {
                    const disk  = fullestDisk(d.volumes);
                    const isSel = d.id === selId;
                    return (
                      <tr key={d.id} onClick={() => setSelId(isSel ? null : d.id)}
                        style={{ cursor: 'pointer', background: isSel ? '#1F2A44' : 'transparent' }}>
                        <td style={{ padding: '12px', borderBottom: '1px solid #232529' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                            <span style={{
                              width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                              background: STATUS_DOT[d.status] ?? 'var(--text-sec)',
                            }} />
                            {d.hostname}
                            {hasIssues(d) && (
                              <span style={{ fontSize: '11px', color: 'var(--amber)' }} title="Con avisos">⚠</span>
                            )}
                          </span>
                        </td>
                        <td style={{ padding: '12px', borderBottom: '1px solid #232529', color: 'var(--text-sec)' }}>
                          {d.effType ? (TYPE_LABEL[d.effType] ?? d.effType) : '—'}
                        </td>
                        <td style={{ padding: '12px', borderBottom: '1px solid #232529', color: 'var(--text-sec)' }}>
                          {getLanIp(d)}
                        </td>
                        <td style={{ padding: '12px', borderBottom: '1px solid #232529', color: 'var(--text-sec)', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.osName ?? '—'}
                        </td>
                        <td style={{ padding: '12px', borderBottom: '1px solid #232529' }}>{fmtPct(d.cpuAvgPct)}</td>
                        <td style={{ padding: '12px', borderBottom: '1px solid #232529' }}>{fmtPct(d.memoryUsedAvgPct)}</td>
                        <td style={{ padding: '12px', borderBottom: '1px solid #232529' }}>
                          {disk ? <span style={{ color: diskColor(disk.usedPct) }}>{disk.mount} {disk.usedPct} %</span> : '—'}
                        </td>
                        <td style={{ padding: '12px', borderBottom: '1px solid #232529', color: 'var(--text-sec)' }}>
                          {timeAgo(d.lastSeenAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Pestaña Sedes */}
        {tab === 'sedes' && (
          <SedesTab
            sites={sites}
            remotosCount={devices.filter(d => d.siteId === null).length}
            clientId={client.id}
            role={role}
            onRefresh={() => router.refresh()}
          />
        )}

        {/* Pestaña Tokens */}
        {tab === 'tokens' && (
          <TokensTab
            tokens={tokens}
            sites={sites}
            clientId={client.id}
            role={role}
            onRefresh={() => router.refresh()}
          />
        )}

        {/* Pestaña Ajustes */}
        {tab === 'ajustes' && (
          <div className="soon-wrap">
            <p className="soon-sub">Ajustes — se implementa en la parte 5 del plan</p>
          </div>
        )}
      </section>

      {/* ── Panel lateral de detalle (hermano de la sección, no dentro de pestañas) */}
      {selectedDev && (
        <aside aria-label={`Detalle de ${selectedDev.hostname}`}
          style={{
            flex: '0 0 380px', minWidth: 0,
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: '12px', padding: '20px',
            display: 'flex', flexDirection: 'column', gap: '18px',
          }}>
          <DevicePanel device={selectedDev} onClose={() => setSelId(null)} />
        </aside>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Botón "Añadir equipo" con modal
// ---------------------------------------------------------------------------

function AddDeviceButton({ clientId }: { clientId: string }) {
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [token,   setToken]   = useState<string | null>(null);
  const [err,     setErr]     = useState<string | null>(null);
  const [copied,  setCopied]  = useState(false);

  const generate = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/clientes/${clientId}/tokens`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { fullToken: string };
      setToken(data.fullToken);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  function open_modal() { setOpen(true); setToken(null); setErr(null); }

  function copyCommand() {
    if (!token) return;
    navigator.clipboard.writeText(`vylax-agent.exe --token ${token}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <button type="button" onClick={open_modal}
        style={{
          border: 0, background: 'var(--accent)', color: '#0B1220',
          borderRadius: '8px', padding: '9px 14px',
          font: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
        }}>
        + Añadir equipo
      </button>

      {open && (
        <div role="dialog" aria-modal="true" aria-label="Añadir equipo"
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
          }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div style={{
            background: '#16171A', border: '1px solid var(--border)',
            borderRadius: '14px', padding: '28px', width: '100%', maxWidth: '480px',
            display: 'flex', flexDirection: 'column', gap: '16px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>Añadir equipo</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar"
                style={{
                  background: 'none', border: '1px solid var(--border)', borderRadius: '8px',
                  color: 'var(--text-sec)', width: '32px', height: '32px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18"/>
                </svg>
              </button>
            </div>

            {!token ? (
              <>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-sec)' }}>
                  Genera un token de alta para instalar el agente en un nuevo equipo.
                  El token completo solo se muestra una vez.
                </p>
                {err && <p style={{ margin: 0, fontSize: '13px', color: 'var(--red)' }}>{err}</p>}
                <button type="button" onClick={generate} disabled={loading}
                  style={{
                    border: 0, background: 'var(--accent)', color: '#0B1220',
                    borderRadius: '8px', padding: '10px 16px',
                    font: 'inherit', fontSize: '14px', fontWeight: 600,
                    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
                  }}>
                  {loading ? 'Generando…' : 'Generar token de alta'}
                </button>
              </>
            ) : (
              <>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-sec)' }}>
                  Ejecuta este comando en el equipo a dar de alta. El token no se puede recuperar.
                </p>
                <div style={{
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: '8px', padding: '12px 14px',
                  fontFamily: 'monospace', fontSize: '12px', color: 'var(--accent)',
                  wordBreak: 'break-all', userSelect: 'all',
                }}>
                  vylax-agent.exe --token {token}
                </div>
                <button type="button" onClick={copyCommand}
                  style={{
                    border: '1px solid var(--border)', background: 'none', color: 'var(--text)',
                    borderRadius: '8px', padding: '10px 16px',
                    font: 'inherit', fontSize: '13px', cursor: 'pointer',
                  }}>
                  {copied ? '¡Copiado!' : 'Copiar comando de instalación'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Panel lateral de detalle
// ---------------------------------------------------------------------------

function DevicePanel({ device, onClose }: { device: DeviceRow; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const now      = new Date();
  const secRing  = securityChecks({
    antivirus:     device.antivirus,
    windowsUpdate: device.windowsUpdate,
    osInfo:        { build: device.osBuild ?? undefined, name: device.osName ?? undefined },
  }, now);
  const perfRing = performanceChecks({
    cpuAvgPct:        device.cpuAvgPct,
    memoryUsedAvgPct: device.memoryUsedAvgPct,
    volumes:          device.volumes,
    physicalDisks:    device.physicalDisks,
  });

  const lanIp  = getLanIp(device);
  const avList = Array.isArray(device.antivirus)
    ? (device.antivirus as Array<{ product: string; enabled: boolean; up_to_date: boolean }>)
    : [];
  const avOk    = avList.find(av => av.enabled && av.up_to_date);
  const avText  = avOk ? `${avOk.product} · al día` : avList.length ? `${avList[0].product} · problema` : 'Sin datos';
  const avColor = avOk ? 'var(--green)' : avList.length ? 'var(--red)' : 'var(--text-sec)';

  const wu = device.windowsUpdate as { last_installed_at?: string } | null;
  let wuText = 'Sin datos'; let wuColor = 'var(--text-sec)';
  if (wu?.last_installed_at) {
    const days = Math.floor((now.getTime() - new Date(wu.last_installed_at).getTime()) / 86_400_000);
    wuText  = `Hace ${days} días`;
    wuColor = days <= 45 ? 'var(--green)' : 'var(--amber)';
  }

  // Qué comprobaciones fallan en cada anillo (nombre del problema)
  const secFail  = secRing.details.filter(d => d.status !== 'ok' && d.status !== 'no-data').map(d => d.failLabel);
  const perfFail = perfRing.details.filter(d => d.status !== 'ok' && d.status !== 'no-data').map(d => d.failLabel);

  function copyIp() {
    navigator.clipboard.writeText(lanIp).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const typeLabel = device.effType ? (TYPE_LABEL[device.effType] ?? device.effType) : null;
  const subtitle  = [device.manufacturer, typeLabel, device.osName].filter(Boolean).join(' · ');

  return (
    <>
      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div style={{
          width: '56px', height: '56px', borderRadius: '12px',
          background: '#23262B', color: 'var(--text-sec)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <DeviceTypeIcon type={device.effType} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {device.hostname}
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-sec)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subtitle || 'SO desconocido'}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar detalle"
          style={{
            width: '36px', height: '36px', borderRadius: '8px',
            border: '1px solid var(--border)', background: 'none',
            color: 'var(--text-sec)', cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18"/>
          </svg>
        </button>
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {hasIssues(device) && (
          <span style={{ fontSize: '12px', fontWeight: 600, padding: '3px 9px', borderRadius: '999px',
            color: '#F5B942', background: '#3A2E14' }}>Aviso</span>
        )}
        <span style={{
          fontSize: '12px', fontWeight: 600, padding: '3px 9px', borderRadius: '999px',
          color: STATUS_DOT[device.status] ?? 'var(--text-sec)',
          background: STATUS_BADGE_BG[device.status] ?? 'rgba(148,163,171,0.12)',
        }}>
          {STATUS_LABEL[device.status] ?? device.status} · {timeAgo(device.lastSeenAt)}
        </span>
      </div>

      {/* Anillos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
        <RingCard label="Seguridad"   ring={secRing}  subtitle={secFail.length  ? secFail.join(', ')  : 'Sin incidencias'} />
        <RingCard label="Rendimiento" ring={perfRing} subtitle={perfFail.length ? perfFail.join(', ') : 'Sin incidencias'} />
      </div>

      {/* Datos rápidos */}
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', fontSize: '13px' }}>
        <dt style={{ color: 'var(--text-sec)' }}>IP</dt>
        <dd style={{ margin: 0 }}>{lanIp}{getLinkSpeedLabel(device)}</dd>

        <dt style={{ color: 'var(--text-sec)' }}>Usuario</dt>
        <dd style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {device.loggedOnUser ?? '—'}
        </dd>

        <dt style={{ color: 'var(--text-sec)' }}>CPU · RAM</dt>
        <dd style={{ margin: 0 }}>
          {fmtPct(device.cpuAvgPct)} · {fmtPct(device.memoryUsedAvgPct)}
          {device.ramTotalBytes ? ` de ${fmtGb(device.ramTotalBytes)}` : ''}
        </dd>

        <dt style={{ color: 'var(--text-sec)' }}>Antivirus</dt>
        <dd style={{ margin: 0, color: avColor }}>{avText}</dd>

        <dt style={{ color: 'var(--text-sec)' }}>Actualizaciones</dt>
        <dd style={{ margin: 0, color: wuColor }}>{wuText}</dd>

        {device.agentVersion && (
          <>
            <dt style={{ color: 'var(--text-sec)' }}>Agente</dt>
            <dd style={{ margin: 0 }}>
              {device.agentVersion}
              {device.agentMemBytes ? ` · ${Math.round(device.agentMemBytes / 1_048_576)} MB` : ''}
            </dd>
          </>
        )}
      </dl>

      {/* Volúmenes */}
      {device.volumes?.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Volúmenes</h3>
          {device.volumes.map((v, i) => {
            const usedPct = v.total_bytes > 0
              ? Math.round(((v.total_bytes - v.free_bytes) / v.total_bytes) * 100) : 0;
            const col    = diskColor(usedPct);
            const label  = v.mount + (v.label ? ` ${v.label}` : '');
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span>{label}</span>
                  <span style={{ color: col }}>{usedPct} % · {fmtGb(v.free_bytes)} libres</span>
                </div>
                <div style={{ height: '6px', background: 'var(--border)', borderRadius: '999px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${usedPct}%`, background: col, borderRadius: '999px' }} />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Últimos eventos */}
      {device.lastEvents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Últimos eventos</h3>
          {device.lastEvents.map((ev, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', fontSize: '13px' }}>
              <span style={{ color: 'var(--text-sec)', width: '52px', flexShrink: 0, fontSize: '12px' }}>
                {new Date(ev.occurredAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span>{EVENT_LABEL[ev.eventType] ?? ev.eventType}</span>
            </div>
          ))}
        </div>
      )}

      {/* Botones */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <Link href={`/equipos/${device.id}`}
          style={{
            flex: 1, textAlign: 'center', textDecoration: 'none',
            background: 'var(--accent)', color: '#0B1220',
            borderRadius: '8px', padding: '10px 14px',
            fontSize: '13px', fontWeight: 600,
          }}>
          Abrir ficha completa
        </Link>
        <button type="button" onClick={copyIp}
          style={{
            border: '1px solid var(--border)', background: 'none', color: 'var(--text)',
            borderRadius: '8px', padding: '10px 14px',
            font: 'inherit', fontSize: '13px', cursor: 'pointer',
          }}>
          {copied ? '¡Copiada!' : 'Copiar IP'}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Anillo SVG
// ---------------------------------------------------------------------------

function RingCard({ label, ring, subtitle }: {
  label:    string;
  ring:     ReturnType<typeof securityChecks>;
  subtitle: string;
}) {
  const { ok, total, color } = ring.result;
  const dash = total > 0 ? Math.round(CIRC * (ok / total)) : 0;
  const col  = RING_COLOR[color] ?? 'var(--accent)';

  return (
    <div style={{
      background: '#141518', border: '1px solid var(--border)',
      borderRadius: '10px', padding: '12px',
      display: 'flex', alignItems: 'center', gap: '10px',
      minWidth: 0,
    }}>
      <div style={{ position: 'relative', width: '56px', height: '56px', flexShrink: 0 }}>
        <svg viewBox="0 0 120 120" width="56" height="56" role="img" aria-label={`${label}: ${ok} de ${total}`}>
          <circle cx="60" cy="60" r="48" fill="none" stroke="var(--border)" strokeWidth="14" />
          <circle cx="60" cy="60" r="48" fill="none" stroke={col} strokeWidth="14"
            strokeDasharray={`${dash} ${CIRC}`} transform="rotate(-90 60 60)" strokeLinecap="round" />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '13px', fontWeight: 700,
        }}>
          {ok}/{total}
        </div>
      </div>
      <div style={{ fontSize: '13px', minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div style={{ color: 'var(--text-sec)', fontSize: '12px', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {subtitle}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pestaña Sedes
// ---------------------------------------------------------------------------

function parseIps(text: string): string[] {
  return text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
}

function SedesTab({
  sites, remotosCount, clientId, role, onRefresh,
}: {
  sites:         SiteRow[];
  remotosCount:  number;
  clientId:      string;
  role:           string;
  onRefresh:     () => void;
}) {
  const [modal,   setModal]   = useState<'create' | 'edit' | 'delete' | null>(null);
  const [current, setCurrent] = useState<SiteRow | null>(null);
  const [name,    setName]    = useState('');
  const [ipsText, setIpsText] = useState('');
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState<string | null>(null);

  function openCreate() { setModal('create'); setCurrent(null); setName(''); setIpsText(''); setErr(null); }
  function openEdit(s: SiteRow) { setModal('edit'); setCurrent(s); setName(s.name); setIpsText(s.publicIps.join('\n')); setErr(null); }
  function openDelete(s: SiteRow) { setModal('delete'); setCurrent(s); setErr(null); }
  function close() { setModal(null); setCurrent(null); }

  async function save() {
    setLoading(true); setErr(null);
    const publicIps = parseIps(ipsText);
    try {
      if (modal === 'create') {
        const res = await fetch(`/api/clientes/${clientId}/sites`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), publicIps }),
        });
        if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? 'Error'); }
      } else if (modal === 'edit' && current) {
        const res = await fetch(`/api/clientes/${clientId}/sites/${current.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), publicIps }),
        });
        if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? 'Error'); }
      }
      close(); onRefresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }

  async function confirmDelete() {
    if (!current) return;
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/clientes/${clientId}/sites/${current.id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? 'Error'); }
      close(); onRefresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px',
    color: 'var(--text)', padding: '9px 12px', font: 'inherit', fontSize: '13px',
    width: '100%', outline: 'none', boxSizing: 'border-box',
  };
  const btnPrimary: React.CSSProperties = {
    border: 0, background: 'var(--accent)', color: '#0B1220',
    borderRadius: '8px', padding: '10px 16px',
    font: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  };
  const btnSecondary: React.CSSProperties = {
    border: '1px solid var(--border)', background: 'none', color: 'var(--text)',
    borderRadius: '8px', padding: '10px 16px',
    font: 'inherit', fontSize: '13px', cursor: 'pointer',
  };
  const btnDanger: React.CSSProperties = {
    border: 0, background: 'var(--red)', color: '#fff',
    borderRadius: '8px', padding: '10px 16px',
    font: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  };

  const allSites = [...sites];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Sedes ({sites.length})</h2>
        {role === 'admin' && (
          <button type="button" onClick={openCreate} style={btnPrimary}>+ Nueva sede</button>
        )}
      </div>

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ color: 'var(--text-sec)', fontSize: '12px', textAlign: 'left' }}>
              {['Nombre', 'IPs Públicas', 'Equipos', ...(role === 'admin' ? ['Acciones'] : [])].map(h => (
                <th key={h} style={{ padding: '12px', fontWeight: 500, borderBottom: '1px solid var(--border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allSites.map(s => (
              <tr key={s.id}>
                <td style={{ padding: '12px', borderBottom: '1px solid #232529', fontWeight: 500 }}>{s.name}</td>
                <td style={{ padding: '12px', borderBottom: '1px solid #232529', color: 'var(--text-sec)' }}>
                  {s.publicIps.length ? s.publicIps.join(', ') : '—'}
                </td>
                <td style={{ padding: '12px', borderBottom: '1px solid #232529' }}>{s.deviceCount}</td>
                {role === 'admin' && (
                  <td style={{ padding: '12px', borderBottom: '1px solid #232529' }}>
                    <span style={{ display: 'flex', gap: '8px' }}>
                      <button type="button" onClick={() => openEdit(s)} style={{ ...btnSecondary, padding: '5px 12px', fontSize: '12px' }}>Editar</button>
                      <button type="button" onClick={() => openDelete(s)} style={{ ...btnDanger, padding: '5px 12px', fontSize: '12px', opacity: s.deviceCount > 0 ? 0.5 : 1 }}>Borrar</button>
                    </span>
                  </td>
                )}
              </tr>
            ))}
            {/* Remotos / sin sede — siempre al final */}
            <tr>
              <td style={{ padding: '12px', color: 'var(--text-sec)', fontStyle: 'italic' }}>Remotos / sin sede</td>
              <td style={{ padding: '12px', color: 'var(--text-sec)' }}>Asignación por IP</td>
              <td style={{ padding: '12px' }}>{remotosCount}</td>
              {role === 'admin' && <td style={{ padding: '12px' }} />}
            </tr>
            {allSites.length === 0 && remotosCount === 0 && (
              <tr>
                <td colSpan={role === 'admin' ? 4 : 3}
                  style={{ padding: '24px', textAlign: 'center', color: 'var(--text-sec)' }}>
                  Sin sedes creadas
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal crear / editar */}
      {(modal === 'create' || modal === 'edit') && (
        <div role="dialog" aria-modal="true" aria-label={modal === 'create' ? 'Nueva sede' : 'Editar sede'}
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={e => { if (e.target === e.currentTarget) close(); }}>
          <div style={{ background: '#16171A', border: '1px solid var(--border)', borderRadius: '14px',
            padding: '28px', width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>
                {modal === 'create' ? 'Nueva sede' : 'Editar sede'}
              </h2>
              <button type="button" onClick={close} aria-label="Cerrar"
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '8px',
                  color: 'var(--text-sec)', width: '32px', height: '32px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18"/>
                </svg>
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-sec)' }}>Nombre</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre de la sede" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-sec)' }}>IPs públicas (una por línea o separadas por coma)</label>
              <textarea value={ipsText} onChange={e => setIpsText(e.target.value)}
                placeholder="203.0.113.1&#10;203.0.113.2"
                rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
            {err && <p style={{ margin: 0, fontSize: '13px', color: 'var(--red)' }}>{err}</p>}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={close} style={btnSecondary}>Cancelar</button>
              <button type="button" onClick={save} disabled={loading || !name.trim()}
                style={{ ...btnPrimary, opacity: loading || !name.trim() ? 0.7 : 1, cursor: loading || !name.trim() ? 'not-allowed' : 'pointer' }}>
                {loading ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar borrar */}
      {modal === 'delete' && current && (
        <div role="dialog" aria-modal="true" aria-label="Confirmar eliminación"
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={e => { if (e.target === e.currentTarget) close(); }}>
          <div style={{ background: '#16171A', border: '1px solid var(--border)', borderRadius: '14px',
            padding: '28px', width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>Eliminar sede</h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-sec)' }}>
              ¿Eliminar «{current.name}»? Esta acción no se puede deshacer.
            </p>
            {err && <p style={{ margin: 0, fontSize: '13px', color: 'var(--red)' }}>{err}</p>}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={close} style={btnSecondary}>Cancelar</button>
              <button type="button" onClick={confirmDelete} disabled={loading}
                style={{ ...btnDanger, opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
                {loading ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pestaña Tokens de alta
// ---------------------------------------------------------------------------

function TokensTab({
  tokens, sites, clientId, role, onRefresh,
}: {
  tokens:    TokenRow[];
  sites:     SiteRow[];
  clientId:  string;
  role:       string;
  onRefresh: () => void;
}) {
  const [modal,       setModal]       = useState<'create' | 'show' | 'revoke' | 'rotate_confirm' | 'rotate_show' | null>(null);
  const [current,     setCurrent]     = useState<TokenRow | null>(null);
  const [fullToken,   setFullToken]   = useState<string | null>(null);
  const [label,       setLabel]       = useState('');
  const [siteId,      setSiteId]      = useState<string>('');
  const [loading,     setLoading]     = useState(false);
  const [err,         setErr]         = useState<string | null>(null);
  const [copied,      setCopied]      = useState(false);

  function openCreate() { setModal('create'); setLabel(''); setSiteId(''); setErr(null); setFullToken(null); }
  function openRevoke(t: TokenRow) { setModal('revoke'); setCurrent(t); setErr(null); }
  function openRotate(t: TokenRow) { setModal('rotate_confirm'); setCurrent(t); setErr(null); }
  function close() { setModal(null); setCurrent(null); setFullToken(null); }

  function copyCommand() {
    if (!fullToken) return;
    navigator.clipboard.writeText(`vylax-agent.exe --token ${fullToken}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function createNewToken() {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/clientes/${clientId}/tokens`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || `Token ${new Date().toLocaleDateString('es')}`, siteId: siteId || null }),
      });
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? 'Error'); }
      const data = await res.json() as { fullToken: string };
      setFullToken(data.fullToken);
      setModal('show');
      onRefresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }

  async function confirmRevoke() {
    if (!current) return;
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/clientes/${clientId}/tokens/${current.id}/revoke`, { method: 'POST' });
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? 'Error'); }
      close(); onRefresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }

  async function confirmRotate() {
    if (!current) return;
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/clientes/${clientId}/tokens/${current.id}/rotate`, { method: 'POST' });
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? 'Error'); }
      const data = await res.json() as { fullToken: string };
      setFullToken(data.fullToken);
      setModal('rotate_show');
      onRefresh();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setLoading(false); }
  }

  function fmtDate(iso: string | null) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px',
    color: 'var(--text)', padding: '9px 12px', font: 'inherit', fontSize: '13px',
    width: '100%', outline: 'none', boxSizing: 'border-box',
  };
  const btnPrimary: React.CSSProperties = {
    border: 0, background: 'var(--accent)', color: '#0B1220',
    borderRadius: '8px', padding: '10px 16px',
    font: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  };
  const btnSecondary: React.CSSProperties = {
    border: '1px solid var(--border)', background: 'none', color: 'var(--text)',
    borderRadius: '8px', padding: '10px 16px',
    font: 'inherit', fontSize: '13px', cursor: 'pointer',
  };
  const btnDanger: React.CSSProperties = {
    border: 0, background: 'var(--red)', color: '#fff',
    borderRadius: '8px', padding: '10px 16px',
    font: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  };
  const btnSmall = (base: React.CSSProperties): React.CSSProperties =>
    ({ ...base, padding: '5px 12px', fontSize: '12px' });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Tokens de alta ({tokens.length})</h2>
        {role === 'admin' && (
          <button type="button" onClick={openCreate} style={btnPrimary}>+ Nuevo token</button>
        )}
      </div>

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '600px' }}>
          <thead>
            <tr style={{ color: 'var(--text-sec)', fontSize: '12px', textAlign: 'left' }}>
              {['Etiqueta', 'Prefijo', 'Sede', 'Estado', 'Creado', 'Último uso', ...(role === 'admin' ? ['Acciones'] : [])].map(h => (
                <th key={h} style={{ padding: '12px', fontWeight: 500, borderBottom: '1px solid var(--border)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tokens.length === 0 ? (
              <tr><td colSpan={role === 'admin' ? 7 : 6} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-sec)' }}>
                Sin tokens creados
              </td></tr>
            ) : tokens.map(t => (
              <tr key={t.id}>
                <td style={{ padding: '12px', borderBottom: '1px solid #232529', fontWeight: 500 }}>{t.label}</td>
                <td style={{ padding: '12px', borderBottom: '1px solid #232529', fontFamily: 'monospace', fontSize: '12px', color: 'var(--accent)' }}>
                  {t.tokenPrefix}…
                </td>
                <td style={{ padding: '12px', borderBottom: '1px solid #232529', color: 'var(--text-sec)' }}>
                  {t.siteName ?? 'Asignación por IP'}
                </td>
                <td style={{ padding: '12px', borderBottom: '1px solid #232529' }}>
                  <span style={{
                    fontSize: '12px', fontWeight: 600, padding: '3px 9px', borderRadius: '999px',
                    color: t.revokedAt ? 'var(--text-sec)' : 'var(--green)',
                    background: t.revokedAt ? 'rgba(148,163,171,0.1)' : 'rgba(52,211,153,0.1)',
                  }}>
                    {t.revokedAt ? 'Revocado' : 'Activo'}
                  </span>
                </td>
                <td style={{ padding: '12px', borderBottom: '1px solid #232529', color: 'var(--text-sec)' }}>{fmtDate(t.createdAt)}</td>
                <td style={{ padding: '12px', borderBottom: '1px solid #232529', color: 'var(--text-sec)' }}>{fmtDate(t.lastUsedAt)}</td>
                {role === 'admin' && (
                  <td style={{ padding: '12px', borderBottom: '1px solid #232529' }}>
                    <span style={{ display: 'flex', gap: '6px' }}>
                      {!t.revokedAt && (
                        <>
                          <button type="button" onClick={() => openRotate(t)} style={btnSmall(btnSecondary)}>Rotar</button>
                          <button type="button" onClick={() => openRevoke(t)} style={btnSmall(btnDanger)}>Revocar</button>
                        </>
                      )}
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal crear token */}
      {modal === 'create' && (
        <div role="dialog" aria-modal="true" aria-label="Nuevo token de alta"
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={e => { if (e.target === e.currentTarget) close(); }}>
          <div style={{ background: '#16171A', border: '1px solid var(--border)', borderRadius: '14px',
            padding: '28px', width: '100%', maxWidth: '480px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>Nuevo token de alta</h2>
              <button type="button" onClick={close} aria-label="Cerrar"
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '8px',
                  color: 'var(--text-sec)', width: '32px', height: '32px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18"/>
                </svg>
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-sec)' }}>Etiqueta</label>
              <input value={label} onChange={e => setLabel(e.target.value)} placeholder="p. ej. Oficina central" style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '13px', color: 'var(--text-sec)' }}>Sede (opcional — sin sede: asignación por IP)</label>
              <select value={siteId} onChange={e => setSiteId(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">Asignación por IP</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {err && <p style={{ margin: 0, fontSize: '13px', color: 'var(--red)' }}>{err}</p>}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={close} style={btnSecondary}>Cancelar</button>
              <button type="button" onClick={createNewToken} disabled={loading}
                style={{ ...btnPrimary, opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
                {loading ? 'Generando…' : 'Generar token'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal mostrar token completo (crear o rotar) */}
      {(modal === 'show' || modal === 'rotate_show') && fullToken && (
        <div role="dialog" aria-modal="true" aria-label="Token generado"
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={e => { if (e.target === e.currentTarget) close(); }}>
          <div style={{ background: '#16171A', border: '1px solid var(--border)', borderRadius: '14px',
            padding: '28px', width: '100%', maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>
              {modal === 'rotate_show' ? 'Token rotado' : 'Token de alta generado'}
            </h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-sec)' }}>
              Copia el comando ahora. Este token <strong style={{ color: 'var(--text)' }}>no se puede recuperar</strong> una vez cerrado este diálogo.
            </p>
            <div style={{
              background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px',
              padding: '12px 14px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--accent)',
              wordBreak: 'break-all', userSelect: 'all',
            }}>
              vylax-agent.exe --token {fullToken}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={copyCommand} style={btnSecondary}>
                {copied ? '¡Copiado!' : 'Copiar comando de instalación'}
              </button>
              <button type="button" onClick={close} style={btnPrimary}>Hecho</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar revocar */}
      {modal === 'revoke' && current && (
        <div role="dialog" aria-modal="true" aria-label="Confirmar revocación"
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={e => { if (e.target === e.currentTarget) close(); }}>
          <div style={{ background: '#16171A', border: '1px solid var(--border)', borderRadius: '14px',
            padding: '28px', width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>Revocar token</h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-sec)' }}>
              ¿Revocar «{current.label}»? Los equipos ya registrados con este token no se verán afectados.
              No podrá usarse para registrar nuevos equipos.
            </p>
            {err && <p style={{ margin: 0, fontSize: '13px', color: 'var(--red)' }}>{err}</p>}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={close} style={btnSecondary}>Cancelar</button>
              <button type="button" onClick={confirmRevoke} disabled={loading}
                style={{ ...btnDanger, opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
                {loading ? 'Revocando…' : 'Revocar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar rotar */}
      {modal === 'rotate_confirm' && current && (
        <div role="dialog" aria-modal="true" aria-label="Confirmar rotación"
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
          onClick={e => { if (e.target === e.currentTarget) close(); }}>
          <div style={{ background: '#16171A', border: '1px solid var(--border)', borderRadius: '14px',
            padding: '28px', width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>Rotar token</h2>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-sec)' }}>
              El token actual «{current.label}» quedará revocado al instante y se creará uno nuevo.
              Los equipos ya registrados no se verán afectados.
            </p>
            {err && <p style={{ margin: 0, fontSize: '13px', color: 'var(--red)' }}>{err}</p>}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={close} style={btnSecondary}>Cancelar</button>
              <button type="button" onClick={confirmRotate} disabled={loading}
                style={{ ...btnPrimary, opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
                {loading ? 'Rotando…' : 'Rotar token'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Icono de tipo
// ---------------------------------------------------------------------------

function DeviceTypeIcon({ type }: { type: string | null }) {
  if (type === 'server') return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="4" y="3" width="16" height="7" rx="1.5"/><rect x="4" y="14" width="16" height="7" rx="1.5"/>
    </svg>
  );
  if (type === 'laptop') return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/>
    </svg>
  );
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>
    </svg>
  );
}
