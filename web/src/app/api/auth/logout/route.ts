import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/db';
import { sessions, auditLog } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { SESSION_COOKIE, hashToken, deleteSession } from '@/lib/auth/session';

/** POST /api/auth/logout — destruye la sesión activa. */
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    const session = await db.query.sessions.findFirst({ where: eq(sessions.tokenHash, hashToken(token)) });
    if (session) {
      await deleteSession(session.id);
      await db.insert(auditLog).values({
        userId:    session.userId,
        orgId:     session.orgId ?? undefined,
        event:     'logout',
        ip:        req.headers.get('x-forwarded-for') ?? null,
        userAgent: req.headers.get('user-agent'),
      });
    }
    cookieStore.delete(SESSION_COOKIE);
  }

  return NextResponse.json({ ok: true });
}
