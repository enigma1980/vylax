'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

interface Client { id: string; name: string }
interface Device { id: string; hostname: string; publicIp: string | null }

function IconSearch() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" />
    </svg>
  );
}

export function SearchBar() {
  const [q, setQ]           = useState('');
  const [results, setResults] = useState<{ clients: Client[]; devices: Device[] } | null>(null);
  const [open, setOpen]     = useState(false);
  const wrapRef             = useRef<HTMLDivElement>(null);
  const timerRef            = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (term: string) => {
    if (term.length < 2) { setResults(null); setOpen(false); return; }
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
      if (!res.ok) return;
      const data = await res.json() as { clients: Client[]; devices: Device[] };
      setResults(data);
      setOpen(true);
    } catch { /* ignorar */ }
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(q), 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [q, search]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const hasResults = results && (results.clients.length > 0 || results.devices.length > 0);

  return (
    <div className="panel-header-search" ref={wrapRef}>
      <label className="search-wrap">
        <IconSearch />
        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>Buscar</span>
        <input
          type="search"
          placeholder="Buscar cliente, equipo o IP"
          value={q}
          onChange={e => setQ(e.target.value)}
          onFocus={() => { if (hasResults) setOpen(true); }}
          autoComplete="off"
        />
      </label>

      {open && results && (
        <div className="search-dropdown">
          {!hasResults && <p className="search-empty">Sin resultados</p>}

          {results.clients.length > 0 && (
            <>
              <p className="search-group-title">Clientes</p>
              {results.clients.map(c => (
                <a key={c.id} href={`/clientes/${c.id}`} className="search-result" onClick={() => setOpen(false)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />
                  </svg>
                  {c.name}
                </a>
              ))}
            </>
          )}

          {results.devices.length > 0 && (
            <>
              <p className="search-group-title">Equipos</p>
              {results.devices.map(d => (
                <a key={d.id} href={`/equipos/${d.id}`} className="search-result" onClick={() => setOpen(false)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8" />
                  </svg>
                  {d.hostname}{d.publicIp ? ` · ${d.publicIp}` : ''}
                </a>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
