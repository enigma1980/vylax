import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, UnauthenticatedError } from '@/lib/dal';
import { createToken } from '@/lib/sites-tokens';

const bodySchema = z.object({
  label:  z.string().min(1).max(200).trim().optional(),
  siteId: z.string().uuid().nullable().optional(),
});

export async function POST(
  req: NextRequest,
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

  let rawBody = {};
  try { rawBody = await req.json(); } catch { /* cuerpo vacío → defaults */ }
  const parsed = bodySchema.safeParse(rawBody);
  const userLabel  = parsed.success ? parsed.data.label  : undefined;
  const userSiteId = parsed.success ? (parsed.data.siteId ?? null) : null;

  try {
    const { fullToken } = await createToken(orgId, userId, {
      clientId,
      siteId: userSiteId,
      label:  userLabel ?? `Añadir equipo – ${new Date().toLocaleDateString('es')}`,
    });
    return NextResponse.json({ fullToken }, { status: 201 });
  } catch (e) {
    const err = e as { httpStatus?: number; message?: string };
    return NextResponse.json({ error: err.message ?? 'Error interno' }, { status: err.httpStatus ?? 500 });
  }
}
