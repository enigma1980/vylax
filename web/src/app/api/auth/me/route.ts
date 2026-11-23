import { NextResponse } from 'next/server';
import { getSession, UnauthenticatedError } from '@/lib/dal';

/** GET /api/auth/me — devuelve la sesión activa o 401. */
export async function GET() {
  try {
    const session = await getSession('route');
    return NextResponse.json({ userId: session.userId, orgId: session.orgId, role: session.role });
  } catch (e) {
    if (e instanceof UnauthenticatedError) {
      return NextResponse.json({ error: e.reason }, { status: 401 });
    }
    throw e;
  }
}
