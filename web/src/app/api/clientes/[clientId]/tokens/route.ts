import { NextRequest, NextResponse } from 'next/server';
import { getSession, UnauthenticatedError } from '@/lib/dal';
import { db } from '@/db';
import { clients, enrollmentTokens, auditLog } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { generateEnrollmentToken, sha256hex, tokenPrefix } from '@/lib/crypto';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  let session: Awaited<ReturnType<typeof getSession>>;
  try { session = await getSession('route'); }
  catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
    throw e;
  }
  if (session.role !== 'admin') return NextResponse.json({ error: 'prohibido' }, { status: 403 });

  const { clientId } = await params;
  const { orgId, userId } = session;

  const client = await db.query.clients.findFirst({
    where: and(eq(clients.id, clientId), eq(clients.organizationId, orgId)),
  });
  if (!client) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });

  const fullToken = generateEnrollmentToken();
  const hash      = sha256hex(fullToken);
  const prefix    = tokenPrefix(fullToken);

  await db.transaction(async tx => {
    const [token] = await tx.insert(enrollmentTokens).values({
      organizationId: orgId,
      clientId,
      tokenHash:   hash,
      tokenPrefix: prefix,
      label:       `Añadir equipo – ${new Date().toLocaleDateString('es')}`,
    }).returning({ id: enrollmentTokens.id });

    await tx.insert(auditLog).values({
      userId, orgId, event: 'token_created',
      metadata: { tokenId: token.id, clientId, prefix, source: 'add_device' },
    });
  });

  return NextResponse.json({ fullToken }, { status: 201 });
}
