import { randomBytes, createHash } from 'crypto';
import { db } from '@/db';
import { trustedDevices } from '@/db/schema';
import { eq, and, gt } from 'drizzle-orm';

export const TRUSTED_DEVICE_COOKIE  = 'trusted_device';
const TRUSTED_DEVICE_EXPIRY_MS      = 30 * 24 * 60 * 60 * 1000; // 30 días

function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createTrustedDevice(
  userId: string,
  userAgent: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token     = randomBytes(32).toString('base64url');
  const tokenHash = hashDeviceToken(token);
  const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_EXPIRY_MS);
  await db.insert(trustedDevices).values({ tokenHash, userId, expiresAt, userAgent });
  return { token, expiresAt };
}

/** Devuelve true si el token pertenece al usuario y no ha caducado. */
export async function validateTrustedDevice(token: string, userId: string): Promise<boolean> {
  const tokenHash = hashDeviceToken(token);
  const row = await db.query.trustedDevices.findFirst({ where: eq(trustedDevices.tokenHash, tokenHash) });
  if (!row) return false;
  if (row.userId !== userId) return false;
  if (new Date() > row.expiresAt) return false;
  return true;
}
