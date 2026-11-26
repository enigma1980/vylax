'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { applyFilters, computeCounts, type FilterType } from '@/lib/device-filters';
import type { DeviceOrgRow } from '@/lib/dashboard';

const PAGE_SIZE = 50;

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

function fmtPct(v: number | null | undefined): string {
  return v == null ? '—' : Math.round(v) + ' %';
}

function fullestDisk(vols: DeviceOrgRow['volumes']): { mount: string; usedPct: number } | null {
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
};

const TYPE_LABEL: Record<string, string> = {
  server:  'Servidor',
  desktop: 'Sobremesa',
  pc:      'Sobremesa',
  laptop:  'Portátil',
  nas:     'NAS',
  ups:     'SAI',
};

// ─── Componente principal ─────────────────────────────────────────────────────

interface Props {
  devices:    DeviceOrgRow[];
  clientList: Array<{ id: string; name: string }>;
}

export function EquiposView({ devices, clientList }: Props) {
  const router = useRouter();

  const [typeFilter,    setTypeFilter]    = useState<FilterType>('all');
  const [clientFilter,  setClientFilter]  = useState('');
  const [searchInput,   setSearchInput]   = useState('');
  const [search,        setSearch]        = useState('');
  const [page,          setPage]          = useState(1);

  // Debounce search input 300 ms
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  function onTypeFilter(f: FilterType) { setTypeFilter(f); setPage(1); }
  function onClientFilter(id: string)  { setClientFilter(id); setPage(1); }

  // Filtrado
  const byClient  = clientFilter ? devices.filter(d => d.clientId === clientFilter) : devices;
  const byType    = applyFilters(byClient, '', typeFilter) as DeviceOrgRow[];
  const bySearch  = search
    ? byType.filter(d => {
        const q = search.toLowerCase();
        return d.hostname.toLowerCase().includes(q)
          || (d.publicIp?.toLowerCase() ?? '').includes(q);
      })
    : byType;

  const counts     = computeCounts(byClient, '');
  const total      = bySearch.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageItems  = bySearch.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const chips: { key: FilterType; label: string }[] = [
    { key: 'all',        label: `Todos ${counts.all}` },
    { key: 'con_avisos', label: `Con avisos ${counts.con_avisos}` },
    { key: 'server',     label: `Servidores ${counts.server}` },
    { key: 'pc',         label: `PCs ${counts.pc}` },
    { key: 'laptop',     label: `Portátiles ${counts.laptop}` },
  ];

  const selectStyle: React.CSSProperties = {
    background: 'var(--card)', border: '1px solid var(--border)',
    borderRadius: '8px', color: 'var(--text)',
    padding: '6px 10px', font: 'inherit', fontSize: '13px',
    cursor: 'pointer', outline: 'none',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* Cabecera */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 600 }}>Equipos</h1>
        <span style={{ fontSize: '13px', color: 'var(--text-sec)' }}>
          {total} equipo{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Barra de filtros */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>

        {/* Selector de cliente */}
        {clientList.length > 0 && (
          <select value={clientFilter} onChange={e => onClientFilter(e.target.value)} style={selectStyle}>
            <option value="">Todos los clientes</option>
            {clientList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}

        {/* Chips de tipo */}
        {chips.map(c => (
          <button key={c.key} type="button"
            onClick={() => onTypeFilter(c.key)}
            style={{
              border: `1px solid ${typeFilter === c.key ? 'var(--accent)' : 'var(--border)'}`,
              background: typeFilter === c.key ? 'var(--active-nav)' : 'var(--card)',
              color: typeFilter === c.key ? 'var(--text)' : 'var(--text-sec)',
              borderRadius: '999px', padding: '6px 12px',
              font: 'inherit', fontSize: '13px', cursor: 'pointer',
            }}>
            {c.label}
          </button>
        ))}

        {/* Buscador */}
        <input
          type="search"
          placeholder="Buscar por nombre o IP…"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          style={{
            marginLeft: 'auto',
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: '8px', color: 'var(--text)',
            padding: '6px 12px', font: 'inherit', fontSize: '13px',
            outline: 'none', width: '220px',
          }}
        />
      </div>

      {/* Tabla */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '12px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '900px' }}>
          <thead>
            <tr style={{ color: 'var(--text-sec)', fontSize: '12px', textAlign: 'left' }}>
              {['Equipo', 'Cliente', 'Tipo', 'IP', 'Sistema', 'CPU', 'RAM', 'Disco más lleno', 'Último contacto'].map(h => (
                <th key={h} style={{ padding: '12px', fontWeight: 500, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageItems.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-sec)' }}>
                  {search || typeFilter !== 'all' || clientFilter
                    ? 'No hay equipos con estos filtros'
                    : 'No hay equipos registrados'}
                </td>
              </tr>
            ) : pageItems.map(d => {
              const disk = fullestDisk(d.volumes);
              const ip   = d.network?.adapters?.[0]?.ipv4?.[0] ?? d.publicIp ?? '—';
              return (
                <tr key={d.id}
                  onClick={() => router.push(`/equipos/${d.id}`)}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--active-nav)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Equipo */}
                  <td style={{ padding: '12px', borderBottom: '1px solid #232529' }}>
                    <span style={{
                      display: 'inline-block', width: '8px', height: '8px',
                      borderRadius: '50%', background: STATUS_DOT[d.status] ?? 'var(--text-sec)',
                      marginRight: '8px', verticalAlign: 'middle',
                    }} />
                    <span style={{ fontWeight: 500 }}>{d.hostname}</span>
                  </td>

                  {/* Cliente */}
                  <td style={{ padding: '12px', borderBottom: '1px solid #232529', color: 'var(--text-sec)' }}>
                    {d.clientName ?? '—'}
                  </td>

                  {/* Tipo */}
                  <td style={{ padding: '12px', borderBottom: '1px solid #232529', color: 'var(--text-sec)' }}>
                    {d.effType ? (TYPE_LABEL[d.effType] ?? d.effType) : '—'}
                  </td>

                  {/* IP */}
                  <td style={{ padding: '12px', borderBottom: '1px solid #232529', color: 'var(--text-sec)', fontFamily: 'monospace', fontSize: '12px' }}>
                    {ip}
                  </td>

                  {/* Sistema */}
                  <td style={{ padding: '12px', borderBottom: '1px solid #232529', color: 'var(--text-sec)', maxWidth: '160px' }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.osName
                        ? d.osName.replace(/Windows Server\s?/i, 'WS ').replace(/Windows\s?/i, 'Win ').replace(/\s+\(.*\)/, '')
                        : '—'}
                    </span>
                  </td>

                  {/* CPU */}
                  <td style={{ padding: '12px', borderBottom: '1px solid #232529' }}>
                    {fmtPct(d.cpuAvgPct)}
                  </td>

                  {/* RAM */}
                  <td style={{ padding: '12px', borderBottom: '1px solid #232529' }}>
                    {fmtPct(d.memoryUsedAvgPct)}
                  </td>

                  {/* Disco más lleno */}
                  <td style={{ padding: '12px', borderBottom: '1px solid #232529' }}>
                    {disk
                      ? <span style={{ color: diskColor(disk.usedPct) }}>{disk.mount} {disk.usedPct} %</span>
                      : <span style={{ color: 'var(--text-sec)' }}>—</span>}
                  </td>

                  {/* Último contacto */}
                  <td style={{ padding: '12px', borderBottom: '1px solid #232529', color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>
                    {timeAgo(d.lastSeenAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px', color: 'var(--text-sec)' }}>
          <span>
            {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} de {total}
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: '6px', padding: '4px 12px',
                color: page === 1 ? 'var(--text-sec)' : 'var(--text)',
                font: 'inherit', fontSize: '13px', cursor: page === 1 ? 'default' : 'pointer',
              }}>
              ← Anterior
            </button>
            <span style={{ padding: '4px 8px' }}>{page} / {totalPages}</span>
            <button
              type="button"
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
              style={{
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: '6px', padding: '4px 12px',
                color: page === totalPages ? 'var(--text-sec)' : 'var(--text)',
                font: 'inherit', fontSize: '13px', cursor: page === totalPages ? 'default' : 'pointer',
              }}>
              Siguiente →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
