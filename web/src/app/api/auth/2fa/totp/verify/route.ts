import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/db';
import { users, sessions, auditLog, userOrganizations } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { decryptTotpSecret, verifyTotpCode, generateRecoveryCodes } from '@/lib/auth/totp';
import { SESSION_COOKIE, hashToken, upgradeToFull, deleteSession } from '@/lib/auth/session';
import { createTrustedDevice, TRUSTED_DEVICE_COOKIE } from '@/lib/auth/trusted-device';

/**
 * POST /api/auth/2fa/totp/verify — primer código TOTP durante el setup.
 * Activa two_fa_method='totp', genera códigos de recuperación y completa la sesión.
 */
export async function POST(req: NextRequest) {
  const { token: inputToken, rememberDevice } = await req.json().catch(() => ({}));
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionCookie || !inputToken) return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });

  const session = await db.query.sessions.findFirst({ where: eq(sessions.tokenHash, hashToken(sessionCookie)) });
  if (!session || session.mfaVerifiedAt) return NextResponse.json({ error: 'Sin sesión parcial' }, { status: 401 });
  if (Date.now() - session.createdAt.getTime() > 10 * 60 * 1000) return NextResponse.json({ error: 'Sesión caducada' }, { status: 401 });

  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!user?.totpSecretEncrypted) return NextResponse.json({ error: 'Sin secreto TOTP configurado' }, { status: 400 });

  const base32 = decryptTotpSecret(user.totpSecretEncrypted);
  const result = verifyTotpCode(base32, String(inputToken), user.totpLastStep);

  if (!result.valid) {
    return NextResponse.json({ error: 'Código TOTP incorrecto o ya usado.' }, { status: 401 });
  }

  // Generar códigos de recuperación
  const { codes, hashes } = await generateRecoveryCodes();

  await db.update(users).set({
    twoFaMethod:   'totp',
    totpVerified:  true,
    totpLastStep:  result.step,
    recoveryCodes: hashes,
    updatedAt:     new Date(),
  }).where(eq(users.id, user.id));

  // Completar sesión
  const orgs = await db.query.userOrganizations.findMany({ where: eq(userOrganizations.userId, user.id) });
  const orgId = orgs.length === 1 ? orgs[0].orgId : null;
  await upgradeToFull(session.id, orgId ?? '');

  await db.insert(auditLog).values({
    userId: user.id, orgId: orgId ?? undefined, event: '2fa_ok',
    ip: req.headers.get('x-forwarded-for') ?? null,
    userAgent: req.headers.get('user-agent'),
    metadata: { method: 'totp_setup' },
  });

  const secure = process.env.NODE_ENV === 'production';
  const res = NextResponse.json({ next: orgId ? '/panel' : '/login/organizacion', recoveryCodes: codes });

  if (rememberDevice) {
    const { token: devToken, expiresAt } = await createTrustedDevice(user.id, req.headers.get('user-agent'));
    (await cookies()).set(TRUSTED_DEVICE_COOKIE, devToken, { httpOnly: true, secure, sameSite: 'strict', expires: expiresAt, path: '/' });
  }

  return res;
}
