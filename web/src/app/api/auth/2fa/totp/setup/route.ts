import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { generateTotpSecret, encryptTotpSecret } from '@/lib/auth/totp';
import { SESSION_COOKIE, hashToken } from '@/lib/auth/session';
import { sessions } from '@/db/schema';
import QRCode from 'qrcode';

/** POST /api/auth/2fa/totp/setup — genera secreto TOTP y devuelve QR + URI */
export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: 'Sin sesión' }, { status: 401 });

  const session = await db.query.sessions.findFirst({ where: eq(sessions.tokenHash, hashToken(token)) });
  if (!session || session.mfaVerifiedAt) {
    return NextResponse.json({ error: 'Requiere sesión parcial activa' }, { status: 401 });
  }
  if (Date.now() - session.createdAt.getTime() > 10 * 60 * 1000) {
    return NextResponse.json({ error: 'Sesión parcial caducada' }, { status: 401 });
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

  if (user.twoFaMethod) {
    return NextResponse.json({ error: '2FA ya está configurado. Usa reset-2fa para cambiar el método.' }, { status: 409 });
  }

  const { base32, uri } = generateTotpSecret(user.email);
  const encrypted       = encryptTotpSecret(base32);

  // Guarda el secreto cifrado (aún no verificado; totp_verified sigue false)
  await db.update(users).set({ totpSecretEncrypted: encrypted }).where(eq(users.id, user.id));

  const qrDataUrl = await QRCode.toDataURL(uri);
  return NextResponse.json({ qrDataUrl, uri, base32 });
}
