import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/db';
import { users, userOrganizations, auditLog } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword, verifyPassword, getDummyHash } from '@/lib/auth/argon2';
import { createPartialSession, createFullSession, SESSION_COOKIE } from '@/lib/auth/session';
import { validateTrustedDevice, TRUSTED_DEVICE_COOKIE } from '@/lib/auth/trusted-device';

const LOCK_THRESHOLD    = 5;
const LOCK_DURATION_MS  = 15 * 60 * 1000;
const GENERIC_ERROR     = 'Correo o contraseña incorrectos.';

function getIp(req: NextRequest): string | null {
  if (process.env.TRUST_PROXY === 'true') {
    const fwd = req.headers.get('x-forwarded-for');
    if (fwd) return fwd.split(',')[0].trim();
  }
  return req.headers.get('x-real-ip') ?? null;
}

function cookieOpts(expiresAt: Date, secure: boolean) {
  return { httpOnly: true, secure, sameSite: 'strict' as const, expires: expiresAt, path: '/' };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.email || !body?.password) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  const email     = String(body.email).trim().toLowerCase();
  const password  = String(body.password);
  const ip        = getIp(req);
  const userAgent = req.headers.get('user-agent');
  const secure    = process.env.NODE_ENV === 'production';

  const user = await db.query.users.findFirst({ where: eq(users.email, email) });

  if (!user) {
    // Hash ficticio para igualar tiempo de respuesta
    await verifyPassword(await getDummyHash(), password).catch(() => {});
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  // Bloqueo activo
  const now = new Date();
  if (user.passwordLockedUntil && user.passwordLockedUntil > now) {
    await db.insert(auditLog).values({ userId: user.id, event: 'login_failed', ip, userAgent, metadata: { reason: 'locked' } });
    return NextResponse.json({ error: 'Cuenta bloqueada temporalmente. Inténtalo de nuevo en 15 minutos.' }, { status: 429 });
  }

  const valid = await verifyPassword(user.passwordHash, password).catch(() => false);

  if (!valid) {
    const attempts = user.passwordAttempts + 1;
    const lock     = attempts >= LOCK_THRESHOLD;
    await db.update(users).set({
      passwordAttempts:    attempts,
      passwordLockedUntil: lock ? new Date(now.getTime() + LOCK_DURATION_MS) : null,
      updatedAt:           now,
    }).where(eq(users.id, user.id));

    const event = lock ? 'lockout' : 'login_failed';
    await db.insert(auditLog).values({ userId: user.id, event, ip, userAgent, metadata: { attempts } });

    if (lock) return NextResponse.json({ error: 'Demasiados intentos fallidos. Cuenta bloqueada 15 minutos.' }, { status: 429 });
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  // Login correcto: resetear intentos
  await db.update(users).set({ passwordAttempts: 0, updatedAt: now }).where(eq(users.id, user.id));
  await db.insert(auditLog).values({ userId: user.id, event: 'login_ok', ip, userAgent });

  // ¿Dispositivo de confianza válido?
  const cookieStore     = await cookies();
  const deviceToken     = cookieStore.get(TRUSTED_DEVICE_COOKIE)?.value;
  const trustedDevice   = deviceToken ? await validateTrustedDevice(deviceToken, user.id) : false;

  const orgs = await db.query.userOrganizations.findMany({ where: eq(userOrganizations.userId, user.id) });

  if (trustedDevice) {
    // Sesión completa directa
    const orgId = orgs.length === 1 ? orgs[0].orgId : null;
    if (!orgId && orgs.length === 0) return NextResponse.json({ error: 'Sin organización asignada.' }, { status: 403 });

    const { token, expiresAt } = orgId
      ? await createFullSession(user.id, orgId, ip, userAgent)
      : await createPartialSession(user.id, ip, userAgent); // >1 org: parcial para seleccionar

    const res  = NextResponse.json({ next: orgId ? '/panel' : '/login/organizacion' });
    const opts = cookieOpts(expiresAt, secure);
    (await cookies()).set(SESSION_COOKIE, token, opts);
    return res;
  }

  // Sin dispositivo de confianza → sesión parcial
  const { token, expiresAt } = await createPartialSession(user.id, ip, userAgent);
  const next = !user.twoFaMethod ? '/login/configurar-2fa' : '/login/verificacion';
  const res  = NextResponse.json({ next });
  (await cookies()).set(SESSION_COOKIE, token, cookieOpts(expiresAt, secure));
  return res;
}
