import { getSession } from '@/lib/dal';
import { db } from '@/db';
import { clients } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export default async function ClientePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const session        = await getSession('page');
  const { clientId }   = await params;

  const client = await db.query.clients.findFirst({
    where: and(
      eq(clients.id, clientId),
      eq(clients.organizationId, session.orgId),
    ),
  });

  if (!client) notFound();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Link
          href="/clientes"
          style={{
            color: 'var(--text-sec)', textDecoration: 'none', fontSize: '14px',
            display: 'flex', alignItems: 'center', gap: '4px',
          }}
        >
          ← Clientes
        </Link>
        <span style={{ color: 'var(--border)' }}>·</span>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 600 }}>{client.name}</h1>
      </div>

      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: '12px', padding: '24px',
        display: 'flex', flexDirection: 'column', gap: '8px',
      }}>
        <p style={{ margin: 0, fontSize: '14px', color: 'var(--text-sec)' }}>
          Vista de cliente en construcción — Paso 6 del plan de trabajo.
        </p>
      </div>
    </div>
  );
}
