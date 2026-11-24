import { getSession } from '@/lib/dal';
import { getClientList } from '@/lib/dashboard';
import { ClientGrid } from '../ClientGrid';

export default async function ClientesPage() {
  const session = await getSession('page');
  const list    = await getClientList(session.orgId);

  return (
    <div style={{ maxWidth: '1680px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 600 }}>Clientes</h1>
      </div>
      <ClientGrid clients={list} role={session.role} />
    </div>
  );
}
