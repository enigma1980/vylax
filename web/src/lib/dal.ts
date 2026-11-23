import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { sessions, userOrganizations } from '@/db/schema';
import { eq, and, gt } from 'drizzle-orm';
import { SESSION_COOKIE, hashToken, touchSession, INACTIVE_TIMEOUT_MS } from '@/lib/auth/session';

export interface SessionData {
  sessionId: string;
  userId:    string;
  orgId:     string;
  role:      string;
}

export class UnauthenticatedError extends Error {
  constructor(public readonly reason: 'no_session' | 'partial_session' | 'no_org' | 'forbidden') {
    super('UnauthenticatedError: ' + reason);
    this.name = 'UnauthenticatedError';
  }
}

// ---------------------------------------------------------------------------
// Lógica interna común
// ---------------------------------------------------------------------------
async function resolveRawSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await db.query.sessions.findFirst({ where: eq(sessions.tokenHash, tokenHash) });
  if (!session) return null;

  const now = new Date();
  if (now > session.expiresAt) return null;
  if (now.getTime() - session.lastActiveAt.getTime() > INACTIVE_TIMEOUT_MS) return null;

  return session;
}

// ---------------------------------------------------------------------------
// getSession — para páginas del panel y Route Handlers del panel
//
// 'page':  redirige en caso de error
// 'route': lanza UnauthenticatedError (el caller devuelve 401)
// ---------------------------------------------------------------------------
export async function getSession(context: 'page' | 'route' = 'page'): Promise<SessionData> {
  const session = await resolveRawSession();

  if (!session) {
    if (context === 'page') redirect('/login');
    throw new UnauthenticatedError('no_session');
  }

  if (!session.mfaVerifiedAt) {
    if (context === 'page') redirect('/login/verificacion');
    throw new UnauthenticatedError('partial_session');
  }

  if (!session.orgId) {
    if (context === 'page') redirect('/login/organizacion');
    throw new UnauthenticatedError('no_org');
  }

  // Verificar que el usuario sigue perteneciendo a esa org
  const membership = await db.query.userOrganizations.findFirst({
    where: and(
      eq(userOrganizations.userId, session.userId),
      eq(userOrganizations.orgId,  session.orgId),
    ),
  });
  if (!membership) {
    if (context === 'page') redirect('/login');
    throw new UnauthenticatedError('forbidden');
  }

  await touchSession(session.id);
  return { sessionId: session.id, userId: session.userId, orgId: session.orgId, role: membership.role };
}

// ---------------------------------------------------------------------------
// getPartialSession — solo para las páginas del flujo de login (2FA, org)
// Acepta sesiones sin mfa_verified_at pero exige que tengan menos de 10 min.
// ---------------------------------------------------------------------------
export async function getPartialSession() {
  const session = await resolveRawSession();

  if (!session) redirect('/login');

  const ageMs = Date.now() - session.createdAt.getTime();
  if (ageMs > 10 * 60 * 1000) redirect('/login'); // sesión parcial caducada

  return session;
}
