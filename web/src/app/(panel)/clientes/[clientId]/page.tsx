import { getSession } from '@/lib/dal';
import { getClientDetail, getDevicesForClient } from '@/lib/dashboard';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ClientDetailView } from './ClientDetailView';

export default async function ClientePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const session      = await getSession('page');
  const { clientId } = await params;

  const [client, devices] = await Promise.all([
    getClientDetail(session.orgId, clientId),
    getDevicesForClient(session.orgId, clientId).catch(() => null),
  ]);

  if (!client) notFound();

  return (
    <div className="page-wrap" style={{ paddingTop: '24px', paddingBottom: '40px' }}>
      {/* Miga de pan */}
      <nav aria-label="Migas de pan" style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
        <Link href="/clientes" style={{ color: 'var(--text-sec)', textDecoration: 'none' }}>
          ← Clientes
        </Link>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ color: 'var(--text)' }}>{client.name}</span>
      </nav>

      <ClientDetailView
        client={client}
        devices={devices ?? []}
        role={session.role}
      />
    </div>
  );
}
