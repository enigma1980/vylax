import { getSession } from '@/lib/dal';
import { db } from '@/db';
import { organizations, users, userOrganizations, devices } from '@/db/schema';
import { eq, and, count } from 'drizzle-orm';
import { PanelNav } from './PanelNav';
import { SearchBar } from './SearchBar';
import { AvatarMenu } from './AvatarMenu';
import { HeaderBreadcrumb } from './HeaderBreadcrumb';
import { BreadcrumbProvider } from '@/lib/breadcrumb';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession('page');

  const [user, org, pendingResult] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, session.userId) }),
    db.query.organizations.findFirst({ where: eq(organizations.id, session.orgId) }),
    db
      .select({ n: count() })
      .from(devices)
      .where(and(eq(devices.organizationId, session.orgId), eq(devices.status, 'pending_assignment'))),
  ]);

  const pendingCount = Number(pendingResult[0]?.n ?? 0);

  return (
    <BreadcrumbProvider>
      <div className="panel-wrap">
        <header className="panel-header">
          <a href="/" className="panel-header-logo" aria-label="Inicio">
            <svg width="26" height="26" viewBox="0 0 28 28" aria-hidden="true">
              <rect x="1" y="1" width="26" height="26" rx="8" fill="none" stroke="var(--accent)" strokeWidth="2"/>
              <path d="M8 9l6 11 6-11" fill="none" stroke="var(--text)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Vylax</span>
          </a>

          <HeaderBreadcrumb orgName={org?.name ?? '…'} />

          <SearchBar />

          <div className="panel-header-right">
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
    </BreadcrumbProvider>
  );
}
