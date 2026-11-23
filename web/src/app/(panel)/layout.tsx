import { getSession } from '@/lib/dal';
import { db } from '@/db';
import { organizations } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { LogoutButton } from './LogoutButton';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession('page');

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, session.orgId),
  });

  return (
    <div className="panel-wrap">
      {/* Menú lateral provisional */}
      <aside className="panel-sidebar">
        <div className="panel-logo">
          <div className="panel-logo-mark" aria-hidden="true">
            <svg viewBox="0 0 18 18" fill="none" width="16" height="16">
              <path d="M9 2L2 6v5c0 3.1 2.9 6 7 7 4.1-1 7-3.9 7-7V6L9 2Z" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M6 9l2.5 2.5L12 7" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span>Vylax</span>
        </div>

        <div style={{ flex: 1 }}>
          <NavItem href="/" label="Vista general" active />
        </div>

        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-sec)', marginBottom: '0.35rem' }}>{org?.name}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-sec)', marginBottom: '0.75rem' }}>
            {session.role === 'admin' ? 'Administrador' : 'Técnico'}
          </div>
          <LogoutButton />
        </div>
      </aside>

      {/* Contenido principal */}
      <div className="panel-main">
        <header className="panel-topbar">
          <span style={{ fontWeight: 500 }}>{org?.name ?? '…'}</span>
        </header>
        <main className="panel-content">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavItem({ href, label, active }: { href: string; label: string; active?: boolean }) {
  return (
    <a
      href={href}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        padding: '0.5rem 0.75rem', borderRadius: '6px',
        color: active ? 'var(--accent)' : 'var(--text-sec)',
        background: active ? 'rgba(129,140,248,0.1)' : 'transparent',
        fontWeight: active ? 500 : 400,
        fontSize: '0.9rem',
        textDecoration: 'none',
        transition: 'background 0.15s, color 0.15s',
      }}
    >
      {label}
    </a>
  );
}
