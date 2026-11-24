import { getSession } from '@/lib/dal';
import { getClientDetail, getDevicesForClient } from '@/lib/dashboard';
import { getSites, getTokens } from '@/lib/sites-tokens';
import { notFound } from 'next/navigation';
import { ClientDetailView } from './ClientDetailView';

export default async function ClientePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const session      = await getSession('page');
  const { clientId } = await params;

  const [client, devices, sites, tokens] = await Promise.all([
    getClientDetail(session.orgId, clientId),
    getDevicesForClient(session.orgId, clientId).catch(() => null),
    getSites(session.orgId, clientId).catch(() => []),
    getTokens(session.orgId, clientId).catch(() => []),
  ]);

  if (!client) notFound();

  return (
    <ClientDetailView
      client={client}
      devices={devices ?? []}
      sites={sites}
      tokens={tokens}
      role={session.role}
    />
  );
}
