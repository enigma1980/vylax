import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSession }                        from '@/lib/dal';
import { getDevice, getDeviceMetrics }       from '@/lib/dashboard';
import type { DeviceDetail, MetricPoint }    from '@/lib/dashboard';
import { securityChecks, performanceChecks } from '@/lib/device-checks';
import { BreadcrumbSetter }                  from './BreadcrumbSetter';
import { PeriodSelect }                      from './PeriodSelect';

// ─── Colores y etiquetas ────────────────────────────────────────────────────

const BLUE = '#4C8DFF';
const GREEN = '#34D399';

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
  system_boot:       'Arranque del sistema',
  system_shutdown:   'Apagado del sistema',
  system_sleep:      'Suspensión',
  system_resume:     'Reanudación',
  suspend:           'Suspensión',
  resume:            'Reanudación',
  shutdown:          'Apagado',
  boot:              'Arranque',
  service_stopped:   'Servicio detenido',
  service_started:   'Servicio iniciado',
};

const EVENT_DOT: Record<string, string> = {
  device_enrolled:   BLUE,
  device_reenrolled: BLUE,
  system_boot:       GREEN,
  boot:              GREEN,
  service_started:   GREEN,
  system_shutdown:   '#94A3B8',
  shutdown:          '#94A3B8',
  system_sleep:      '#94A3B8',
  suspend:           '#94A3B8',
  system_resume:     BLUE,
  resume:            BLUE,
  service_stopped:   '#FBBF24',
};

const CHECK_COLOR: Record<string, string> = {
  ok:      GREEN,
  warn:    '#FBBF24',
  crit:    '#F87171',
  'no-data': '#94A3B8',
};

// ─── Helpers de formato ─────────────────────────────────────────────────────

function fmtGbEs(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  const v = bytes / 1_073_741_824;
  return v.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' GB';
}

function fmtMbEs(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  return Math.round(bytes / 1_048_576).toLocaleString('es-ES') + ' MB';
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return '—';
  return Math.round(v).toLocaleString('es-ES') + ' %';
}

function fmtPctDec(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %';
}

function fmtDate(isoStr: string | null | undefined): string {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

function timeAgo(isoStr: string | null | undefined, singular = false): string {
  if (!isoStr) return 'Nunca';
  const ms   = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1)  return singular ? 'ahora' : 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `hace ${hrs} h`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}

