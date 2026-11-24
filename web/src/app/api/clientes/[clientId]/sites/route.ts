import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, UnauthenticatedError } from '@/lib/dal';
import { createSite } from '@/lib/sites-tokens';

const bodySchema = z.object({
  name:      z.string().min(1).max(200).trim(),
  publicIps: z.array(z.string().trim().min(1)).default([]),
});

function handleErr(e: unknown) {
  const err = e as { httpStatus?: number; message?: string };
  return NextResponse.json(
    { error: err.message ?? 'Error interno' },
    { status: err.httpStatus ?? 500 },
  );
}

export async function POST(
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
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'parámetros incorrectos' }, { status: 400 });

  try {
    const site = await createSite(session.orgId, session.userId, clientId, parsed.data);
    return NextResponse.json(site, { status: 201 });
  } catch (e) { return handleErr(e); }
}
