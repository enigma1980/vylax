import { NextRequest, NextResponse } from 'next/server';
import { getSession, UnauthenticatedError } from '@/lib/dal';
import { revokeToken } from '@/lib/sites-tokens';

type RouteContext = { params: Promise<{ tokenId: string }> };

export async function POST(_req: NextRequest, { params }: RouteContext) {
  let session: Awaited<ReturnType<typeof getSession>>;
  try { session = await getSession('route'); }
  catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
    throw e;
  }
  if (session.role !== 'admin') return NextResponse.json({ error: 'prohibido' }, { status: 403 });

  const { tokenId } = await params;

  try {
    await revokeToken(session.orgId, session.userId, tokenId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e as { httpStatus?: number; message?: string };
    return NextResponse.json({ error: err.message ?? 'Error interno' }, { status: err.httpStatus ?? 500 });
  }
}
