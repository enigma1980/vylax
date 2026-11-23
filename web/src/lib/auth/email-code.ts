import { randomInt } from 'crypto';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { sendEmail } from '@/lib/mail';

const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 min
const MAX_ATTEMPTS   = 5;
const RESEND_WAIT_MS = 60 * 1000;       // 60 s

export async function generateAndStoreEmailCode(userId: string): Promise<string> {
  const code    = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const codeHash = await argon2Hash(code);
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);
  await db.update(users).set({ emailCodeHash: codeHash, emailCodeExpiresAt: expiresAt, emailCodeAttempts: 0 }).where(eq(users.id, userId));
  return code;
}

export async function sendEmailCode(toEmail: string, code: string): Promise<void> {
  await sendEmail({
    to:      toEmail,
    subject: 'Código de verificación Vylax',
    text:    `Tu código de verificación es: ${code}\n\nCaduca en 10 minutos. No lo compartas con nadie.`,
    html:    `<p>Tu código de verificación es:</p><h2>${code}</h2><p>Caduca en 10 minutos.</p>`,
  });
}

type VerifyResult = 'ok' | 'invalid' | 'expired' | 'too_many_attempts';

export async function verifyEmailCode(userId: string, inputCode: string): Promise<VerifyResult> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user?.emailCodeHash || !user.emailCodeExpiresAt) return 'invalid';
  if (user.emailCodeAttempts >= MAX_ATTEMPTS) return 'too_many_attempts';
  if (new Date() > user.emailCodeExpiresAt) return 'expired';

  const valid = await argon2Verify(user.emailCodeHash, inputCode);
  if (!valid) {
    const newAttempts = user.emailCodeAttempts + 1;
    await db.update(users).set({ emailCodeAttempts: newAttempts }).where(eq(users.id, userId));
    return newAttempts >= MAX_ATTEMPTS ? 'too_many_attempts' : 'invalid';
  }

  await db.update(users).set({ emailCodeHash: null, emailCodeExpiresAt: null, emailCodeAttempts: 0 }).where(eq(users.id, userId));
  return 'ok';
}
