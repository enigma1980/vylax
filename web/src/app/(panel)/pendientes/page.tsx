import { getSession } from '@/lib/dal';
import { getPendingDevices, getClientsWithSites } from '@/lib/dashboard';
import { getOrgToken } from '@/lib/sites-tokens';
import { PendientesView } from './PendientesView';

export default async function PendientesPage() {
  const session = await getSession('page');
  const isAdmin = session.role === 'admin';

  const [pendingDevices, orgToken, clientsWithSites] = await Promise.all([
    getPendingDevices(session.orgId),
    isAdmin ? getOrgToken(session.orgId) : Promise.resolve(null),
    isAdmin ? getClientsWithSites(session.orgId) : Promise.resolve([]),
  ]);

  return (
    <PendientesView
      pendingDevices={pendingDevices}
      orgToken={orgToken}
      clientsWithSites={clientsWithSites}
      isAdmin={isAdmin}
    />
  );
}
