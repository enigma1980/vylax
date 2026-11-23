'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavProps {
  pendingCount: number;
}

export function PanelNav({ pendingCount }: NavProps) {
  const pathname = usePathname();

  function active(href: string) {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  }

  return (
    <nav className="panel-nav" aria-label="Menú principal">
      <NavLink href="/" label="Vista general" active={active('/')}>
        <IconGrid />
      </NavLink>
      <NavLink href="/clientes" label="Clientes" active={active('/clientes')}>
        <IconBuilding />
      </NavLink>
      <NavLink href="/equipos" label="Equipos" active={active('/equipos')}>
        <IconMonitor />
      </NavLink>
      <NavLink
        href="/pendientes"
        label="Pendientes"
        active={active('/pendientes')}
        badge={pendingCount}
      >
        <IconInbox />
      </NavLink>
      <NavLink href="/alertas" label="Alertas" active={active('/alertas')}>
        <IconBell />
      </NavLink>
      <div className="nav-spacer" aria-hidden="true" />
      <NavLink href="/ajustes" label="Ajustes" active={active('/ajustes')}>
        <IconSettings />
      </NavLink>
    </nav>
  );
}

function NavLink({
  href, label, active, badge = 0, children,
}: {
  href: string; label: string; active: boolean; badge?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`nav-link${active ? ' nav-active' : ''}`}
      aria-label={badge > 0 ? `${label} (${badge})` : label}
      title={label}
    >
      {children}
      <span className="nav-label">{label}</span>
      {badge > 0 && <span className="nav-badge">{badge}</span>}
    </Link>
  );
}

function IconGrid() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function IconBuilding() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" />
    </svg>
  );
}
function IconMonitor() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" />
    </svg>
  );
}
function IconInbox() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 4h16v12H4zM4 16l3 4h10l3-4" />
    </svg>
  );
}
function IconBell() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0" />
    </svg>
  );
}
function IconSettings() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
    </svg>
  );
}