function fmtEventWhen(isoStr: string): string {
  const d    = new Date(isoStr);
  const now  = new Date();
  const hhmm = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dDiff = Math.floor((now.setHours(0, 0, 0, 0), now.getTime()) / 86400000)
              - Math.floor(new Date(isoStr).setHours(0, 0, 0, 0) / 86400000);
  if (dDiff === 0) return `Hoy ${hhmm}`;
  if (dDiff === 1) return `Ayer ${hhmm}`;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function statusBadge(status: string, lastSeenAt: string | null): {
  text: string; color: string; bg: string;
} {
  const ago = lastSeenAt ? ' · ' + timeAgo(lastSeenAt) : '';
  if (status === 'online')       return { text: 'En línea' + ago,     color: '#34D399', bg: '#0D2A22' };
  if (status === 'no_report')    return { text: 'Sin reportar' + ago, color: '#FBBF24', bg: '#2A230D' };
  if (status === 'disconnected') return { text: 'Sin conexión' + ago, color: '#94A3B8', bg: '#151F30' };
  return                                { text: status + ago,          color: '#94A3B8', bg: '#151F30' };
}

// ─── Helpers de checks ──────────────────────────────────────────────────────

function secDetailRows(device: DeviceDetail): Array<{ name: string; value: string; color: string }> {
  const rows: Array<{ name: string; value: string; color: string }> = [];

  // Antivirus
  const av = device.antivirus;
  if (!av || av.length === 0) {
    rows.push({ name: 'Antivirus', value: 'No detectado', color: CHECK_COLOR.crit });
  } else {
    const allOk  = av.every(a => a.enabled && a.up_to_date);
    const names  = av.map(a => a.product).join(', ');
    if (allOk) {
      rows.push({ name: 'Antivirus', value: `${names} · activo, firmas al día`, color: CHECK_COLOR.ok });
    } else {
      rows.push({ name: 'Antivirus', value: `${names} · desactualizado o inactivo`, color: CHECK_COLOR.crit });
    }
  }

  // Actualizaciones
  const wu = device.windowsUpdate;
  if (!wu?.last_installed_at) {
    rows.push({ name: 'Actualizaciones', value: 'Sin datos', color: CHECK_COLOR['no-data'] });
  } else {
    const days = Math.floor((Date.now() - new Date(wu.last_installed_at).getTime()) / 86400000);
    const col  = days > 60 ? 'crit' : days > 45 ? 'warn' : 'ok';
    const dStr = days === 1 ? '1 día' : `${days} días`;
    rows.push({ name: 'Actualizaciones', value: `Última hace ${dStr}`, color: CHECK_COLOR[col] });
  }

  // Sistema operativo
  const os = device.osInfo;
  if (!os?.name) {
    rows.push({ name: 'Sistema operativo', value: 'Sin datos', color: CHECK_COLOR['no-data'] });
  } else {
    const isOld = /Windows (7|8|10)\b/.test(os.name);
    const short = os.name.replace(/\s+\(.*\)/, '').replace(/\s+\d{4,}$/, '');
    if (isOld) {
      rows.push({ name: 'Sistema operativo', value: `${short} sin soporte`, color: CHECK_COLOR.warn });
    } else {
      rows.push({ name: 'Sistema operativo', value: short, color: CHECK_COLOR.ok });
    }
  }

  return rows;
}

function perfDetailRows(device: DeviceDetail): Array<{ name: string; value: string; color: string }> {
  const rows: Array<{ name: string; value: string; color: string }> = [];

  // CPU
  const cpu = device.cpuAvgPct;
  if (cpu != null) {
    const col = cpu >= 90 ? 'crit' : cpu >= 75 ? 'warn' : 'ok';
    rows.push({ name: 'CPU (media)', value: fmtPct(cpu), color: CHECK_COLOR[col] });
  }

  // Memoria
  const mem = device.memoryUsedAvgPct;
  if (mem != null) {
    const col = mem >= 90 ? 'crit' : mem >= 85 ? 'warn' : 'ok';
    rows.push({ name: 'Memoria', value: fmtPct(mem), color: CHECK_COLOR[col] });
  }

  // Volúmenes
  for (const v of (device.volumes ?? [])) {
    if (!v.total_bytes) continue;
    const freePct = v.free_bytes / v.total_bytes;
    const usedPct = Math.round((1 - freePct) * 100);
    const col     = freePct < 0.05 ? 'crit' : freePct < 0.15 ? 'warn' : 'ok';
    rows.push({ name: `Disco ${v.mount}`, value: `${usedPct} % usado`, color: CHECK_COLOR[col] });
  }

  // SMART
  const pd = device.physicalDisks;
  if (pd && pd.length > 0) {
    const healthy = pd.filter(d => !d.predict_failure && (d.health === 'Healthy' || d.health === 'OK' || d.health === 'Sano'));
    const col     = healthy.length === pd.length ? 'ok' : 'crit';
    const n       = healthy.length;
    rows.push({ name: 'Salud de discos (SMART)', value: `${n} sano${n !== 1 ? 's' : ''}`, color: CHECK_COLOR[col] });
  }

  return rows;
}

// ─── Helpers de gráficas ────────────────────────────────────────────────────

function buildChartPaths(vals: Array<number | null>): { linePath: string; areaPath: string } | null {
  if (vals.length < 2 || !vals.some(v => v != null)) return null;
  const W = 400; const BASE = 120; const TOP = 20;
  const n = vals.length;
  const pts = vals.map((v, i) => ({
    x: (i / (n - 1)) * W,
    y: BASE - ((v ?? 0) / 100) * (BASE - TOP),
  }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${BASE} L${pts[0].x.toFixed(1)},${BASE} Z`;
  return { linePath: line, areaPath: area };
}

function chartAxisLabels(points: MetricPoint[], period: '24h' | '7d'): Array<{ x: number; text: string }> {
  if (period === '24h') {
    return [
      { x: 0,   text: '0:00' },
      { x: 95,  text: '6:00' },
      { x: 190, text: '12:00' },
      { x: 290, text: '18:00' },
      { x: 368, text: 'Ahora' },
    ];
  }
  const n = points.length;
  if (n === 0) return [];
  return points.map((p, i) => ({
    x:    n > 1 ? (i / (n - 1)) * 400 : 200,
    text: new Date(p.ts).toLocaleDateString('es-ES', { weekday: 'short' }),
  }));
}

// ─── Componente anillo ───────────────────────────────────────────────────────

function Ring({ ok, total }: { ok: number; total: number }) {
  const CIRC = 302;
  const dash  = total > 0 ? (ok / total) * CIRC : 0;
  const color = total === 0 ? '#94A3B8'
    : ok === total ? GREEN
    : ok / total >= 0.5 ? '#FBBF24'
    : '#F87171';
  const ringColor = total === 0 ? '#1E293B' : color;

  return (
    <div style={{ position: 'relative', width: '140px', height: '140px', flexShrink: 0 }}>
      <svg viewBox="0 0 120 120" width="140" height="140" aria-hidden="true">
        <circle cx="60" cy="60" r="48" fill="none" stroke="#1E293B"   strokeWidth="11" />
        <circle cx="60" cy="60" r="48" fill="none" stroke={ringColor} strokeWidth="11"
          strokeDasharray={`${dash.toFixed(1)} ${CIRC}`}
          transform="rotate(-90 60 60)"
          strokeLinecap="round" />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: '30px', fontWeight: 700 }}>{total > 0 ? `${ok}/${total}` : '—'}</span>
        <span style={{ fontSize: '12px', color: '#94A3B8' }}>correctas</span>
      </div>
    </div>
  );
}

// ─── Tarjeta de gráfica ─────────────────────────────────────────────────────

function ChartCard({
  title, gradientId, color, avgPct, subLabel, paths, axisLabels, period, paramName,
}: {
  title:       string;
  gradientId:  string;
  color:       string;
  avgPct:      number | null;
  subLabel:    string;
  paths:       { linePath: string; areaPath: string } | null;
  axisLabels:  Array<{ x: number; text: string }>;
  period:      '24h' | '7d';
  paramName:   string;
}) {
  return (
    <div style={{
      background: '#0F172A', border: '1px solid #1E293B', borderRadius: '12px',
      padding: '20px', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{title}</h2>
        <Suspense fallback={
          <select style={{ background: '#0A0F1E', color: '#E2E8F0', border: '1px solid #1E293B', borderRadius: '8px', padding: '8px', fontFamily: 'inherit', fontSize: '13px' }}>
            <option>{period === '24h' ? '24 horas' : '7 días'}</option>
          </select>
        }>
          <PeriodSelect paramName={paramName} value={period} ariaLabel={`Periodo de la gráfica de ${title}`} />
        </Suspense>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
          <span style={{ fontSize: '40px', fontWeight: 700, lineHeight: 1.1 }}>
            {fmtPct(avgPct)}
          </span>
          <span style={{ fontSize: '12px', color: '#94A3B8', marginTop: '2px' }}>{subLabel}</span>
        </div>

        {paths ? (
          <svg viewBox="0 0 400 140" role="img" aria-label={`Gráfica de ${title}`}
            style={{ flex: 1, minWidth: 0, height: 'auto' }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={color} stopOpacity="0.35" />
                <stop offset="1" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <g stroke="#1E293B" strokeDasharray="4 4">
              <line x1="0" y1="20"  x2="400" y2="20" />
              <line x1="0" y1="65"  x2="400" y2="65" />
              <line x1="0" y1="110" x2="400" y2="110" />
            </g>
            <path d={paths.areaPath} fill={`url(#${gradientId})`} />
            <path d={paths.linePath} fill="none" stroke={color} strokeWidth="2.5" />
            <g fill="#94A3B8" fontSize="11" fontFamily="Inter, sans-serif">
              {axisLabels.map((l, i) => (
                <text key={i} x={l.x} y="136">{l.text}</text>
              ))}
            </g>
          </svg>
        ) : (
          <div style={{
            flex: 1, minWidth: 0, height: '90px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px dashed #1E293B', borderRadius: '8px',
            color: '#94A3B8', fontSize: '13px',
          }}>
            Sin métricas disponibles
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Página ─────────────────────────────────────────────────────────────────

export default async function EquipoPage({
  params,
  searchParams,
}: {
  params:       Promise<{ deviceId: string }>;
  searchParams: Promise<{ cpuPeriod?: string; memPeriod?: string }>;
}) {
  const session    = await getSession('page');
  const { deviceId } = await params;
  const sp           = await searchParams;

  const cpuPeriod: '24h' | '7d' = sp.cpuPeriod === '7d' ? '7d' : '24h';
  const memPeriod: '24h' | '7d' = sp.memPeriod === '7d' ? '7d' : '24h';

  const [device, metricsCpu, metricsMem] = await Promise.all([
    getDevice(session.orgId, deviceId),
    getDeviceMetrics(session.orgId, deviceId, cpuPeriod),
    getDeviceMetrics(session.orgId, deviceId, memPeriod),
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

  const secRows  = secDetailRows(device);
  const perfRows = perfDetailRows(device);

  // Gráficas
  const cpuVals   = metricsCpu.map(p => p.cpuAvgPct);
  const memVals   = metricsMem.map(p => p.memoryUsedAvgPct);
  const cpuPaths  = buildChartPaths(cpuVals);
  const memPaths  = buildChartPaths(memVals);
  const cpuLabels = chartAxisLabels(metricsCpu, cpuPeriod);
  const memLabels = chartAxisLabels(metricsMem, memPeriod);

  const cpuAvg    = cpuVals.filter((v): v is number => v != null).reduce((s, v, _, a) => s + v / a.length, 0) || device.cpuAvgPct;
  const cpuMax    = metricsCpu.map(p => p.cpuMaxPct).filter((v): v is number => v != null).reduce((m, v) => Math.max(m, v), 0) || null;
  const memAvg    = memVals.filter((v): v is number => v != null).reduce((s, v, _, a) => s + v / a.length, 0) || device.memoryUsedAvgPct;
  const memMax    = metricsMem.map(p => p.memoryUsedMaxPct).filter((v): v is number => v != null).reduce((m, v) => Math.max(m, v), 0) || null;

  const ramGb = device.ramTotalBytes ?? device.memoryTotalBytes;
  const cpuSubLabel = cpuMax ? `media · máx. ${fmtPct(cpuMax)}` : 'media · sin histórico';
  const memSubLabel = ramGb
    ? (memMax ? `de ${fmtGbEs(ramGb)} · máx. ${fmtPct(memMax)}` : `de ${fmtGbEs(ramGb)} · sin histórico`)
    : (memMax ? `media · máx. ${fmtPct(memMax)}` : 'media · sin histórico');

  // Cabecera: badges
  const sBadge = statusBadge(device.status, device.lastSeenAt);
  const worstRing = secRing.result.color === 'crit' || perfRing.result.color === 'crit' ? 'crit'
    : secRing.result.color === 'warn' || perfRing.result.color === 'warn' ? 'warn' : 'ok';

  const stoppedServices = (device.services ?? []).filter(s => s.status !== 'Running');

  // Info line
  const infoParts: string[] = [];
  if (device.osInfo?.name) {
    const name = device.osInfo.name;
    const build = device.osInfo.build ? ` (${device.osInfo.build})` : '';
    infoParts.push(`${name}${build}`);
  }
  if (device.systemInfo?.manufacturer) {
    infoParts.push(device.systemInfo.manufacturer + (device.systemInfo.model ? ' ' + device.systemInfo.model : ''));
  }
  if (device.cpuInfo?.name) infoParts.push(device.cpuInfo.name);
  if (ramGb) infoParts.push(fmtGbEs(ramGb) + ' RAM');
  if (device.loggedOnUser) infoParts.push('Usuario: ' + device.loggedOnUser);
  if (device.agentVersion) infoParts.push('Agente ' + device.agentVersion);

  const card: React.CSSProperties = {
    background: '#0F172A', border: '1px solid #1E293B', borderRadius: '12px', padding: '20px',
  };

  return (
    <>
      <BreadcrumbSetter
        clientName={device.clientName}
        clientId={device.clientId}
        hostname={device.hostname}
      />

      <div style={{ maxWidth: '1180px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>

        {/* ── Cabecera ─────────────────────────────────────────────────────── */}
        <header style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Link
            href={device.clientId ? `/clientes/${device.clientId}` : '/clientes'}
            style={{ fontSize: '13px', textDecoration: 'none', color: '#A5B4FC' }}
          >
            ← {device.clientName ?? 'Clientes'}{device.siteName ? ' · ' + device.siteName : ''}
          </Link>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
            <h1 style={{ margin: 0, fontSize: '30px', fontWeight: 700 }}>{device.hostname}</h1>
            {worstRing !== 'ok' && (
              <span style={{
                padding: '4px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
                color:      worstRing === 'crit' ? '#F87171' : '#FBBF24',
                background: worstRing === 'crit' ? '#2D0F0F'  : '#2A230D',
              }}>
                ● {worstRing === 'crit' ? 'Crítico' : 'Aviso'}
              </span>
            )}
            <span style={{
              padding: '4px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
              color: sBadge.color, background: sBadge.bg,
            }}>
              {sBadge.text}
            </span>
            {device.effType && (
              <span style={{
                padding: '4px 10px', borderRadius: '999px', fontSize: '12px',
                color: '#CBD5E1', border: '1px solid #1E293B',
              }}>
                {TYPE_LABEL[device.effType] ?? device.effType}
              </span>
            )}
          </div>
          {infoParts.length > 0 && (
            <p style={{ margin: 0, color: '#94A3B8', fontSize: '14px' }}>
              {infoParts.join(' · ')}
            </p>
          )}
        </header>

        {/* ── Seguridad + Rendimiento + Gráficas (2×2) ─────────────────────── */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px' }}>

          {/* Seguridad */}
          <div style={{ ...card, display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 100%' }}>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Seguridad</h2>
            </div>
            <Ring ok={secRing.result.ok} total={secRing.result.total} />
            <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '14px' }}>
              {secRows.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <span>{r.name}</span>
                  <span style={{ color: r.color, textAlign: 'right' }}>{r.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Rendimiento y discos */}
          <div style={{ ...card, display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 100%' }}>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Rendimiento y discos</h2>
            </div>
            <Ring ok={perfRing.result.ok} total={perfRing.result.total} />
            <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px' }}>
              {perfRows.map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{r.name}</span>
                  <span style={{ color: r.color }}>{r.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* CPU */}
          <ChartCard
            title="CPU"
            gradientId="gc"
            color={BLUE}
            avgPct={cpuAvg ?? null}
            subLabel={cpuSubLabel}
            paths={cpuPaths}
            axisLabels={cpuLabels}
            period={cpuPeriod}
            paramName="cpuPeriod"
          />

          {/* Memoria */}
          <ChartCard
            title="Memoria"
            gradientId="gm"
            color={GREEN}
            avgPct={memAvg ?? null}
            subLabel={memSubLabel}
            paths={memPaths}
            axisLabels={memLabels}
            period={memPeriod}
            paramName="memPeriod"
          />
        </section>

        {/* ── Volúmenes ────────────────────────────────────────────────────── */}
        {device.volumes && device.volumes.length > 0 && (
          <section style={card}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              gap: '12px', flexWrap: 'wrap', marginBottom: '16px',
            }}>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Volúmenes</h2>
              <span style={{ fontSize: '12px', color: '#94A3B8' }}>
                Aviso &lt; 15&nbsp;% libre · crítico &lt; 5&nbsp;% libre
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '20px' }}>
              {device.volumes.map((v, i) => {
                const freePct = v.total_bytes > 0 ? v.free_bytes / v.total_bytes : 0;
                const usedPct = Math.round((1 - freePct) * 100);
                const col     = freePct < 0.05 ? '#F87171' : freePct < 0.15 ? '#FBBF24' : GREEN;
                return (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' }}>
                      <span style={{ fontSize: '15px', fontWeight: 600 }}>{v.mount}{v.label ? ' ' + v.label : ''}</span>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: col }}>{usedPct}&nbsp;% usado</span>
                    </div>
                    <div style={{ height: '10px', background: '#1E293B', borderRadius: '999px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${usedPct}%`, background: col, borderRadius: '999px' }} />
                    </div>
                    <div style={{ fontSize: '13px', color: '#94A3B8' }}>
                      {fmtGbEs(v.free_bytes)} libres de {fmtGbEs(v.total_bytes)}
                    </div>
                    <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                      Tendencia: se calculará con el resumen diario
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Discos físicos + Sistema y red ───────────────────────────────── */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px' }}>

          {/* Discos físicos */}
          {device.physicalDisks && device.physicalDisks.length > 0 && (
            <div style={{ ...card, minWidth: 0 }}>
              <h2 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>Discos físicos</h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '420px' }}>
                  <thead>
                    <tr style={{ color: '#94A3B8', fontSize: '12px', textAlign: 'left' }}>
                      {(['Modelo', 'Tipo', 'Salud', 'Temp.', 'Desgaste'] as const).map((h, i) => (
                        <th key={h} style={{
                          padding: '8px', fontWeight: 500, borderBottom: '1px solid #1E293B',
                          textAlign: i >= 3 ? 'right' : 'left',
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {device.physicalDisks.map((d, i) => {
                      const isLast   = i === device.physicalDisks!.length - 1;
                      const healthOk = !d.predict_failure && (d.health === 'Healthy' || d.health === 'OK' || d.health === 'Sano');
                      const hCol     = healthOk ? GREEN : '#F87171';
                      const rowBorder = isLast ? undefined : '1px solid #172036';
                      return (
                        <tr key={i}>
                          <td style={{ padding: '10px 8px', borderBottom: rowBorder }}>{d.model ?? '—'}</td>
                          <td style={{ padding: '10px 8px', borderBottom: rowBorder, color: '#94A3B8' }}>{d.type ?? '—'}</td>
                          <td style={{ padding: '10px 8px', borderBottom: rowBorder, color: hCol }}>{d.health}</td>
                          <td style={{ padding: '10px 8px', borderBottom: rowBorder, textAlign: 'right' }}>
                            {d.temperature_c != null ? `${d.temperature_c} °C` : <span style={{ color: '#94A3B8' }}>No disponible</span>}
                          </td>
                          <td style={{ padding: '10px 8px', borderBottom: rowBorder, textAlign: 'right' }}>
                            {d.wear_pct != null ? fmtPct(d.wear_pct) : <span style={{ color: '#94A3B8' }}>No disponible</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sistema y red */}
          <div style={card}>
            <h2 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>Sistema y red</h2>
            <dl style={{
              margin: 0, display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '12px 20px', fontSize: '13px',
            }}>
              {device.osInfo?.name && (
                <div>
                  <dt style={{ color: '#94A3B8', fontSize: '12px' }}>Sistema operativo</dt>
                  <dd style={{ margin: '2px 0 0' }}>
                    {device.osInfo.name}{device.osInfo.build ? ` · ${device.osInfo.build}` : ''}
                  </dd>
                </div>
              )}
              {device.osInfo?.install_date && (
                <div>
                  <dt style={{ color: '#94A3B8', fontSize: '12px' }}>Instalado</dt>
                  <dd style={{ margin: '2px 0 0' }}>{fmtDate(device.osInfo.install_date)}</dd>
                </div>
              )}
              {(device.systemInfo?.manufacturer || device.systemInfo?.bios_version) && (
                <div>
                  <dt style={{ color: '#94A3B8', fontSize: '12px' }}>Fabricante · BIOS</dt>
                  <dd style={{ margin: '2px 0 0' }}>
                    {[device.systemInfo?.manufacturer, device.systemInfo?.bios_version].filter(Boolean).join(' · ')}
                  </dd>
                </div>
              )}
              {device.cpuInfo?.name && (
                <div>
                  <dt style={{ color: '#94A3B8', fontSize: '12px' }}>Procesador</dt>
                  <dd style={{ margin: '2px 0 0' }}>
                    {device.cpuInfo.name}{device.cpuInfo.cores ? ` · ${device.cpuInfo.cores} núcleos` : ''}
                  </dd>
                </div>
              )}
              {device.network?.adapters?.[0] && (() => {
                const a = device.network!.adapters![0];
                return (
                  <>
                    <div>
                      <dt style={{ color: '#94A3B8', fontSize: '12px' }}>Red</dt>
                      <dd style={{ margin: '2px 0 0' }}>
                        {[a.name, a.link_speed_mbps ? `${a.link_speed_mbps} Mbps` : null, a.ipv4?.[0]].filter(Boolean).join(' · ')}
                      </dd>
                    </div>
                    {(a.gateway || a.dns?.length) && (
                      <div>
                        <dt style={{ color: '#94A3B8', fontSize: '12px' }}>Puerta de enlace · DNS</dt>
                        <dd style={{ margin: '2px 0 0' }}>
                          {[a.gateway, a.dns?.[0]].filter(Boolean).join(' · ')}
                        </dd>
                      </div>
                    )}
                  </>
                );
              })()}
              {device.lastBootAt && (
                <div>
                  <dt style={{ color: '#94A3B8', fontSize: '12px' }}>Último arranque de Windows</dt>
                  <dd style={{ margin: '2px 0 0' }}>{fmtDate(device.lastBootAt)}</dd>
                </div>
              )}
              {device.rebootPending != null && (
                <div>
                  <dt style={{ color: '#94A3B8', fontSize: '12px' }}>Reinicio pendiente</dt>
                  <dd style={{ margin: '2px 0 0', color: device.rebootPending ? '#FBBF24' : undefined }}>
                    {device.rebootPending ? 'Sí' : 'No'}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </section>

        {/* ── Historial + Servicios + Agente (3 columnas) ──────────────────── */}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '16px' }}>

          {/* Historial (span 2) */}
          <div style={{ ...card, gridColumn: 'span 2', minWidth: 0 }}>
            <h2 style={{ margin: '0 0 12px', fontSize: '16px', fontWeight: 600 }}>Historial del agente</h2>
            {device.agentEvents.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: '#94A3B8' }}>Sin eventos registrados.</p>
            ) : (
              <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
                {device.agentEvents.map((e, i) => {
                  const isLast = i === device.agentEvents.length - 1;
                  const dot = EVENT_DOT[e.eventType] ?? '#94A3B8';
                  return (
                    <li key={i} style={{
                      display: 'flex', gap: '14px', alignItems: 'flex-start',
                      padding: '10px 0',
                      borderBottom: isLast ? undefined : '1px solid #172036',
                    }}>
                      <span style={{
                        width: '10px', height: '10px', borderRadius: '50%',
                        background: dot, flexShrink: 0, marginTop: '5px',
                      }} />
                      <span style={{ width: '120px', flexShrink: 0, fontSize: '13px', color: '#94A3B8' }}>
                        {fmtEventWhen(e.occurredAt)}
                      </span>
                      <span style={{ fontSize: '14px', flex: 1 }}>
                        {EVENT_LABEL[e.eventType] ?? e.eventType}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {/* Columna derecha: Servicios + Agente */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Servicios parados */}
            <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Servicios parados</h2>
              <span style={{ fontSize: '30px', fontWeight: 700 }}>{stoppedServices.length}</span>
              <span style={{ fontSize: '13px', color: '#94A3B8' }}>
                {stoppedServices.length === 0
                  ? 'Todos los servicios monitorizados están activos.'
                  : stoppedServices.slice(0, 3).map(s => s.display_name ?? s.name).join(', ')
                    + (stoppedServices.length > 3 ? ` y ${stoppedServices.length - 3} más…` : '')}
              </span>
              {stoppedServices.length > 0 && (
                <a href="#servicios" style={{ fontSize: '13px', textDecoration: 'none', color: '#A5B4FC' }}>
                  Ver lista
                </a>
              )}
            </div>

            {/* Vylax Agent */}
            <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Vylax Agent</h2>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94A3B8' }}>Versión</span>
                <span>{device.agentVersion ?? '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94A3B8' }}>Consumo</span>
                <span>
                  {fmtMbEs(device.agentMemBytes)}
                  {device.agentCpuPct != null ? ` · ${fmtPctDec(device.agentCpuPct)} CPU` : ''}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94A3B8' }}>Alta</span>
                <span>{fmtDate(device.createdAt)}</span>
              </div>
              {device.uptimeSecs != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94A3B8' }}>Uptime</span>
                  <span>
                    {Math.floor(device.uptimeSecs / 86400)}d&nbsp;
                    {Math.floor((device.uptimeSecs % 86400) / 3600)}h
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>

      </div>
    </>
  );
}
