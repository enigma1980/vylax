import { getSession } from '@/lib/dal';
import { getDevicesForOrg, getClientsWithSites } from '@/lib/dashboard';
import { EquiposView } from './EquiposView';

export default async function EquiposPage() {
  const session = await getSession('page');

  const [devices, clientsWithSites] = await Promise.all([
    getDevicesForOrg(session.orgId),
    getClientsWithSites(session.orgId),
  ]);

  const clientList = clientsWithSites.map(c => ({ id: c.id, name: c.name }));

  return <EquiposView devices={devices} clientList={clientList} />;
}
