'use client';
import { useState } from 'react';
import { securityChecks, performanceChecks } from '@/lib/device-checks';
import { applyFilters, computeCounts, type FilterType } from '@/lib/device-filters';
import { isOsSupported } from '@/lib/os-support';
import type { ClientDetail, DeviceRow } from '@/lib/dashboard';

interface Props {
  client:  ClientDetail;
  devices: DeviceRow[];
  role:    string;
}

type TabType = 'equipos' | 'sedes' | 'tokens' | 'ajustes';

// ---------------------------------------------------------------------------
// Helpers de presentación
// ---------------------------------------------------------------------------

function timeAgo(isoStr: string | null): string {
  if (!isoStr) return 'Nunca';
  const ms = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days} días`;
}

function fmtGb(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  return (bytes / 1_073_741_824).toFixed(1) + ' GB';
}

function fmtPct(pct: number | null | undefined): string {
  if (pct == null) return '—';
  return Math.round(pct) + ' %';
}

function getLanIp(device: DeviceRow): string {
  const adapters = device.network?.adapters;
  if (adapters?.length) {
    for (const a of adapters) {
      if (a.ipv4?.length) return a.ipv4[0];
    }
  }
  return '—';
}

function fullestDisk(vols: DeviceRow['volumes']): { mount: string; usedPct: number } | null {
  if (!vols?.length) return null;
  let best = { mount: '', usedPct: -1 };
  for (const v of vols) {
    if (!v.total_bytes || v.total_bytes === 0) continue;
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

const STATUS_COLOR: Record<string, string> = {
  online:       'var(--green)',
  disconnected: 'var(--text-sec)',
  suspended:    'var(--accent)',
  no_report:    'var(--amber)',
};

const STATUS_LABEL: Record<string, string> = {
  online:       'En línea',
  disconnected: 'Sin conexión',
  suspended:    'Suspendido',
  no_report:    'Sin reportar',
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
  device_reenrolled: 're-alta del equipo',
  system_boot:       'Arranque',
  system_shutdown:   'Apagado',
  system_sleep:      'Suspensión',
  system_resume:     'Reanudación',
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

export function ClientDetailView({ client, devices, role }: Props) {
  const [tab,        setTab]        = useState<TabType>('equipos');
  const [siteFilter, setSiteFilter] = useState('');
  const [filter,     setFilter]     = useState<FilterType>('all');
  const [selId,      setSelId]      = useState<string | null>(null);

  const filtered     = applyFilters(devices, siteFilter, filter);
  const counts       = computeCounts(devices, siteFilter);
  const selectedDev  = selId ? (devices.find(d => d.id === selId) ?? null) : null;

  const chips: { key: FilterType; label: string }[] = [
    { key: 'all',       label: `Todos ${counts.all}` },
    { key: 'online',    label: `En línea ${counts.online}` },
    { key: 'no_report', label: `Sin reportar ${counts.no_report}` },
    { key: 'server',    label: `Servidores ${counts.server}` },
    { key: 'pc',        label: `PCs ${counts.pc}` },
    { key: 'laptop',    label: `Portátiles ${counts.laptop}` },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Cabecera */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 600 }}>{client.name}</h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-sec)' }}>
            {client.sites.length} sede{client.sites.length !== 1 ? 's' : ''}
            {client.deviceCount > 0 && ` · ${client.deviceCount} equipo${client.deviceCount !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {/* Pestañas */}
      <div role="tablist" aria-label="Secciones del cliente" style={{
        display: 'flex', gap: '4px',
        borderBottom: '1px solid var(--border)',
      }}>
        {(['equipos', 'sedes', 'tokens', ...(role === 'admin' ? ['ajustes'] as const : [])] as TabType[]).map(t => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            style={{
              background: 'none', border: 'none',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t ? 'var(--text)' : 'var(--text-sec)',
              padding: '10px 14px',
              font: 'inherit', fontSize: '14px',
              fontWeight: tab === t ? 600 : 400,
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {t === 'tokens' ? 'Tokens de alta' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Pestaña Equipos */}
      {tab === 'equipos' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'flex-start' }}>

          {/* Sección principal */}
          <section style={{ flex: '999 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* Filtros */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              {client.sites.length > 1 && (
                <select
                  value={siteFilter}
                  onChange={e => { setSiteFilter(e.target.value); setSelId(null); }}
                  style={{
                    background: 'var(--card)', border: '1px solid var(--border)',
                    borderRadius: '8px', color: 'var(--text)',
                    padding: '6px 10px', font: 'inherit', fontSize: '13px',
                    cursor: 'pointer', outline: 'none',
                  }}
                >
                  <option value="">Todas las sedes</option>
                  {client.sites.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              )}
              {chips.map(c => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => { setFilter(c.key); setSelId(null); }}
                  style={{
                    border: `1px solid ${filter === c.key ? 'var(--accent)' : 'var(--border)'}`,
                    background: filter === c.key ? 'rgba(129,140,248,0.12)' : 'var(--card)',
                    color: filter === c.key ? 'var(--text)' : 'var(--text-sec)',
                    borderRadius: '999px', padding: '5px 12px',
                    font: 'inherit', fontSize: '13px', cursor: 'pointer',
                  }}
                >
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
                    <tr>
                      <td colSpan={8} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-sec)' }}>
                        No hay equipos con estos filtros
                      </td>
                    </tr>
                  ) : (
                    filtered.map(d => {
                      const disk    = fullestDisk(d.volumes);
                      const isSelRow = d.id === selId;
                      return (
                        <tr
                          key={d.id}
                          onClick={() => setSelId(isSelRow ? null : d.id)}
                          style={{
                            cursor: 'pointer',
                            background: isSelRow ? 'rgba(129,140,248,0.08)' : 'transparent',
                          }}
                        >
                          <td style={{ padding: '12px', borderBottom: '1px solid var(--border)' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                              <span style={{
                                width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                                background: STATUS_COLOR[d.status],
                              }} />
                              {d.hostname}
                            </span>
                          </td>
                          <td style={{ padding: '12px', borderBottom: '1px solid var(--border)', color: 'var(--text-sec)' }}>
                            {d.effType ? (TYPE_LABEL[d.effType] ?? d.effType) : '—'}
                          </td>
                          <td style={{ padding: '12px', borderBottom: '1px solid var(--border)', color: 'var(--text-sec)', fontFamily: 'monospace' }}>
                            {getLanIp(d)}
                          </td>
                          <td style={{ padding: '12px', borderBottom: '1px solid var(--border)', color: 'var(--text-sec)', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.osName ?? '—'}
                          </td>
                          <td style={{ padding: '12px', borderBottom: '1px solid var(--border)' }}>
                            {fmtPct(d.cpuAvgPct)}
                          </td>
                          <td style={{ padding: '12px', borderBottom: '1px solid var(--border)' }}>
                            {fmtPct(d.memoryUsedAvgPct)}
                          </td>
                          <td style={{ padding: '12px', borderBottom: '1px solid var(--border)' }}>
                            {disk ? (
                              <span style={{ color: diskColor(disk.usedPct) }}>
                                {disk.mount} {disk.usedPct} %
                              </span>
                            ) : '—'}
                          </td>
                          <td style={{ padding: '12px', borderBottom: '1px solid var(--border)', color: 'var(--text-sec)' }}>
                            {timeAgo(d.lastSeenAt)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Panel lateral */}
          {selectedDev && (
            <aside
              aria-label={`Detalle de ${selectedDev.hostname}`}
              style={{
                flex: '0 0 380px', minWidth: 0,
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: '12px', padding: '20px',
                display: 'flex', flexDirection: 'column', gap: '18px',
              }}
            >
              <DevicePanel device={selectedDev} onClose={() => setSelId(null)} />
            </aside>
          )}
        </div>
      )}

      {/* Pestañas pendientes */}
      {(tab === 'sedes' || tab === 'tokens' || tab === 'ajustes') && (
        <div className="soon-wrap">
          <p className="soon-sub">
            {tab === 'sedes' ? 'Sedes' : tab === 'tokens' ? 'Tokens de alta' : 'Ajustes'} — Parte 4{tab === 'ajustes' ? '/5' : ''} del plan
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel lateral de detalle
// ---------------------------------------------------------------------------

function DevicePanel({ device, onClose }: { device: DeviceRow; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const now        = new Date();
  const secRing    = securityChecks({
    antivirus:    device.antivirus,
    windowsUpdate: device.windowsUpdate,
    osInfo:       { build: device.osBuild ?? undefined, name: device.osName ?? undefined },
  }, now);
  const perfRing   = performanceChecks({
    cpuAvgPct:        device.cpuAvgPct,
    memoryUsedAvgPct: device.memoryUsedAvgPct,
    volumes:          device.volumes,
    physicalDisks:    device.physicalDisks,
  });
  const lanIp = getLanIp(device);

  function copyIp() {
    navigator.clipboard.writeText(lanIp).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Antivirus display
  const avList = Array.isArray(device.antivirus) ? device.antivirus : [];
  const avOk   = avList.find(av => av.enabled && av.up_to_date);
  const avText = avOk
    ? `${avOk.product} · al día`
    : avList.length ? `${avList[0].product} · problema` : 'Sin datos';
  const avColor = avOk ? 'var(--green)' : avList.length ? 'var(--red)' : 'var(--text-sec)';

  // Updates display
  const wu = device.windowsUpdate;
  let wuText = 'Sin datos'; let wuColor = 'var(--text-sec)';
  if (wu?.last_installed_at) {
    const days = Math.floor((now.getTime() - new Date(wu.last_installed_at).getTime()) / 86_400_000);
    wuText  = `Hace ${days} días`;
    wuColor = days <= 45 ? 'var(--green)' : 'var(--amber)';
  }

  return (
    <>
      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div style={{
          width: '48px', height: '48px', borderRadius: '10px',
          background: 'rgba(129,140,248,0.1)', color: 'var(--text-sec)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <DeviceTypeIcon type={device.effType} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {device.hostname}
          </h2>
          <p style={{ margin: '3px 0 0', fontSize: '12px', color: 'var(--text-sec)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {device.osName ?? 'SO desconocido'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar detalle"
          style={{
            width: '32px', height: '32px', borderRadius: '8px',
            border: '1px solid var(--border)', background: 'none',
            color: 'var(--text-sec)', cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18"/>
          </svg>
        </button>
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        <span style={{
          fontSize: '12px', fontWeight: 600, padding: '3px 9px', borderRadius: '999px',
          color: STATUS_COLOR[device.status],
          background: device.status === 'online' ? 'rgba(52,211,153,0.12)' : device.status === 'no_report' ? 'rgba(251,191,36,0.12)' : device.status === 'suspended' ? 'rgba(129,140,248,0.12)' : 'rgba(148,163,184,0.12)',
        }}>
          {STATUS_LABEL[device.status]} · {timeAgo(device.lastSeenAt)}
        </span>
        {device.effType && (
          <span style={{ fontSize: '12px', padding: '3px 9px', borderRadius: '999px', background: 'rgba(129,140,248,0.1)', color: 'var(--accent)' }}>
            {TYPE_LABEL[device.effType] ?? device.effType}
          </span>
        )}
      </div>

      {/* Anillos seguridad + rendimiento */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <RingCard label="Seguridad"    ring={secRing}  subtitle={secRingSubtitle(device)} />
        <RingCard label="Rendimiento"  ring={perfRing} subtitle={perfRingSubtitle(device)} />
      </div>

      {/* Datos rápidos */}
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '7px 14px', fontSize: '13px' }}>
        <dt style={{ color: 'var(--text-sec)' }}>IP</dt>
        <dd style={{ margin: 0 }}>{lanIp}{device.network?.adapters?.[0]?.link_speed_mbps ? ` · ${device.network.adapters[0].link_speed_mbps} Mbps` : ''}</dd>

        {device.loggedOnUser && (
          <>
            <dt style={{ color: 'var(--text-sec)' }}>Usuario</dt>
            <dd style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{device.loggedOnUser}</dd>
          </>
        )}

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>Volúmenes</h3>
          {device.volumes.map((v, i) => {
            const usedPct = v.total_bytes > 0
              ? Math.round(((v.total_bytes - v.free_bytes) / v.total_bytes) * 100)
              : 0;
            const col = diskColor(usedPct);
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span>{v.mount}{v.label ? ` ${v.label}` : ''}</span>
                  <span style={{ color: col }}>
                    {usedPct} % · {fmtGb(v.free_bytes)} libres
                  </span>
                </div>
                <div style={{ height: '5px', background: 'var(--border)', borderRadius: '999px', overflow: 'hidden' }}>
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
          <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 600 }}>Últimos eventos</h3>
          {device.lastEvents.map((ev, i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', fontSize: '13px' }}>
              <span style={{ color: 'var(--text-sec)', flexShrink: 0, fontSize: '12px', paddingTop: '1px' }}>
                {new Date(ev.occurredAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span>{EVENT_LABEL[ev.eventType] ?? ev.eventType}</span>
            </div>
          ))}
        </div>
      )}

      {/* Botones */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <a
          href={`/equipos/${device.id}`}
          style={{
            flex: 1, textAlign: 'center', textDecoration: 'none',
            background: 'var(--accent)', color: '#0B1220',
            borderRadius: '8px', padding: '10px 14px',
            fontSize: '13px', fontWeight: 600,
          }}
        >
          Abrir ficha completa
        </a>
        <button
          type="button"
          onClick={copyIp}
          style={{
            border: '1px solid var(--border)', background: 'none',
            color: 'var(--text)', borderRadius: '8px', padding: '10px 14px',
            font: 'inherit', fontSize: '13px', cursor: 'pointer',
          }}
        >
          {copied ? '¡Copiada!' : 'Copiar IP'}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Anillo SVG
// ---------------------------------------------------------------------------

interface RingProps {
  label:    string;
  ring:     ReturnType<typeof securityChecks>;
  subtitle: string;
}

function RingCard({ label, ring, subtitle }: RingProps) {
  const { ok, total, color } = ring.result;
  const dash = total > 0 ? Math.round(CIRC * (ok / total)) : 0;
  const col  = RING_COLOR[color] ?? 'var(--accent)';

  return (
    <div style={{
      background: 'var(--bg)', border: '1px solid var(--border)',
      borderRadius: '10px', padding: '12px',
      display: 'flex', alignItems: 'center', gap: '10px',
    }}>
      <div style={{ position: 'relative', width: '52px', height: '52px', flexShrink: 0 }}>
        <svg viewBox="0 0 120 120" width="52" height="52" role="img" aria-label={`${label}: ${ok} de ${total}`}>
          <circle cx="60" cy="60" r="48" fill="none" stroke="var(--border)" strokeWidth="14" />
          <circle cx="60" cy="60" r="48" fill="none" stroke={col} strokeWidth="14"
            strokeDasharray={`${dash} ${CIRC}`} transform="rotate(-90 60 60)" strokeLinecap="round" />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '12px', fontWeight: 700,
        }}>
          {ok}/{total}
        </div>
      </div>
      <div style={{ fontSize: '13px', minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div style={{ color: 'var(--text-sec)', fontSize: '11px', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {subtitle}
        </div>
      </div>
    </div>
  );
}

function secRingSubtitle(d: DeviceRow): string {
  const issues: string[] = [];
  const avList = Array.isArray(d.antivirus) ? d.antivirus : [];
  if (!avList.some(av => av.enabled && av.up_to_date)) issues.push('AV');
  if (d.windowsUpdate?.last_installed_at) {
    const days = Math.floor((Date.now() - new Date(d.windowsUpdate.last_installed_at).getTime()) / 86_400_000);
    if (days > 45) issues.push('Actualizaciones');
  }
  if (d.osBuild && !isOsSupported(d.osBuild, d.osName ?? undefined)) issues.push('SO');
  return issues.length ? issues.join(', ') : 'Sin incidencias';
}

function perfRingSubtitle(d: DeviceRow): string {
  const issues: string[] = [];
  if ((d.cpuAvgPct ?? 0) >= 90) issues.push('CPU');
  if ((d.memoryUsedAvgPct ?? 0) >= 90) issues.push('RAM');
  if (d.volumes?.some(v => v.total_bytes > 0 && (v.total_bytes - v.free_bytes) / v.total_bytes >= 0.95)) issues.push('Disco crítico');
  else if (d.volumes?.some(v => v.total_bytes > 0 && (v.total_bytes - v.free_bytes) / v.total_bytes >= 0.85)) issues.push('Disco lleno');
  return issues.length ? issues.join(', ') : 'Sin incidencias';
}

// ---------------------------------------------------------------------------
// Icono de tipo de dispositivo
// ---------------------------------------------------------------------------

function DeviceTypeIcon({ type }: { type: string | null }) {
  if (type === 'server') return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="4" y="3" width="16" height="7" rx="1.5"/><rect x="4" y="14" width="16" height="7" rx="1.5"/>
    </svg>
  );
  if (type === 'laptop') return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/>
    </svg>
  );
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>
    </svg>
  );
}
