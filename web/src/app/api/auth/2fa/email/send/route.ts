import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/db';
import { sessions, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { generateAndStoreEmailCode, sendEmailCode } from '@/lib/auth/email-code';
import { SESSION_COOKIE, hashToken } from '@/lib/auth/session';

/** POST /api/auth/2fa/email/send — genera y envía código de verificación por correo. */
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionCookie) return NextResponse.json({ error: 'Sin sesión' }, { status: 401 });

  const session = await db.query.sessions.findFirst({ where: eq(sessions.tokenHash, hashToken(sessionCookie)) });
  if (!session || session.mfaVerifiedAt) return NextResponse.json({ error: 'Sin sesión parcial' }, { status: 401 });
  if (Date.now() - session.createdAt.getTime() > 10 * 60 * 1000) return NextResponse.json({ error: 'Sesión caducada' }, { status: 401 });

  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  const code = await generateAndStoreEmailCode(user.id);
  await sendEmailCode(user.email, code);

  return NextResponse.json({ ok: true });
}
