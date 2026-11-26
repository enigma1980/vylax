import { getSession } from '@/lib/dal';
import { getDevice, getDeviceMetrics } from '@/lib/dashboard';
import { securityChecks, performanceChecks } from '@/lib/device-checks';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BreadcrumbSetter } from './BreadcrumbSetter';

// ---------------------------------------------------------------------------
// Helpers de formato
// ---------------------------------------------------------------------------

function fmtGb(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  return (bytes / 1_073_741_824).toFixed(1) + ' GB';
}

function fmtPct(v: number | null | undefined): string {
  return v == null ? '—' : Math.round(v) + ' %';
}

function fmtMb(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  return Math.round(bytes / 1_048_576) + ' MB';
}

function timeAgo(isoStr: string | null | undefined): string {
  if (!isoStr) return 'Nunca';
  const ms   = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1)  return 'Ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `hace ${hrs} h`;
  return `hace ${Math.floor(hrs / 24)} días`;
}

function fmtDate(isoStr: string | null | undefined): string {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

function diskColor(freePct: number): string {
  if (freePct < 0.05) return 'var(--red)';
  if (freePct < 0.15) return 'var(--amber)';
  return 'var(--green)';
}

const STATUS_COLOR: Record<string, string> = {
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

const TYPE_LABEL: Record<string, string> = {
  server: 'Servidor',
  pc:     'Sobremesa',
  laptop: 'Portátil',
  nas:    'NAS',
  ups:    'SAI',
};

const RING_COLOR: Record<string, string> = {
  ok:   'var(--green)',
  warn: 'var(--amber)',
  crit: 'var(--red)',
};

const EVENT_LABEL: Record<string, string> = {
  device_enrolled:   'Alta del equipo',
  device_reenrolled: 'Re-alta',
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

const CIRC = 302; // 2π × 48

// ---------------------------------------------------------------------------
// Anillo SVG inline
// ---------------------------------------------------------------------------

function Ring({ ok, total, color }: { ok: number; total: number; color: string }) {
  if (total === 0) return (
    <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
      <circle cx="48" cy="48" r="40" fill="none" stroke="var(--border)" strokeWidth="8" />
      <text x="48" y="53" textAnchor="middle" fill="var(--text-sec)" fontSize="13">—</text>
    </svg>
  );
  const pct  = ok / total;
  const dash = pct * CIRC;
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
      <circle cx="48" cy="48" r="40" fill="none" stroke="var(--border)"    strokeWidth="8" />
      <circle cx="48" cy="48" r="40" fill="none" stroke={color} strokeWidth="8"
        strokeDasharray={`${dash} ${CIRC}`} strokeDashoffset={CIRC * 0.25}
        strokeLinecap="round" transform="rotate(-90 48 48)" />
      <text x="48" y="45" textAnchor="middle" fill={color}        fontSize="18" fontWeight="600">{ok}</text>
      <text x="48" y="62" textAnchor="middle" fill="var(--text-sec)" fontSize="12">de {total}</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Gráfica CPU / Memoria (SVG inline)
// ---------------------------------------------------------------------------

function MetricChart({ points, field, label }: {
  points: Array<{ ts: string; cpuAvgPct: number | null; memoryUsedAvgPct: number | null }>;
  field:  'cpuAvgPct' | 'memoryUsedAvgPct';
  label:  string;
}) {
  const values = points.map(p => p[field] ?? null);
  const hasData = values.some(v => v != null);

  if (!hasData) {
    return (
      <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-sec)', fontSize: '13px', border: '1px dashed var(--border)', borderRadius: '8px' }}>
        Sin métricas disponibles
      </div>
    );
  }

  const W = 480; const H = 100; const PAD = 4;
  const n = points.length;
  if (n === 0) return null;

  const pts = values.map((v, i) => ({
    x: PAD + (i / (n - 1 || 1)) * (W - PAD * 2),
    y: H - PAD - ((v ?? 0) / 100) * (H - PAD * 2),
  }));

  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${path} L${pts[pts.length - 1].x.toFixed(1)},${H - PAD} L${pts[0].x.toFixed(1)},${H - PAD} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '120px' }} aria-label={label}>
      {/* guías */}
      {[25, 50, 75].map(v => {
        const y = H - PAD - (v / 100) * (H - PAD * 2);
        return <line key={v} x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="var(--border)" strokeWidth="0.5" />;
      })}
      <path d={area} fill="var(--accent)" fillOpacity="0.08" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default async function EquipoPage({
  params,
  searchParams,
}: {
  params:       Promise<{ deviceId: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const session    = await getSession('page');
  const { deviceId } = await params;
  const { period }   = await searchParams;
  const metricPeriod: '24h' | '7d' = period === '7d' ? '7d' : '24h';

  const [device, metrics] = await Promise.all([
    getDevice(session.orgId, deviceId),
    getDeviceMetrics(session.orgId, deviceId, metricPeriod),
  ]);

  if (!device) notFound();

  const secRing  = securityChecks({
    antivirus:    device.antivirus,
    windowsUpdate: device.windowsUpdate,
    osInfo:       device.osInfo,
  });
  const perfRing = performanceChecks({
    cpuAvgPct:        device.cpuAvgPct,
    memoryUsedAvgPct: device.memoryUsedAvgPct,
    volumes:          device.volumes,
    physicalDisks:    device.physicalDisks,
  });

  const stoppedServices = (device.services ?? []).filter(s => s.status !== 'Running');
  const statusColor     = STATUS_COLOR[device.status] ?? 'var(--text-sec)';

  const card: React.CSSProperties = {
    background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '20px',
  };
  const cardTitle: React.CSSProperties = {
    fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
    color: 'var(--text-sec)', marginBottom: '14px',
  };
  const badge: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    fontSize: '12px', fontWeight: 500, padding: '3px 8px', borderRadius: '20px',
    border: '1px solid',
  };

  return (
    <>
      <BreadcrumbSetter
        clientName={device.clientName}
        clientId={device.clientId}
        hostname={device.hostname}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1100px' }}>

        {/* ── Cabecera ─────────────────────────────────────────────── */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              {/* flecha ← al cliente */}
              <Link
                href={device.clientId ? `/clientes/${device.clientId}` : '/clientes'}
                style={{ color: 'var(--text-sec)', fontSize: '22px', lineHeight: '1.3', textDecoration: 'none', flexShrink: 0, marginTop: '2px' }}
                aria-label="Volver al cliente">
                ←
              </Link>
              <div>
                <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 600 }}>{device.hostname}</h1>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-sec)' }}>
                  {device.clientName ?? 'Sin cliente'}
                  {device.siteName && ` · ${device.siteName}`}
                </p>
              </div>
            </div>

            {/* badges */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
              <span style={{ ...badge, color: statusColor, borderColor: statusColor + '44', background: statusColor + '12' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                {STATUS_LABEL[device.status] ?? device.status}
              </span>
              {device.effType && (
                <span style={{ ...badge, color: 'var(--accent)', borderColor: 'var(--accent)44', background: 'var(--accent)12' }}>
                  {TYPE_LABEL[device.effType] ?? device.effType}
                </span>
              )}
              <span style={{ ...badge, color: 'var(--text-sec)', borderColor: 'var(--border)', background: 'transparent' }}>
                {timeAgo(device.lastSeenAt)}
              </span>
            </div>
          </div>

          {/* resumen de una línea */}
          <p style={{ margin: '12px 0 0', fontSize: '13px', color: 'var(--text-sec)', display: 'flex', flexWrap: 'wrap', gap: '0 16px' }}>
            {device.osInfo?.name && <span>{device.osInfo.name}</span>}
            {device.systemInfo?.manufacturer && <span>{device.systemInfo.manufacturer}{device.systemInfo.model ? ' · ' + device.systemInfo.model : ''}</span>}
            {device.cpuInfo?.name && <span>{device.cpuInfo.name}{device.cpuInfo.cores ? ` · ${device.cpuInfo.cores} núcleos` : ''}</span>}
            {device.ramTotalBytes && <span>{fmtGb(device.ramTotalBytes)} RAM</span>}
            {device.loggedOnUser && <span>Usuario: {device.loggedOnUser}</span>}
            {device.agentVersion && <span>Agente v{device.agentVersion}</span>}
          </p>
        </div>

        {/* ── Seguridad + Rendimiento ───────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>

          {/* Anillo de seguridad */}
          <div style={card}>
            <p style={cardTitle}>Seguridad</p>
            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <Ring ok={secRing.result.ok} total={secRing.result.total} color={RING_COLOR[secRing.result.color]} />
              <div style={{ flex: 1, minWidth: '140px' }}>
                {secRing.details.map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0',
                    borderBottom: i < secRing.details.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                      background: d.status === 'ok' ? 'var(--green)' : d.status === 'crit' ? 'var(--red)' : d.status === 'warn' ? 'var(--amber)' : 'var(--border)' }} />
                    <span style={{ fontSize: '13px', color: d.status === 'ok' ? 'var(--text)' : 'var(--text-sec)' }}>
                      {d.status === 'ok' ? d.label : d.failLabel}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Anillo de rendimiento */}
          <div style={card}>
            <p style={cardTitle}>Rendimiento</p>
            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <Ring ok={perfRing.result.ok} total={perfRing.result.total} color={RING_COLOR[perfRing.result.color]} />
              <div style={{ flex: 1, minWidth: '140px' }}>
                {perfRing.details.map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0',
                    borderBottom: i < perfRing.details.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                      background: d.status === 'ok' ? 'var(--green)' : d.status === 'crit' ? 'var(--red)' : d.status === 'warn' ? 'var(--amber)' : 'var(--border)' }} />
                    <span style={{ fontSize: '13px', color: d.status === 'ok' ? 'var(--text)' : 'var(--text-sec)' }}>
                      {d.status === 'ok' ? d.label : d.failLabel}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Gráficas CPU + Memoria ────────────────────────────────── */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
            <p style={{ ...cardTitle, margin: 0 }}>Métricas de rendimiento</p>
            <div style={{ display: 'flex', gap: '6px' }}>
              <Link href={`?period=24h`}
                style={{ padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 500, textDecoration: 'none',
                  background: metricPeriod === '24h' ? 'var(--accent)' : 'transparent',
                  color:      metricPeriod === '24h' ? '#fff' : 'var(--text-sec)',
                  border:     metricPeriod === '24h' ? 'none' : '1px solid var(--border)' }}>
                24 horas
              </Link>
              <Link href={`?period=7d`}
                style={{ padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 500, textDecoration: 'none',
                  background: metricPeriod === '7d' ? 'var(--accent)' : 'transparent',
                  color:      metricPeriod === '7d' ? '#fff' : 'var(--text-sec)',
                  border:     metricPeriod === '7d' ? 'none' : '1px solid var(--border)' }}>
                7 días
              </Link>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
            <div>
              <p style={{ fontSize: '12px', color: 'var(--text-sec)', marginBottom: '6px' }}>CPU media</p>
              <MetricChart points={metrics} field="cpuAvgPct" label="Uso de CPU" />
            </div>
            <div>
              <p style={{ fontSize: '12px', color: 'var(--text-sec)', marginBottom: '6px' }}>Memoria usada</p>
              <MetricChart points={metrics} field="memoryUsedAvgPct" label="Uso de memoria" />
            </div>
          </div>
        </div>

        {/* ── Volúmenes ─────────────────────────────────────────────── */}
        {device.volumes && device.volumes.length > 0 && (
          <div style={card}>
            <p style={cardTitle}>Volúmenes</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
              {device.volumes.map((v, i) => {
                const freePct = v.total_bytes > 0 ? v.free_bytes / v.total_bytes : 0;
                const usedPct = 1 - freePct;
                const col = diskColor(freePct);
                return (
                  <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', padding: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 600 }}>{v.mount}</span>
                      <span style={{ fontSize: '12px', color: col }}>{Math.round(usedPct * 100)} %</span>
                    </div>
                    <div style={{ height: '6px', borderRadius: '3px', background: 'var(--border)', overflow: 'hidden', marginBottom: '6px' }}>
                      <div style={{ height: '100%', width: `${Math.round(usedPct * 100)}%`, background: col, borderRadius: '3px' }} />
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-sec)', margin: 0 }}>
                      {fmtGb(v.free_bytes)} libres de {fmtGb(v.total_bytes)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Discos físicos ─────────────────────────────────────────── */}
        {device.physicalDisks && device.physicalDisks.length > 0 && (
          <div style={card}>
            <p style={cardTitle}>Discos físicos</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-sec)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 500 }}>Modelo</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 500 }}>Tipo</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 500 }}>Salud</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 500 }}>Temp.</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', fontWeight: 500 }}>Desgaste</th>
                  </tr>
                </thead>
                <tbody>
                  {device.physicalDisks.map((d, i) => {
                    const healthOk  = d.health === 'Healthy' || d.health === 'OK';
                    const healthCol = healthOk && !d.predict_failure ? 'var(--green)' : 'var(--red)';
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 8px' }}>{d.model ?? '—'}</td>
                        <td style={{ padding: '8px 8px', color: 'var(--text-sec)' }}>{d.type ?? '—'}</td>
                        <td style={{ padding: '8px 8px', color: healthCol }}>{d.health}</td>
                        <td style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--text-sec)' }}>
                          {d.temperature_c != null ? `${d.temperature_c} °C` : '—'}
                        </td>
                        <td style={{ padding: '8px 8px', textAlign: 'right', color: 'var(--text-sec)' }}>
                          {d.wear_pct != null ? `${d.wear_pct} %` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Sistema y red + Vylax Agent ──────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>

          {/* Sistema y red */}
          <div style={card}>
            <p style={cardTitle}>Sistema y red</p>
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: '13px' }}>
              {device.osInfo?.name && <><dt style={{ color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>Sistema</dt><dd>{device.osInfo.name}{device.osInfo.build ? ` (build ${device.osInfo.build})` : ''}</dd></>}
              {device.osInfo?.install_date && <><dt style={{ color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>Instalado</dt><dd>{fmtDate(device.osInfo.install_date)}</dd></>}
              {device.systemInfo?.manufacturer && <><dt style={{ color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>Fabricante</dt><dd>{device.systemInfo.manufacturer}{device.systemInfo.model ? ' · ' + device.systemInfo.model : ''}</dd></>}
              {device.systemInfo?.bios_version && <><dt style={{ color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>BIOS</dt><dd>{device.systemInfo.bios_version}{device.systemInfo.bios_date ? ' · ' + device.systemInfo.bios_date : ''}</dd></>}
              {device.cpuInfo?.name && <><dt style={{ color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>CPU</dt><dd>{device.cpuInfo.name}{device.cpuInfo.cores ? ` · ${device.cpuInfo.cores} núcleos` : ''}</dd></>}
              {device.network?.adapters?.[0] && (() => {
                const a = device.network!.adapters![0];
                return (
                  <>
                    <dt style={{ color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>Red</dt>
                    <dd>{a.name}{a.ipv4?.[0] ? ' · ' + a.ipv4[0] : ''}{a.mac ? ' · ' + a.mac : ''}</dd>
                    {a.gateway && <><dt style={{ color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>Gateway</dt><dd>{a.gateway}</dd></>}
                    {a.dns && a.dns.length > 0 && <><dt style={{ color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>DNS</dt><dd>{a.dns.join(', ')}</dd></>}
                  </>
                );
              })()}
              {device.lastBootAt && <><dt style={{ color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>Último arranque</dt><dd>{fmtDate(device.lastBootAt)}</dd></>}
              {device.rebootPending != null && <><dt style={{ color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>Reinicio pendiente</dt><dd style={{ color: device.rebootPending ? 'var(--amber)' : 'var(--text-sec)' }}>{device.rebootPending ? 'Sí' : 'No'}</dd></>}
            </dl>
          </div>

          {/* Vylax Agent */}
          <div style={card}>
            <p style={cardTitle}>Vylax Agent</p>
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: '13px' }}>
              <dt style={{ color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>Versión</dt>
              <dd>{device.agentVersion ?? '—'}</dd>
              <dt style={{ color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>CPU</dt>
              <dd>{fmtPct(device.agentCpuPct)}</dd>
              <dt style={{ color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>Memoria</dt>
              <dd>{fmtMb(device.agentMemBytes)}</dd>
              <dt style={{ color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>Alta</dt>
              <dd>{fmtDate(device.createdAt)}</dd>
              {device.uptimeSecs != null && (
                <>
                  <dt style={{ color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>Uptime</dt>
                  <dd>{Math.floor(device.uptimeSecs / 86400)}d {Math.floor((device.uptimeSecs % 86400) / 3600)}h</dd>
                </>
              )}
            </dl>
          </div>
        </div>

        {/* ── Servicios parados ─────────────────────────────────────── */}
        {stoppedServices.length > 0 && (
          <div style={card}>
            <p style={cardTitle}>Servicios parados ({stoppedServices.length})</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {stoppedServices.slice(0, 20).map((s, i) => (
                <span key={i} style={{ fontSize: '12px', padding: '3px 8px', borderRadius: '4px',
                  background: 'rgba(248,113,113,0.1)', color: 'var(--red)', border: '1px solid rgba(248,113,113,0.2)' }}>
                  {s.display_name ?? s.name}
                </span>
              ))}
              {stoppedServices.length > 20 && (
                <span style={{ fontSize: '12px', color: 'var(--text-sec)', padding: '3px 8px' }}>
                  + {stoppedServices.length - 20} más
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Historial del agente ──────────────────────────────────── */}
        {device.agentEvents.length > 0 && (
          <div style={card}>
            <p style={cardTitle}>Historial del agente</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {device.agentEvents.map((e, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0',
                  borderBottom: i < device.agentEvents.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-sec)', whiteSpace: 'nowrap', minWidth: '130px' }}>
                    {fmtDate(e.occurredAt)}
                  </span>
                  <span style={{ fontSize: '13px' }}>{EVENT_LABEL[e.eventType] ?? e.eventType}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Acciones (placeholder Parte 7) ───────────────────────── */}
        {session.role === 'admin' && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {(['Cambiar tipo', 'Mover equipo', 'Servicios críticos', 'Revocar credencial'] as const).map(label => (
              <button key={label} disabled
                style={{ padding: '8px 16px', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                  background: 'var(--card)', color: 'var(--text-sec)', fontSize: '13px', cursor: 'not-allowed', opacity: 0.5 }}>
                {label}
              </button>
            ))}
          </div>
        )}

      </div>
    </>
  );
}
