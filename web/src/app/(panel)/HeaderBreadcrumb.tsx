'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useBreadcrumb } from '@/lib/breadcrumb';

const SECTION_LABELS: Record<string, string> = {
  clientes:   'Clientes',
  equipos:    'Equipos',
  pendientes: 'Pendientes',
  alertas:    'Alertas',
  ajustes:    'Ajustes',
};

interface Props { orgName: string }

export function HeaderBreadcrumb({ orgName }: Props) {
  const { crumbs } = useBreadcrumb();
  const pathname   = usePathname();

  const sep = <span style={{ color: 'var(--border)', userSelect: 'none', margin: '0 2px' }} aria-hidden="true">/</span>;

  // Si hay crumbs del contexto (p.ej. página de cliente), úsalos
  if (crumbs.length > 0) {
    return (
      <nav aria-label="Ruta" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px', color: 'var(--text-sec)' }}>
        <span>{orgName}</span>
        {crumbs.map((c, i) => (
          <>
            {sep}
            {c.href
              ? <Link key={i} href={c.href} style={{ color: 'var(--text-sec)', textDecoration: 'none' }}>{c.label}</Link>
              : <span key={i} style={{ color: 'var(--text)' }}>{c.label}</span>
            }
          </>
        ))}
      </nav>
    );
  }

  // Fallback: sección basada en pathname
  const segment  = pathname.split('/').filter(Boolean)[0] ?? '';
  const secLabel = SECTION_LABELS[segment];

  return (
    <nav aria-label="Ruta" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '14px', color: 'var(--text-sec)' }}>
      <span>{orgName}</span>
      {secLabel && <>{sep}<span style={{ color: 'var(--text)' }}>{secLabel}</span></>}
    </nav>
  );
}
