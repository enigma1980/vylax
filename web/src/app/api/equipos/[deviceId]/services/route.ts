import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, UnauthenticatedError } from '@/lib/dal';
import { updateCriticalServices } from '@/lib/device-actions';

function handleErr(e: unknown) {
  const err = e as { httpStatus?: number; message?: string };
  return NextResponse.json({ error: err.message ?? 'Error interno' }, { status: err.httpStatus ?? 500 });
}

const schema = z.object({
  services: z.array(z.string().min(1).max(200)).max(50),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ deviceId: string }> },
) {
  let session;
  try { session = await getSession('route'); }
  catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
    throw e;
  }
  if (session.role !== 'admin') return NextResponse.json({ error: 'prohibido' }, { status: 403 });

  const { deviceId } = await params;
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'body inválido' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'parámetros incorrectos' }, { status: 400 });

  try {
    await updateCriticalServices(session.orgId, session.userId, deviceId, parsed.data.services);
    return NextResponse.json({ ok: true });
  } catch (e) { return handleErr(e); }
}
