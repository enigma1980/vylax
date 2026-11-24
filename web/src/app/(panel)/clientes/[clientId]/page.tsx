import { getSession } from '@/lib/dal';
import { getClientDetail, getDevicesForClient } from '@/lib/dashboard';
import { notFound } from 'next/navigation';
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
    <ClientDetailView
      client={client}
      devices={devices ?? []}
      role={session.role}
    />
  );
}
