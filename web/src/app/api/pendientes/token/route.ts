import { NextResponse } from 'next/server';
import { getSession, UnauthenticatedError } from '@/lib/dal';
import { createOrgToken } from '@/lib/sites-tokens';

export async function POST() {
  let session: Awaited<ReturnType<typeof getSession>>;
  try { session = await getSession('route'); }
  catch (e) {
    if (e instanceof UnauthenticatedError) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
    throw e;
  }
  if (session.role !== 'admin') return NextResponse.json({ error: 'prohibido' }, { status: 403 });

  try {
    const result = await createOrgToken(
      session.orgId,
      session.userId,
      `Token de org – ${new Date().toLocaleDateString('es')}`,
    );
    return NextResponse.json({ fullToken: result.fullToken, token: result.token }, { status: 201 });
  } catch (e) {
    const err = e as { httpStatus?: number; message?: string };
    return NextResponse.json({ error: err.message ?? 'Error interno' }, { status: err.httpStatus ?? 500 });
  }
}
