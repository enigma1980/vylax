import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, UnauthenticatedError } from '@/lib/dal';
import { assignDevice } from '@/lib/pending-devices';

const bodySchema = z.union([
  z.object({
    clientId: z.string().uuid(),
    siteId:   z.string().uuid().nullable(),
  }),
  z.object({
    newClientName: z.string().min(1).max(200).trim(),
    newSiteName:   z.string().min(1).max(200).trim().nullable(),
  }),
]);

type RouteContext = { params: Promise<{ deviceId: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
  let session: Awaited<ReturnType<typeof getSession>>;
  try { session = await getSession('route'); }
  catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
    throw e;
  }
  if (session.role !== 'admin') return NextResponse.json({ error: 'prohibido' }, { status: 403 });

  const { deviceId } = await params;

  let rawBody: unknown;
  try { rawBody = await req.json(); }
  catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }); }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  try {
    await assignDevice(session.orgId, session.userId, deviceId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e as { httpStatus?: number; message?: string };
    return NextResponse.json({ error: err.message ?? 'Error interno' }, { status: err.httpStatus ?? 500 });
  }
}
