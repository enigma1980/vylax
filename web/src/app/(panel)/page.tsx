import { getSession } from '@/lib/dal';
import { db } from '@/db';
import { users, organizations } from '@/db/schema';
import { eq } from 'drizzle-orm';

export default async function PanelHome() {
  const session = await getSession('page');

  const [user, org] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, session.userId) }),
    db.query.organizations.findFirst({ where: eq(organizations.id, session.orgId) }),
  ]);

  return (
    <>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1.25rem' }}>
        Vista general
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
        <div className="info-card">
          <div className="info-label">Usuario</div>
          <div className="info-value">{user?.email ?? session.userId}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-sec)', marginTop: '0.2rem' }}>
            {session.role === 'admin' ? 'Administrador' : 'Técnico'}
          </div>
        </div>

        <div className="info-card">
          <div className="info-label">Organización</div>
          <div className="info-value">{org?.name ?? session.orgId}</div>
        </div>

        <div className="info-card">
          <div className="info-label">ID de sesión</div>
          <div className="info-value" style={{ fontSize: '0.75rem', fontFamily: 'monospace', letterSpacing: '0.03em' }}>
            {session.sessionId.slice(0, 8)}…
          </div>
        </div>
      </div>

      <p style={{ marginTop: '2rem', color: 'var(--text-sec)', fontSize: '0.875rem' }}>
        Panel en construcción — paso 5b añadirá clientes, equipos y alertas.
      </p>
    </>
  );
}
