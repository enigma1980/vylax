import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { TOTP, Secret } from 'otpauth';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';

// ---------------------------------------------------------------------------
// Clave de cifrado
// ---------------------------------------------------------------------------
function getEncryptionKey(): Buffer {
  const hex = process.env.VYLAX_ENCRYPTION_KEY;
  if (!hex) throw new Error('VYLAX_ENCRYPTION_KEY no está configurada');
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    throw new Error('VYLAX_ENCRYPTION_KEY debe tener 32 bytes (64 caracteres hex). Genera una con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Cifrado AES-256-GCM: iv(12) + authTag(16) + ciphertext → base64
// ---------------------------------------------------------------------------
export function encryptTotpSecret(secret: string): string {
  const key = getEncryptionKey();
  const iv  = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc    = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptTotpSecret(encrypted: string): string {
  const key  = getEncryptionKey();
  const data = Buffer.from(encrypted, 'base64');
  const iv   = data.subarray(0, 12);
  const tag  = data.subarray(12, 28);
  const enc  = data.subarray(28);
  const dec  = createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(enc), dec.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------------
export function generateTotpSecret(label: string): { base32: string; uri: string } {
  const totp = new TOTP({ issuer: 'Vylax', label, algorithm: 'SHA1', digits: 6, period: 30 });
  return { base32: totp.secret.base32, uri: totp.toString() };
}

/** Verifica un código TOTP. Devuelve el step aceptado, o null si inválido/replay. */
export function verifyTotpCode(
  base32: string,
  token: string,
  lastStep: number | null,
): { valid: false } | { valid: true; step: number } {
  const totp  = new TOTP({ issuer: 'Vylax', label: '', algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(base32) });
  const delta = totp.validate({ token, window: 1 });
  if (delta === null) return { valid: false };
  const step = Math.floor(Date.now() / 1000 / 30) + delta;
  if (lastStep !== null && step === lastStep) return { valid: false }; // replay
  return { valid: true, step };
}

// ---------------------------------------------------------------------------
// Códigos de recuperación (8 × 8 chars base64url, mostrar una vez)
// ---------------------------------------------------------------------------
export async function generateRecoveryCodes(): Promise<{ codes: string[]; hashes: string[] }> {
  const codes  = Array.from({ length: 8 }, () => randomBytes(5).toString('base64url').toUpperCase());
  const hashes = await Promise.all(codes.map((c) => argon2Hash(c)));
  return { codes, hashes };
}

/** Intenta usar un código de recuperación. Devuelve el índice del código usado, o -1. */
export async function consumeRecoveryCode(
  storedHashes: string[],
  inputCode: string,
): Promise<number> {
  for (let i = 0; i < storedHashes.length; i++) {
    if (await argon2Verify(storedHashes[i], inputCode)) return i;
  }
  return -1;
}
