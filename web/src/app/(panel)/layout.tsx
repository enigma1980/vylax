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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/guaitiq-logo-blanco.png" alt="Guaitiq" height={28} style={{ display: 'block' }} />
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
            {children}
          </main>
        </div>
      </div>
    </BreadcrumbProvider>
  );
}
