import { NextRequest, NextResponse } from 'next/server';
import { getSession, UnauthenticatedError } from '@/lib/dal';
import { rotateToken } from '@/lib/sites-tokens';

type RouteContext = { params: Promise<{ clientId: string; tokenId: string }> };

export async function POST(_req: NextRequest, { params }: RouteContext) {
  let session;
  try { session = await getSession('route'); }
  catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
    throw e;
  }
  if (session.role !== 'admin') return NextResponse.json({ error: 'prohibido' }, { status: 403 });

  const { tokenId } = await params;

  try {
    const result = await rotateToken(session.orgId, session.userId, tokenId);
    return NextResponse.json({ fullToken: result.fullToken, token: result.token }, { status: 201 });
  } catch (e) {
    const err = e as { httpStatus?: number; message?: string };
    return NextResponse.json({ error: err.message ?? 'Error interno' }, { status: err.httpStatus ?? 500 });
  }
}
