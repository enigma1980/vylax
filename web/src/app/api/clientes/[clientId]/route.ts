import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, UnauthenticatedError } from '@/lib/dal';
import { updateClient, deleteClient } from '@/lib/sites-tokens';

function handleErr(e: unknown) {
  const err = e as { httpStatus?: number; message?: string };
  return NextResponse.json(
    { error: err.message ?? 'Error interno' },
    { status: err.httpStatus ?? 500 },
  );
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).trim(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  let session;
  try { session = await getSession('route'); }
  catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
    throw e;
  }
  if (session.role !== 'admin') return NextResponse.json({ error: 'prohibido' }, { status: 403 });

  const { clientId } = await params;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'body inválido' }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'parámetros incorrectos' }, { status: 400 });

  try {
    await updateClient(session.orgId, session.userId, clientId, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (e) { return handleErr(e); }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  let session;
  try { session = await getSession('route'); }
  catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
    throw e;
  }
  if (session.role !== 'admin') return NextResponse.json({ error: 'prohibido' }, { status: 403 });

  const { clientId } = await params;

  try {
    await deleteClient(session.orgId, session.userId, clientId);
    return NextResponse.json({ ok: true });
  } catch (e) { return handleErr(e); }
}
