import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/db';
import { sessions, users, userOrganizations } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { generateAndStoreEmailCode, sendEmailCode, isEmailCodeRateLimited } from '@/lib/auth/email-code';
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

  // Los administradores solo pueden usar TOTP
  const memberships = await db.query.userOrganizations.findMany({ where: eq(userOrganizations.userId, user.id) });
  if (memberships.some(m => m.role === 'admin')) {
    return NextResponse.json({ error: 'Los administradores deben usar TOTP.' }, { status: 403 });
  }

  // No permitir cambiar a email si ya tiene otro método activo
  if (user.twoFaMethod && user.twoFaMethod !== 'email') {
    return NextResponse.json({ error: '2FA ya está configurado con otro método.' }, { status: 409 });
  }

  // Rate limit: mínimo 60 s entre reenvíos
  if (await isEmailCodeRateLimited(user.id)) {
    return NextResponse.json({ error: 'Espera 60 segundos antes de pedir otro código.' }, { status: 429 });
  }

  const code = await generateAndStoreEmailCode(user.id);
  await sendEmailCode(user.email, code);

  return NextResponse.json({ ok: true });
}
