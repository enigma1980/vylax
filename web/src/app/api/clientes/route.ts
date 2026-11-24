import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, UnauthenticatedError } from '@/lib/dal';
import { db } from '@/db';
import { clients, sites, enrollmentTokens, auditLog } from '@/db/schema';
import { generateEnrollmentToken, sha256hex, tokenPrefix } from '@/lib/crypto';

const bodySchema = z.object({
  clientName: z.string().min(1).max(200).trim(),
  siteName:   z.string().min(1).max(200).trim(),
});

export async function POST(req: NextRequest) {
  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession('route');
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
    }
    throw e;
  }

  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'prohibido' }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'body inválido' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'parámetros incorrectos' }, { status: 400 });
  }

  const { clientName, siteName } = parsed.data;
  const orgId  = session.orgId;
  const userId = session.userId;

  const fullToken = generateEnrollmentToken();
  const hash      = sha256hex(fullToken);
  const prefix    = tokenPrefix(fullToken);

  const result = await db.transaction(async (tx) => {
    const [client] = await tx.insert(clients).values({
      organizationId: orgId,
      name: clientName,
    }).returning({ id: clients.id });

    const [site] = await tx.insert(sites).values({
      organizationId: orgId,
      clientId: client.id,
      name: siteName,
    }).returning({ id: sites.id });

    const [token] = await tx.insert(enrollmentTokens).values({
      organizationId: orgId,
      clientId: client.id,
      siteId: null,
      tokenHash: hash,
      tokenPrefix: prefix,
      label: `Alta ${clientName}`,
    }).returning({ id: enrollmentTokens.id });

    await tx.insert(auditLog).values([
      { userId, orgId, event: 'client_created', metadata: { clientId: client.id, name: clientName } },
      { userId, orgId, event: 'site_created',   metadata: { siteId: site.id, clientId: client.id, name: siteName } },
      { userId, orgId, event: 'token_created',  metadata: { tokenId: token.id, clientId: client.id, prefix } },
    ]);

    return { clientId: client.id };
  });

  return NextResponse.json({ clientId: result.clientId, fullToken }, { status: 201 });
}
