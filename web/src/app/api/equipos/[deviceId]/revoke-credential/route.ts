import { NextRequest, NextResponse } from 'next/server';
import { getSession, UnauthenticatedError } from '@/lib/dal';
import { revokeDeviceCredential } from '@/lib/device-actions';

function handleErr(e: unknown) {
  const err = e as { httpStatus?: number; message?: string };
  return NextResponse.json({ error: err.message ?? 'Error interno' }, { status: err.httpStatus ?? 500 });
}

export async function POST(
  _req: NextRequest,
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

  try {
    await revokeDeviceCredential(session.orgId, session.userId, deviceId);
    return NextResponse.json({ ok: true });
  } catch (e) { return handleErr(e); }
}
