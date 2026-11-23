import { getSession } from '@/lib/dal';
import { db } from '@/db';
import { organizations, users, userOrganizations, devices } from '@/db/schema';
import { eq, and, count } from 'drizzle-orm';
import { PanelNav } from './PanelNav';
import { SearchBar } from './SearchBar';
import { AvatarMenu } from './AvatarMenu';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession('page');

  const [user, org, pendingResult, orgsCount] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, session.userId) }),
    db.query.organizations.findFirst({ where: eq(organizations.id, session.orgId) }),
    db
      .select({ n: count() })
      .from(devices)
      .where(and(eq(devices.organizationId, session.orgId), eq(devices.status, 'pending_assignment'))),
    db
      .select({ n: count() })
      .from(userOrganizations)
      .where(eq(userOrganizations.userId, session.userId)),
  ]);

  const pendingCount = Number(pendingResult[0]?.n ?? 0);
  const multiOrg     = Number(orgsCount[0]?.n ?? 0) > 1;

  return (
    <div className="panel-wrap">
      <header className="panel-header">
        <a href="/" className="panel-header-logo" aria-label="Inicio">
          <svg width="26" height="26" viewBox="0 0 28 28" aria-hidden="true">
            <rect x="1" y="1" width="26" height="26" rx="8" fill="none" stroke="#818CF8" strokeWidth="2"/>
            <path d="M8 9l6 11 6-11" fill="none" stroke="#E2E8F0" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Vylax</span>
        </a>

        {multiOrg && (
          <label className="org-selector-wrap">
            Organización
            <select defaultValue={session.orgId} aria-label="Organización activa">
              <option value={session.orgId}>{org?.name ?? '…'}</option>
            </select>
          </label>
        )}

        <SearchBar />

        <div className="panel-header-right">
          <button className="notif-btn" aria-label="Notificaciones">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0"/>
            </svg>
          </button>
          <AvatarMenu email={user?.email ?? session.userId} />
        </div>
      </header>

      <div className="panel-body">
        <PanelNav pendingCount={pendingCount} />
        <main className="panel-content">
          <div className="page-wrap">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
