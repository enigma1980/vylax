import { randomBytes, createHash } from 'crypto';
import { db } from '@/db';
import { sessions } from '@/db/schema';
import { eq, and, lt } from 'drizzle-orm';

export const SESSION_COOKIE      = 'session_token';
const FULL_EXPIRY_MS             = 8  * 60 * 60 * 1000; // 8 h
const PARTIAL_EXPIRY_MS          = 10 * 60 * 1000;       // 10 min
export const INACTIVE_TIMEOUT_MS = 8  * 60 * 60 * 1000;

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createPartialSession(
  userId: string,
  ip: string | null,
  userAgent: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token     = generateSessionToken();
  const tokenHash = hashToken(token);
  const now       = new Date();
  const expiresAt = new Date(now.getTime() + PARTIAL_EXPIRY_MS);
  await db.insert(sessions).values({ tokenHash, userId, orgId: null, mfaVerifiedAt: null, lastActiveAt: now, expiresAt, ip, userAgent });
  return { token, expiresAt };
}

export async function createFullSession(
  userId: string,
  orgId: string,
  ip: string | null,
  userAgent: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const token     = generateSessionToken();
  const tokenHash = hashToken(token);
  const now       = new Date();
  const expiresAt = new Date(now.getTime() + FULL_EXPIRY_MS);
  await db.insert(sessions).values({ tokenHash, userId, orgId, mfaVerifiedAt: now, lastActiveAt: now, expiresAt, ip, userAgent });
  return { token, expiresAt };
}

export async function findSession(token: string) {
  const tokenHash = hashToken(token);
  return db.query.sessions.findFirst({ where: eq(sessions.tokenHash, tokenHash) });
}

export async function upgradeToFull(sessionId: string, orgId: string): Promise<void> {
  await db.update(sessions).set({ mfaVerifiedAt: new Date(), orgId }).where(eq(sessions.id, sessionId));
}

export async function setSessionOrg(sessionId: string, orgId: string): Promise<void> {
  await db.update(sessions).set({ orgId }).where(eq(sessions.id, sessionId));
}

export async function touchSession(sessionId: string): Promise<void> {
  await db.update(sessions).set({ lastActiveAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function deleteUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
