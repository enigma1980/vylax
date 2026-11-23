import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/db';
import { sessions, userOrganizations, auditLog } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { SESSION_COOKIE, hashToken, setSessionOrg } from '@/lib/auth/session';

/** POST /api/auth/org/select — asigna la organización activa a la sesión. */
export async function POST(req: NextRequest) {
  const { orgId } = await req.json().catch(() => ({}));
  if (!orgId) return NextResponse.json({ error: 'Falta orgId' }, { status: 400 });

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'Sin sesión' }, { status: 401 });

  const session = await db.query.sessions.findFirst({ where: eq(sessions.tokenHash, hashToken(token)) });
  if (!session || !session.mfaVerifiedAt) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });

  // Verificar pertenencia
  const membership = await db.query.userOrganizations.findFirst({
    where: and(eq(userOrganizations.userId, session.userId), eq(userOrganizations.orgId, orgId)),
  });
  if (!membership) return NextResponse.json({ error: 'Sin acceso a esa organización' }, { status: 403 });

  await setSessionOrg(session.id, orgId);

  await db.insert(auditLog).values({
    userId:    session.userId,
    orgId,
    event:     'org_changed',
    ip:        req.headers.get('x-forwarded-for') ?? null,
    userAgent: req.headers.get('user-agent'),
  });

  return NextResponse.json({ ok: true });
}
