import { getSession } from '@/lib/dal';
import { getOverviewData } from '@/lib/dashboard';
import { ClientGrid } from './ClientGrid';

export default async function PanelHome() {
  const session = await getSession('page');
  const data    = await getOverviewData(session.orgId);

  const {
    totalDevices, onlineCount, noRepCount, pendingCount,
    clientList, updatePct, atDay, withDaily,
    dayCountArr, disks,
  } = data;

  // Barra de estado: en línea + apagados + sin reportar
  const offNormal = totalDevices - onlineCount - noRepCount;

  // Anillo de actualizaciones (circunferencia ≈ 302 para r=48)
  const CIRC = 302;
  const dash = Math.round(CIRC * updatePct / 100);

  // Gráfica 7 días
  const chartPoints = buildChartPoints(dayCountArr);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 600 }}>Vista general</h1>
      </div>

      {/* Fila de resumen */}
      <section
        aria-label="Resumen"
        style={{
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: '12px', padding: '18px 20px',
          display: 'flex', flexDirection: 'column', gap: '14px',
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '16px' }}>
          <SumCell label="Equipos" value={totalDevices} />
          <SumCell label="En línea"              value={onlineCount}  color="var(--green)" sep />
          <SumCell label="Sin reportar"          value={noRepCount}   color="var(--red)"   sep />
          <SumCell label="Pendientes de asignar" value={pendingCount} color="var(--amber)" sep />
        </div>
        <div
          role="img"
          aria-label={`${onlineCount} en línea, ${offNormal} apagados normales, ${noRepCount} sin reportar`}
          style={{ display: 'flex', height: '8px', borderRadius: '999px', overflow: 'hidden', gap: '2px' }}
        >
          <span style={{ flex: onlineCount || 1,  background: 'var(--green)' }} />
          <span style={{ flex: offNormal  || 0,   background: '#4A4E56'    }} />
          <span style={{ flex: noRepCount || 0,   background: 'var(--red)' }} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px', fontSize: '12px', color: 'var(--text-sec)' }}>
          <span>■ <span style={{ color: 'var(--green)' }}>En línea</span></span>
          <span>■ Apagados (portátiles, normal)</span>
          <span>■ <span style={{ color: 'var(--red)' }}>Sin reportar</span></span>
        </div>
      </section>

      {/* Columnas: clientes + aside */}
      <div className="dash-cols">

        {/* Cuadrícula de clientes */}
        <div style={{ flex: '999 1 560px', minWidth: 0 }}>
          <ClientGrid clients={clientList} />
        </div>

        {/* Aside: actualizaciones + gráfica + discos */}
        <aside className="dash-aside">

          {/* Anillo actualizaciones */}
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: '12px', padding: '18px',
            display: 'flex', flexDirection: 'column', gap: '10px',
          }}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Actualizaciones al día</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
              <div style={{ position: 'relative', width: '110px', height: '110px', flexShrink: 0 }}>
                <svg viewBox="0 0 120 120" width="110" height="110" role="img" aria-label={`${updatePct} % de los equipos al día`}>
                  <circle cx="60" cy="60" r="48" fill="none" stroke="var(--border)" strokeWidth="12" />
                  <circle
                    cx="60" cy="60" r="48" fill="none"
                    stroke="var(--green)" strokeWidth="12"
                    strokeDasharray={`${dash} ${CIRC}`}
                    transform="rotate(-90 60 60)"
                    strokeLinecap="round"
                  />
                </svg>
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '24px', fontWeight: 700,
                }}>
                  {updatePct}&thinsp;%
                </div>
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-sec)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span><span style={{ color: 'var(--green)' }}>{atDay}</span> al día</span>
                <span><span style={{ color: 'var(--red)' }}>{withDaily - atDay}</span> con más de 45 días</span>
              </div>
            </div>
          </div>

          {/* Gráfica 7 días */}
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: '12px', padding: '18px',
            display: 'flex', flexDirection: 'column', gap: '8px',
          }}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>En línea · 7 días</h2>
            <svg viewBox="0 0 300 110" role="img" aria-label="Equipos en línea por día" style={{ width: '100%', height: 'auto' }}>
              <defs>
                <linearGradient id="g7d" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--accent)" stopOpacity="0.35" />
                  <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <g stroke="var(--border)" strokeDasharray="4 4">
                <line x1="0" y1="20" x2="300" y2="20" />
                <line x1="0" y1="55" x2="300" y2="55" />
                <line x1="0" y1="90" x2="300" y2="90" />
              </g>
              {chartPoints && (
                <>
                  <path d={`${chartPoints} L300 95 L0 95 Z`} fill="url(#g7d)" />
                  <path d={chartPoints} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
                </>
              )}
            </svg>
          </div>

          {/* Discos con menos espacio */}
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: '12px', padding: '18px',
            display: 'flex', flexDirection: 'column', gap: '12px',
          }}>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Discos con menos espacio</h2>
            {disks.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-sec)', margin: 0 }}>Sin datos</p>
            ) : (
              disks.map((d, i) => {
                const barColor = d.usedPct >= 90 ? 'var(--red)' : d.usedPct >= 75 ? 'var(--amber)' : 'var(--accent)';
                return (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', gap: '8px' }}>
                      <span>{d.hostname} · {d.mount}</span>
                      <span style={{ color: 'var(--amber)', flexShrink: 0 }}>{d.usedPct}&thinsp;%</span>
                    </div>
                    <div style={{ height: '6px', background: 'var(--border)', borderRadius: '999px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: '999px', background: barColor, width: `${d.usedPct}%` }} />
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-sec)' }}>
                      {d.freeGb}&thinsp;GB libres de {d.totalGb}&thinsp;GB
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function SumCell({ label, value, color, sep }: { label: string; value: number; color?: string; sep?: boolean }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '4px',
      ...(sep ? { borderLeft: '1px solid var(--border)', paddingLeft: '16px' } : {}),
    }}>
      <span style={{ fontSize: '13px', color: 'var(--text-sec)' }}>{label}</span>
      <span style={{ fontSize: '26px', fontWeight: 700, color: color ?? 'var(--text)' }}>{value}</span>
    </div>
  );
}

function buildChartPoints(dayCountArr: Array<{ day: string; count: number }>): string | null {
  if (dayCountArr.length === 0) return null;

  const counts = dayCountArr.map(d => d.count);
  const max    = Math.max(...counts, 1);
  const min    = Math.min(...counts, 0);
  const range  = max - min || 1;

  const n     = dayCountArr.length;
  const step  = n > 1 ? 300 / (n - 1) : 0;
  const toY   = (v: number) => 90 - Math.round(((v - min) / range) * 70);

  const pts = dayCountArr
    .map((d, i) => `${Math.round(i * step)} ${toY(d.count)}`)
    .join(' L');

  return `M${pts}`;
}
